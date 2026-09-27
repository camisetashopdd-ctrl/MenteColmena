/*
 * Motor de backtest: port a JavaScript del indicador
 * "Luxy UT GOD - UT-BOT Forecast" (Pine Script v6).
 *
 * El original es un `indicator`, no una `strategy`: no envía órdenes. Este motor
 * reproduce sus señales Buy/Sell, su stop sugerido y sus TP (múltiplos de R), y mide:
 *  - la estadística propia del indicador (señal ganadora = algún TP tocado antes que el SL);
 *  - un modelo de operación: entrada al cierre de la señal y salida en el SL, en el TP más
 *    lejano activado o al cierre de la siguiente señal, con el tamaño de su calculadora de riesgo.
 * Todo se evalúa al cierre de cada vela (como en el histórico de TradingView).
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    preset: 'Auto (from TF)', utKey: 1.2, utAtrPeriod: 7, classicUT: false,
    smartTrail: true, chopStrength: 1.0,
    enableLayer1: false, adxPeriod: 14, adxThreshold: 15, cooldownBars: 3, confirmBars: 1,
    assetType: 'Forex', adaptiveMode: 'Dynamic',
    useVolatility: false, volLookback: 50, volThresh: 1.2,
    useSwingFilter: false, swingLen: 8,
    usePctFilter: false, pctThr: 0.05,
    useDelay: false,
    useVolFilter: false, volSmaLen: 20, volThreshold: 1.0,
    useRsiFilter: false, rsiLen: 14, rsiOB: 70, rsiOS: 30,
    useHull: false, hullPeriod: 20,
    useSuperTrend: false, stAtrPeriod: 10, stMult: 3.0,
    useFullCandle: false,
    useZoneFilter: false, zoneWidthMult: 0.5, zonePivotLen: 10,
    slMethod: 'Smart Adaptive', slAtrLen: 14, slAtrMult: 1.5, slPctStop: 5.0, slTickStop: 50, slExtraTicks: 0,
    tp1On: true, tp15On: false, tp2On: true, tp3On: false, tpFreezeOnTouch: true,
    useMTF: false, mtfTimeframe: 'Auto (×4)', statsLookback: 60,
    divRsiLen: 14, divLookback: 5,
    riskMode: '% of Account', accountSize: 10000, riskPct: 1.0, riskFixed: 100,
    predMode: 'Standard', predSamples: 50
  };

  // ---------- series helpers (Pine semantics) ----------
  const nanArr = n => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = NaN; return a; };
  const div = (a, b) => (b === 0 || isNaN(a) || isNaN(b)) ? NaN : a / b; // Pine: x / 0 = na

  function smooth(src, len, alpha) {
    const n = src.length, out = nanArr(n);
    let prev = NaN, sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const x = src[i];
      if (isNaN(prev)) {
        if (isNaN(x)) { sum = 0; cnt = 0; continue; }
        sum += x; cnt++;
        if (cnt >= len) { prev = sum / len; out[i] = prev; }
      } else {
        if (!isNaN(x)) prev = alpha * x + (1 - alpha) * prev;
        out[i] = prev;
      }
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
  const rollSum = (src, len) => sma(src, len).map(x => x * len);

  function wma(src, len) {
    const n = src.length, out = nanArr(n), den = len * (len + 1) / 2;
    for (let i = len - 1; i < n; i++) {
      let s = 0, ok = true;
      for (let k = 0; k < len; k++) { const x = src[i - k]; if (isNaN(x)) { ok = false; break; } s += x * (len - k); }
      if (ok) out[i] = s / den;
    }
    return out;
  }

  function trueRange(h, l, c) {
    return h.map((x, i) => i === 0 ? x - l[i] : Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const atr = (h, l, c, len) => rma(trueRange(h, l, c), len);

  function rollExt(src, len, isMax) {
    const n = src.length, out = nanArr(n);
    for (let i = len - 1; i < n; i++) {
      let m = isMax ? -Infinity : Infinity;
      for (let k = i - len + 1; k <= i; k++) { const x = src[k]; if (isMax ? x > m : x < m) m = x; }
      if (isFinite(m)) out[i] = m;
    }
    return out;
  }

  function rsi(src, len) {
    const ch = src.map((x, i) => i === 0 ? NaN : x - src[i - 1]);
    const up = rma(ch.map(x => isNaN(x) ? NaN : Math.max(x, 0)), len);
    const dn = rma(ch.map(x => isNaN(x) ? NaN : Math.max(-x, 0)), len);
    return up.map((u, i) => isNaN(u) || isNaN(dn[i]) ? NaN : dn[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / dn[i]));
  }

  function adx(h, l, c, len) {
    const n = h.length, plusDM = new Array(n), minusDM = new Array(n);
    for (let i = 0; i < n; i++) {
      const up = i ? h[i] - h[i - 1] : NaN, dn = i ? l[i - 1] - l[i] : NaN;
      plusDM[i] = up > dn && up > 0 ? up : 0;
      minusDM[i] = dn > up && dn > 0 ? dn : 0;
    }
    const tr = rma(trueRange(h, l, c).map((x, i) => i === 0 ? NaN : x), len);
    const p = rma(plusDM, len).map((x, i) => 100 * x / tr[i]);
    const m = rma(minusDM, len).map((x, i) => 100 * x / tr[i]);
    const dx = p.map((x, i) => { const s = x + m[i]; return isNaN(s) ? NaN : 100 * Math.abs(x - m[i]) / (s === 0 ? 1 : s); });
    return rma(dx, len);
  }

  // Pivot confirmed at bar i for the bar i - right (left side strict, right side non-strict).
  function pivot(src, i, left, right, isHigh) {
    const cI = i - right;
    if (cI - left < 0) return NaN;
    const x = src[cI];
    if (isNaN(x)) return NaN;
    for (let k = cI - left; k <= i; k++) {
      if (k === cI) continue;
      const y = src[k];
      if (isNaN(y)) return NaN;
      if (isHigh ? (k < cI ? y >= x : y > x) : (k < cI ? y <= x : y < x)) return NaN;
    }
    return x;
  }

  // ---------- time helpers ----------
  const weekKey = t => Math.floor((Math.floor(t / 86400000) + 3) / 7);
  function inferTfMinutes(t) {
    const d = [];
    for (let i = 1; i < Math.min(t.length, 500); i++) d.push(t[i] - t[i - 1]);
    d.sort((a, b) => a - b);
    return d.length ? Math.max(1, Math.round(d[Math.floor(d.length / 2)] / 60000)) : 15;
  }
  function inferMintick(c) {
    let dec = 0;
    for (let i = 0; i < Math.min(c.length, 300); i++) {
      const s = String(c[i]); const p = s.indexOf('.');
      if (p >= 0) dec = Math.max(dec, Math.min(8, s.length - p - 1));
    }
    return Math.pow(10, -dec);
  }

  // Higher-timeframe EMA 9/21 trend, request.security(..., lookahead_off): the HTF value
  // updates on the chart bar that closes each HTF bar and holds until the next one closes.
  function htfTrend(t, c, bucket) {
    const n = t.length, out = new Array(n).fill(0);
    const e = { 9: NaN, 21: NaN }, sums = { 9: 0, 21: 0 };
    let k = 0, cur = 0;
    for (let i = 0; i < n; i++) {
      if (i < n - 1 && bucket(t[i + 1]) !== bucket(t[i])) {
        const x = c[i]; k++;
        for (const len of [9, 21]) {
          if (k < len) sums[len] += x;
          else if (k === len) e[len] = (sums[len] + x) / len;
          else e[len] = x * (2 / (len + 1)) + e[len] * (1 - 2 / (len + 1));
        }
        cur = e[9] > e[21] ? 1 : e[9] < e[21] ? -1 : 0;
      }
      out[i] = cur;
    }
    return out;
  }
  const BUCKETS = {
    '5': t => Math.floor(t / 300000), '15': t => Math.floor(t / 900000), '30': t => Math.floor(t / 1800000),
    '60': t => Math.floor(t / 3600000), '240': t => Math.floor(t / 14400000),
    'D': t => Math.floor(t / 86400000), 'W': weekKey
  };

  function autoHTF(tfMin) {
    if (tfMin < 1440) {
      const htfMins = tfMin * 4;
      if (htfMins < 60) return String(htfMins);
      if (htfMins < 240) return Math.floor(htfMins / 60) + 'H';
      if (htfMins < 1440) return '4H';
      return 'D';
    }
    if (tfMin < 10080) return 'W';
    return 'M';
  }
  const MTF_MAP = { '5m': '5', '15m': '15', '30m': '30', '1H': '60', '4H': '240', 'D': 'D', 'W': 'W' };

  // ---------- prediction helpers ----------
  function ewaAvg(arr, decay) {
    let sw = 0, sv = 0; const n = arr.length;
    for (let i = 0; i < n; i++) { const w = Math.pow(decay, n - 1 - i); sw += w; sv += arr[i] * w; }
    return sw > 0 ? sv / sw : 0;
  }
  function ewaStdev(arr, avg, decay) {
    let sw = 0, sq = 0; const n = arr.length;
    for (let i = 0; i < n; i++) { const w = Math.pow(decay, n - 1 - i); const d = arr[i] - avg; sw += w; sq += w * d * d; }
    return sw > 0 ? Math.sqrt(sq / sw) : 0;
  }
  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b), n = s.length;
    return n === 0 ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function p90(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)];
  }

  const ASSET_MULT = { Crypto: 1.5, Forex: 0.8, Futures: 1.2, Index: 0.9, 'Fund/ETF': 0.9, CFD: 1.0, Bond: 0.5, Stock: 1.0 };
  const TP_DEFS = [['tp1On', 'TP1', 1.0], ['tp15On', 'TP1.5', 1.5], ['tp2On', 'TP2', 2.0], ['tp3On', 'TP3', 3.0]];

  // ---------- backtest ----------
  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const { t, o, h, l, c, v } = data;
    const n = t.length;
    const tfMin = data.tfMin || inferTfMinutes(t);
    const mintick = data.mintick || inferMintick(c);

    // Preset resolution
    const autoStyle = tfMin < 1440 ? (tfMin <= 5 ? 'Scalping' : tfMin <= 60 ? 'Day Trading' : 'Swing') : tfMin < 10080 ? 'Swing' : 'Position';
    const effStyle = P.preset === 'Auto (from TF)' ? autoStyle : P.preset;
    const pick = (m, fallback) => P.classicUT ? fallback : (m[effStyle] !== undefined ? m[effStyle] : fallback);
    const effKey = pick({ Scalping: 1.0, 'Day Trading': 1.5, Swing: 2.0, Position: 2.5 }, P.utKey);
    const effAtr = pick({ Scalping: 7, 'Day Trading': 10, Swing: 14, Position: 20 }, P.utAtrPeriod);
    const effChop = P.classicUT ? 0 : pick({ Scalping: 1.3, 'Day Trading': 1.1, Swing: 1.0, Position: 0.9 }, P.chopStrength);
    const slManual = P.preset === 'Custom (manual)' || P.classicUT;
    const slMethod = slManual ? P.slMethod : 'ATR';
    const slAtrMult = slManual ? P.slAtrMult : ({ Scalping: 1.0, 'Day Trading': 1.3, Swing: 1.8, Position: 2.3 })[effStyle] || P.slAtrMult;
    const assetMult = ASSET_MULT[P.assetType] || 1.0;

    // Volatility / regime series
    const atr14 = atr(h, l, c, 14);
    const avgATR = sma(atr14, P.volLookback);
    const volatilityRatio = atr14.map((x, i) => avgATR[i] > 0 ? x / avgATR[i] : 1.0);
    const adaptiveMult = volatilityRatio.map(r => {
      if (P.adaptiveMode === 'Fixed') return 1.0;
      const aggr = P.adaptiveMode === 'Aggressive';
      return r < 0.8 ? (aggr ? 0.7 : 0.85) : r > 1.2 ? (aggr ? 1.3 : 1.15) : 1.0;
    });

    // Adaptive UT trailing stop
    const xATR = atr(h, l, c, effAtr);
    const vol20 = sma(v, 20);
    const volRatio = v.map((x, i) => div(x, vol20[i]));
    const absCh = c.map((x, i) => i === 0 ? NaN : Math.abs(x - c[i - 1]));
    const erVol = rollSum(absCh, 10);
    const stop = nanArr(n);
    for (let i = 0; i < n; i++) {
      const erChange = i >= 10 ? Math.abs(c[i] - c[i - 10]) : NaN;
      let er = div(erChange, erVol[i]); if (isNaN(er)) er = 0;
      const chopMult = (P.smartTrail && !P.classicUT) ? 1 + (1 - er) * effChop : 1.0;
      const baseKey = P.classicUT ? effKey : effKey * assetMult * adaptiveMult[i];
      const adaptiveKey = P.classicUT ? baseKey : baseKey * (isNaN(volRatio[i]) ? NaN : Math.max(0.8, Math.min(1.2, volRatio[i])));
      const dist = xATR[i] * adaptiveKey * chopMult;
      const prev = i > 0 ? stop[i - 1] : NaN;
      if (isNaN(prev)) stop[i] = c[i];
      else if (c[i] > prev && c[i - 1] > prev) stop[i] = Math.max(prev, c[i] - dist);
      else if (c[i] < prev && c[i - 1] < prev) stop[i] = Math.min(prev, c[i] + dist);
      else if (c[i] > prev) stop[i] = c[i] - dist;
      else stop[i] = c[i] + dist;
    }
    const barbuy = c.map((x, i) => x > stop[i]);
    const barsell = c.map((x, i) => x < stop[i]);
    const flipUp = c.map((x, i) => i > 0 && x > stop[i] && c[i - 1] <= stop[i - 1]);
    const flipDn = c.map((x, i) => i > 0 && x < stop[i] && c[i - 1] >= stop[i - 1]);

    // Filters
    const adxArr = adx(h, l, c, P.adxPeriod);
    const volSmaF = sma(v, P.volSmaLen);
    const rsiF = rsi(c, P.rsiLen);
    let hull = c.slice();
    if (P.useHull) {
      const wFull = wma(c, P.hullPeriod);
      const diffS = wma(c, Math.floor(P.hullPeriod / 2)).map((x, i) => 2 * x - wFull[i]);
      hull = wma(diffS, Math.round(Math.sqrt(P.hullPeriod)));
    }
    const lowC = rollExt(c, P.swingLen, false), highC = rollExt(c, P.swingLen, true);

    // SuperTrend (as written in the script)
    const stAtr = atr(h, l, c, P.stAtrPeriod);
    const stDir = new Array(n), stValue = nanArr(n), stStrength = nanArr(n);
    let ub = NaN, lb = NaN, prevUb = NaN, prevLb = NaN, dir = 1;
    for (let i = 0; i < n; i++) {
      const hl2 = (h[i] + l[i]) / 2, up = hl2 - P.stMult * stAtr[i], dn = hl2 + P.stMult * stAtr[i];
      prevUb = ub; prevLb = lb;
      ub = isNaN(prevUb) ? up : (up > prevUb || c[i - 1] < prevUb) ? up : prevUb;
      lb = isNaN(prevLb) ? dn : (dn < prevLb || c[i - 1] > prevLb) ? dn : prevLb;
      if (i > 0) dir = dir === -1 && c[i] > prevLb ? 1 : dir === 1 && c[i] < prevUb ? -1 : dir;
      stDir[i] = dir;
      stValue[i] = dir === 1 ? ub : lb;
      stStrength[i] = Math.min(100, Math.abs(c[i] - stValue[i]) / stAtr[i] * 25);
    }

    // Structure
    const sbHigh = rollExt(h, P.swingLen, true), sbLow = rollExt(l, P.swingLen, false);

    // MTF
    const htf = {};
    for (const k of Object.keys(BUCKETS)) htf[k] = htfTrend(t, c, BUCKETS[k]);
    const htfSel = P.mtfTimeframe === 'Auto (×4)' ? autoHTF(tfMin) : (MTF_MAP[P.mtfTimeframe] || '60');
    const htfUsed = htf[htfSel] ? htfSel : '60';
    const htfTr = htf[htfUsed];

    // Divergence
    const divRsi = rsi(c, P.divRsiLen);

    // SL helpers
    const slATR = atr(h, l, c, P.slAtrLen);
    const swingLowL = rollExt(l, P.swingLen, false), swingHighH = rollExt(h, P.swingLen, true);
    function calcSL(i, entry, isLong) {
      const s = isLong ? 1 : -1, a = slATR[i], atrPct = c[i] !== 0 ? a / c[i] * 100 : 1.0;
      let sl = NaN;
      switch (slMethod) {
        case 'ATR': sl = entry - s * a * slAtrMult; break;
        case '% Based': sl = entry * (1 - s * P.slPctStop / 100); break;
        case 'Tick Based': sl = entry - s * P.slTickStop * mintick; break;
        case 'Swing': {
          const sw = isLong ? swingLowL[i] : swingHighH[i];
          sl = !isNaN(sw) && (isLong ? sw < entry : sw > entry) ? sw : entry - s * a * 1.5; break;
        }
        case 'Scaled ATR': {
          const m = atrPct > 5 ? 2.5 : atrPct > 3 ? 2.0 : atrPct > 1.5 ? 1.5 : 1.2;
          sl = entry - s * Math.max(a * m, entry * 0.01); break;
        }
        case 'Smart Adaptive': {
          const m = atrPct > 3 ? 1.5 : atrPct > 1.5 ? 1.0 : 0.7;
          sl = entry - s * Math.max(a * m, entry * 0.01); break;
        }
        case 'Safer': {
          const atrSL = entry - s * a * slAtrMult, pctSL = entry * (1 - s * P.slPctStop / 100);
          let sw = isLong ? swingLowL[i] : swingHighH[i];
          if (isNaN(sw) || (isLong ? sw >= entry : sw <= entry)) sw = entry - s * a * 2;
          sl = isLong ? Math.min(atrSL, pctSL, sw) : Math.max(atrSL, pctSL, sw); break;
        }
      }
      if (isNaN(sl)) sl = entry - s * a * 1.5;
      return sl - s * xATR[i] * 0.10;
    }

    // ---- per-bar state ----
    let lastSignalBar = null, lastSignalDir = 0;
    let prevPL = NaN, prevPH = NaN, prevRL = NaN, prevRH = NaN;
    let lastDivType = 'None', lastDivBar = null;
    const zRes = [], zSup = []; // {price, touch, start}
    let nearRes = false, nearSup = false, nearResT = 0, nearSupT = 0;
    const conf = nanArr(n);
    const signals = [], legs = [];
    let leg = null;
    const st = { total: 0, wins: 0, losses: 0, totalBars: 0, winBars: 0 };
    // First outcome of the current leg (TP touched = win, SL touched = loss). The
    // indicator's own table only counts legs inside the "Stats Days" window.
    function markStat(i, kind) {
      leg.evalOpen = false; leg.stat = kind;
      if (kind === 'win') leg.statBars = i - leg.idx;
      if (!leg.inLookback) return;
      if (kind === 'win') { st.wins++; st.totalBars += i - leg.idx; st.winBars++; } else st.losses++;
    }
    const riskAmount = P.riskMode === 'Fixed Amount' ? P.riskFixed : P.accountSize * (P.riskPct / 100);
    const lookbackStart = n ? t[n - 1] - P.statsLookback * 86400000 : 0;
    const realized = new Array(n).fill(0);
    let realizedSum = 0;

    // Prediction state
    const pred = { bull: [], bear: [], all: [], cur: 0, isBull: true, avg: NaN, end: NaN, fallback: false, lastPred: [], lastAct: [] };

    const FKEYS = ['pct', 'swing', 'fullCandle', 'regime', 'cooldown', 'confirm', 'volume', 'volatility', 'rsi', 'hull', 'supertrend', 'mtf', 'zone', 'alternate'];
    const mkF = () => { const f = { total: 0, passed: 0 }; FKEYS.forEach(k => f[k] = 0); return f; };
    const funnel = { long: mkF(), short: mkF() };

    function registerZone(arr, price, tol, start, cur) {
      let match = -1;
      for (let k = 0; k < arr.length; k++) if (Math.abs(price - arr[k].price) <= tol) match = k;
      if (match >= 0) { arr[match].price = (arr[match].price + price) / 2; arr[match].touch++; return; }
      if (arr.length >= 3) {
        let worst = 0, wd = Math.abs(cur - arr[0].price);
        for (let k = 1; k < arr.length; k++) { const d = Math.abs(cur - arr[k].price); if (d > wd) { wd = d; worst = k; } }
        arr.splice(worst, 1);
      }
      arr.push({ price, touch: 1, start });
    }
    function zoneMatch(arr, tol, price) {
      let inside = false, touch = 0;
      for (const z of arr) if (Math.abs(price - z.price) <= tol) { inside = true; touch = z.touch; }
      return [inside, touch];
    }

    function closeLeg(i, price, reason) {
      if (!leg || leg.done) return;
      leg.done = true; leg.exitIdx = i; leg.exitPrice = price; leg.exitReason = reason;
      leg.pnl = leg.shares * leg.dir * (price - leg.entry);
      leg.r = leg.slRisk > 0 ? leg.dir * (price - leg.entry) / leg.slRisk : 0;
      realizedSum += leg.pnl;
    }
    const touchedLevel = (i, dirL, lvl) => dirL === 1 ? h[i] >= lvl : l[i] <= lvl;
    const hitSL = (i, lg) => { const tol = mintick * 0.51; return lg.dir === 1 ? l[i] <= lg.sl + tol : h[i] >= lg.sl - tol; };
    const gapFill = (i, lg, lvl, isStop) => {
      // Fill at the open when the bar gaps through the level
      if (lg.dir === 1) return isStop ? (o[i] < lvl ? o[i] : lvl) : (o[i] > lvl ? o[i] : lvl);
      return isStop ? (o[i] > lvl ? o[i] : lvl) : (o[i] < lvl ? o[i] : lvl);
    };

    for (let i = 0; i < n; i++) {
      // Divergence
      const pl = pivot(l, i, P.divLookback, P.divLookback, false), ph = pivot(h, i, P.divLookback, P.divLookback, true);
      const rpl = pivot(divRsi, i, P.divLookback, P.divLookback, false), rph = pivot(divRsi, i, P.divLookback, P.divLookback, true);
      let bullDiv = false, bearDiv = false;
      if (!isNaN(pl) && !isNaN(rpl)) {
        if (!isNaN(prevPL) && !isNaN(prevRL) && pl < prevPL && rpl > prevRL) bullDiv = true;
        prevPL = pl; prevRL = rpl;
      }
      if (!isNaN(ph) && !isNaN(rph)) {
        if (!isNaN(prevPH) && !isNaN(prevRH) && ph > prevPH && rph < prevRH) bearDiv = true;
        prevPH = ph; prevRH = rph;
      }
      if (bullDiv) { lastDivType = 'BULL'; lastDivBar = i; }
      if (bearDiv) { lastDivType = 'BEAR'; lastDivBar = i; }
      const barsSinceDiv = lastDivBar === null ? 999 : i - lastDivBar;

      // S/R zones
      const zoneTol = atr14[i] * P.zoneWidthMult, stale = c[i] * 0.06;
      for (const arr of [zRes, zSup]) for (let k = arr.length - 1; k >= 0; k--) if (Math.abs(c[i] - arr[k].price) > stale) arr.splice(k, 1);
      const zph = pivot(h, i, P.zonePivotLen, P.zonePivotLen, true), zpl = pivot(l, i, P.zonePivotLen, P.zonePivotLen, false);
      if (!isNaN(zph)) registerZone(zRes, zph, zoneTol, i - P.zonePivotLen, c[i]);
      if (!isNaN(zpl)) registerZone(zSup, zpl, zoneTol, i - P.zonePivotLen, c[i]);
      [nearRes, nearResT] = zoneMatch(zRes, zoneTol, c[i]);
      [nearSup, nearSupT] = zoneMatch(zSup, zoneTol, c[i]);

      // Prediction (trend durations)
      const fBull = barbuy[i] && !(i > 0 && barbuy[i - 1]);
      const fBear = barsell[i] && !(i > 0 && barsell[i - 1]);
      if (fBull || fBear) {
        const done = pred.cur;
        pred.cur = 1;
        if (done > 1) {
          (pred.isBull ? pred.bull : pred.bear).push(done); pred.all.push(done);
          for (const a of [pred.all, pred.bull, pred.bear]) while (a.length > P.predSamples) a.shift();
          if (!isNaN(pred.end)) {
            pred.lastPred.push(pred.end); pred.lastAct.push(done);
            if (pred.lastPred.length > 10) { pred.lastPred.shift(); pred.lastAct.shift(); }
          }
        }
        pred.isBull = fBull;
        const rel = pred.isBull ? pred.bull : pred.bear;
        if (rel.length >= 3) {
          pred.fallback = false;
          if (P.predMode === 'Simple') { const m = median(rel); pred.avg = m; pred.end = m * 2.5; }
          else { const a = ewaAvg(rel, 0.9); pred.avg = a; pred.end = a + 2 * ewaStdev(rel, a, 0.9); }
        } else {
          pred.fallback = true;
          const all = pred.all;
          if (all.length >= 3) { const a = ewaAvg(all, 0.9); pred.avg = a; pred.end = a + 2 * ewaStdev(all, a, 0.9); }
          else if (all.length >= 1) { const a = ewaAvg(all, 0.9); pred.avg = a; pred.end = a * 2.5; }
          else { pred.avg = 8; pred.end = 16; }
        }
        const capArr = rel.length >= 3 ? rel : pred.all;
        if (!isNaN(pred.end) && capArr.length >= 3) { const q = p90(capArr); if (q > 0) pred.end = Math.min(pred.end, q); }
      } else pred.cur++;

      // Confidence score (every bar)
      const sbMid = (sbHigh[i - 1] + sbLow[i - 1]) / 2, sbHalf = (sbHigh[i - 1] - sbLow[i - 1]) / 2;
      const sbBullBreak = c[i] > sbHigh[i - 1], sbBearBreak = c[i] < sbLow[i - 1];
      const sbBreakStr = Math.min(100, Math.max(sbBullBreak ? c[i] - sbHigh[i - 1] : 0, sbBearBreak ? sbLow[i - 1] - c[i] : 0) / atr14[i] * 30);
      const sbPosStr = sbHalf > 0 ? Math.min(100, Math.abs(c[i] - sbMid) / sbHalf * 100) : 0;
      const sbStrength = sbBullBreak || sbBearBreak ? sbBreakStr : sbPosStr;
      const sbBull = c[i] > sbMid, sbBear = c[i] <= sbMid;
      const regimeOk = !P.enableLayer1 || adxArr[i] >= P.adxThreshold;
      const bb = barbuy[i], bs = barsell[i];
      const stBull = stDir[i] === 1, stBear = stDir[i] === -1;
      const stAl = (bb && stBull) || (bs && stBear), sbAl = (bb && sbBull) || (bs && sbBear);
      const mtfAl = (bb && htfTr[i] >= 0) || (bs && htfTr[i] <= 0);
      const vr = volRatio[i];
      const divRecent = barsSinceDiv <= P.divLookback * 4;
      const divAl = divRecent && ((bb && lastDivType === 'BULL') || (bs && lastDivType === 'BEAR'));
      const divOp = divRecent && ((bb && lastDivType === 'BEAR') || (bs && lastDivType === 'BULL'));
      let score = (bb || bs ? 26 : 13)
        + (stAl ? 12 + stStrength[i] / 100 * 9 : 4)
        + (sbAl ? 11 + sbStrength / 100 * 7 : 4)
        + (regimeOk ? 13 : 4) + (mtfAl ? 8 : 2)
        + (vr >= 2 ? 10 : vr >= 1.5 ? 8 : vr >= 1 ? 6 : 3)
        + (divAl ? 4 : divOp ? 0 : 2);
      conf[i] = Math.min(100, Math.max(0, score));

      // Signals
      const atrPct = c[i] !== 0 ? xATR[i] / c[i] * 100 : 0;
      const thr = Math.max(P.pctThr, Math.min(atrPct, 20) * 0.5);
      const chgOk = !P.usePctFilter || (i > 0 && Math.abs(c[i] - c[i - 1]) / c[i - 1] * 100 > thr);
      const cooldownOk = P.cooldownBars === 0 || lastSignalBar === null || i - lastSignalBar >= P.cooldownBars;
      const volOk = !P.useVolFilter || v[i] >= volSmaF[i] * P.volThreshold;
      const volatOk = !P.useVolatility || volatilityRatio[i] >= P.volThresh;
      const evalSide = isBuy => {
        const base = P.useDelay
          ? (i > 1 && (isBuy ? flipUp[i - 2] : flipDn[i - 2]) && (isBuy ? barbuy[i - 1] && barbuy[i - 2] : barsell[i - 1] && barsell[i - 2]))
          : (isBuy ? flipUp[i] : flipDn[i]);
        if (!base) return null;
        let confirmOk = true;
        for (let k = 1; k < P.confirmBars; k++) {
          if (i - k < 0) break;
          if (isBuy ? c[i - k] <= stop[i - k] : c[i - k] >= stop[i - k]) { confirmOk = false; break; }
        }
        return [
          ['pct', chgOk],
          ['swing', !P.useSwingFilter || (isBuy ? c[i] > lowC[i] * 1.01 : c[i] < highC[i] * 0.99)],
          ['fullCandle', isBuy ? c[i] > stop[i] && (!P.useFullCandle || l[i] > stop[i]) : c[i] < stop[i] && (!P.useFullCandle || h[i] < stop[i])],
          ['regime', regimeOk], ['cooldown', cooldownOk], ['confirm', confirmOk],
          ['volume', volOk], ['volatility', volatOk],
          ['rsi', !P.useRsiFilter || (isBuy ? rsiF[i] < P.rsiOB : rsiF[i] > P.rsiOS)],
          ['hull', !P.useHull || (isBuy ? c[i] > hull[i] : c[i] < hull[i])],
          ['supertrend', !P.useSuperTrend || (isBuy ? stBull : stBear)],
          ['mtf', !P.useMTF || (isBuy ? htfTr[i] >= 0 : htfTr[i] <= 0)],
          ['zone', !P.useZoneFilter || (isBuy ? !nearRes : !nearSup)],
          ['alternate', lastSignalDir !== (isBuy ? 1 : -1)]
        ];
      };
      let utBuy = false, utSell = false;
      for (const isBuy of [true, false]) {
        const checks = evalSide(isBuy);
        if (!checks) continue;
        const f = isBuy ? funnel.long : funnel.short;
        f.total++;
        const fail = checks.find(x => !x[1]);
        if (fail) f[fail[0]]++; else { f.passed++; if (isBuy) utBuy = true; else utSell = true; }
      }
      if (utBuy) { lastSignalBar = i; lastSignalDir = 1; }
      if (utSell) { lastSignalBar = i; lastSignalDir = -1; }
      const commit = utBuy || utSell;

      // Previous leg on a new signal bar: TP checked first, then SL (as in the script)
      if (commit && leg) {
        if (leg.evalOpen && i > leg.idx && leg.tps.some(tp => !tp.frozen && touchedLevel(i, leg.dir, tp.price))) markStat(i, 'win');
        if (!leg.slFrozen && leg.evalOpen && hitSL(i, leg)) markStat(i, 'loss');
        if (!leg.done) {
          if (!isNaN(leg.farTP) && touchedLevel(i, leg.dir, leg.farTP)) closeLeg(i, gapFill(i, leg, leg.farTP, false), leg.farName);
          else if (!leg.slFrozen && hitSL(i, leg)) closeLeg(i, gapFill(i, leg, leg.sl, true), 'SL');
          else closeLeg(i, c[i], 'Señal contraria');
        }
      }

      if (commit) {
        const isLong = utBuy, entry = c[i];
        const baseSl = calcSL(i, entry, isLong);
        const extra = P.slExtraTicks * mintick;
        let sl = isLong ? baseSl - extra : baseSl + extra;
        const minFloor = xATR[i] * 1.5 + xATR[i] * 0.10 + extra;
        if (isLong && sl >= entry) sl = entry - minFloor;
        if (!isLong && sl <= entry) sl = entry + minFloor;
        const risk = Math.abs(entry - baseSl), dirL = isLong ? 1 : -1;
        const tps = TP_DEFS.filter(d => P[d[0]]).map(d => ({ name: d[1], price: entry + dirL * risk * d[2], frozen: false, hit: false }));
        const far = tps.length ? tps[tps.length - 1] : null;
        const inLookback = t[i] >= lookbackStart;
        if (inLookback) st.total++;
        const slRisk = Math.abs(entry - sl);
        const star = isLong ? (lastDivType === 'BULL' && barsSinceDiv <= P.divLookback * 4) : (lastDivType === 'BEAR' && barsSinceDiv <= P.divLookback * 4);
        leg = {
          idx: i, dir: dirL, entry, baseSl, sl, slRisk, tps,
          farTP: far ? far.price : NaN, farName: far ? far.name : '',
          shares: slRisk > 0 ? Math.floor(riskAmount / slRisk) : 0,
          conf: conf[i], star, inLookback, stat: null, statBars: null, evalOpen: true,
          slFrozen: false, done: false, exitIdx: null, exitPrice: NaN, exitReason: '', pnl: 0, r: 0
        };
        legs.push(leg);
        signals.push({ i, dir: dirL, conf: conf[i], star });
      }

      if (leg) {
        // SL touch (checked before the TPs on ordinary bars)
        if (!leg.slFrozen && i > leg.idx && hitSL(i, leg)) {
          leg.slFrozen = true;
          leg.tps.forEach(tp => tp.frozen = true);
          if (leg.evalOpen) markStat(i, 'loss');
          closeLeg(i, gapFill(i, leg, leg.sl, true), 'SL');
        }
        // TP freeze-on-touch: first TP touched = win in the indicator's stats
        if (P.tpFreezeOnTouch && !leg.done && !commit && i > leg.idx) {
          for (const tp of leg.tps) {
            if (!tp.frozen && touchedLevel(i, leg.dir, tp.price)) {
              tp.frozen = true; tp.hit = true;
              if (leg.evalOpen) markStat(i, 'win');
            }
          }
        }
        // Farthest TP closes the leg
        if (!leg.done && !commit && i > leg.idx && !isNaN(leg.farTP) && touchedLevel(i, leg.dir, leg.farTP)) {
          leg.tps.forEach(tp => { tp.frozen = true; tp.hit = true; });
          leg.slFrozen = true;
          closeLeg(i, gapFill(i, leg, leg.farTP, false), leg.farName);
        }
      }

      realized[i] = realizedSum;
    }

    // Mark open leg to market
    const openLeg = legs.find(x => !x.done) || null;
    const openPnl = openLeg ? openLeg.shares * openLeg.dir * (c[n - 1] - openLeg.entry) : 0;
    const equity = realized.map(x => P.accountSize + x);
    if (n && openLeg) for (let i = openLeg.idx + 1; i < n; i++) equity[i] += openLeg.shares * openLeg.dir * (c[i] - openLeg.entry);

    const closed = legs.filter(x => x.done);
    const wins = closed.filter(x => x.pnl > 0);
    const gp = wins.reduce((s, x) => s + x.pnl, 0), gl = -closed.filter(x => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
    let peak = -Infinity, maxDd = 0, maxDdPct = 0;
    for (const e of equity) { if (e > peak) peak = e; const d = peak - e; if (d > maxDd) maxDd = d; if (peak > 0 && d / peak > maxDdPct) maxDdPct = d / peak; }
    const allStat = legs.filter(x => x.stat !== null || x.done);
    const statAllWins = legs.filter(x => x.stat === 'win').length;

    const last = n - 1;
    let successes = 0;
    for (let k = 0; k < pred.lastAct.length; k++) if (pred.lastAct[k] <= Math.floor(pred.lastPred[k])) successes++;

    return {
      params: P, n, tfMin, mintick, effStyle, effKey, effAtr, effChop, slMethod, slAtrMult, assetMult,
      stop, stValue, stDir, barbuy, barsell, conf, signals, legs,
      equity, htf, htfSel, htfUsed,
      funnel,
      indicatorStats: st,
      stats: {
        signals: legs.length,
        trades: closed.length,
        wins: wins.length,
        winRate: closed.length ? wins.length / closed.length * 100 : NaN,
        profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN),
        netProfit: realizedSum, netProfitPct: realizedSum / P.accountSize * 100,
        openPnl, maxDd, maxDdPct: maxDdPct * 100,
        avgR: closed.length ? closed.reduce((s, x) => s + x.r, 0) / closed.length : NaN,
        tpFirstRate: legs.length ? statAllWins / legs.length * 100 : NaN,
        tpFirstWins: statAllWins
      },
      table: n ? {
        confidence: conf[last], adaptiveMult: adaptiveMult[last], volatilityRatio: volatilityRatio[last],
        signal: barbuy[last] ? 'BULLISH' : barsell[last] ? 'BEARISH' : 'NEUTRAL',
        lastDivType, barsSinceDiv: lastDivBar === null ? 999 : last - lastDivBar,
        adx: adxArr[last], rsi: rsiF[last], volRatio: volRatio[last],
        stDir: stDir[last], stStrength: stStrength[last],
        nearRes, nearSup, nearResT, nearSupT, zRes: zRes.slice(), zSup: zSup.slice(), zoneTol: atr14[last] * P.zoneWidthMult,
        sbHigh: sbHigh[last], sbLow: sbLow[last],
        pred: {
          avg: pred.avg, end: pred.end, fallback: pred.fallback, cur: pred.cur, isBull: pred.isBull,
          bull: pred.bull.length, bear: pred.bear.length, all: pred.all.length,
          successRate: pred.lastAct.length ? successes / pred.lastAct.length * 100 : NaN, successN: pred.lastAct.length
        },
        cooldownBars: lastSignalBar === null ? 999 : last - lastSignalBar
      } : null
    };
  }

  // ---------- sample data (synthetic, EURUSD-like, 15 minutes) ----------
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
    out.mintick = 0.00001;
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
    if (rows.length < 100) throw new Error('Se leyeron ' + rows.length + ' velas válidas; hacen falta al menos 100.');
    rows.sort((a, b) => a[0] - b[0]);
    const out = { t: [], o: [], h: [], l: [], c: [], v: [], hasVolume: iV >= 0 };
    for (const r of rows) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(isFinite(r[5]) ? r[5] : 0); }
    return out;
  }

  const api = { DEFAULTS, run, makeSample, parseCSV, inferTfMinutes, inferMintick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineLuxy = api;
})(typeof window !== 'undefined' ? window : this);
