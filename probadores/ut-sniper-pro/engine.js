/*
 * Motor de backtest: port a JavaScript del indicador "UT Sniper Pro" (Pine Script v6).
 *
 * El indicador lleva su propia gestión de operaciones (variable `state`): entra al cierre
 * de la vela de señal y cierra en TP2, en el SL o en la entrada después de haber tocado
 * TP1 ("TP1 > ENTRY"). Este motor reproduce esa máquina de estados vela a vela, con el
 * mismo orden de comprobaciones que el script, y cuenta el resultado en R: TP2 = +TP2 R,
 * SL = −1 R, TP1 > ENTRY = 0 R.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    a: 2.0, c: 10, useHA: false,
    minAtrMult: 0.5, maxAtrMult: 1.5,
    pivLen: 4, divLookback: 20,
    useMacd: false, macdFast: 12, macdSlow: 26, macdSig: 9, maxHistRatio: 1.0,
    bbLen: 200, bbStd: 2.0,
    minSetupBars: 2, maxSetupBars: 10,
    useFomo: true, maxFomoCandles: 2,
    useAtrFilter: true, atrLookback: 75, maxAtrIncrease: 1.3,
    maxBbPctLong: 0.3, minBbPctShort: 0.7,
    slAtrMult: 2.0, tp1Mult: 1.5, tp2Mult: 2.0,
    accountSize: 10000, riskPct: 1.0
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
  const trueRange = (h, l, c) => h.map((x, i) => i === 0 ? x - l[i] : Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  const atr = (h, l, c, len) => rma(trueRange(h, l, c), len);

  // ta.bb: basis = SMA, deviation = population standard deviation
  function bb(src, len, mult) {
    const n = src.length, mid = nanArr(n), up = nanArr(n), lo = nanArr(n);
    for (let i = len - 1; i < n; i++) {
      let s = 0;
      for (let k = i - len + 1; k <= i; k++) s += src[k];
      const m = s / len;
      let q = 0;
      for (let k = i - len + 1; k <= i; k++) { const d = src[k] - m; q += d * d; }
      const sd = Math.sqrt(q / len);
      mid[i] = m; up[i] = m + mult * sd; lo[i] = m - mult * sd;
    }
    return [mid, up, lo];
  }

  // Pivot confirmed at bar i for bar i - len (left side strict, right side non-strict)
  function pivot(src, i, len, isHigh) {
    const cI = i - len;
    if (cI - len < 0) return NaN;
    const x = src[cI];
    for (let k = cI - len; k <= i; k++) {
      if (k === cI) continue;
      const y = src[k];
      if (isHigh ? (k < cI ? y >= x : y > x) : (k < cI ? y <= x : y < x)) return NaN;
    }
    return x;
  }

  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const { t, o, h, l, c } = data;
    const n = t.length;
    const src = P.useHA ? c.map((x, i) => (o[i] + h[i] + l[i] + x) / 4) : c.slice();

    // UT Bot (nz(stop[1], 0) as in the script)
    const xATR = atr(h, l, c, P.c);
    const stop = nanArr(n), pos = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const prevRaw = i > 0 ? stop[i - 1] : NaN, prev = isNaN(prevRaw) ? 0 : prevRaw;
      const s1 = i > 0 ? src[i - 1] : NaN, loss = P.a * xATR[i];
      stop[i] = src[i] > prev && s1 > prev ? Math.max(prev, src[i] - loss)
        : src[i] < prev && s1 < prev ? Math.min(prev, src[i] + loss)
        : src[i] > prev ? src[i] - loss : src[i] + loss;
      pos[i] = s1 < prev && src[i] > prev ? 1 : s1 > prev && src[i] < prev ? -1 : (i > 0 ? pos[i - 1] : 0);
    }

    const [bbMid, bbUp, bbLo] = bb(src, P.bbLen, P.bbStd);
    const slowE = ema(src, P.macdSlow), fastE = ema(src, P.macdFast);
    const macdLine = fastE.map((x, i) => x - slowE[i]);
    const sig = ema(macdLine, P.macdSig);
    const hist = macdLine.map((x, i) => x - sig[i]);

    const L = P.pivLen;
    let lastPh = NaN, lastPhHist = NaN, lastPhBar = 0;
    let lastPl = NaN, lastPlHist = NaN, lastPlBar = 0;
    let longSetup = false, shortSetup = false, longSetupBar = 0, shortSetupBar = 0, longSetupPl = NaN, shortSetupPh = NaN;
    let state = 0, entryP = NaN, slP = NaN, tp1P = NaN, tp2P = NaN, tp1Hit = false;
    const counts = { total: 0, tp1Back: 0, tp2: 0, sl: 0, current: 'NONE' };
    const trades = [], setups = [];
    let trade = null, curSetup = { long: null, short: null };
    const riskCash = P.accountSize * P.riskPct / 100;
    let realized = 0;
    const equity = new Array(n);

    const mkF = () => ({ pivots: 0, lowerLow: 0, inLookback: 0, macd: 0, bbTouch: 0, expired: 0, bbOpposite: 0, invalidated: 0, replaced: 0, entries: 0, pending: 0,
      block: { inTrade: 0, early: 0, pos: 0, candle: 0, color: 0, zone: 0, macdHist: 0, fomo: 0, atr: 0 } });
    const funnel = { long: mkF(), short: mkF() };

    const endSetup = (side, i, reason) => {
      const s = curSetup[side]; if (!s) return;
      s.end = i; s.reason = reason; curSetup[side] = null;
      funnel[side === 'long' ? 'long' : 'short'][reason]++;
    };

    for (let i = 0; i < n; i++) {
      const ph = pivot(src, i, L, true), pl = pivot(src, i, L, false);
      const prevPl = lastPl, prevPlHist = lastPlHist, prevPlBar = lastPlBar;
      const prevPh = lastPh, prevPhHist = lastPhHist, prevPhBar = lastPhBar;
      const hc = i >= L ? hist[i - L] : NaN;
      if (!isNaN(ph)) { lastPh = ph; lastPhHist = hc; lastPhBar = i - L; }
      if (!isNaN(pl)) { lastPl = pl; lastPlHist = hc; lastPlBar = i - L; }

      // Divergence setups
      const nzH = (x, d) => isNaN(x) ? d : x;
      const evalDiv = (isBuy) => {
        const pv = isBuy ? pl : ph;
        if (isNaN(pv)) return false;
        const f = isBuy ? funnel.long : funnel.short;
        f.pivots++;
        const prevV = isBuy ? prevPl : prevPh, prevB = isBuy ? prevPlBar : prevPhBar, prevH = isBuy ? prevPlHist : prevPhHist;
        if (!(isBuy ? pv < prevV : pv > prevV)) return false;
        f.lowerLow++;
        if (!((i - L) - prevB <= P.divLookback)) return false;
        f.inLookback++;
        const ratioOk = Math.abs(hc) <= P.maxHistRatio * Math.abs(nzH(prevH, hc));
        const macdOk = !P.useMacd || ((isBuy ? hc > nzH(prevH, hc) : hc < nzH(prevH, hc)) && ratioOk);
        if (!macdOk) return false;
        f.macd++;
        if (!(isBuy ? l[i - L] <= bbLo[i - L] : h[i - L] >= bbUp[i - L])) return false;
        f.bbTouch++;
        return { prevBar: prevB, prevVal: prevV };
      };
      const buyDiv = evalDiv(true), sellDiv = evalDiv(false);
      if (buyDiv) {
        endSetup('short', i, 'replaced'); if (curSetup.long) endSetup('long', i, 'replaced');
        longSetup = true; shortSetup = false; longSetupBar = i; longSetupPl = pl;
        curSetup.long = { side: 'long', bar: i, pivBar: i - L, pivVal: pl, prevBar: buyDiv.prevBar, prevVal: buyDiv.prevVal, end: null, reason: null };
        setups.push(curSetup.long);
      }
      if (sellDiv) {
        endSetup('long', i, 'replaced'); if (curSetup.short) endSetup('short', i, 'replaced');
        shortSetup = true; longSetup = false; shortSetupBar = i; shortSetupPh = ph;
        curSetup.short = { side: 'short', bar: i, pivBar: i - L, pivVal: ph, prevBar: sellDiv.prevBar, prevVal: sellDiv.prevVal, end: null, reason: null };
        setups.push(curSetup.short);
      }
      if (longSetup && ((i - longSetupBar) > P.maxSetupBars || h[i] >= bbUp[i] || c[i] < longSetupPl)) {
        longSetup = false;
        endSetup('long', i, (i - longSetupBar) > P.maxSetupBars ? 'expired' : h[i] >= bbUp[i] ? 'bbOpposite' : 'invalidated');
      }
      if (shortSetup && ((i - shortSetupBar) > P.maxSetupBars || l[i] <= bbLo[i] || c[i] > shortSetupPh)) {
        shortSetup = false;
        endSetup('short', i, (i - shortSetupBar) > P.maxSetupBars ? 'expired' : l[i] <= bbLo[i] ? 'bbOpposite' : 'invalidated');
      }

      // Entry conditions
      const body = Math.abs(c[i] - o[i]);
      const validCandle = body > P.minAtrMult * xATR[i] && body < P.maxAtrMult * xATR[i];
      const green = c[i] > o[i], red = c[i] < o[i];
      const range = bbUp[i] - bbLo[i];
      const longZone = c[i] <= bbLo[i] + range * P.maxBbPctLong;
      const shortZone = c[i] >= bbLo[i] + range * P.minBbPctShort;
      const histUp = i > 0 && hist[i] > hist[i - 1], histDn = i > 0 && hist[i] < hist[i - 1];
      let pg = NaN, pr = NaN;
      if (i - P.maxFomoCandles >= 0) {
        pg = 0; pr = 0;
        for (let k = i - P.maxFomoCandles; k < i; k++) { if (c[k] > o[k]) pg++; if (c[k] < o[k]) pr++; }
      }
      const noFomoLong = !P.useFomo || pg < P.maxFomoCandles;
      const noFomoShort = !P.useFomo || pr < P.maxFomoCandles;
      const pastAtr = i >= P.atrLookback && !isNaN(xATR[i - P.atrLookback]) ? xATR[i - P.atrLookback] : xATR[i];
      const atrOk = !P.useAtrFilter || xATR[i] <= pastAtr * P.maxAtrIncrease;

      const sideChecks = isBuy => [
        ['inTrade', state === 0],
        ['early', (i - (isBuy ? longSetupBar : shortSetupBar)) >= P.minSetupBars],
        ['pos', pos[i] === (isBuy ? 1 : -1)],
        ['candle', validCandle],
        ['color', isBuy ? green : red],
        ['zone', isBuy ? longZone : shortZone],
        ['macdHist', isBuy ? histUp : histDn],
        ['fomo', isBuy ? noFomoLong : noFomoShort],
        ['atr', atrOk]
      ];
      let longCond = false, shortCond = false;
      if (longSetup) {
        const ch = sideChecks(true), fail = ch.find(x => !x[1]);
        if (fail) funnel.long.block[fail[0]]++; else longCond = true;
      }
      if (shortSetup) {
        const ch = sideChecks(false), fail = ch.find(x => !x[1]);
        if (fail) funnel.short.block[fail[0]]++; else shortCond = true;
      }

      const open = (dir, side) => {
        state = dir; entryP = c[i];
        slP = c[i] - dir * xATR[i] * P.slAtrMult;
        const risk = Math.abs(entryP - slP);
        tp1P = entryP + dir * risk * P.tp1Mult; tp2P = entryP + dir * risk * P.tp2Mult;
        tp1Hit = false; counts.total++; counts.current = dir > 0 ? 'LONG' : 'SHORT';
        const s = curSetup[side];
        trade = { dir, idx: i, entry: entryP, sl: slP, tp1: tp1P, tp2: tp2P, risk, setupBar: s ? s.bar : null, tp1Idx: null, exitIdx: null, exitPrice: NaN, outcome: null, r: 0, pnl: 0 };
        trades.push(trade);
        funnel[side].entries++;
        if (s) { s.end = i; s.reason = 'entry'; curSetup[side] = null; }
      };
      if (longCond) { longSetup = false; open(1, 'long'); }
      if (shortCond) { shortSetup = false; open(-1, 'short'); }

      // Close trade (runs on the entry bar too, as in the script)
      if (state !== 0) {
        const d = state;
        if (d === 1 ? h[i] >= tp1P : l[i] <= tp1P) { if (!tp1Hit) trade.tp1Idx = i; tp1Hit = true; }
        let outcome = null, px = NaN;
        if (tp1Hit && (d === 1 ? l[i] <= entryP : h[i] >= entryP)) { outcome = 'TP1 > ENTRY'; px = entryP; counts.tp1Back++; }
        else if (d === 1 ? h[i] >= tp2P : l[i] <= tp2P) { outcome = 'TP2'; px = tp2P; counts.tp2++; }
        else if (d === 1 ? l[i] <= slP : h[i] >= slP) { outcome = 'SL'; px = slP; counts.sl++; }
        if (outcome) {
          state = 0;
          counts.current = outcome === 'TP1 > ENTRY' ? 'TP1->ENTRY' : outcome === 'TP2' ? 'TP2 DONE' : 'SL HIT';
          trade.exitIdx = i; trade.exitPrice = px; trade.outcome = outcome;
          trade.r = d * (px - trade.entry) / trade.risk;
          trade.pnl = trade.r * riskCash;
          trade.sameBar = i === trade.idx;
          realized += trade.pnl;
        }
      }
      // Mark-to-market of the open trade, in the same R units
      equity[i] = P.accountSize + realized + (state !== 0 ? riskCash * state * (c[i] - trade.entry) / trade.risk : 0);
    }
    for (const side of ['long', 'short']) if (curSetup[side]) funnel[side].pending++;

    const closed = trades.filter(x => x.outcome);
    const gp = closed.filter(x => x.pnl > 0).reduce((s, x) => s + x.pnl, 0);
    const gl = -closed.filter(x => x.pnl < 0).reduce((s, x) => s + x.pnl, 0);
    let peak = -Infinity, maxDd = 0, maxDdPct = 0;
    for (const e of equity) { if (e > peak) peak = e; const dd = peak - e; if (dd > maxDd) maxDd = dd; if (peak > 0 && dd / peak > maxDdPct) maxDdPct = dd / peak; }
    const winRate = (counts.tp2 + counts.sl) > 0 ? counts.tp2 / (counts.tp2 + counts.sl) * 100 : 0;

    return {
      params: P, n, src, stop, pos, bbUp, bbLo, bbMid, hist, trades, setups, funnel, counts, equity,
      stats: {
        trades: counts.total, closed: closed.length, winRate,
        tp2: counts.tp2, sl: counts.sl, tp1Back: counts.tp1Back,
        totalR: closed.reduce((s, x) => s + x.r, 0),
        avgR: closed.length ? closed.reduce((s, x) => s + x.r, 0) / closed.length : NaN,
        netProfit: realized, netProfitPct: realized / P.accountSize * 100,
        profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN),
        maxDd, maxDdPct: maxDdPct * 100,
        sameBarExits: closed.filter(x => x.sameBar).length,
        setups: setups.length
      }
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
      const r = [tt, +p[iO], +p[iH], +p[iL], +p[iC], iV >= 0 ? +p[iV] : 0];
      if (r.slice(0, 5).every(x => isFinite(x))) rows.push(r);
    }
    if (rows.length < 250) throw new Error('Se leyeron ' + rows.length + ' velas válidas; hacen falta al menos 250 (las Bollinger usan 200).');
    rows.sort((a, b) => a[0] - b[0]);
    const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
    for (const r of rows) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(isFinite(r[5]) ? r[5] : 0); }
    return out;
  }

  const api = { DEFAULTS, run, makeSample, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineSniper = api;
})(typeof window !== 'undefined' ? window : this);
