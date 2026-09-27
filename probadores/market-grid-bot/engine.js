/*
 * Motor de backtest: port a JavaScript de "Continuous Market Grid bot" (Pine Script v6, strategy).
 *
 * Emula el broker de TradingView con los ajustes del script:
 *  - el script se evalúa al cierre de cada vela;
 *  - strategy.entry / strategy.close / strategy.close_all son órdenes a mercado y se ejecutan
 *    en la apertura de la vela siguiente (no al precio del nivel);
 *  - pyramiding = 200, close_entries_rule = "ANY" (cada nivel cierra su propia entrada);
 *  - comisión del 0,035 % del valor en cada ejecución; capital inicial 10 000.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    upperLimit: 4600, lowerLimit: 4200, gridLines: 20, qtyPerGrid: 0.1,
    useSL: false, slPrice: 3800,
    initialCapital: 10000, commissionPct: 0.035
  };

  function inferDecimals(c) {
    let dec = 0;
    for (let i = 0; i < Math.min(c.length, 300); i++) { const s = String(c[i]), p = s.indexOf('.'); if (p >= 0) dec = Math.max(dec, Math.min(8, s.length - p - 1)); }
    return dec;
  }

  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const { t, o, h, l, c } = data;
    const n = t.length;
    const G = Math.max(2, Math.round(P.gridLines));
    const step = (P.upperLimit - P.lowerLimit) / (G - 1);
    const levels = [];
    for (let k = 0; k < G; k++) levels.push(P.lowerLimit + k * step);
    const comm = P.commissionPct / 100;

    const holding = new Array(G).fill(false);
    let activated = false, activatedAt = null;
    let pending = [];            // orders placed at the previous close: {type:'entry'|'close'|'closeAll', level, placedIdx}
    const open = new Map();      // level -> lot
    const trades = [];
    let realized = 0, commissionPaid = 0, maxLots = 0, maxExposure = 0;
    const equity = new Array(n), lotsHeld = new Array(n), holdingCount = new Array(n);
    const events = [];           // for the chart: {i, type:'buy'|'sell'|'sl', level, price}
    let slHits = 0, deactivatedBars = 0;
    const levelStats = levels.slice(0, G - 1).map((p, k) => ({ k, price: p, target: levels[k + 1], buys: 0, sells: 0, pnl: 0 }));

    const closeLot = (lot, i, price, reason) => {
      const fee = price * lot.qty * comm;
      commissionPaid += fee;
      lot.exitIdx = i; lot.exitPrice = price; lot.reason = reason;
      lot.pnl = (price - lot.entryPrice) * lot.qty - lot.entryFee - fee;
      realized += (price - lot.entryPrice) * lot.qty - fee;  // entry fee already counted at the fill
      levelStats[lot.level].pnl += lot.pnl;
      levelStats[lot.level].sells++;
      open.delete(lot.level);
      events.push({ i, type: reason === 'SL Hit' ? 'sl' : 'sell', level: lot.level, price });
    };

    for (let i = 0; i < n; i++) {
      // ---- fills at the open of bar i ----
      if (pending.length) {
        for (const ord of pending) {
          if (ord.type === 'entry') {
            const fee = o[i] * P.qtyPerGrid * comm;
            commissionPaid += fee; realized -= fee;
            const lot = { level: ord.level, gridPrice: levels[ord.level], target: levels[ord.level + 1], qty: P.qtyPerGrid,
              signalIdx: ord.placedIdx, entryIdx: i, entryPrice: o[i], entryFee: fee, exitIdx: null, exitPrice: NaN, pnl: 0, reason: '' };
            open.set(ord.level, lot); trades.push(lot);
            levelStats[ord.level].buys++;
            events.push({ i, type: 'buy', level: ord.level, price: o[i] });
          } else if (ord.type === 'close') {
            const lot = open.get(ord.level);
            if (lot) closeLot(lot, i, o[i], 'TP_' + ord.level);
          } else if (ord.type === 'closeAll') {
            for (const lot of Array.from(open.values())) closeLot(lot, i, o[i], 'SL Hit');
          }
        }
        pending = [];
      }

      // ---- script at the close of bar i ----
      if (!activated && c[i] >= P.lowerLimit && c[i] <= P.upperLimit) { activated = true; if (activatedAt === null) activatedAt = i; }
      if (activated && i > 0) {
        for (let k = 0; k <= G - 2; k++) {
          const gp = levels[k], tp = levels[k + 1];
          const hitBuy = l[i] <= gp && h[i - 1] >= gp;
          if (hitBuy && !holding[k]) {
            pending.push({ type: 'entry', level: k, placedIdx: i });
            holding[k] = true;
          } else {
            const hitSell = h[i] >= tp && l[i - 1] <= tp;
            if (hitSell && holding[k]) {
              pending.push({ type: 'close', level: k, placedIdx: i });
              holding[k] = false;
            }
          }
        }
      }
      if (!activated) deactivatedBars++;
      if (P.useSL && c[i] <= P.slPrice) {
        if (activated || open.size) slHits++;
        pending = [{ type: 'closeAll', placedIdx: i }];   // strategy.cancel_all() + strategy.close_all()
        activated = false;
        holding.fill(false);
      }

      let unreal = 0, qty = 0;
      for (const lot of open.values()) { unreal += (c[i] - lot.entryPrice) * lot.qty; qty += lot.qty; }
      equity[i] = P.initialCapital + realized + unreal;
      lotsHeld[i] = open.size;
      holdingCount[i] = holding.reduce((s, x) => s + (x ? 1 : 0), 0);
      if (open.size > maxLots) maxLots = open.size;
      if (qty * c[i] > maxExposure) maxExposure = qty * c[i];
    }

    const closed = trades.filter(x => x.exitIdx !== null);
    const wins = closed.filter(x => x.pnl > 0);
    const gp = wins.reduce((s, x) => s + x.pnl, 0), gl = -closed.filter(x => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
    let peak = -Infinity, maxDd = 0, maxDdPct = 0;
    for (const e of equity) { if (e > peak) peak = e; const d = peak - e; if (d > maxDd) maxDd = d; if (peak > 0 && d / peak > maxDdPct) maxDdPct = d / peak; }
    const openLots = trades.filter(x => x.exitIdx === null);
    const unrealized = n ? openLots.reduce((s, x) => s + (c[n - 1] - x.entryPrice) * x.qty, 0) : 0;
    const avg = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN;
    // Execution gap: how far market fills land from the grid prices they react to
    const buyGap = avg(trades.map(x => x.entryPrice - x.gridPrice));
    const sellGap = avg(closed.filter(x => x.reason.startsWith('TP')).map(x => x.exitPrice - x.target));
    let inRange = 0;
    for (let i = 0; i < n; i++) if (c[i] >= P.lowerLimit && c[i] <= P.upperLimit) inRange++;

    return {
      params: P, n, decimals: inferDecimals(c), levels, step, trades, events, equity, lotsHeld, holdingCount, levelStats,
      stats: {
        netProfit: equity[n - 1] - P.initialCapital, netProfitPct: (equity[n - 1] - P.initialCapital) / P.initialCapital * 100,
        realized, unrealized, commissionPaid,
        trades: closed.length, entries: trades.length, wins: wins.length,
        winRate: closed.length ? wins.length / closed.length * 100 : NaN,
        profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN),
        maxDd, maxDdPct: maxDdPct * 100,
        openLots: openLots.length, maxLots, maxExposure,
        buyGap, sellGap, slHits,
        activatedAt, inRangePct: n ? inRange / n * 100 : 0,
        buyHoldPct: n ? (c[n - 1] - c[0]) / c[0] * 100 : NaN,
        gridProfitPerCycle: step * P.qtyPerGrid
      }
    };
  }

  // ---------- sample data: synthetic gold-like prices, 1 hour bars ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let q = Math.imul(a ^ a >>> 15, 1 | a);
      q = q + Math.imul(q ^ q >>> 7, 61 | q) ^ q;
      return ((q ^ q >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeSample(seed, weeks) {
    const rnd = mulberry32(seed >>> 0);
    const gauss = () => { let u = 0, w = 0; while (u === 0) u = rnd(); while (w === 0) w = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
    const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
    const t0 = Date.UTC(2026, 3, 6), step = 3600000, total = (weeks || 20) * 7 * 24;
    let price = 4400, anchor = 4400, logVol = 0;
    for (let k = 0; k < total; k++) {
      const tt = t0 + k * step, d = new Date(tt), dow = d.getUTCDay(), hr = d.getUTCHours();
      if (dow === 0 || dow === 6) continue;
      const season = hr >= 12 && hr < 17 ? 1.4 : hr >= 7 && hr < 12 ? 1.1 : 0.7;
      logVol += 0.06 * gauss() - 0.02 * logVol;
      anchor += gauss() * 4;
      const sigma = 0.0022 * price * season * Math.exp(logVol);
      const open = price + gauss() * sigma * 0.05;
      let p = open, hi = open, lo = open;
      for (let s = 0; s < 6; s++) {
        p += 0.004 * (anchor - p) / 6 + gauss() * sigma / Math.sqrt(6);
        if (p > hi) hi = p; if (p < lo) lo = p;
      }
      const r2 = x => Math.round(x * 100) / 100;
      out.t.push(tt); out.o.push(r2(open)); out.h.push(r2(hi)); out.l.push(r2(lo)); out.c.push(r2(p));
      out.v.push(Math.round((hi - lo) * 40 * (0.7 + 0.6 * rnd())));
      price = p;
    }
    return out;
  }

  function parseCSV(text) {
    const lines = text.replace(/\r/g, '').split('\n').filter(x => x.trim());
    if (lines.length < 2) throw new Error('El archivo tiene menos de dos líneas.');
    const delim = [',', ';', '\t'].map(d => [d, lines[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const head = lines[0].split(delim).map(x => x.trim().replace(/^<|>$/g, '').replace(/^"|"$/g, '').toLowerCase());
    const find = names => head.findIndex(x => names.includes(x));
    const iT = find(['time', 'timestamp', 'datetime', 'date', 'fecha']);
    const iTime2 = head.indexOf('time') !== iT ? head.indexOf('time') : -1;
    const iO = find(['open', 'apertura']), iH = find(['high', 'máximo', 'maximo']);
    const iL = find(['low', 'mínimo', 'minimo']), iC = find(['close', 'cierre']);
    if ([iT, iO, iH, iL, iC].some(x => x < 0)) throw new Error('Faltan columnas. Se necesitan: time, open, high, low, close.');
    const parseTime = (a, b) => {
      let s = (a || '').replace(/^"|"$/g, '').trim();
      if (b !== undefined) s += ' ' + b.replace(/^"|"$/g, '').trim();
      if (/^\d+(\.\d+)?$/.test(s)) { const x = +s; return x < 1e12 ? x * 1000 : x; }
      s = s.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3').replace(' ', 'T');
      if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += (s.includes('T') ? '' : 'T00:00') + 'Z';
      return Date.parse(s);
    };
    const rows = [];
    for (let k = 1; k < lines.length; k++) {
      const p = lines[k].split(delim);
      const tt = parseTime(p[iT], iTime2 >= 0 ? p[iTime2] : undefined);
      const r = [tt, +p[iO], +p[iH], +p[iL], +p[iC]];
      if (r.every(x => isFinite(x))) rows.push(r);
    }
    if (rows.length < 20) throw new Error('Se leyeron ' + rows.length + ' velas válidas; hacen falta al menos 20.');
    rows.sort((a, b) => a[0] - b[0]);
    const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
    for (const r of rows) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(0); }
    return out;
  }

  const api = { DEFAULTS, run, makeSample, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineGrid = api;
})(typeof window !== 'undefined' ? window : this);
