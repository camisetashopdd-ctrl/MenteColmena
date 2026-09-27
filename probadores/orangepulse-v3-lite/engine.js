/*
 * Motor de backtest: port a JavaScript de "OrangePulse v3.0 Lite" (Pine Script v6, strategy).
 *
 * Emula el broker de TradingView con los ajustes del script:
 *  - process_orders_on_close = true: strategy.entry y strategy.close_all se ejecutan al CIERRE
 *    de la misma vela en la que se evalúa el script (no en la apertura siguiente);
 *  - la posición (strategy.position_size / position_avg_price) cambia después de esa ejecución,
 *    así que el script la ve distinta a partir de la vela siguiente;
 *  - pyramiding = 4 (BO + 3 SO), cantidades fijas en USD / cierre, capital 10 000, sin comisiones.
 * Simplificación: calc_on_order_fills = true haría que TradingView volviera a ejecutar el script
 * después de cada ejecución en la misma vela; aquí el script se evalúa una vez por vela.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    startTime: Date.UTC(2025, 0, 21), endTime: Date.UTC(2050, 0, 1),
    direction: 'LONG',
    boUsd: 1000, soUsd: 1000,
    soNumber: 3, pdPct: 3.0, vs: 2.0, sc: 1.25, cooldownAfterBo: 2, soCooldownBars: 1,
    useTp: true, tpPct: 1, useSl: false, slPct: 3.0,
    useTrailTp: false, trailActivationPct: 1.0, trailDistancePct: 0.5,
    bbLen: 20, bbMult: 2.0, rsiOversold: 50, rsiOverbought: 70, rsiLen: 14,
    initialCapital: 10000, mintick: 0.01
  };

  function nanArr(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = NaN; return a; }
  function sma(src, len) {
    const n = src.length, out = nanArr(n); let s = 0;
    for (let i = 0; i < n; i++) { s += src[i]; if (i >= len) s -= src[i - len]; if (i >= len - 1) out[i] = s / len; }
    return out;
  }
  function stdev(src, len, mean) {
    const n = src.length, out = nanArr(n);
    for (let i = len - 1; i < n; i++) { let s = 0; for (let k = i - len + 1; k <= i; k++) { const d = src[k] - mean[i]; s += d * d; } out[i] = Math.sqrt(s / len); }
    return out;
  }
  function rma(src, len) {
    const n = src.length, out = nanArr(n), a = 1 / len; let prev = NaN, sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const x = src[i];
      if (isNaN(prev)) { if (isNaN(x)) { sum = 0; cnt = 0; continue; } sum += x; cnt++; if (cnt >= len) { prev = sum / len; out[i] = prev; } }
      else { prev = a * x + (1 - a) * prev; out[i] = prev; }
    }
    return out;
  }
  function rsiSeries(c, len) {
    const n = c.length, up = nanArr(n), dn = nanArr(n);
    for (let i = 1; i < n; i++) { const d = c[i] - c[i - 1]; up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0); }
    const u = rma(up, len), d = rma(dn, len);
    return u.map((x, i) => isNaN(x) || isNaN(d[i]) ? NaN : d[i] === 0 ? 100 : x === 0 ? 0 : 100 - 100 / (1 + x / d[i]));
  }
  function inferDecimals(c) {
    let dec = 0;
    for (let i = 0; i < Math.min(c.length, 300); i++) { const s = String(c[i]), p = s.indexOf('.'); if (p >= 0) dec = Math.max(dec, Math.min(8, s.length - p - 1)); }
    return dec;
  }

  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const { t, o, h, l, c } = data;
    const n = t.length, LONG = P.direction === 'LONG', dirSign = LONG ? 1 : -1;
    const tick = P.mintick > 0 ? P.mintick : 0.01;
    const toTick = p => Math.round(p / tick) * tick;
    const basis = sma(c, P.bbLen), dev = stdev(c, P.bbLen, basis).map(x => x * P.bbMult);
    const upper = basis.map((x, i) => x + dev[i]), lower = basis.map((x, i) => x - dev[i]);
    const rsi = rsiSeries(c, P.rsiLen);
    const soN = Math.max(0, Math.min(3, Math.round(P.soNumber)));

    // broker
    let qty = 0, avg = NaN, cost = 0, realized = 0, cycle = null;
    const cycles = [], fills = [];
    // script state (var)
    let ladderActive = false, boRef = NaN, soPrices = [], soUsds = [], soFilled = [];
    let lastEntryBar = NaN, lastSOBar = NaN, soNext = 0, lastSoFill = NaN;
    let hh = NaN, ll = NaN, trailArmed = false;
    // per-bar output
    const equity = new Array(n), avgPlot = nanArr(n), tpPlot = nanArr(n), slPlot = nanArr(n), trailPlot = nanArr(n);
    const nextSoPlot = nanArr(n), avgAfter = nanArr(n), soCount = new Array(n).fill(0), invested = new Array(n).fill(0), signal = new Array(n).fill(false), inPosArr = new Array(n).fill(false);
    let maxInvested = 0, peak = -Infinity, maxDd = 0, maxDdPct = 0;

    const buildLadder = base => {
      soPrices = []; soUsds = []; soFilled = [];
      let prev = base, usd = P.soUsd;
      for (let k = 0; k < soN; k++) {
        const step = P.pdPct * Math.pow(P.sc, k), delta = prev * step / 100;
        let pq = toTick(LONG ? prev - delta : prev + delta);
        if (LONG ? pq >= prev : pq <= prev) pq = LONG ? prev - tick : prev + tick;
        soPrices.push(pq); soUsds.push(usd); soFilled.push(false);
        prev = pq; usd *= P.vs;
      }
    };
    const fill = (i, kind, usd, price) => {
      const q = usd / price;
      if (qty === 0) { cycle = { start: i, fills: [], maxAdverse: 0, exitIdx: null }; cycles.push(cycle); }
      cost += q * price; qty += q; avg = cost / qty;
      cycle.fills.push({ i, kind, usd, price, q });
      fills.push({ i, kind, price });
    };
    const closeAll = (i, price, reason, tpLevel) => {
      const pnl = dirSign * (price - avg) * qty;
      realized += pnl;
      Object.assign(cycle, { exitIdx: i, exitPrice: price, reason, pnl, pnlPct: pnl / cost * 100, avg, invested: cost, tpLevel });
      fills.push({ i, kind: 'EXIT', price, reason });
      qty = 0; cost = 0; avg = NaN; cycle = null;
    };

    for (let i = 0; i < n; i++) {
      // ---- script at the close of bar i (position as it stood before this bar's orders) ----
      const inPos = qty !== 0, posAvg = avg;
      inPosArr[i] = inPos;
      const inWin = t[i] >= P.startTime && t[i] <= P.endTime;
      const touchL = c[i] <= lower[i] || l[i] <= lower[i], touchS = c[i] >= upper[i] || h[i] >= upper[i];
      const sigL = touchL && rsi[i] < P.rsiOversold, sigS = touchS && rsi[i] > P.rsiOverbought;
      const entrySignal = LONG ? sigL : sigS;

      let tpPrice = NaN, slPrice = NaN;
      if (inPos) {
        tpPrice = posAvg * (1 + dirSign * P.tpPct / 100);
        slPrice = posAvg * (1 - dirSign * P.slPct / 100);
        if (LONG) hh = isNaN(hh) ? h[i] : Math.max(hh, h[i]); else ll = isNaN(ll) ? l[i] : Math.min(ll, l[i]);
      }
      let trailTrig = NaN;
      if (inPos && P.useTrailTp) {
        const act = posAvg * (1 + dirSign * P.trailActivationPct / 100);
        if (LONG ? h[i] >= act : l[i] <= act) trailArmed = true;
        if (trailArmed) trailTrig = LONG ? (isNaN(hh) ? NaN : hh * (1 - P.trailDistancePct / 100)) : (isNaN(ll) ? NaN : ll * (1 + P.trailDistancePct / 100));
      }
      const tpT = P.useTp && inPos && !P.useTrailTp && (LONG ? h[i] >= tpPrice : l[i] <= tpPrice);
      const slT = P.useSl && inPos && (LONG ? l[i] <= slPrice : h[i] >= slPrice);
      const trT = P.useTrailTp && inPos && trailArmed && isFinite(trailTrig) && (LONG ? c[i] <= trailTrig : c[i] >= trailTrig);
      const willExit = tpT || slT || trT;

      const orders = [];
      if (willExit) {
        orders.push({ type: 'exit', reason: tpT ? 'TP' : slT ? 'SL' : 'Trail TP', level: tpT ? tpPrice : slT ? slPrice : trailTrig });
        ladderActive = false; boRef = NaN; soNext = 0; lastSOBar = NaN; lastSoFill = NaN;
        soPrices = []; soUsds = []; soFilled = []; hh = NaN; ll = NaN; trailArmed = false;
      }
      const canEnter = inWin && !inPos && !willExit;
      signal[i] = entrySignal && canEnter;
      if (canEnter && entrySignal && c[i] > 0) {
        orders.push({ type: 'entry', kind: 'BO', usd: P.boUsd });
        lastEntryBar = i; boRef = c[i];
        if (soN > 0) { buildLadder(boRef); ladderActive = true; soNext = 0; lastSOBar = NaN; lastSoFill = NaN; }
        hh = NaN; ll = NaN; trailArmed = false;
      }
      if (ladderActive && inPos && inWin && soN > 0 && !willExit && soNext < soPrices.length) {
        const lvl = soPrices[soNext];
        const touched = LONG ? l[i] <= lvl : h[i] >= lvl;
        const ref = isNaN(lastSoFill) ? boRef : lastSoFill;
        const gL = isNaN(ref) ? lvl : Math.min(lvl, ref - tick), gS = isNaN(ref) ? lvl : Math.max(lvl, ref + tick);
        const mono = LONG ? c[i] <= gL : c[i] >= gS;
        const cdOk = isNaN(lastSOBar) || i - lastSOBar >= P.soCooldownBars + 1;
        const boCdOk = soNext === 0 ? (isNaN(lastEntryBar) || i - lastEntryBar >= P.cooldownAfterBo + 1) : true;
        if (cycle) {
          if (touched && !(cdOk && boCdOk && mono)) cycle.blockedSO = (cycle.blockedSO || 0) + 1;
        }
        if (touched && cdOk && boCdOk && mono) {
          orders.push({ type: 'entry', kind: 'SO' + (soNext + 1), usd: soUsds[soNext] });
          soFilled[soNext] = true; soNext++; lastSOBar = i; lastSoFill = c[i];
          trailArmed = false; if (LONG) hh = c[i]; else ll = c[i];
        }
      }
      // clear ladder when flat (not on the BO/SO bar)
      if (!inPos && ladderActive && (isNaN(lastEntryBar) || i > lastEntryBar) && (isNaN(lastSOBar) || i > lastSOBar)) {
        ladderActive = false; soPrices = []; soUsds = []; soFilled = []; soNext = 0; lastSOBar = NaN; lastSoFill = NaN;
      }
      if (ladderActive && soNext < soPrices.length) nextSoPlot[i] = soPrices[soNext];
      if (inPos) { avgPlot[i] = posAvg; if (P.useTp && !P.useTrailTp) tpPlot[i] = tpPrice; if (P.useSl) slPlot[i] = slPrice; if (P.useTrailTp && trailArmed) trailPlot[i] = trailTrig; }

      // ---- broker: process_orders_on_close -> fills at c[i] ----
      for (const od of orders) {
        if (od.type === 'exit') { if (qty !== 0) closeAll(i, c[i], od.reason, od.level); }
        else fill(i, od.kind, od.usd, c[i]);
      }
      if (cycle) cycle.maxAdverse = Math.max(cycle.maxAdverse, dirSign * (avg - (LONG ? l[i] : h[i])) * qty);
      invested[i] = cost; avgAfter[i] = avg; soCount[i] = cycle ? cycle.fills.length - 1 : 0;
      if (cost > maxInvested) maxInvested = cost;
      const eq = P.initialCapital + realized + (qty ? dirSign * (c[i] - avg) * qty : 0);
      equity[i] = eq;
      if (eq > peak) peak = eq;
      if (peak - eq > maxDd) maxDd = peak - eq;
      if ((peak - eq) / peak > maxDdPct) maxDdPct = (peak - eq) / peak;
    }

    const closed = cycles.filter(x => x.exitIdx !== null);
    const wins = closed.filter(x => x.pnl > 0);
    const gp = wins.reduce((s, x) => s + x.pnl, 0), gl = -closed.filter(x => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
    const tpExits = closed.filter(x => x.reason === 'TP');
    const soUse = [0, 0, 0, 0];
    closed.forEach(x => { soUse[Math.min(3, x.fills.length - 1)]++; });
    const openCycle = cycles.find(x => x.exitIdx === null) || null;
    const last = n ? equity[n - 1] : P.initialCapital;
    let barsIn = 0; for (const x of inPosArr) if (x) barsIn++;
    const stats = {
      trades: closed.length, wins: wins.length, winRate: closed.length ? wins.length / closed.length * 100 : NaN,
      netProfit: last - P.initialCapital, netProfitPct: (last - P.initialCapital) / P.initialCapital * 100,
      realized, openPnl: last - P.initialCapital - realized,
      profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN),
      maxDd, maxDdPct: maxDdPct * 100, maxInvested,
      tpExits: tpExits.length, tpBelowLevel: tpExits.filter(x => LONG ? x.exitPrice < x.tpLevel : x.exitPrice > x.tpLevel).length,
      tpLosses: tpExits.filter(x => x.pnl <= 0).length,
      avgTpGap: tpExits.length ? tpExits.reduce((s, x) => s + (x.exitPrice - x.tpLevel) / x.tpLevel * 100, 0) / tpExits.length : NaN,
      soUse, fullLadder: soUse[3], timeInPosPct: n ? barsIn / n * 100 : 0,
      worstAdverse: cycles.reduce((m, x) => Math.max(m, x.maxAdverse), 0),
      buyHoldPct: n ? (c[n - 1] - c[0]) / c[0] * 100 : 0,
      openCycle: openCycle ? { invested: openCycle.fills.reduce((s, f) => s + f.usd, 0), sos: openCycle.fills.length - 1 } : null
    };
    return { params: P, n, soN, decimals: inferDecimals(c), avgAfter, soCount, basis, upper, lower, rsi, equity, avgPlot, tpPlot, slPlot, trailPlot, nextSoPlot, invested, signal, cycles, fills, stats };
  }

  // ---------- sample data (synthetic, BTCUSD-like, 1 hour, 24/7) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeSample(seed, weeks) {
    const rnd = mulberry32(seed >>> 0);
    const gauss = () => { let u = 0, w = 0; while (u === 0) u = rnd(); while (w === 0) w = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
    const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
    const t0 = Date.UTC(2026, 0, 5), total = (weeks || 10) * 7 * 24;
    let price = 95000, logVol = 0, drift = 0;
    for (let k = 0; k < total; k++) {
      const t = t0 + k * 3600000, hr = new Date(t).getUTCHours();
      const season = hr >= 13 && hr < 21 ? 1.3 : hr >= 7 && hr < 13 ? 1.0 : 0.75;
      logVol += 0.08 * gauss() - 0.03 * logVol;
      if (rnd() < 0.02) drift = gauss() * 0.0009;
      drift *= 0.99;
      const sigma = 0.0045 * season * Math.exp(logVol);
      const open = price;
      let p = open, hi = open, lo = open;
      for (let s = 0; s < 6; s++) { p *= 1 + drift / 6 + gauss() * sigma / Math.sqrt(6); if (p > hi) hi = p; if (p < lo) lo = p; }
      const r2 = x => Math.round(x * 100) / 100;
      out.t.push(t); out.o.push(r2(open)); out.h.push(r2(hi)); out.l.push(r2(lo)); out.c.push(r2(p));
      out.v.push(Math.round((hi - lo) / price * 2e4 * (0.6 + 0.8 * rnd())));
      price = p;
    }
    return out;
  }

  // ---------- CSV import ----------
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
    if (rows.length < 50) throw new Error('Se leyeron ' + rows.length + ' velas válidas; hacen falta al menos 50.');
    rows.sort((a, b) => a[0] - b[0]);
    const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
    for (const r of rows) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(0); }
    return out;
  }

  const api = { DEFAULTS, run, makeSample, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineOrangePulse = api;
})(typeof window !== 'undefined' ? window : this);
