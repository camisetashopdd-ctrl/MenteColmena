/*
 * Motor: port a JavaScript de "Dynamic Grid Engine v3.0 — AleksDU" (Pine Script v6, indicator).
 *
 * El indicador no opera: calcula una rejilla de niveles alrededor de un centro, con paso = ATR x mult,
 * y la dibuja solo en la última vela (barstate.islast). Este motor calcula las series de todas las velas
 * para poder dibujar la rejilla «como si» cualquier vela fuera la última, y evalúa las alertas.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    gridLevels: 15, atrLen: 14, atrMult: 0.5, recenter: true,
    extendBars: 20, showZone: true, showProfit: true, positionUsd: 100,
    showNearest: true, showDash: true
  };

  function nanArr(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = NaN; return a; }

  // ta.rma seeded with the SMA of the first `len` values
  function rma(src, len) {
    const n = src.length, out = nanArr(n), a = 1 / len;
    let prev = NaN, sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const x = src[i];
      if (isNaN(prev)) {
        if (isNaN(x)) { sum = 0; cnt = 0; continue; }
        sum += x; cnt++;
        if (cnt >= len) { prev = sum / len; out[i] = prev; }
      } else { if (!isNaN(x)) prev = a * x + (1 - a) * prev; out[i] = prev; }
    }
    return out;
  }
  function atrSeries(h, l, c, len) {
    const n = h.length, tr = new Array(n);
    for (let i = 0; i < n; i++) tr[i] = i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    return rma(tr, len);
  }
  // Pine math.round: half away from zero
  const pround = x => Math.sign(x) * Math.round(Math.abs(x));

  function inferDecimals(c) {
    let dec = 0;
    for (let i = 0; i < Math.min(c.length, 300); i++) { const s = String(c[i]), p = s.indexOf('.'); if (p >= 0) dec = Math.max(dec, Math.min(8, s.length - p - 1)); }
    return dec;
  }

  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const { c, h, l } = data;
    const n = c.length, L = Math.max(1, Math.round(P.gridLevels));
    const atr = atrSeries(h, l, c, P.atrLen);
    const step = atr.map(x => x * P.atrMult);
    const center = new Array(n), upper = nanArr(n), lower = nanArr(n);
    const inGrid = new Array(n), crossed = new Array(n).fill(false), realCross = new Array(n).fill(false);
    const recenters = [];
    let gc = n ? c[0] : NaN;  // var float grid_center = close (first bar)

    for (let i = 0; i < n; i++) {
      if (P.recenter) {
        // comparisons with na are false, so nothing happens until the ATR exists
        if (c[i] > gc + step[i] * L || c[i] < gc - step[i] * L) {
          recenters.push({ i, from: gc, to: c[i], dir: c[i] > gc ? 1 : -1 });
          gc = c[i];
        }
      }
      center[i] = gc;
      upper[i] = gc + step[i] * L; lower[i] = gc - step[i] * L;
      inGrid[i] = c[i] >= lower[i] && c[i] <= upper[i];
      if (i > 0) {
        // crossed_level exactly as written (math.round of both distances with the current step)
        const a = pround((c[i] - gc) / step[i]), b = pround((c[i - 1] - gc) / step[i]);
        crossed[i] = Math.abs(a - b) >= 1;
        // a grid line (center + k*step, current bar's grid) lies between close[1] and close
        const fa = Math.floor((c[i] - gc) / step[i]), fb = Math.floor((c[i - 1] - gc) / step[i]);
        realCross[i] = fa !== fb;
      }
    }

    // Alert diagnostics
    let det = 0, real = 0, both = 0, onlyDet = 0, onlyReal = 0, byRecenter = 0;
    const recSet = new Set(recenters.map(r => r.i));
    const kind = new Array(n).fill(0); // 1 both, 2 only detected (false), 3 only real (missed)
    for (let i = 1; i < n; i++) {
      if (!isFinite(step[i])) continue;
      if (crossed[i]) det++;
      if (realCross[i]) real++;
      if (crossed[i] && realCross[i]) { both++; kind[i] = 1; }
      else if (crossed[i]) { onlyDet++; kind[i] = 2; }
      else if (realCross[i]) { onlyReal++; kind[i] = 3; }
      if (crossed[i] && recSet.has(i)) byRecenter++;
    }
    let valid = 0, inside = 0, above = 0, below = 0;
    for (let i = 0; i < n; i++) {
      if (!isFinite(step[i])) continue;
      valid++; if (inGrid[i]) inside++; else if (c[i] > upper[i]) above++; else below++;
    }

    return {
      params: P, n, L, decimals: inferDecimals(c), atr, step, center, upper, lower, inGrid, crossed, realCross, kind, recenters,
      stats: {
        signals: det, detected: det, real, both, falseAlerts: onlyDet, missed: onlyReal, byRecenter,
        recenters: recenters.length, validBars: valid, insidePct: valid ? inside / valid * 100 : NaN,
        abovePct: valid ? above / valid * 100 : NaN, belowPct: valid ? below / valid * 100 : NaN,
        outside: above + below, above, below
      }
    };
  }

  // Everything the script draws when bar `i` is the last one (barstate.islast)
  function gridAt(res, data, i) {
    const P = res.params, L = res.L, close = data.c[i], gc = res.center[i], st = res.step[i], atr = res.atr[i];
    if (!isFinite(st)) return null;
    let nearestSell = NaN, nearestBuy = NaN;
    for (let k = 1; k <= L; k++) {
      const s = gc + st * k; if (s > close && isNaN(nearestSell)) nearestSell = s;
      const b = gc - st * k; if (b < close && isNaN(nearestBuy)) nearestBuy = b;
    }
    const r2 = x => Math.round(x * 100) / 100;
    const levels = [];
    for (let k = 1; k <= L; k++) {
      const lvl = gc + st * k, pct = (lvl - close) / close * 100, profit = P.positionUsd * (st / lvl);
      let label = 'S' + k + '  +' + r2(pct) + '%';
      if (P.showProfit) label += '  +$' + r2(profit);
      levels.push({ side: 'S', k, price: lvl, pct, profit, label, near: lvl === nearestSell, transp: Math.round(Math.min(k * 5, 75)) });
    }
    for (let k = 1; k <= L; k++) {
      const lvl = gc - st * k, pct = (close - lvl) / close * 100, profit = P.positionUsd * (st / lvl);
      let label = 'B' + k + '  -' + r2(pct) + '%';
      if (P.showProfit) label += '  +$' + r2(profit);
      levels.push({ side: 'B', k, price: lvl, pct, profit, label, near: lvl === nearestBuy, transp: Math.round(Math.min(k * 5, 75)) });
    }
    const upper = gc + st * L, lower = gc - st * L;
    const profitPerGrid = P.positionUsd * (st / close);
    return {
      i, close, center: gc, step: st, atr, levels, nearestSell, nearestBuy,
      zoneTop: gc + st, zoneBottom: gc - st,
      dash: {
        stepPct: st / close * 100, totalRangePct: st * L / close * 100, upper, lower,
        inGrid: close >= lower && close <= upper, positionUsd: P.positionUsd,
        profitPerGrid, totalIfFull: profitPerGrid * L * 2
      }
    };
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
    const t0 = Date.UTC(2026, 5, 1), total = (weeks || 10) * 7 * 24;
    let price = 65000, logVol = 0, drift = 0;
    for (let k = 0; k < total; k++) {
      const t = t0 + k * 3600000, hr = new Date(t).getUTCHours();
      const season = hr >= 13 && hr < 21 ? 1.3 : hr >= 7 && hr < 13 ? 1.0 : 0.75;
      logVol += 0.08 * gauss() - 0.03 * logVol;
      if (rnd() < 0.03) drift = gauss() * 0.0012;
      drift *= 0.985;
      const sigma = 0.0055 * season * Math.exp(logVol);
      const open = price * (1 + gauss() * sigma * 0.05);
      let p = open, hi = open, lo = open;
      for (let s = 0; s < 6; s++) {
        p *= 1 + drift / 6 + gauss() * sigma / Math.sqrt(6);
        if (p > hi) hi = p; if (p < lo) lo = p;
      }
      const r2 = x => Math.round(x * 100) / 100;
      out.t.push(t); out.o.push(r2(open)); out.h.push(r2(hi)); out.l.push(r2(lo)); out.c.push(r2(p));
      out.v.push(Math.round((hi - lo) / price * 2e4 * (0.6 + 0.8 * rnd())));
      price = p;
    }
    return out;
  }

  // ---------- CSV import (TradingView / MetaTrader style exports) ----------
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
    const iV = find(['volume', 'vol', 'tick_volume', 'tickvol', 'volumen', 'real_volume']);
    if ([iT, iO, iH, iL, iC].some(x => x < 0)) throw new Error('Faltan columnas. Se necesitan: time, open, high, low, close (y opcionalmente volume).');
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
      const r = [tt, +p[iO], +p[iH], +p[iL], +p[iC], iV >= 0 ? +p[iV] : 0];
      if (r.slice(0, 5).every(x => isFinite(x))) rows.push(r);
    }
    if (rows.length < 50) throw new Error('Se leyeron ' + rows.length + ' velas válidas; hacen falta al menos 50.');
    rows.sort((a, b) => a[0] - b[0]);
    const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
    for (const r of rows) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(isFinite(r[5]) ? r[5] : 0); }
    return out;
  }

  const api = { DEFAULTS, run, gridAt, makeSample, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineDGE = api;
})(typeof window !== 'undefined' ? window : this);
