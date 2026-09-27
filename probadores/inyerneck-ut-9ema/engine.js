/*
 * Motor de backtest: port a JavaScript de "Inyerneck UT Bot 9 EMA Filter" (Pine Script v5).
 *
 * Dos modos:
 *  - original: la lógica tal cual. Las bandas son src ± mult × ATR, así que
 *    ta.crossover(src, lowerBand) solo se cumple si el ATR de la vela anterior es <= 0.
 *  - corregido: propuesta con el trailing stop clásico de UT Bot (Key = mult) y el mismo
 *    filtro de EMA 9 (estrategias/inyerneck-ut-9ema-corregido.pine).
 *
 * El indicador solo da señales. Modelo de operación: siempre en el mercado, entrada al cierre
 * de la señal y giro al cierre de la señal contraria (las señales repetidas en la misma
 * dirección se ignoran), con un tamaño fijo en unidades. Sin comisiones.
 */
(function (root) {
  'use strict';

  const DEFAULTS = { mode: 'original', length: 10, mult: 1.0, source: 'close', units: 10000 };

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
  const trueRange = (h, l, c) => h.map((x, i) => i === 0 ? x - l[i] : Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])));

  const SOURCES = {
    close: (o, h, l, c, i) => c[i], open: (o, h, l, c, i) => o[i], high: (o, h, l, c, i) => h[i], low: (o, h, l, c, i) => l[i],
    hl2: (o, h, l, c, i) => (h[i] + l[i]) / 2, hlc3: (o, h, l, c, i) => (h[i] + l[i] + c[i]) / 3,
    ohlc4: (o, h, l, c, i) => (o[i] + h[i] + l[i] + c[i]) / 4, hlcc4: (o, h, l, c, i) => (h[i] + l[i] + 2 * c[i]) / 4
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
    const fsrc = SOURCES[P.source] || SOURCES.close;
    const src = c.map((_, i) => fsrc(o, h, l, c, i));
    const atr = rma(trueRange(h, l, c), P.length);
    const ema9 = ema(c, 9);
    const dec = inferDecimals(c);
    const pip = (dec === 5 || dec === 3) ? Math.pow(10, -(dec - 1)) : Math.pow(10, -dec);

    const upper = src.map((x, i) => x + P.mult * atr[i]);
    const lower = src.map((x, i) => x - P.mult * atr[i]);
    const trail = nanArr(n);
    if (P.mode === 'corregido') {
      for (let i = 0; i < n; i++) {
        const pr = i > 0 && !isNaN(trail[i - 1]) ? trail[i - 1] : 0, s1 = i > 0 ? src[i - 1] : NaN, loss = P.mult * atr[i];
        trail[i] = src[i] > pr && s1 > pr ? Math.max(pr, src[i] - loss)
          : src[i] < pr && s1 < pr ? Math.min(pr, src[i] + loss)
          : src[i] > pr ? src[i] - loss : src[i] + loss;
      }
    }

    // Signals
    const signals = [];
    const diag = { crossBuyRaw: 0, crossSellRaw: 0, emaBlockedBuy: 0, emaBlockedSell: 0, prevAtrZero: 0, bars: n };
    for (let i = 1; i < n; i++) {
      let up, dn;
      if (P.mode === 'corregido') {
        up = src[i] > trail[i] && src[i - 1] <= trail[i - 1];
        dn = src[i] < trail[i] && src[i - 1] >= trail[i - 1];
      } else {
        up = src[i] > lower[i] && src[i - 1] <= lower[i - 1];
        dn = src[i] < upper[i] && src[i - 1] >= upper[i - 1];
        if (atr[i - 1] <= 0) diag.prevAtrZero++;
      }
      if (up) { diag.crossBuyRaw++; if (c[i] > ema9[i]) signals.push({ i, dir: 1 }); else diag.emaBlockedBuy++; }
      if (dn) { diag.crossSellRaw++; if (c[i] < ema9[i]) signals.push({ i, dir: -1 }); else diag.emaBlockedSell++; }
    }

    // Always-in-the-market reversal model
    const trades = [];
    let cur = null, realized = 0;
    const equity = new Array(n).fill(0);
    let sIdx = 0;
    for (let i = 0; i < n; i++) {
      while (sIdx < signals.length && signals[sIdx].i === i) {
        const sg = signals[sIdx++];
        if (cur && cur.dir === sg.dir) { cur.ignored++; continue; }
        if (cur) {
          cur.exitIdx = i; cur.exitPrice = c[i];
          cur.pips = cur.dir * (c[i] - cur.entry) / pip;
          cur.pnl = cur.dir * (c[i] - cur.entry) * P.units;
          realized += cur.pnl;
        }
        cur = { dir: sg.dir, idx: i, entry: c[i], exitIdx: null, exitPrice: NaN, pips: 0, pnl: 0, ignored: 0 };
        trades.push(cur);
      }
      equity[i] = realized + (cur && cur.exitIdx === null ? cur.dir * (c[i] - cur.entry) * P.units : 0);
    }
    const closed = trades.filter(x => x.exitIdx !== null);
    const wins = closed.filter(x => x.pnl > 0);
    const gp = wins.reduce((s, x) => s + x.pnl, 0), gl = -closed.filter(x => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
    let peak = -Infinity, maxDd = 0;
    for (const e of equity) { if (e > peak) peak = e; if (peak - e > maxDd) maxDd = peak - e; }
    const open = trades.find(x => x.exitIdx === null);

    return {
      params: P, n, src, atr, ema9, upper, lower, trail, signals, trades, equity, diag, pip, decimals: dec,
      stats: {
        signals: signals.length,
        buys: signals.filter(x => x.dir > 0).length,
        trades: closed.length,
        wins: wins.length,
        winRate: closed.length ? wins.length / closed.length * 100 : NaN,
        netPips: closed.reduce((s, x) => s + x.pips, 0),
        netProfit: realized,
        openPnl: open ? open.dir * (c[n - 1] - open.entry) * P.units : 0,
        profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN),
        maxDd,
        ignored: trades.reduce((s, x) => s + x.ignored, 0)
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
    if (rows.length < 50) throw new Error('Se leyeron ' + rows.length + ' velas válidas; hacen falta al menos 50.');
    rows.sort((a, b) => a[0] - b[0]);
    const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
    for (const r of rows) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(0); }
    return out;
  }

  const api = { DEFAULTS, run, makeSample, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineInyerneck = api;
})(typeof window !== 'undefined' ? window : this);
