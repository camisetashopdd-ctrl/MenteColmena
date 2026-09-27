/*
 * Motor de backtest: port a JavaScript de "UT Bot Stochastic RSI" (Pine Script v5).
 *
 * El indicador ejecuta 8 variantes de la señal de compra a la vez (sin filtro, FRAMA,
 * Estocástico, RSI y sus combinaciones), hace un backtest de cada una (solo largos,
 * 1000 $ por operación, entrada y salida al cierre) y en cada vela usa la compra y la venta
 * de la variante que lleva más beneficio (o mejor % de acierto) hasta esa vela. Después
 * hace otro backtest con esas señales combinadas: es el que muestra su tabla.
 * Este motor reproduce las 8 variantes, la elección vela a vela y el backtest final.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    N: 26, distance: 1.5,
    optimizationMetric: 'Profit', atrSensitivity: 2, atrPeriod: 3,
    emaFastPeriod: 10, emaSlowPeriod: 20, lowRiskEntry: false,
    initialCapital: 1000
  };

  const VARIANTS = [
    { name: 'Sin filtro', rsi: false, stoch: false, frama: false },
    { name: 'FRAMA', rsi: false, stoch: false, frama: true },
    { name: 'Estocástico', rsi: false, stoch: true, frama: false },
    { name: 'Estocástico + FRAMA', rsi: false, stoch: true, frama: true },
    { name: 'RSI', rsi: true, stoch: false, frama: false },
    { name: 'RSI + FRAMA', rsi: true, stoch: false, frama: true },
    { name: 'RSI + Estocástico', rsi: true, stoch: true, frama: false },
    { name: 'RSI + Estocástico + FRAMA', rsi: true, stoch: true, frama: true }
  ];

  const nanArr = n => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = NaN; return a; };
  function smooth(src, len, alpha) {
    const n = src.length, out = nanArr(n);
    let prev = NaN, sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const x = src[i];
      if (isNaN(prev)) {
        if (isNaN(x)) { sum = 0; cnt = 0; continue; }
        sum += x; cnt++;
        if (cnt >= len) { prev = sum / len; out[i] = prev; }
      } else { if (!isNaN(x)) prev = alpha * x + (1 - alpha) * prev; out[i] = prev; }
    }
    return out;
  }
  const ema = (s, len) => smooth(s, len, 2 / (len + 1));
  const rma = (s, len) => smooth(s, len, 1 / len);
  function sma(src, len) {
    const n = src.length, out = nanArr(n);
    let sum = 0, bad = 0;
    for (let i = 0; i < n; i++) {
      const x = src[i];
      if (isNaN(x)) bad++; else sum += x;
      if (i >= len) { const y = src[i - len]; if (isNaN(y)) bad--; else sum -= y; }
      if (i >= len - 1 && bad === 0) out[i] = sum / len;
    }
    return out;
  }
  const trueRange = (h, l, c) => h.map((x, i) => i === 0 ? x - l[i] : Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  const atr = (h, l, c, len) => rma(trueRange(h, l, c), len);
  function rollExt(src, len, isMax) {
    const n = src.length, out = nanArr(n);
    for (let i = len - 1; i < n; i++) {
      let m = isMax ? -Infinity : Infinity;
      for (let k = i - len + 1; k <= i; k++) { const x = src[k]; if (isMax ? x > m : x < m) m = x; }
      out[i] = m;
    }
    return out;
  }
  function rsi(src, len) {
    const ch = src.map((x, i) => i === 0 ? NaN : x - src[i - 1]);
    const up = rma(ch.map(x => isNaN(x) ? NaN : Math.max(x, 0)), len), dn = rma(ch.map(x => isNaN(x) ? NaN : Math.max(-x, 0)), len);
    return up.map((u, i) => isNaN(u) || isNaN(dn[i]) ? NaN : dn[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / dn[i]));
  }
  function inferDecimals(c) {
    let dec = 0;
    for (let i = 0; i < Math.min(c.length, 300); i++) { const s = String(c[i]), p = s.indexOf('.'); if (p >= 0) dec = Math.max(dec, Math.min(8, s.length - p - 1)); }
    return dec;
  }

  // FRAMA channel (BigBeluga), as written in the script
  function frama(h, l, N, distance) {
    const n = h.length, price = h.map((x, i) => (x + l[i]) / 2);
    const vol = sma(h.map((x, i) => x - l[i]), 200);
    const hN = rollExt(h, N, true), lN = rollExt(l, N, false);
    const half = Math.floor(N / 2);
    const filt = nanArr(n), inputs = nanArr(n), up = nanArr(n), dn = nanArr(n);
    let prev = NaN;
    for (let i = 0; i < n; i++) {
      const N3 = (hN[i] - lN[i]) / N;
      let HH = h[i], LL = l[i];
      for (let k = 0; k <= half - 1; k++) { const j = i - k; if (j < 0) continue; if (h[j] > HH) HH = h[j]; if (l[j] < LL) LL = l[j]; }
      const N1 = (HH - LL) / half;
      HH = i - half >= 0 ? h[i - half] : NaN; LL = i - half >= 0 ? l[i - half] : NaN;
      for (let k = half; k <= N - 1; k++) { const j = i - k; if (j < 0) continue; if (h[j] > HH) HH = h[j]; if (l[j] < LL) LL = l[j]; }
      const N2 = (HH - LL) / half;
      let dimen = 0;
      if (N1 > 0 && N2 > 0 && N3 > 0) dimen = (Math.log(N1 + N2) - Math.log(N3)) / Math.log(2);
      const alpha = Math.max(Math.min(Math.exp(-4.6 * (dimen - 1)), 1), 0.01);
      const raw = isNaN(prev) ? price[i] : alpha * price[i] + (1 - alpha) * prev;
      inputs[i] = i < N + 1 ? price[i] : raw;
      if (i >= 4) { let s = 0; for (let k = i - 4; k <= i; k++) s += inputs[k]; filt[i] = s / 5; }
      prev = filt[i];
      up[i] = filt[i] + vol[i] * distance; dn[i] = filt[i] - vol[i] * distance;
    }
    return { filt, up, dn };
  }

  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const { t, o, h, l, c } = data;
    const n = t.length;
    const cap = P.initialCapital;

    // UT trailing stop (nz(stop[1], 0) form)
    const xATR = atr(h, l, c, P.atrPeriod);
    const trail = nanArr(n);
    for (let i = 0; i < n; i++) {
      const pr = i > 0 && !isNaN(trail[i - 1]) ? trail[i - 1] : 0, c1 = i > 0 ? c[i - 1] : NaN, loss = P.atrSensitivity * xATR[i];
      trail[i] = c[i] > pr && c1 > pr ? Math.max(pr, c[i] - loss)
        : c[i] < pr && c1 < pr ? Math.min(pr, c[i] + loss)
        : c[i] > pr ? c[i] - loss : c[i] + loss;
    }
    const crossUp = c.map((x, i) => i > 0 && x > trail[i] && c[i - 1] <= trail[i - 1]);
    const crossDn = c.map((x, i) => i > 0 && trail[i] > x && trail[i - 1] <= c[i - 1]);

    // Filters
    const F = frama(h, l, P.N, P.distance);
    const hlc3 = c.map((x, i) => (h[i] + l[i] + x) / 3);
    const framaOk = hlc3.map((x, i) => x > F.up[i]);
    const r = rsi(c, 14), er = ema(r, 14);
    const rsiOk = r.map((x, i) => x >= 50 && x > er[i] && er[i] > 40);
    const hh = rollExt(h, 14, true), ll = rollExt(l, 14, false);
    const stoch = c.map((x, i) => 100 * (x - ll[i]) / (hh[i] - ll[i]));
    const k = sma(stoch, 3), d = sma(k, 3);
    const stochOk = k.map((x, i) => x > d[i] && d[i] < 60);
    const e50 = ema(c, 50), e200 = ema(c, 200);
    const ema50x200 = e50.map((x, i) => x > e200[i]);
    const emaFast = ema(c, P.emaFastPeriod), emaSlow = ema(c, P.emaSlowPeriod);

    // Per-variant state
    const mkState = () => ({ green: false, open: false, entry: NaN, qty: 0, profit: 0, profitPct: 0, winrate: 0, wins: 0, losses: 0, entries: 0, exits: 0, buys: 0, selected: 0 });
    const vs = VARIANTS.map(mkState);
    const low = mkState(); // low-risk entry variant (EMA 50 > 200)
    const step = (s, i, buySig) => {
      if (c[i] <= trail[i]) s.green = false;
      const buy = c[i] > trail[i] && buySig && !s.green;
      if (buy) { s.green = true; s.buys++; }
      const sell = crossDn[i];
      if (!s.open && buy) { s.open = true; s.entry = c[i]; s.qty = cap / c[i]; s.entries++; }
      if (s.open && sell) {
        s.open = false;
        if (c[i] > s.entry) s.wins++; else s.losses++;
        s.winrate = Math.round(s.wins / (s.wins + s.losses) * 10000) / 100;
        s.profit += s.qty * c[i] - cap; s.profitPct = s.profit / cap * 100; s.exits++;
      }
      return { buy, sell };
    };
    const buySignal = (i, useR, useS, useF, use5x2) => {
      let b = true;
      if (useR) b = b && rsiOk[i];
      if (useS) b = b && stochOk[i];
      if (use5x2) b = b && ema50x200[i];
      if (!useR && !useS && !use5x2) b = crossUp[i];
      if (useF) b = b && framaOk[i];
      return b;
    };

    // Combined backtest
    const best = new Array(n).fill(-1);
    const trades = [];
    const comb = { open: false, entry: NaN, qty: 0, profit: 0, wins: 0, losses: 0, entries: 0, exits: 0 };
    let cur = null;
    const equity = new Array(n).fill(cap);
    let firstPrice = NaN;
    for (let i = 0; i < n; i++) {
      if (isNaN(firstPrice)) firstPrice = c[i];
      let bestProfit = -100000, bestWinrate = 0, bBuy = false, bSell = false, bIdx = -1, bFlags = [false, false, false];
      for (let v = 0; v < VARIANTS.length; v++) {
        const V = VARIANTS[v], s = vs[v];
        const sig = step(s, i, buySignal(i, V.rsi, V.stoch, V.frama, false));
        const better = P.optimizationMetric === 'Profit' ? s.profitPct > bestProfit : s.winrate > bestWinrate;
        if (better) { bestProfit = s.profitPct; bestWinrate = s.winrate; bBuy = sig.buy; bSell = sig.sell; bIdx = v; bFlags = [V.rsi, V.stoch, V.frama]; }
      }
      if (P.lowRiskEntry) {
        const sig = step(low, i, buySignal(i, bFlags[0], bFlags[1], bFlags[2], true));
        const better = P.optimizationMetric === 'Profit' ? low.profitPct > bestProfit : low.winrate > bestWinrate;
        if (better) { bBuy = sig.buy; bSell = sig.sell; bIdx = VARIANTS.length; }
      }
      best[i] = bIdx;
      if (bIdx >= 0) (bIdx < VARIANTS.length ? vs[bIdx] : low).selected++;
      if (!comb.open && bBuy) {
        comb.open = true; comb.entry = c[i]; comb.qty = cap / c[i]; comb.entries++;
        cur = { idx: i, entry: c[i], variant: bIdx, exitIdx: null, exitPrice: NaN, pnl: 0, pct: 0 };
        trades.push(cur);
      }
      if (comb.open && bSell) {
        comb.open = false;
        if (c[i] > comb.entry) comb.wins++; else comb.losses++;
        const pnl = comb.qty * c[i] - cap;
        comb.profit += pnl; comb.exits++;
        cur.exitIdx = i; cur.exitPrice = c[i]; cur.pnl = pnl; cur.pct = (c[i] - cur.entry) / cur.entry * 100; cur.exitVariant = bIdx;
      }
      equity[i] = cap + comb.profit + (comb.open ? comb.qty * c[i] - cap : 0);
    }
    const stockGrowth = n ? (c[n - 1] - firstPrice) / firstPrice * 100 : NaN;
    let peak = -Infinity, maxDd = 0;
    for (const e of equity) { if (e > peak) peak = e; if (peak - e > maxDd) maxDd = peak - e; }
    const closed = trades.filter(x => x.exitIdx !== null);
    const winrate = comb.wins + comb.losses ? Math.round(comb.wins / (comb.wins + comb.losses) * 10000) / 100 : 0;
    const switches = best.reduce((s, x, i) => s + (i > 0 && x !== best[i - 1] ? 1 : 0), 0);

    const variantRows = VARIANTS.map((V, v) => Object.assign({ name: V.name, flags: V }, vs[v]));
    if (P.lowRiskEntry) variantRows.push(Object.assign({ name: 'Entrada de bajo riesgo (EMA 50 > 200)', flags: {} }, low));

    return {
      params: P, n, decimals: inferDecimals(c), trail, crossUp, crossDn, frama: F, emaFast, emaSlow,
      best, trades, equity, variants: variantRows,
      stats: {
        initialCapital: cap,
        closeBalance: comb.exits ? cap + comb.profit : NaN,
        profit: comb.profit, profitPct: comb.profit / cap * 100,
        stockGrowth, entries: comb.entries, trades: comb.entries, exits: comb.exits, wins: comb.wins, losses: comb.losses, winrate,
        openPnl: comb.open ? comb.qty * c[n - 1] - cap : 0,
        maxDd, switches,
        bestHindsight: variantRows.reduce((a, b) => b.profitPct > a.profitPct ? b : a, variantRows[0])
      }
    };
  }

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
    const t0 = Date.UTC(2026, 5, 1), step = 15 * 60000, total = (weeks || 10) * 7 * 96;
    let price = 1.0850, logVol = 0, drift = 0;
    for (let k = 0; k < total; k++) {
      const tt = t0 + k * step, d = new Date(tt), dow = d.getUTCDay(), hr = d.getUTCHours();
      if (dow === 0 || dow === 6) continue;
      const season = hr >= 12 && hr < 16 ? 1.5 : hr >= 7 && hr < 17 ? 1.2 : hr >= 21 || hr < 1 ? 0.45 : 0.6;
      logVol += 0.05 * gauss() - 0.015 * logVol;
      if (rnd() < 0.012) drift = gauss() * 0.00005;
      drift *= 0.997;
      const sigma = 0.00028 * season * Math.exp(logVol);
      const open = price + gauss() * sigma * 0.05;
      let p = open, hi = open, lo = open;
      for (let s = 0; s < 6; s++) { p += drift / 6 + gauss() * sigma / Math.sqrt(6); if (p > hi) hi = p; if (p < lo) lo = p; }
      const r5 = x => Math.round(x * 1e5) / 1e5;
      out.t.push(tt); out.o.push(r5(open)); out.h.push(r5(hi)); out.l.push(r5(lo)); out.c.push(r5(p));
      out.v.push(Math.round((hi - lo) / 0.0001 * 55 * (0.7 + 0.6 * rnd()) + 40 * season));
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
    if (rows.length < 250) throw new Error('Se leyeron ' + rows.length + ' velas válidas; hacen falta al menos 250 (el canal FRAMA usa una media de 200).');
    rows.sort((a, b) => a[0] - b[0]);
    const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
    for (const r of rows) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(0); }
    return out;
  }

  const api = { DEFAULTS, VARIANTS, run, makeSample, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineStochRsi = api;
})(typeof window !== 'undefined' ? window : this);
