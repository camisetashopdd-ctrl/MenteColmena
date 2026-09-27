/*
 * Motor de backtest: port a JavaScript de
 * "UT Bot + STC Conjunction Strategy Tester (v4.6 Lag Window)" (Pine Script v6).
 *
 * Emula el broker de TradingView con la configuración por defecto del script:
 *  - el script se evalúa al cierre de cada vela;
 *  - strategy.entry a mercado se ejecuta en la apertura de la vela siguiente;
 *  - las órdenes de strategy.exit colocadas al cierre se evalúan en la vela siguiente,
 *    recorriendo apertura -> extremo más cercano -> otro extremo -> cierre;
 *  - sin comisiones ni deslizamiento, pyramiding = 1.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    initialCapital: 10000,
    useSession: true, allowedSess: '0730-1900', sessTimezone: 'UTC',
    accountRisk: 1.0, minStopDist: 0.001,
    useLagWindow: true, maxLagBars: 2,
    useCircuitBreaker: true, maxWeeklyLossPct: 3.0,
    useDynamicOffset: true, lowVolOffset: 0.0, normalVolOffset: 2.0, highVolOffset: 6.0,
    normalSwingLookback: 10, highVolSwingLookback: 7,
    filterAtrLen: 50, useRangeFilter: true, minRangePercent: 40.0,
    useMaxCandleFilter: true, maxRangePercent: 375.0,
    stcLowerZone: 25.0, stcUpperZone: 75.0,
    useVolumeFilter: true, volFastLen: 5, volSlowLen: 10,
    useBreakeven: true, beMilestoneR: 1.5,
    useWickFilter: true, maxWickPercent: 50.0,
    useVelocityFilter: true, trendEmaLen: 25, velocityLookback: 3, maxAllowedSlope: 0.001,
    usePartialTP: false, partialMilestone: 1.5,
    regimeFastAtrLen: 14, regimeSlowAtrLen: 200, highVolThreshold: 1.2, lowVolThreshold: 0.8,
    normalRrTarget: 3.0, highVolRrTarget: 3.0, lowVolRrTarget: 4.0,
    utKeyV: 2.0, utAtrLen: 1,
    stcLength: 80, stcFastLen: 27, stcSlowLen: 50, stcAaa: 0.5
  };

  // ---------- series helpers (same seeding as Pine built-ins) ----------
  function nanArr(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = NaN; return a; }

  // Exponential smoothing seeded with the SMA of the first `len` values (ta.ema / ta.rma).
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
  const ema = (src, len) => smooth(src, len, 2 / (len + 1));
  const rma = (src, len) => smooth(src, len, 1 / len);

  function trueRange(h, l, c) {
    const n = h.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = i === 0 ? h[i] - l[i]
        : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    }
    return out;
  }
  const atr = (h, l, c, len) => rma(trueRange(h, l, c), len);

  function lowestAt(a, i, len) {
    if (i < len - 1) return NaN;
    let m = Infinity;
    for (let k = i - len + 1; k <= i; k++) if (a[k] < m) m = a[k];
    return m === Infinity ? NaN : m;
  }
  function highestAt(a, i, len) {
    if (i < len - 1) return NaN;
    let m = -Infinity;
    for (let k = i - len + 1; k <= i; k++) if (a[k] > m) m = a[k];
    return m === -Infinity ? NaN : m;
  }

  // ---------- session / time helpers ----------
  function parseSession(s) {
    const m = /^\s*(\d{2})(\d{2})-(\d{2})(\d{2})(?::([1-7]+))?\s*$/.exec(s || '');
    if (!m) return null;
    const start = +m[1] * 60 + +m[2], end = +m[3] * 60 + +m[4];
    if (start >= 1440 || end > 1440) return null;
    // Pine weekdays: 1 = Sunday ... 7 = Saturday
    const days = m[5] ? new Set(m[5].split('').map(d => +d - 1)) : null;
    return { start, end, days };
  }

  function makeClock(tz) {
    if (!tz || tz === 'UTC' || tz === 'Etc/UTC') {
      return t => { const d = new Date(t); return { mins: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() }; };
    }
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    const W = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return t => {
      let hh = 0, mm = 0, wd = 0;
      for (const p of fmt.formatToParts(t)) {
        if (p.type === 'hour') hh = +p.value % 24;
        else if (p.type === 'minute') mm = +p.value;
        else if (p.type === 'weekday') wd = W[p.value];
      }
      return { mins: hh * 60 + mm, dow: wd };
    };
  }

  function inSession(sess, clk) {
    if (!sess) return true;
    if (sess.days && !sess.days.has(clk.dow)) return false;
    if (sess.start === sess.end) return true;
    return sess.start < sess.end
      ? clk.mins >= sess.start && clk.mins < sess.end
      : clk.mins >= sess.start || clk.mins < sess.end;
  }

  // Monday-based week number (1970-01-01 was a Thursday).
  const weekKey = t => Math.floor((Math.floor(t / 86400000) + 3) / 7);

  // ---------- backtest ----------
  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const { t, o, h, l, c, v } = data;
    const n = t.length;

    // UT Bot
    const utAtr = atr(h, l, c, P.utAtrLen);
    const ts = nanArr(n);
    const utBuy = new Array(n).fill(false), utSell = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      const loss = P.utKeyV * utAtr[i];
      const prev = i > 0 ? ts[i - 1] : NaN;
      if (isNaN(prev)) ts[i] = c[i] - loss;
      else if (c[i] > prev && c[i - 1] > prev) ts[i] = Math.max(prev, c[i] - loss);
      else if (c[i] < prev && c[i - 1] < prev) ts[i] = Math.min(prev, c[i] + loss);
      else ts[i] = c[i] > prev ? c[i] - loss : c[i] + loss;
      if (i > 0) {
        utBuy[i] = c[i] > ts[i] && c[i - 1] <= ts[i - 1];   // ta.crossover(close, stop)
        utSell[i] = c[i] < ts[i] && c[i - 1] >= ts[i - 1];  // ta.crossover(stop, close)
      }
    }

    // Schaff Trend Cycle
    const ef = ema(c, P.stcFastLen), es = ema(c, P.stcSlowLen);
    const macd = ef.map((x, i) => x - es[i]);
    const cVal = new Array(n), dVal = new Array(n), d6 = new Array(n), stc = new Array(n);
    const f = P.stcAaa, L = P.stcLength;
    for (let i = 0; i < n; i++) {
      const lo = lowestAt(macd, i, L), rg = highestAt(macd, i, L) - lo;
      cVal[i] = rg > 0 ? (macd[i] - lo) / rg * 100 : (i > 0 ? cVal[i - 1] : 0);
      dVal[i] = i === 0 ? cVal[i] : dVal[i - 1] + f * (cVal[i] - dVal[i - 1]);
      const loD = lowestAt(dVal, i, L), rgD = highestAt(dVal, i, L) - loD;
      d6[i] = rgD > 0 ? (dVal[i] - loD) / rgD * 100 : (i > 0 ? d6[i - 1] : 0);
      stc[i] = i === 0 ? d6[i] : stc[i - 1] + f * (d6[i] - stc[i - 1]);
    }

    // Filter series
    const baseAtr = atr(h, l, c, P.filterAtrLen);
    const fastVol = ema(v, P.volFastLen), slowVol = ema(v, P.volSlowLen);
    const baseEma = ema(c, P.trendEmaLen);
    const fastReg = atr(h, l, c, P.regimeFastAtrLen), slowReg = atr(h, l, c, P.regimeSlowAtrLen);

    const sess = P.useSession ? parseSession(P.allowedSess) : null;
    const clock = makeClock(P.sessTimezone);

    // Broker state
    let pos = 0, avg = NaN, closedPnl = 0;
    let pendingEntry = null, exits = null, openTrade = null;
    const trades = [];

    // Pine `var` state
    let weeklyHigh = P.initialCapital, breaker = false;
    let slLevel = NaN, tpLevel = NaN, pTpLevel = NaN, entryPrice = NaN, initialRisk = NaN;
    let beTriggered = false, partialExecuted = false, maxP = 0, minP = 0;
    let longPending = false, longAge = 0, pLongSl = NaN;
    let shortPending = false, shortAge = 0, pShortSl = NaN;
    let prevPos = 0;

    // Per-bar output
    const equity = new Array(n), slPlot = nanArr(n), tpPlot = nanArr(n);
    const bePlot = new Array(n).fill(false), inWinArr = new Array(n), breakerArr = new Array(n);
    const ratioArr = new Array(n), stcUp = new Array(n);

    const funnelKeys = ['zone', 'session', 'floor', 'ceiling', 'volume', 'wick', 'velocity', 'breaker', 'inPosition', 'passed'];
    const mkFunnel = () => { const o = { total: 0, entries: 0, minStopRejects: 0 }; funnelKeys.forEach(k => o[k] = 0); return o; };
    const funnel = { long: mkFunnel(), short: mkFunnel() };

    function fillExit(i, price, qty, reason) {
      const dir = pos > 0 ? 1 : -1;
      const pnl = dir * (price - avg) * qty;
      closedPnl += pnl;
      openTrade.fills.push({ i, price, qty, reason, pnl });
      const rem = Math.abs(pos) - qty;
      pos = rem > 1e-9 ? dir * rem : 0;
      if (pos === 0) closeTrade(i);
    }

    function closeTrade(i) {
      const tr = openTrade;
      const q = tr.fills.reduce((s, x) => s + x.qty, 0);
      tr.exitIdx = i;
      tr.exitPrice = tr.fills.reduce((s, x) => s + x.price * x.qty, 0) / q;
      tr.pnl = tr.fills.reduce((s, x) => s + x.pnl, 0);
      tr.r = tr.pnl / tr.riskCash;
      tr.reason = tr.fills.map(x => x.reason).filter((x, k, a) => a.indexOf(x) === k).join(' + ');
      tr.closed = true;
      openTrade = null;
      avg = NaN;
    }

    // Walks the bar's path and fills the stop / limit orders placed at the previous close.
    function processExits(i) {
      const dir = pos > 0 ? 1 : -1;
      const sl = exits.full.stop, tp = exits.full.limit;
      const ptp = exits.partial ? exits.partial.limit : NaN;
      let partActive = !!exits.partial, fullActive = true;
      const partQty = partActive ? Math.abs(pos) * 0.5 : 0;
      const slReason = exits.be ? 'BE' : 'SL';

      const hitStop = price => {
        if (partActive) { partActive = false; fillExit(i, price, partQty, slReason); }
        if (pos !== 0 && fullActive) { fullActive = false; fillExit(i, price, Math.abs(pos), slReason); }
      };
      const hitPartial = price => { partActive = false; fillExit(i, price, Math.min(partQty, Math.abs(pos)), 'TP parcial'); };
      const hitTarget = price => {
        fullActive = false;
        const q = Math.abs(pos) - (partActive ? partQty : 0);
        if (q > 1e-9) fillExit(i, price, q, 'TP');
      };

      // Gap through the levels at the open
      const op = o[i];
      if (dir > 0 ? op <= sl : op >= sl) { hitStop(op); return; }
      if (partActive && (dir > 0 ? op >= ptp : op <= ptp)) hitPartial(op);
      if (pos !== 0 && fullActive && (dir > 0 ? op >= tp : op <= tp)) hitTarget(op);
      if (pos === 0) return;

      const highFirst = (h[i] - op) < (op - l[i]);
      const path = highFirst ? [op, h[i], l[i], c[i]] : [op, l[i], h[i], c[i]];
      for (let s = 0; s < 3 && pos !== 0; s++) {
        const a = path[s], b = path[s + 1];
        if (a === b) continue;
        const up = b > a;
        const crosses = lvl => up ? (lvl > a && lvl <= b) : (lvl < a && lvl >= b);
        const ev = [];
        const stopSide = dir > 0 ? !up : up;
        if (stopSide && crosses(sl)) ev.push({ lvl: sl, kind: 'stop' });
        if (!stopSide) {
          if (partActive && crosses(ptp)) ev.push({ lvl: ptp, kind: 'partial' });
          if (fullActive && crosses(tp)) ev.push({ lvl: tp, kind: 'target' });
        }
        ev.sort((x, y) => Math.abs(x.lvl - a) - Math.abs(y.lvl - a));
        for (const e of ev) {
          if (pos === 0) break;
          if (e.kind === 'stop' && (partActive || fullActive)) hitStop(e.lvl);
          else if (e.kind === 'partial' && partActive) hitPartial(e.lvl);
          else if (e.kind === 'target' && fullActive) hitTarget(e.lvl);
        }
      }
    }

    for (let i = 0; i < n; i++) {
      // ---- broker: fills during bar i ----
      if (pendingEntry) {
        const pe = pendingEntry; pendingEntry = null;
        pos = pe.dir * pe.qty; avg = o[i];
        openTrade = {
          dir: pe.dir, signalIdx: pe.signalIdx, entryIdx: i, entryPrice: o[i], plannedEntry: pe.calc,
          qty: pe.qty, sl0: pe.sl, tp0: pe.tp, risk: pe.risk, riskCash: pe.riskCash, regime: pe.regime,
          fills: [], closed: false
        };
        trades.push(openTrade);
        exits = null;
      } else if (pos !== 0 && exits) {
        processExits(i);
      }
      exits = null;

      // ---- script: runs at the close of bar i ----
      const eq = P.initialCapital + closedPnl + (pos !== 0 ? pos * (c[i] - avg) : 0);
      equity[i] = eq;

      // Regime
      const ratio = (isNaN(slowReg[i]) || slowReg[i] === 0) ? 1.0 : fastReg[i] / slowReg[i];
      ratioArr[i] = ratio;
      const hiVol = ratio >= P.highVolThreshold, loVol = ratio <= P.lowVolThreshold;
      const activeRr = hiVol ? P.highVolRrTarget : loVol ? P.lowVolRrTarget : P.normalRrTarget;
      const swingLb = hiVol ? P.highVolSwingLookback : P.normalSwingLookback;
      const offsetPip = !P.useDynamicOffset ? 0 : hiVol ? P.highVolOffset : loVol ? P.lowVolOffset : P.normalVolOffset;
      const offset = offsetPip * 0.00001;

      // Weekly circuit breaker
      const isNewWeek = i > 0 && weekKey(t[i]) !== weekKey(t[i - 1]);
      if (isNewWeek) { weeklyHigh = eq; breaker = false; }
      else weeklyHigh = Math.max(weeklyHigh, eq);
      if (P.useCircuitBreaker && !breaker && pos === 0) {
        const dd = (weeklyHigh - eq) / weeklyHigh * 100;
        if (dd >= P.maxWeeklyLossPct) breaker = true;
      }
      breakerArr[i] = breaker;

      const inWin = !P.useSession || inSession(sess, clock(t[i]));
      inWinArr[i] = inWin;

      const gLow = lowestAt(l, i, swingLb), gHigh = highestAt(h, i, swingLb);
      const riskCash = eq * (P.accountRisk / 100);

      // Environment filters
      const range = h[i] - l[i];
      const floorOk = !P.useRangeFilter || range >= baseAtr[i] * (P.minRangePercent / 100);
      const ceilOk = !P.useMaxCandleFilter || range <= baseAtr[i] * (P.maxRangePercent / 100);
      const volOsc = (isNaN(slowVol[i]) || slowVol[i] === 0) ? 0 : (fastVol[i] - slowVol[i]) / slowVol[i] * 100;
      const volOk = !P.useVolumeFilter || volOsc > 0;
      const upWick = h[i] - Math.max(o[i], c[i]), dnWick = Math.min(o[i], c[i]) - l[i];
      const longWickPct = range > 0 ? upWick / range * 100 : 0;
      const shortWickPct = range > 0 ? dnWick / range * 100 : 0;
      const longWickOk = !P.useWickFilter || longWickPct <= P.maxWickPercent;
      const shortWickOk = !P.useWickFilter || shortWickPct <= P.maxWickPercent;
      const emaDelta = i >= P.velocityLookback ? baseEma[i] - baseEma[i - P.velocityLookback] : NaN;
      const longVelBlock = P.useVelocityFilter && emaDelta < -P.maxAllowedSlope;
      const shortVelBlock = P.useVelocityFilter && emaDelta > P.maxAllowedSlope;

      stcUp[i] = i > 0 && stc[i] > stc[i - 1];
      const stcDown = i > 0 && stc[i] < stc[i - 1];

      const longChecks = [['zone', stc[i] <= P.stcLowerZone], ['session', inWin], ['floor', floorOk], ['ceiling', ceilOk],
        ['volume', volOk], ['wick', longWickOk], ['velocity', !longVelBlock], ['breaker', !breaker]];
      const shortChecks = [['zone', stc[i] >= P.stcUpperZone], ['session', inWin], ['floor', floorOk], ['ceiling', ceilOk],
        ['volume', volOk], ['wick', shortWickOk], ['velocity', !shortVelBlock], ['breaker', !breaker]];
      const coreLong = utBuy[i] && longChecks.every(x => x[1]);
      const coreShort = utSell[i] && shortChecks.every(x => x[1]);

      const tally = (fn, checks) => {
        fn.total++;
        const fail = checks.find(x => !x[1]);
        fn[fail ? fail[0] : (pos !== 0 ? 'inPosition' : 'passed')]++;
      };
      if (utBuy[i]) tally(funnel.long, longChecks);
      if (utSell[i]) tally(funnel.short, shortChecks);

      // v4.6 lag window
      if (P.useLagWindow) {
        if (coreLong && pos === 0) { longPending = true; longAge = 0; pLongSl = gLow; shortPending = false; }
        else if (longPending) longAge += 1;
        if (coreShort && pos === 0) { shortPending = true; shortAge = 0; pShortSl = gHigh; longPending = false; }
        else if (shortPending) shortAge += 1;
        if (longAge > P.maxLagBars || !inWin || breaker) longPending = false;
        if (shortAge > P.maxLagBars || !inWin || breaker) shortPending = false;
      } else {
        longPending = coreLong; shortPending = coreShort; pLongSl = gLow; pShortSl = gHigh;
      }
      if (pos !== 0) { longPending = false; shortPending = false; }

      const finalBuy = longPending && stcUp[i] && pos === 0;
      const finalSell = shortPending && stcDown && pos === 0;

      if (pos === 0) {
        slLevel = NaN; tpLevel = NaN; pTpLevel = NaN; entryPrice = NaN; initialRisk = NaN;
        beTriggered = false; partialExecuted = false; maxP = 0; minP = 0;
      }

      const regime = hiVol ? 'alta' : loVol ? 'baja' : 'normal';
      if (finalBuy) {
        const calc = c[i] + offset, risk = calc - pLongSl;
        if (risk >= P.minStopDist) {
          slLevel = pLongSl; tpLevel = calc + risk * activeRr; pTpLevel = calc + risk * P.partialMilestone;
          pendingEntry = { dir: 1, qty: riskCash / risk, signalIdx: i, calc, sl: slLevel, tp: tpLevel, risk, riskCash, regime };
          entryPrice = c[i]; initialRisk = risk; beTriggered = false; partialExecuted = false;
          maxP = h[i]; longPending = false;
          funnel.long.entries++;
        } else funnel.long.minStopRejects++;
      }
      if (finalSell) {
        const calc = c[i] - offset, risk = pShortSl - calc;
        if (risk >= P.minStopDist) {
          slLevel = pShortSl; tpLevel = calc - risk * activeRr; pTpLevel = calc - risk * P.partialMilestone;
          pendingEntry = { dir: -1, qty: riskCash / risk, signalIdx: i, calc, sl: slLevel, tp: tpLevel, risk, riskCash, regime };
          entryPrice = c[i]; initialRisk = risk; beTriggered = false; partialExecuted = false;
          minP = l[i]; shortPending = false;
          funnel.short.entries++;
        } else funnel.short.minStopRejects++;
      }

      // Breakeven
      if (pos > 0) {
        maxP = Math.max(maxP, h[i]);
        if (P.useBreakeven && !beTriggered && maxP - entryPrice >= initialRisk * P.beMilestoneR) { slLevel = entryPrice; beTriggered = true; }
      }
      if (pos < 0) {
        minP = Math.min(minP, l[i]);
        if (P.useBreakeven && !beTriggered && entryPrice - minP >= initialRisk * P.beMilestoneR) { slLevel = entryPrice; beTriggered = true; }
      }

      // Exit orders, active from the next bar
      if (pos !== 0) {
        exits = {
          partial: P.usePartialTP && !partialExecuted ? { limit: pTpLevel } : null,
          full: { stop: slLevel, limit: tpLevel },
          be: beTriggered
        };
      }
      if (pos !== 0 && prevPos !== 0 && Math.abs(pos) < Math.abs(prevPos)) partialExecuted = true;
      prevPos = pos;

      if (pos !== 0) { slPlot[i] = slLevel; tpPlot[i] = tpLevel; bePlot[i] = beTriggered; }
    }

    // Stats
    const closed = trades.filter(x => x.closed);
    const wins = closed.filter(x => x.pnl > 0), losses = closed.filter(x => x.pnl <= 0);
    const grossProfit = wins.reduce((s, x) => s + x.pnl, 0);
    const grossLoss = -losses.reduce((s, x) => s + x.pnl, 0);
    let peak = -Infinity, maxDd = 0, maxDdPct = 0;
    for (const e of equity) {
      if (e > peak) peak = e;
      const dd = peak - e;
      if (dd > maxDd) maxDd = dd;
      if (peak > 0 && dd / peak > maxDdPct) maxDdPct = dd / peak;
    }
    const last = n ? equity[n - 1] : P.initialCapital;
    const stats = {
      netProfit: closedPnl,
      netProfitPct: closedPnl / P.initialCapital * 100,
      finalEquity: last,
      openPnl: last - P.initialCapital - closedPnl,
      trades: closed.length,
      wins: wins.length,
      winRate: closed.length ? wins.length / closed.length * 100 : NaN,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : NaN),
      avgR: closed.length ? closed.reduce((s, x) => s + x.r, 0) / closed.length : NaN,
      maxDd, maxDdPct: maxDdPct * 100,
      longs: closed.filter(x => x.dir > 0).length,
      shorts: closed.filter(x => x.dir < 0).length
    };

    return {
      params: P, n, ts, stc, stcUp, equity, slPlot, tpPlot, bePlot,
      inWin: inWinArr, breaker: breakerArr, ratio: ratioArr,
      trades, stats, funnel, sessionValid: !P.useSession || !!sess
    };
  }

  // ---------- sample data (synthetic, EURUSD-like, 15 minutes) ----------
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
    const t0 = Date.UTC(2026, 5, 1); // Monday 1 June 2026
    const step = 15 * 60000, total = (weeks || 10) * 7 * 96;
    let price = 1.0850, logVol = 0, drift = 0;
    for (let k = 0; k < total; k++) {
      const t = t0 + k * step, d = new Date(t), dow = d.getUTCDay(), hr = d.getUTCHours();
      if (dow === 0 || dow === 6) continue;
      const season = hr >= 12 && hr < 16 ? 1.5 : hr >= 7 && hr < 17 ? 1.2 : hr >= 21 || hr < 1 ? 0.45 : 0.6;
      logVol += 0.05 * gauss() - 0.015 * logVol;
      if (rnd() < 0.012) drift = gauss() * 0.00005;
      drift *= 0.997;
      const sigma = 0.00028 * season * Math.exp(logVol);
      const open = price + gauss() * sigma * 0.05;
      let p = open, hi = open, lo = open;
      for (let s = 0; s < 6; s++) {
        p += drift / 6 + gauss() * sigma / Math.sqrt(6);
        if (p > hi) hi = p; if (p < lo) lo = p;
      }
      const r5 = x => Math.round(x * 1e5) / 1e5;
      out.t.push(t); out.o.push(r5(open)); out.h.push(r5(hi)); out.l.push(r5(lo)); out.c.push(r5(p));
      out.v.push(Math.round((hi - lo) / 0.0001 * 55 * (0.7 + 0.6 * rnd()) + 40 * season));
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
    const out = { t: [], o: [], h: [], l: [], c: [], v: [], hasVolume: iV >= 0 };
    for (const r of rows) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(isFinite(r[5]) ? r[5] : 0); }
    return out;
  }

  const api = { DEFAULTS, run, makeSample, parseCSV, parseSession };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : this);
