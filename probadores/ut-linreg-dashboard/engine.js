/*
 * Motor de backtest: port a JavaScript de
 * "UT Bot + LinReg Candles + Longevity Zones + S/R + Dashboard" (Pine Script v6).
 *
 * Reproduce:
 *  - las dos líneas UT (compra y venta, con su propio multiplicador y ATR) y sus señales;
 *  - el estado de posición `posState`, que solo acepta señales alternas (las que disparan alertas);
 *  - las velas de regresión lineal y su línea de señal;
 *  - las zonas de longevidad (con el momento en que se crean y en que se rompen);
 *  - las líneas de soporte y resistencia (máximos y mínimos de 10 a 1000 velas);
 *  - el panel de mercado en la última vela.
 * El indicador solo da señales. Modelo de operación: siempre en el mercado siguiendo `posState`,
 * entrada y giro al cierre de cada señal confirmada, tamaño fijo en unidades, sin comisiones.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    aBuy: 2, cBuy: 1, aSell: 2, cSell: 1,
    signalLength: 7, smaSignal: true, linReg: true, linregLength: 11,
    showZones: true, lenZ: 5,
    volMaLen: 20, macdFast: 12, macdSlow: 26, macdSignal: 9, stochLen: 14, stochK: 3, stochD: 3,
    units: 10000
  };

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
  function stdev(src, len) {
    const n = src.length, out = nanArr(n);
    for (let i = len - 1; i < n; i++) {
      let s = 0, ok = true;
      for (let k = i - len + 1; k <= i; k++) { if (isNaN(src[k])) { ok = false; break; } s += src[k]; }
      if (!ok) continue;
      const m = s / len; let q = 0;
      for (let k = i - len + 1; k <= i; k++) q += (src[k] - m) ** 2;
      out[i] = Math.sqrt(q / len);
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
  // ta.linreg(src, len, 0): least-squares line over the window, evaluated at the newest bar
  function linreg(src, len) {
    const n = src.length, out = nanArr(n);
    if (len <= 1) return src.slice();
    const sx = len * (len - 1) / 2, sxx = (len - 1) * len * (2 * len - 1) / 6, den = len * sxx - sx * sx;
    for (let i = len - 1; i < n; i++) {
      let sy = 0, sxy = 0;
      for (let k = 0; k < len; k++) { const y = src[i - len + 1 + k]; sy += y; sxy += k * y; }
      const slope = (len * sxy - sx * sy) / den, icpt = (sy - slope * sx) / len;
      out[i] = icpt + slope * (len - 1);
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
  function inferTfMinutes(t) {
    const d = [];
    for (let i = 1; i < Math.min(t.length, 500); i++) d.push(t[i] - t[i - 1]);
    d.sort((a, b) => a - b);
    return d.length ? Math.max(1, Math.round(d[Math.floor(d.length / 2)] / 60000)) : 15;
  }
  const weekKey = t => Math.floor((Math.floor(t / 86400000) + 3) / 7);
  const monthKey = t => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };

  function utTrail(c, a, nLoss, initSign) {
    const n = c.length, tr = nanArr(n);
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? tr[i - 1] : NaN;
      if (isNaN(prev)) tr[i] = c[i] + initSign * nLoss[i];
      else if (c[i] > prev && c[i - 1] > prev) tr[i] = Math.max(prev, c[i] - nLoss[i]);
      else if (c[i] < prev && c[i - 1] < prev) tr[i] = Math.min(prev, c[i] + nLoss[i]);
      else tr[i] = c[i] > prev ? c[i] - nLoss[i] : c[i] + nLoss[i];
    }
    return tr;
  }

  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const { t, o, h, l, c, v } = data;
    const n = t.length;
    const dec = inferDecimals(c), mintick = Math.pow(10, -dec);
    const pip = (dec === 5 || dec === 3) ? Math.pow(10, -(dec - 1)) : mintick;
    const tfMin = inferTfMinutes(t);

    // UT Bot, buy and sell sides
    const buyEnabled = P.cBuy > 0 && P.aBuy > 0, sellEnabled = P.cSell > 0 && P.aSell > 0;
    const trailBuy = buyEnabled ? utTrail(c, P.aBuy, atr(h, l, c, P.cBuy).map(x => P.aBuy * x), -1) : nanArr(n);
    const trailSell = sellEnabled ? utTrail(c, P.aSell, atr(h, l, c, P.cSell).map(x => P.aSell * x), 1) : nanArr(n);
    const rawBuy = new Array(n).fill(false), rawSell = new Array(n).fill(false), confirmed = [];
    const posState = new Array(n).fill(0);
    let pos = 0, repeatsBuy = 0, repeatsSell = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        rawBuy[i] = buyEnabled && c[i] > trailBuy[i] && c[i - 1] <= trailBuy[i - 1];
        rawSell[i] = sellEnabled && c[i] < trailSell[i] && trailSell[i - 1] <= c[i - 1];
      }
      const cb = rawBuy[i] && pos <= 0, cs = rawSell[i] && pos >= 0;
      if (rawBuy[i] && !cb) repeatsBuy++;
      if (rawSell[i] && !cs) repeatsSell++;
      if (cb) { pos = 1; confirmed.push({ i, dir: 1 }); }
      else if (cs) { pos = -1; confirmed.push({ i, dir: -1 }); }
      posState[i] = pos;
    }

    // LinReg candles + signal line
    const lr = s => P.linReg ? linreg(s, P.linregLength) : s.slice();
    const bo = lr(o), bh = lr(h), bl = lr(l), bc = lr(c);
    const signal = P.smaSignal ? sma(bc, P.signalLength) : ema(bc, P.signalLength);

    // Longevity zones
    const zones = [];
    if (P.showZones) {
      const hz = rollExt(h, P.lenZ, true), lz = rollExt(l, P.lenZ, false), halfATR = atr(h, l, c, 20).map(x => x * 0.5);
      const upper = [], lower = [];
      for (let i = 1; i < n; i++) {
        if (h[i - 1] === hz[i - 1] && h[i] < hz[i]) { const z = { side: 'R', top: hz[i], bot: hz[i] - halfATR[i], start: i - 1, end: null, reason: null }; upper.push(z); zones.push(z); }
        if (l[i - 1] === lz[i - 1] && l[i] > lz[i]) { const z = { side: 'S', top: lz[i] + halfATR[i], bot: lz[i], start: i - 1, end: null, reason: null }; lower.push(z); zones.push(z); }
        if (upper.length > 10) { const z = upper.shift(); z.end = i; z.reason = 'límite de 10'; }
        if (lower.length > 10) { const z = lower.shift(); z.end = i; z.reason = 'límite de 10'; }
        for (let k = upper.length - 1; k >= 0; k--) if (h[i] > upper[k].top && i > upper[k].start) { upper[k].end = i; upper[k].reason = 'rota'; upper.splice(k, 1); }
        for (let k = lower.length - 1; k >= 0; k--) if (l[i] < lower[k].bot && i > lower[k].start) { lower[k].end = i; lower[k].reason = 'rota'; lower.splice(k, 1); }
      }
    }

    // S/R levels at the last bar
    const sr = [];
    if (n) for (const [k, len] of [[1, 1000], [2, 750], [3, 500], [4, 250], [5, 100], [6, 50], [7, 10]]) {
      const w = Math.min(len, n);
      let hi = -Infinity, lo = Infinity;
      for (let i = n - w; i < n; i++) { if (h[i] > hi) hi = h[i]; if (l[i] < lo) lo = l[i]; }
      sr.push({ name: 'R' + k, len, price: len <= n ? hi : NaN }, { name: 'S' + k, len, price: len <= n ? lo : NaN });
    }

    // Trade model: follow posState
    const trades = [];
    let cur = null, realized = 0;
    const equity = new Array(n).fill(0);
    let si = 0;
    for (let i = 0; i < n; i++) {
      if (si < confirmed.length && confirmed[si].i === i) {
        const sg = confirmed[si++];
        if (cur) { cur.exitIdx = i; cur.exitPrice = c[i]; cur.pips = cur.dir * (c[i] - cur.entry) / pip; cur.pnl = cur.dir * (c[i] - cur.entry) * P.units; realized += cur.pnl; }
        cur = { dir: sg.dir, idx: i, entry: c[i], exitIdx: null, exitPrice: NaN, pips: 0, pnl: 0 };
        trades.push(cur);
      }
      equity[i] = realized + (cur && cur.exitIdx === null ? cur.dir * (c[i] - cur.entry) * P.units : 0);
    }
    const closed = trades.filter(x => x.exitIdx !== null), wins = closed.filter(x => x.pnl > 0);
    const gp = wins.reduce((s, x) => s + x.pnl, 0), gl = -closed.filter(x => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
    let peak = -Infinity, maxDd = 0;
    for (const e of equity) { if (e > peak) peak = e; if (peak - e > maxDd) maxDd = peak - e; }
    const open = trades.find(x => x.exitIdx === null);

    // Dashboard at the last bar
    let dash = null;
    if (n > 30) {
      const L = n - 1;
      const atr14 = atr(h, l, c, 14), std2 = stdev(atr14, 20).map(x => 2 * x), sma20 = sma(atr14, 20);
      const top = sma20[L] + std2[L], bot = sma20[L] - std2[L];
      let volat = 30 + 40 * ((atr14[L] - bot) / Math.max(1e-10, top - bot)); if (isNaN(volat)) volat = 50;
      const volMA = sma(v, P.volMaLen)[L];
      // VWAP anchored to the UTC day
      const day = Math.floor(t[L] / 86400000);
      let pv = 0, vv = 0;
      for (let i = L; i >= 0 && Math.floor(t[i] / 86400000) === day; i--) { pv += c[i] * v[i]; vv += v[i]; }
      const vwap = vv > 0 ? pv / vv : NaN;
      const mf = ema(c, P.macdFast), ms = ema(c, P.macdSlow), macd = mf.map((x, i) => x - ms[i]), msig = ema(macd, P.macdSignal);
      const hh = rollExt(h, P.stochLen, true), ll = rollExt(l, P.stochLen, false);
      const stoch = c.map((x, i) => 100 * (x - ll[i]) / (hh[i] - ll[i]));
      const kk = sma(stoch, P.stochK), dd = sma(kk, P.stochD);
      const rsiV = rsi(c, 14)[L];
      // Timeframe trends: EMA 9/21 of each higher timeframe, developing bar included (as in real time)
      const TFS = [['1m', 1], ['5m', 5], ['15m', 15], ['30m', 30], ['1h', 60], ['2h', 120], ['4h', 240], ['1D', 1440], ['1W', 10080], ['1M', 43200]];
      const trends = TFS.map(([name, mins]) => {
        if (mins < tfMin) return { name, trend: null };
        const key = mins === 10080 ? weekKey : mins === 43200 ? monthKey : (x => Math.floor(x / (mins * 60000)));
        const closes = [];
        let lastK = null;
        for (let i = 0; i < n; i++) { const kx = key(t[i]); if (kx !== lastK) { closes.push(c[i]); lastK = kx; } else closes[closes.length - 1] = c[i]; }
        const e9 = ema(closes, 9), e21 = ema(closes, 21), a = e9[e9.length - 1], b = e21[e21.length - 1];
        return { name, trend: isNaN(a) || isNaN(b) ? 0 : a > b ? 1 : a < b ? -1 : 0, bars: closes.length };
      });
      // Today and yesterday (UTC days)
      const dayStats = dk => { let o1 = NaN, c1 = NaN, hi = -Infinity, lo = Infinity; for (let i = 0; i < n; i++) if (Math.floor(t[i] / 86400000) === dk) { if (isNaN(o1)) o1 = o[i]; c1 = c[i]; hi = Math.max(hi, h[i]); lo = Math.min(lo, l[i]); } return { o: o1, c: c1, h: hi, l: lo }; };
      const today = dayStats(day);
      let pd = day - 1; while (pd > day - 10 && isNaN(dayStats(pd).o)) pd--;
      const yday = dayStats(pd);
      const pst = posState[L];
      dash = {
        volatility: volat, volume: v[L], volMA, vwap, close: c[L],
        macdBull: macd[L] > msig[L], stochK: kk[L], stochD: dd[L], rsi: rsiV,
        atr: atr14[L], atrState: atr14[L] > sma20[L] * 1.2 ? 'High' : atr14[L] < sma20[L] * 0.8 ? 'Low' : 'Mid',
        trends, today, yesterday: yday,
        todayRange: (today.h - today.l) / Math.max(today.l, mintick) * 100,
        prevRange: (yday.h - yday.l) / Math.max(yday.l, mintick) * 100,
        posState: pst, trailStop: pst === 1 && buyEnabled ? trailBuy[L] : pst === -1 && sellEnabled ? trailSell[L] : NaN
      };
    }

    return {
      params: P, n, decimals: dec, pip, tfMin, trailBuy, trailSell, rawBuy, rawSell, confirmed, posState,
      bo, bh, bl, bc, signal, zones, sr, trades, equity, dash,
      stats: {
        rawBuys: rawBuy.filter(Boolean).length, rawSells: rawSell.filter(Boolean).length,
        signals: confirmed.length, repeatsBuy, repeatsSell,
        trades: closed.length, wins: wins.length,
        winRate: closed.length ? wins.length / closed.length * 100 : NaN,
        netPips: closed.reduce((s, x) => s + x.pips, 0), netProfit: realized,
        openPnl: open ? open.dir * (c[n - 1] - open.entry) * P.units : 0,
        profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN), maxDd,
        zonesAlive: zones.filter(z => z.end === null).length, zonesTotal: zones.length
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
    const out = { t: [], o: [], h: [], l: [], c: [], v: [], hasVolume: iV >= 0 };
    for (const r of rows) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(isFinite(r[5]) ? r[5] : 0); }
    return out;
  }

  const api = { DEFAULTS, run, makeSample, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineLinReg = api;
})(typeof window !== 'undefined' ? window : this);
