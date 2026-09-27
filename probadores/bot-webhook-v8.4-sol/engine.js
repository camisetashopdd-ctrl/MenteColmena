/*
 * Motor: port a JavaScript de "Bot Webhook v8.4 [SOL]" (Pine Script v5, indicator con alert()).
 *
 * El indicador no opera: envía alertas JSON a un bot externo. Aquí se calculan las mismas series y
 * señales vela a vela (al cierre, barstate.isconfirmed = true en el historial) y, para evaluarlas,
 * se mira si el precio toca antes el take profit o el stop loss que viajan en la alerta
 * (medidos desde el cierre de la vela de la señal, a partir de la vela siguiente).
 *
 * Los umbrales dependen de timeframe.period: 30S, 45S y 1-20 minutos. En cualquier otro marco no hay
 * señales base (solo el Squeeze SHORT) y los umbrales mostrados son los de 20 min.
 */
(function (root) {
  'use strict';

  // [rsi, k, slope, adx] por marco, tal cual en los inputs del script
  const LONG = {
    '30S': [30, 10, -3, 35], '45S': [30, 12, -3, 45], '1': [30, 12, -3, 50], '2': [30, 10, -5, 55], '3': [32, 10, -5, 60],
    '4': [30, 15, -5, 50], '5': [28, 8, -5, 60], '6': [18, 20, -1, 60], '7': [22, 15, 0, 60], '8': [18, 8, -5, 60],
    '9': [28, 15, 2, 50], '10': [18, 3, -5, 50], '11': [28, 20, 2, 40], '12': [18, 10, 1, 60], '13': [20, 5, -5, 40],
    '14': [20, 8, -3, 60], '15': [20, 5, -2, 60], '16': [22, 3, -5, 40], '17': [22, 10, -5, 40], '18': [22, 5, -3, 50],
    '19': [15, 8, -3, 60], '20': [20, 5, -3, 60]
  };
  const SHORT = {
    '30S': [78, 80, 0, 50], '45S': [78, 80, -2, 60], '1': [78, 80, 0, 50], '2': [65, 88, -3, 50], '3': [65, 70, -5, 30],
    '4': [72, 80, -1, 50], '5': [75, 70, 2, 40], '6': [72, 85, 1, 50], '7': [65, 88, 1, 30], '8': [65, 70, -3, 30],
    '9': [75, 95, 1, 100], '10': [78, 92, 2, 60], '11': [68, 70, 0, 30], '12': [78, 70, -5, 100], '13': [68, 95, 1, 60],
    '14': [80, 75, -3, 100], '15': [68, 88, 2, 30], '16': [85, 70, 1, 50], '17': [78, 85, -2, 100], '18': [80, 92, 2, 60],
    '19': [70, 85, 0, 30], '20': [85, 90, 2, 50]
  };
  const TFS = ['30S', '45S'].concat(Array.from({ length: 20 }, (_, i) => String(i + 1)));
  // TFs whose side has an enable input (the others are always on)
  const LONG_TOGGLE = { '4': false, '6': true, '7': true, '8': true, '9': true, '10': true, '11': true, '12': true, '13': true, '14': true, '15': true, '16': true, '17': true, '18': true, '19': true, '20': true };
  const SHORT_TOGGLE = { '30S': true, '1': true, '4': false, '6': true, '7': true, '8': true, '9': true, '10': true, '11': true, '12': true, '13': true, '14': true, '15': true, '16': true, '17': true, '18': true, '19': true, '20': true };
  const LONG_WR = { '30S': '100%', '45S': '100%', '1': '100%', '2': '80%', '3': '100%', '4': '0%', '5': '100%', '6': '80%', '7': '100%', '8': '100%', '9': '67%', '10': '100%', '11': '100%', '12': '100%', '13': '100%', '14': '100%', '15': '75%', '16': '80%', '17': '100%', '18': '100%', '19': '86%', '20': '75%' };
  const SHORT_WR = { '30S': '~80%', '45S': '100%', '1': '~80%', '4': '0%' };
  TFS.forEach(k => { if (!SHORT_WR[k]) SHORT_WR[k] = '100%'; });

  function tfDefaults() {
    const o = {};
    for (const k of TFS) {
      const L = LONG[k], S = SHORT[k];
      o[k] = {
        longRsi: L[0], longK: L[1], longSlope: L[2], longAdx: L[3], longOn: k in LONG_TOGGLE ? LONG_TOGGLE[k] : true,
        shortRsi: S[0], shortK: S[1], shortSlope: S[2], shortAdx: S[3], shortOn: k in SHORT_TOGGLE ? SHORT_TOGGLE[k] : true
      };
    }
    return o;
  }

  const DEFAULTS = {
    chartTf: '5',
    emaFilter: 200, ema50: 50, ema20: 20, rsiLength: 14, rsiSlopeLength: 5,
    stochRsiLength: 14, stochRsiSmooth: 3, stochRsiSmoothD: 3,
    macdFast: 12, macdSlow: 26, macdSignal: 9, bbLength: 20, bbMult: 2.0,
    atrLength: 14, atrMultSL: 1.5, atrMultTP: 2.5, adxLength: 14,
    kcEmaLength: 20, kcAtrLength: 14, kcAtrMult: 1.5,
    minSqueezeBars: 3, squeezeVolMin: 1.2, squeezeMomMin: 0.1, enableSqueezeShort: true,
    adxTrendThreshold: 25, adxRangeThreshold: 20, atrPercLookback: 50, atrHighPercentile: 70, atrLowPercentile: 40,
    blockWeakUp: true, minConfidenceForAlert: 0.70,
    horizon: 300,
    tf: tfDefaults()
  };

  // ---------- series helpers ----------
  function nanArr(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = NaN; return a; }
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
      const x = src[i]; if (isNaN(x)) bad++; else sum += x;
      if (i >= len) { const y = src[i - len]; if (isNaN(y)) bad--; else sum -= y; }
      if (i >= len - 1 && !bad) out[i] = sum / len;
    }
    return out;
  }
  function stdev(src, len, mean) {
    const n = src.length, out = nanArr(n);
    for (let i = len - 1; i < n; i++) {
      if (isNaN(mean[i])) continue;
      let s = 0; for (let k = i - len + 1; k <= i; k++) { const d = src[k] - mean[i]; s += d * d; }
      out[i] = Math.sqrt(s / len);
    }
    return out;
  }
  function trueRange(h, l, c, handleNa) {
    const n = h.length, out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = i === 0 ? (handleNa ? h[i] - l[i] : NaN) : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    return out;
  }
  function rsiSeries(c, len) {
    const n = c.length, up = nanArr(n), dn = nanArr(n);
    for (let i = 1; i < n; i++) { const d = c[i] - c[i - 1]; up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0); }
    const u = rma(up, len), d = rma(dn, len);
    return u.map((x, i) => isNaN(x) || isNaN(d[i]) ? NaN : d[i] === 0 ? 100 : x === 0 ? 0 : 100 - 100 / (1 + x / d[i]));
  }
  function stochOf(src, len) {
    const n = src.length, out = nanArr(n);
    for (let i = len - 1; i < n; i++) {
      let hi = -Infinity, lo = Infinity, ok = true;
      for (let k = i - len + 1; k <= i; k++) { const x = src[k]; if (isNaN(x)) { ok = false; break; } if (x > hi) hi = x; if (x < lo) lo = x; }
      if (ok && hi > lo) out[i] = 100 * (src[i] - lo) / (hi - lo);
    }
    return out;
  }
  function dmi(h, l, c, len) {
    const n = h.length, pDM = nanArr(n), mDM = nanArr(n);
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
      pDM[i] = up > down && up > 0 ? up : 0; mDM[i] = down > up && down > 0 ? down : 0;
    }
    const tr = rma(trueRange(h, l, c, false), len), pS = rma(pDM, len), mS = rma(mDM, len);
    const dx = nanArr(n); let lp = NaN, lm = NaN;
    for (let i = 0; i < n; i++) {
      const p = 100 * pS[i] / tr[i], m = 100 * mS[i] / tr[i];
      if (isFinite(p)) lp = p; if (isFinite(m)) lm = m;
      const s = lp + lm; dx[i] = Math.abs(lp - lm) / (s === 0 ? 1 : s);
    }
    return rma(dx, len).map(x => 100 * x);
  }

  // ---------- timeframes (seconds) ----------
  const tfSeconds = k => /S$/.test(k) ? +k.slice(0, -1) : +k * 60;
  function detectTfSec(t) {
    const d = [];
    for (let i = 1; i < Math.min(t.length, 2000); i++) d.push(t[i] - t[i - 1]);
    d.sort((a, b) => a - b);
    return Math.max(1, Math.round((d[Math.floor(d.length / 2)] || 60000) / 1000));
  }
  function aggregate(src, sec) {
    const ms = sec * 1000, out = { t: [], o: [], h: [], l: [], c: [], v: [] };
    let k = -1, cur = null;
    for (let i = 0; i < src.t.length; i++) {
      const b = Math.floor(src.t[i] / ms);
      if (b !== cur) { cur = b; k++; out.t.push(b * ms); out.o.push(src.o[i]); out.h.push(src.h[i]); out.l.push(src.l[i]); out.c.push(src.c[i]); out.v.push(src.v[i] || 0); }
      else { if (src.h[i] > out.h[k]) out.h[k] = src.h[i]; if (src.l[i] < out.l[k]) out.l[k] = src.l[i]; out.c[k] = src.c[i]; out.v[k] += src.v[i] || 0; }
    }
    return out;
  }
  function chartBars(data, tfKey) {
    const base = data.tfSec || detectTfSec(data.t), want = tfSeconds(tfKey);
    if (want === base) return { bars: data, sec: base, exact: true };
    if (want > base && want % base === 0) return { bars: aggregate(data, want), sec: want, exact: true };
    return { bars: data, sec: base, exact: false };
  }
  const keyForSec = sec => sec % 60 ? sec + 'S' : String(sec / 60);

  // Pine str.tostring(x, "#.##")-style formatting
  function pfmt(x, d) {
    if (!isFinite(x)) return 'NaN';
    const f = Math.pow(10, d), r = Math.round(Math.abs(x) * f) / f;
    let s = r.toFixed(d).replace(/\.?0+$/, '');
    if (s === '') s = '0';
    return (x < 0 && r !== 0 ? '-' : '') + s;
  }

  // ---------- indicator ----------
  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    P.tf = Object.assign(tfDefaults(), (params && params.tf) || {});
    const cb = chartBars(data, P.chartTf);
    const B = cb.bars, { t, o, h, l, c } = B, v = B.v || new Array(B.t.length).fill(0);
    const n = t.length, tfKey = keyForSec(cb.sec);
    const known = tfKey in LONG;
    const TH = P.tf[known ? tfKey : '20'];

    const filterMA = ema(c, P.emaFilter), mediumMA = ema(c, P.ema50), shortMA = ema(c, P.ema20);
    const rsi = rsiSeries(c, P.rsiLength);
    const rsiSlope = rsi.map((x, i) => i >= P.rsiSlopeLength ? x - rsi[i - P.rsiSlopeLength] : NaN);
    const stochRsi = rsiSeries(c, P.stochRsiLength);
    const stochK = sma(stochOf(stochRsi, P.stochRsiLength), P.stochRsiSmooth);
    const fast = ema(c, P.macdFast), slow = ema(c, P.macdSlow);
    const macd = fast.map((x, i) => x - slow[i]);
    const sig = ema(macd, P.macdSignal);
    const hist = macd.map((x, i) => x - sig[i]);
    const bbBasis = sma(c, P.bbLength), bbSd = stdev(c, P.bbLength, bbBasis);
    const bbUpper = bbBasis.map((x, i) => x + P.bbMult * bbSd[i]), bbLower = bbBasis.map((x, i) => x - P.bbMult * bbSd[i]);
    const atr = rma(trueRange(h, l, c, true), P.atrLength);
    const adx = dmi(h, l, c, P.adxLength);
    const volSma = sma(v, 20), volSd = stdev(v, 20, volSma);
    const kcMid = ema(c, P.kcEmaLength), kcAtr = rma(trueRange(h, l, c, true), P.kcAtrLength);
    const kcUpper = kcMid.map((x, i) => x + kcAtr[i] * P.kcAtrMult), kcLower = kcMid.map((x, i) => x - kcAtr[i] * P.kcAtrMult);

    const longOn = known && TH.longOn, shortOn = known && TH.shortOn;
    const longAdxOK = x => TH.longAdx >= 100 || x < TH.longAdx;
    const shortAdxOK = x => TH.shortAdx >= 100 || x < TH.shortAdx;

    // per-bar outputs
    const regime = new Array(n), volRegime = new Array(n), squeezeOn = new Array(n).fill(false), squeezeFired = new Array(n).fill(false);
    const squeezeBars = new Array(n), atrPercentile = new Array(n), conf = new Array(n), longReady = new Array(n), shortReady = new Array(n);
    const volRatio = new Array(n), weakUp = new Array(n);
    const signals = [];   // every bar with a base or squeeze condition, with what happened to it
    const hist50 = [];
    let sqCount = 0, confidence = 0;
    const fl = { rsi: 0, slope: 0, k: 0, adx: 0, enabled: 0, weakUp: 0, conf: 0, alerts: 0 };
    const fs = { rsi: 0, slope: 0, k: 0, adx: 0, enabled: 0, weakUp: 0, conf: 0, alerts: 0 };
    const fq = { fired: 0, bear: 0, mom: 0, vol: 0, rsi: 0, weakUp: 0, conf: 0, alerts: 0, markersNoAlert: 0 };

    for (let i = 0; i < n; i++) {
      const above = c[i] > filterMA[i], below = c[i] < filterMA[i];
      const strongDown = below && shortMA[i] < mediumMA[i] && mediumMA[i] < filterMA[i];
      const strongUp = above && shortMA[i] > mediumMA[i] && mediumMA[i] > filterMA[i];
      volRatio[i] = v[i] / volSma[i];
      const lowVol = v[i] < volSma[i] - 2 * volSd[i];

      const sqOn = bbUpper[i] < kcUpper[i] && bbLower[i] > kcLower[i];
      squeezeOn[i] = sqOn;
      sqCount = sqOn ? sqCount + 1 : 0;
      squeezeBars[i] = sqCount;
      const fired = !sqOn && i > 0 && squeezeOn[i - 1];
      squeezeFired[i] = fired;
      const momDir = hist[i] > 0 ? 1 : hist[i] < 0 ? -1 : 0;
      const momPct = i >= 3 ? Math.abs(c[i] - c[i - 3]) / c[i - 3] * 100 : NaN;

      hist50.push(atr[i]); if (hist50.length > P.atrPercLookback) hist50.shift();
      let pct = 50;
      if (hist50.length >= 10) { let b = 0; for (const x of hist50) if (x <= atr[i]) b++; pct = b / hist50.length * 100; }
      atrPercentile[i] = pct;
      const trending = adx[i] >= P.adxTrendThreshold, ranging = adx[i] < P.adxRangeThreshold;
      const hiVol = pct >= P.atrHighPercentile;
      let vr;
      if (sqOn && sqCount >= P.minSqueezeBars) vr = 'SQUEEZE_BUILDING';
      else if (fired) vr = 'BREAKOUT_IMMINENT';
      else if (trending && hiVol) vr = 'TRENDING_HIGH_VOL';
      else if (trending) vr = 'TRENDING_LOW_VOL';
      else if (ranging && hiVol) vr = 'RANGING_HIGH_VOL';
      else if (ranging) vr = 'RANGING_LOW_VOL';
      else vr = 'TRANSITIONAL';
      volRegime[i] = vr;
      const rg = strongUp ? 'STRONG_TREND_UP' : strongDown ? 'STRONG_TREND_DOWN' : above ? 'WEAK_TREND_UP' : below ? 'WEAK_TREND_DOWN' : 'NEUTRAL';
      regime[i] = rg;
      const blocked = P.blockWeakUp && rg === 'WEAK_TREND_UP';
      weakUp[i] = blocked;

      // base conditions, step by step for the funnel
      const lc = [rsi[i] < TH.longRsi, rsiSlope[i] > TH.longSlope, stochK[i] < TH.longK, longAdxOK(adx[i]), longOn];
      const sc = [rsi[i] > TH.shortRsi, rsiSlope[i] < TH.shortSlope, stochK[i] > TH.shortK, shortAdxOK(adx[i]), shortOn];
      const longBase = lc.every(Boolean), shortBase = sc.every(Boolean);
      const sqShort = P.enableSqueezeShort && fired && momDir < 0 && momPct > P.squeezeMomMin && volRatio[i] > P.squeezeVolMin && rsi[i] > 25;
      const longSignal = longBase && !blocked;
      const shortSignal = (shortBase || sqShort) && !blocked;

      // confidence (var float: keeps its value on bars without a signal)
      if (longSignal) {
        const k = tfKey;
        let cf = k === '9' ? 0.72 : (k === '15' || k === '20') ? 0.78 : (k === '2' || k === '6' || k === '16') ? 0.82 : k === '19' ? 0.85 : 0.92;
        if (rsi[i] < 20) cf += 0.05; else if (rsi[i] < 25) cf += 0.03;
        if (stochK[i] < 3) cf += 0.04; else if (stochK[i] < 5) cf += 0.03;
        if (rsiSlope[i] > 2) cf += 0.02;
        if (vr === 'RANGING_HIGH_VOL') cf -= 0.08;
        else if (vr === 'TRENDING_HIGH_VOL' && !strongDown) cf += 0.04;
        else if (vr === 'SQUEEZE_BUILDING') cf -= 0.03;
        if (strongDown) cf -= 0.10;
        if (lowVol) cf -= 0.05;
        confidence = Math.min(cf, 0.98);
      }
      if (shortSignal) {
        let cf;
        if (sqShort && !shortBase) {
          cf = 0.85;
          if (momPct > 0.3) cf += 0.05;
          if (sqCount > 5) cf += 0.03;
          if (volRatio[i] > 2.0) cf += 0.04;
        } else {
          cf = (tfKey === '30S' || tfKey === '1') ? 0.85 : 0.92;
          if (rsi[i] > 80) cf += 0.04;
          if (stochK[i] > 95) cf += 0.03;
          if (rsiSlope[i] < -4) cf += 0.02;
        }
        if (vr === 'RANGING_HIGH_VOL') cf -= 0.08;
        else if (vr === 'TRENDING_HIGH_VOL' && !strongUp) cf += 0.04;
        if (strongUp) cf -= 0.10;
        if (lowVol) cf -= 0.05;
        confidence = Math.min(cf, 0.98);
      }
      conf[i] = confidence;
      const confOk = confidence >= P.minConfidenceForAlert - 1e-12;

      // funnels (first failing step)
      const tally = (F, steps) => { const f = steps.findIndex(x => !x[1]); if (f >= 0) F[steps[f][0]]++; else F.alerts++; };
      if (lc[0]) tally(fl, [['slope', lc[1]], ['k', lc[2]], ['adx', lc[3]], ['enabled', lc[4]], ['weakUp', !blocked], ['conf', confOk]]);
      if (sc[0]) tally(fs, [['slope', sc[1]], ['k', sc[2]], ['adx', sc[3]], ['enabled', sc[4]], ['weakUp', !blocked], ['conf', confOk]]);
      if (fired && P.enableSqueezeShort) tally(fq, [['bear', momDir < 0], ['mom', momPct > P.squeezeMomMin], ['vol', volRatio[i] > P.squeezeVolMin], ['rsi', rsi[i] > 25], ['weakUp', !blocked], ['conf', confOk]]);
      fl.rsi += lc[0] ? 1 : 0; fs.rsi += sc[0] ? 1 : 0; fq.fired += fired && P.enableSqueezeShort ? 1 : 0;

      const isSq = sqShort && !shortBase;
      const markerSq = isSq && confOk;  // plotshape is not gated by the WEAK_UP block
      if (markerSq && blocked) fq.markersNoAlert++;
      if (longBase || shortBase || sqShort) {
        const mk = (dir, type, alert) => {
          const slM = type === 'SQUEEZE' ? 1.2 : P.atrMultSL, tpM = type === 'SQUEEZE' ? 3.0 : P.atrMultTP;
          signals.push({
            i, dir, type, alert, blocked, conf: confidence, confOk, regime: rg, volRegime: vr,
            entry: c[i], sl: c[i] - dir * atr[i] * slM, tp: c[i] + dir * atr[i] * tpM, rr: tpM / slM,
            repeat: false, marker: type === 'SQUEEZE' ? markerSq : alert,
            m: { atr: atr[i], atrPct: atr[i] / c[i] * 100, adx: adx[i], rsi: rsi[i], rsiSlope: rsiSlope[i], stochK: stochK[i], hist: hist[i], sqOn, sqCount, fired, momDir, kcPos: (c[i] - kcLower[i]) / (kcUpper[i] - kcLower[i]), pct }
          });
        };
        if (longBase) mk(1, 'V73', longSignal && confOk);
        if (shortBase) mk(-1, 'V73', shortSignal && confOk);
        else if (sqShort) mk(-1, 'SQUEEZE', shortSignal && confOk);
      }
      longReady[i] = stochK[i] < TH.longK && rsi[i] < TH.longRsi && longAdxOK(adx[i]) && longOn && !blocked;
      shortReady[i] = stochK[i] > TH.shortK && rsi[i] > TH.shortRsi && shortAdxOK(adx[i]) && shortOn && !blocked;
    }

    // outcome of each alert: TP or SL first, from the next bar
    const lastAlert = { 1: -2, '-1': -2 };
    for (const s of signals) {
      if (!s.alert) continue;
      s.repeat = lastAlert[s.dir] === s.i - 1;
      lastAlert[s.dir] = s.i;
      s.outcome = 'abierta'; s.bars = null; s.r = 0;
      if (!isFinite(s.sl) || !isFinite(s.tp)) continue;
      const end = Math.min(n - 1, s.i + P.horizon);
      for (let j = s.i + 1; j <= end; j++) {
        const hitSL = s.dir > 0 ? l[j] <= s.sl : h[j] >= s.sl, hitTP = s.dir > 0 ? h[j] >= s.tp : l[j] <= s.tp;
        if (!hitSL && !hitTP) continue;
        let res;
        if (s.dir > 0 ? o[j] <= s.sl : o[j] >= s.sl) res = 'SL';
        else if (s.dir > 0 ? o[j] >= s.tp : o[j] <= s.tp) res = 'TP';
        else if (hitSL && hitTP) res = ((h[j] - o[j]) < (o[j] - l[j])) === (s.dir > 0) ? 'TP' : 'SL';
        else res = hitTP ? 'TP' : 'SL';
        s.outcome = res; s.bars = j - s.i; s.r = res === 'TP' ? s.rr : -1;
        break;
      }
      if (s.outcome === 'abierta' && end < n - 1) { s.outcome = 'caducada'; s.bars = P.horizon; }
    }

    const alerts = signals.filter(s => s.alert);
    const summarize = list => {
      const res = list.filter(s => s.outcome === 'TP' || s.outcome === 'SL');
      const tp = res.filter(s => s.outcome === 'TP').length;
      return {
        count: list.length, tp, sl: res.length - tp, open: list.length - res.length,
        tpRate: res.length ? tp / res.length * 100 : NaN,
        expR: res.length ? res.reduce((a, s) => a + s.r, 0) / res.length : NaN,
        repeats: list.filter(s => s.repeat).length
      };
    };
    const longA = alerts.filter(s => s.dir > 0), baseS = alerts.filter(s => s.dir < 0 && s.type === 'V73'), sqS = alerts.filter(s => s.type === 'SQUEEZE');
    const stats = {
      signals: alerts.length, all: summarize(alerts), long: summarize(longA), short: summarize(baseS), squeeze: summarize(sqS),
      weakUpPct: n ? weakUp.filter(Boolean).length / n * 100 : 0
    };

    return {
      params: P, n, bars: B, tfKey, known, tfExact: cb.exact, th: TH, decimals: inferDecimals(c),
      filterMA, mediumMA, shortMA, bbUpper, bbLower, kcUpper, kcLower, rsi, rsiSlope, stochK, adx, atr, hist,
      regime, volRegime, squeezeOn, squeezeFired, squeezeBars, atrPercentile, conf, longReady, shortReady, volRatio, weakUp,
      signals, funnel: { long: fl, short: fs, squeeze: fq }, stats,
      expectedWR: { long: known ? LONG_WR[tfKey] : 'N/A', short: known ? SHORT_WR[tfKey] : 'N/A' }
    };
  }

  function inferDecimals(c) {
    let dec = 0;
    for (let i = 0; i < Math.min(c.length, 300); i++) { const s = String(c[i]), p = s.indexOf('.'); if (p >= 0) dec = Math.max(dec, Math.min(8, s.length - p - 1)); }
    return dec;
  }

  // The JSON body the script sends with alert()
  function alertJson(res, s) {
    const m = s.m, tfp = res.tfKey, side = s.dir > 0 ? 'long' : 'short';
    const type = s.dir > 0 ? 'LONG_V73' : s.type === 'SQUEEZE' ? 'SHORT_SQUEEZE' : 'SHORT_V73';
    const strat = s.type === 'SQUEEZE' ? 'KELTNER_SQUEEZE' : 'RSI_STOCH_V73';
    let j = '{"signal":"' + side + '","symbol":"SOLUSD","timeframe":"' + tfp + '","price":' + pfmt(s.entry, 2) + ',"source":"Bot_Webhook_v84","confidence":' + pfmt(s.conf, 2)
      + ',"metadata":{"entry":' + pfmt(s.entry, 2) + ',"stop_loss":' + pfmt(s.sl, 2) + ',"take_profit":' + pfmt(s.tp, 2) + ',"atr":' + pfmt(m.atr, 2) + ',"atr_pct":' + pfmt(m.atrPct, 3)
      + ',"adx":' + pfmt(m.adx, 2) + ',"rsi":' + pfmt(m.rsi, 2) + ',"rsi_slope":' + pfmt(m.rsiSlope, 2) + ',"stoch_k":' + pfmt(m.stochK, 2) + ',"macd_hist":' + pfmt(m.hist, 2)
      + ',"signal_type":"' + type + '","strategy":"' + strat + '","regime":"' + s.regime + '","vol_regime":"' + s.volRegime + '","squeeze_on":' + (m.sqOn ? 1 : 0) + ',"squeeze_bars":' + m.sqCount;
    if (s.dir < 0) j += ',"squeeze_fired":' + (m.fired ? 1 : 0) + ',"mom_direction":' + m.momDir;
    j += ',"kc_position":' + pfmt(m.kcPos, 3) + ',"atr_percentile":' + pfmt(m.pct, 1) + ',"expected_wr":"' + (s.dir > 0 ? res.expectedWR.long : res.expectedWR.short) + '"}}';
    return j;
  }

  // ---------- sample data (synthetic, SOLUSD-like, 15 seconds, 24/7) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeSample(seed, days) {
    const rnd = mulberry32(seed >>> 0);
    const gauss = () => { let u = 0, w = 0; while (u === 0) u = rnd(); while (w === 0) w = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
    const out = { t: [], o: [], h: [], l: [], c: [], v: [], tfSec: 15 };
    const t0 = Date.UTC(2026, 1, 1), total = (days || 10) * 5760;
    let price = 140, logVol = 0, drift = 0, burst = 0;
    for (let k = 0; k < total; k++) {
      const t = t0 + k * 15000, hr = new Date(t).getUTCHours();
      const season = hr >= 13 && hr < 21 ? 1.3 : hr >= 7 && hr < 13 ? 1.0 : 0.7;
      logVol += 0.006 * gauss() - 0.0006 * logVol;
      if (rnd() < 0.0004) burst = 1 + 2 * rnd();
      burst *= 0.995;
      if (rnd() < 0.0008) drift = gauss() * 0.00004;
      drift *= 0.9997;
      const sigma = 0.0007 * season * Math.exp(logVol) * (1 + burst);
      const open = price;
      let p = open, hi = open, lo = open;
      for (let s = 0; s < 3; s++) { p *= 1 + drift / 3 + gauss() * sigma / Math.sqrt(3); if (p > hi) hi = p; if (p < lo) lo = p; }
      const r = x => Math.round(x * 100) / 100;
      out.t.push(t); out.o.push(r(open)); out.h.push(r(hi)); out.l.push(r(lo)); out.c.push(r(p));
      out.v.push(Math.round((hi - lo) / price * 3e6 * (0.5 + rnd()) * (1 + burst) + 50 * rnd()));
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
    const iV = find(['volume', 'vol', 'tick_volume', 'tickvol', 'volumen', 'real_volume']);
    if ([iT, iO, iH, iL, iC].some(x => x < 0)) throw new Error('Faltan columnas. Se necesitan: time, open, high, low, close y volume.');
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
    out.tfSec = detectTfSec(out.t);
    return out;
  }

  const api = { DEFAULTS, TFS, LONG_WR, SHORT_WR, LONG_TOGGLE, SHORT_TOGGLE, tfDefaults, tfSeconds, run, alertJson, makeSample, parseCSV, pfmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineSolBot = api;
})(typeof window !== 'undefined' ? window : this);
