/*
 * Motor: port a JavaScript de "AI Bot Regime Feed (v6) — stable" (Pine Script v6, indicator con alert()).
 *
 * El indicador no opera: al cierre de la vela envía un JSON (buy / sell) cuando la EMA 12 cruza la EMA 35
 * y el RSI 14 pasa un filtro (< 40 para comprar, > 60 para vender). Aquí se calculan las mismas series,
 * el régimen, la confianza y el JSON, y además todos los cruces de EMA (pasen o no el filtro) con el
 * rendimiento posterior, para ver qué deja pasar el filtro.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    emaFastLen: 12, emaSlowLen: 35, rsiLen: 14, atrLen: 14, adxLen: 14,
    buyRsiMax: 40, sellRsiMin: 60, bullRsi: 45, bearRsi: 55,
    confBase: 0.85, horizon: 24, symbol: 'BTCUSD', timeframe: '60'
  };

  function nanArr(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = NaN; return a; }
  function smooth(src, len, alpha) {
    const n = src.length, out = nanArr(n); let prev = NaN, sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const x = src[i];
      if (isNaN(prev)) { if (isNaN(x)) { sum = 0; cnt = 0; continue; } sum += x; cnt++; if (cnt >= len) { prev = sum / len; out[i] = prev; } }
      else { if (!isNaN(x)) prev = alpha * x + (1 - alpha) * prev; out[i] = prev; }
    }
    return out;
  }
  const ema = (s, l) => smooth(s, l, 2 / (l + 1)), rma = (s, l) => smooth(s, l, 1 / l);
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
  // str.tostring(x) without a format (approximation: up to 8 decimals, trailing zeros removed)
  const tostr = x => !isFinite(x) ? 'NaN' : String(Math.round(x * 1e8) / 1e8);

  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const { t, h, l, c } = data, n = c.length;
    const emaFast = ema(c, P.emaFastLen), emaSlow = ema(c, P.emaSlowLen), rsi = rsiSeries(c, P.rsiLen);
    const tr = new Array(n);
    for (let i = 0; i < n; i++) tr[i] = i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    const atr = rma(tr, P.atrLen);
    // Manual ADX exactly as written: ta.tr (first bar na), plusDM / minusDM with na -> 0
    const trNa = tr.map((x, i) => i === 0 ? NaN : x);
    const pDM = new Array(n), mDM = new Array(n);
    for (let i = 0; i < n; i++) {
      const up = i ? h[i] - h[i - 1] : NaN, down = i ? -(l[i] - l[i - 1]) : NaN;
      pDM[i] = isNaN(up) || up <= 0 || up <= down ? 0 : up;
      mDM[i] = isNaN(down) || down <= 0 || down <= up ? 0 : down;
    }
    const trur = rma(trNa, P.adxLen), pS = rma(pDM, P.adxLen), mS = rma(mDM, P.adxLen);
    const dx = new Array(n);
    for (let i = 0; i < n; i++) {
      const pdi = 100 * pS[i] / trur[i], mdi = 100 * mS[i] / trur[i];
      dx[i] = pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi);   // NaN while trur is na
    }
    const adx = rma(dx, P.adxLen);

    const regime = new Array(n), conf = new Array(n);
    const crosses = [];
    const reg = { bullish: 0, bearish: 0, choppy: 0 };
    for (let i = 0; i < n; i++) {
      const bull = emaFast[i] > emaSlow[i] && rsi[i] > P.bullRsi, bear = emaFast[i] < emaSlow[i] && rsi[i] < P.bearRsi;
      regime[i] = bull ? 'bullish' : bear ? 'bearish' : 'choppy';
      reg[regime[i]]++;
      const volPct = atr[i] / c[i];
      const adj = (adx[i] - 20) * 0.005 - (volPct - 0.01) * 2;
      conf[i] = Math.min(Math.max(P.confBase + adj, 0.5), 0.99);   // NaN stays NaN like math.min/max with na
      if (i === 0) continue;
      const up = emaFast[i] > emaSlow[i] && emaFast[i - 1] <= emaSlow[i - 1];
      const dn = emaFast[i] < emaSlow[i] && emaFast[i - 1] >= emaSlow[i - 1];
      if (!up && !dn) continue;
      const dir = up ? 1 : -1;
      const pass = up ? rsi[i] < P.buyRsiMax : rsi[i] > P.sellRsiMin;
      const j = i + P.horizon;
      const fwd = j < n ? dir * (c[j] / c[i] - 1) * 100 : NaN;
      crosses.push({ i, dir, rsi: rsi[i], pass, regime: regime[i], conf: conf[i], adx: adx[i], atr: atr[i], volPct, fwd });
    }
    const sig = crosses.filter(x => x.pass);
    const avg = arr => { const v = arr.filter(isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
    const validConf = conf.filter(isFinite);
    const stats = {
      signals: sig.length, buys: sig.filter(x => x.dir > 0).length, sells: sig.filter(x => x.dir < 0).length,
      crossUp: crosses.filter(x => x.dir > 0).length, crossDn: crosses.filter(x => x.dir < 0).length,
      rsiAtCrossUp: avg(crosses.filter(x => x.dir > 0).map(x => x.rsi)), rsiAtCrossDn: avg(crosses.filter(x => x.dir < 0).map(x => x.rsi)),
      signalRegimes: sig.reduce((o, x) => (o[x.regime] = (o[x.regime] || 0) + 1, o), {}),
      fwdAll: avg(crosses.map(x => x.fwd)), fwdPass: avg(sig.map(x => x.fwd)), fwdBlocked: avg(crosses.filter(x => !x.pass).map(x => x.fwd)),
      confMin: validConf.length ? Math.min(...validConf) : NaN, confMax: validConf.length ? Math.max(...validConf) : NaN, confAvg: avg(validConf),
      regimePct: { bullish: reg.bullish / n * 100, bearish: reg.bearish / n * 100, choppy: reg.choppy / n * 100 }
    };
    return { params: P, n, decimals: inferDecimals(c), emaFast, emaSlow, rsi, atr, adx, regime, conf, crosses, stats };
  }

  function alertJson(res, data, x) {
    const P = res.params, i = x.i, side = x.dir > 0 ? 'buy' : 'sell';
    return '{"source":"tradingview","symbol":"' + P.symbol + '","side":"' + side + '","timeframe":"' + P.timeframe + '","confidence":' + tostr(res.conf[i])
      + ',"indicators":{"ema_fast":' + tostr(res.emaFast[i]) + ',"ema_slow":' + tostr(res.emaSlow[i]) + ',"rsi":' + tostr(res.rsi[i]) + ',"adx":' + tostr(res.adx[i])
      + ',"atr":' + tostr(res.atr[i]) + ',"volatility":' + tostr(res.atr[i] / data.c[i]) + '},"regime":"' + res.regime[i] + '","note":"ema crossover + rsi gate","ts":' + data.t[i] + '}';
  }

  // ---------- sample data (synthetic, BTCUSD-like, 1 hour) ----------
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

  const api = { DEFAULTS, run, alertJson, makeSample, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineRegimeFeed = api;
})(typeof window !== 'undefined' ? window : this);
