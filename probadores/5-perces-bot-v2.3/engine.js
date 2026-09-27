/*
 * Motor de backtest: port a JavaScript de "5 perces bot v2.3 - FINAL FIX" (Pine Script v5, strategy).
 *
 * Emula el broker de TradingView con los ajustes del script:
 *  - el script se evalúa al cierre de cada vela;
 *  - strategy.entry / strategy.close / strategy.close_all son órdenes a mercado y se ejecutan
 *    en la apertura de la vela siguiente;
 *  - strategy.exit (TP / SL) se coloca al cierre cuando ya hay posición y se evalúa desde la vela
 *    siguiente, recorriendo apertura -> extremo más cercano -> otro extremo -> cierre;
 *  - pyramiding = 1, 100 % del capital por operación (calculado con el cierre de la vela de la señal),
 *    sin comisiones ni deslizamiento, capital inicial 1 000 000 (el valor por defecto de strategy()).
 *
 * request.security:
 *  - "15" (EMA 200 de 15 min) con lookahead_off: el valor cambia en la vela del gráfico que cierra
 *    cada vela de 15 min y se mantiene hasta que cierra la siguiente;
 *  - "1" (EMA 21 de 1 min) es un marco menor que el del gráfico: devuelve el valor de la última vela
 *    de 1 min dentro de cada vela del gráfico. Es exacto si los datos son de 1 min; con datos de
 *    5 min se aproxima con una EMA de 5 min de coeficiente equivalente.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    chartTf: 5,
    keyValue: 2.2, atrLen: 10,
    useEmaFilter: true, emaTrendLen: 200, emaFastLen: 21,
    use1minEma: true, ema1minLen: 21,
    useHtf: true, htfEmaLen: 200,
    useAdx: true, adxLen: 14, adxThreshold: 23,
    useDistance: true, distanceFilter: 0.001,
    tpPercent: 1.5, slPercent: 1.0,
    startHour: 3, endHour: 15, timezone: 'UTC',
    initialCapital: 1000000
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

  // ta.tr(handle_na): with handle_na = false the first bar is na (used by ta.dmi); ta.atr uses true.
  function trueRange(h, l, c, handleNa) {
    const n = h.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = i === 0 ? (handleNa ? h[i] - l[i] : NaN)
        : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    }
    return out;
  }

  // ta.dmi(diLength, adxSmoothing) -> ADX
  function adxSeries(h, l, c, diLen, adxLen) {
    const n = h.length, plusDM = nanArr(n), minusDM = nanArr(n);
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
      plusDM[i] = up > down && up > 0 ? up : 0;
      minusDM[i] = down > up && down > 0 ? down : 0;
    }
    const trur = rma(trueRange(h, l, c, false), diLen);
    const pS = rma(plusDM, diLen), mS = rma(minusDM, diLen);
    const dx = nanArr(n);
    let lp = NaN, lm = NaN; // fixnan
    for (let i = 0; i < n; i++) {
      const p = 100 * pS[i] / trur[i], m = 100 * mS[i] / trur[i];
      if (isFinite(p)) lp = p;
      if (isFinite(m)) lm = m;
      const sum = lp + lm;
      dx[i] = Math.abs(lp - lm) / (sum === 0 ? 1 : sum);
    }
    return rma(dx, adxLen).map(x => 100 * x);
  }

  // ---------- timeframes ----------
  function detectTf(t) {
    const d = [];
    for (let i = 1; i < Math.min(t.length, 2000); i++) d.push(t[i] - t[i - 1]);
    d.sort((a, b) => a - b);
    return Math.max(1, Math.round((d[Math.floor(d.length / 2)] || 60000) / 60000));
  }

  // Groups bars into `tf`-minute buckets aligned to UTC midnight.
  function aggregate(src, tf) {
    const ms = tf * 60000, out = { t: [], o: [], h: [], l: [], c: [], v: [], last: [] };
    let k = -1, cur = null;
    for (let i = 0; i < src.t.length; i++) {
      const b = Math.floor(src.t[i] / ms);
      if (b !== cur) {
        cur = b; k++;
        out.t.push(b * ms); out.o.push(src.o[i]); out.h.push(src.h[i]); out.l.push(src.l[i]);
        out.c.push(src.c[i]); out.v.push(src.v ? src.v[i] || 0 : 0); out.last.push(i);
      } else {
        if (src.h[i] > out.h[k]) out.h[k] = src.h[i];
        if (src.l[i] < out.l[k]) out.l[k] = src.l[i];
        out.c[k] = src.c[i]; out.v[k] += src.v ? src.v[i] || 0 : 0; out.last[k] = i;
      }
    }
    return out;
  }

  // request.security(tickerid, htf, ta.ema(close, len)) on a lower chart timeframe, lookahead_off.
  function htfEma(chart, chartTf, htf, len) {
    const n = chart.t.length, out = nanArr(n), ms = htf * 60000;
    const agg = aggregate(chart, htf), e = ema(agg.c, len);
    let k = -1, cur = NaN;
    for (let i = 0; i < n; i++) {
      const b = Math.floor(chart.t[i] / ms);
      if (k < 0 || agg.t[k] !== b * ms) k++;
      const closes = (chart.t[i] + chartTf * 60000) % ms === 0 ||
        (i < n - 1 && Math.floor(chart.t[i + 1] / ms) !== b);
      if (closes) cur = e[k];
      out[i] = cur;
    }
    return out;
  }

  // request.security(tickerid, ltf, ta.ema(close, len)) on a higher chart timeframe:
  // value of the last `ltf` bar inside each chart bar. Exact when the base data is at least as fine.
  function ltfEma(base, baseTf, chart, chartTf, ltf, len) {
    if (baseTf <= ltf && ltf % baseTf === 0) {
      const lagg = ltf === baseTf ? Object.assign({ last: base.t.map((_, i) => i) }, base) : aggregate(base, ltf);
      const e = ema(lagg.c, len);
      const baseToL = new Array(base.t.length);
      lagg.last.forEach((bi, k) => { baseToL[bi] = k; });
      for (let i = base.t.length - 1, k = lagg.last.length - 1; i >= 0; i--) {
        if (baseToL[i] !== undefined) k = baseToL[i]; else baseToL[i] = k;
      }
      return { series: chart.last.map(bi => e[baseToL[bi]]), exact: true };
    }
    // Approximation: EMA on the chart closes with the same decay per minute.
    const a1 = 2 / (len + 1), a = 1 - Math.pow(1 - a1, chartTf / ltf);
    const eqLen = Math.max(1, Math.round(2 / a - 1));
    return { series: smooth(chart.c, eqLen, a), exact: false, eqLen };
  }

  // ---------- exchange clock (hour(time)) ----------
  function makeHour(tz) {
    if (!tz || tz === 'UTC' || tz === 'Etc/UTC') return t => new Date(t).getUTCHours();
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit' });
    return t => +fmt.formatToParts(t).find(p => p.type === 'hour').value % 24;
  }

  function inferDecimals(c) {
    let dec = 0;
    for (let i = 0; i < Math.min(c.length, 300); i++) { const s = String(c[i]), p = s.indexOf('.'); if (p >= 0) dec = Math.max(dec, Math.min(8, s.length - p - 1)); }
    return dec;
  }

  // ---------- backtest ----------
  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const baseTf = data.tf || detectTf(data.t);
    const chartTf = P.chartTf > baseTf && P.chartTf % baseTf === 0 ? P.chartTf : baseTf;
    const base = { t: data.t, o: data.o, h: data.h, l: data.l, c: data.c, v: data.v };
    const B = chartTf === baseTf ? Object.assign({ last: data.t.map((_, i) => i) }, base) : aggregate(base, chartTf);
    const { t, o, h, l, c } = B;
    const n = t.length;
    const src = c;

    // UT trail, exactly as written: prev = nz(trail[1])
    const xATR = rma(trueRange(h, l, c, true), P.atrLen);
    const trail = nanArr(n);
    for (let i = 0; i < n; i++) {
      const nLoss = P.keyValue * xATR[i];
      const prev = i > 0 && !isNaN(trail[i - 1]) ? trail[i - 1] : 0;
      const s1 = i > 0 ? src[i - 1] : NaN;
      if (src[i] > prev && s1 > prev) trail[i] = Math.max(prev, src[i] - nLoss);
      else if (src[i] < prev && s1 < prev) trail[i] = Math.min(prev, src[i] + nLoss);
      else trail[i] = src[i] > prev ? src[i] - nLoss : src[i] + nLoss;
    }

    const emaFast = ema(src, P.emaFastLen), emaTrend = ema(src, P.emaTrendLen);
    const one = chartTf === 1 ? { series: ema(src, P.ema1minLen), exact: true }
      : ltfEma(base, baseTf, B, chartTf, 1, P.ema1minLen);
    const ema1 = one.series;
    let htf;
    if (chartTf === 15) htf = { series: ema(src, P.htfEmaLen), exact: true, mode: 'igual' };
    else if (chartTf < 15) htf = { series: htfEma(B, chartTf, 15, P.htfEmaLen), exact: true, mode: 'superior' };
    else htf = Object.assign(ltfEma(base, baseTf, B, chartTf, 15, P.htfEmaLen), { mode: 'inferior' });
    const ema15 = htf.series;
    const adx = adxSeries(h, l, c, P.adxLen, P.adxLen);
    const hourOf = makeHour(P.timezone);

    // Broker state
    let pos = 0, qtyAbs = 0, avg = NaN, closedPnl = 0, openTrade = null;
    let orders = [];   // market orders placed at the previous close
    let exitOrd = null; // strategy.exit placed at the previous close: {dir, stop, limit}
    const trades = [];
    const equity = new Array(n), allowed = new Array(n), hours = new Array(n);
    const tpPlot = nanArr(n), slPlot = nanArr(n);
    const signals = [];   // raw UT crossovers with their outcome, for the chart and the funnel

    const FILTERS = ['fast', 'trend', 'ltf', 'htf', 'adx', 'dist', 'time'];
    const mkF = () => { const f = { total: 0, entries: 0, same: 0, reversals: 0, excl: {} }; FILTERS.forEach(k => { f[k] = 0; f.excl[k] = 0; }); return f; };
    const funnel = { long: mkF(), short: mkF() };

    const openPos = (i, dir, qty, signalIdx, price) => {
      pos = dir; qtyAbs = qty; avg = price;
      openTrade = { dir, signalIdx, entryIdx: i, entryPrice: price, qty, exitIdx: null, exitPrice: NaN, reason: '', pnl: 0 };
      trades.push(openTrade);
    };
    const closePos = (i, price, reason) => {
      const pnl = pos * (price - avg) * qtyAbs;
      closedPnl += pnl;
      Object.assign(openTrade, { exitIdx: i, exitPrice: price, reason, pnl, pnlPct: pnl / (avg * qtyAbs) * 100 });
      openTrade = null; pos = 0; qtyAbs = 0; avg = NaN;
    };

    for (let i = 0; i < n; i++) {
      // ---- broker: market orders at the open of bar i ----
      const posBefore = pos;
      for (const od of orders) {
        if (od.type === 'entry') {
          if (pos === od.dir) continue;               // pyramiding = 1
          if (pos !== 0) closePos(i, o[i], 'Reversa');
          openPos(i, od.dir, od.qty, od.signalIdx, o[i]);
        } else if (od.type === 'close') {
          if (pos === od.dir) closePos(i, o[i], od.reason);
        } else if (pos !== 0) closePos(i, o[i], od.reason);
      }
      orders = [];
      // strategy.exit bound to the position that existed at the previous close
      if (exitOrd && pos !== 0 && pos === posBefore && pos === exitOrd.dir) {
        const dir = pos, sl = exitOrd.stop, tp = exitOrd.limit, op = o[i];
        let done = false;
        if (dir > 0 ? op <= sl : op >= sl) { closePos(i, op, 'SL'); done = true; }
        else if (dir > 0 ? op >= tp : op <= tp) { closePos(i, op, 'TP'); done = true; }
        if (!done) {
          const highFirst = (h[i] - op) < (op - l[i]);
          const path = highFirst ? [op, h[i], l[i], c[i]] : [op, l[i], h[i], c[i]];
          for (let s = 0; s < 3 && !done; s++) {
            const a = path[s], b = path[s + 1];
            if (a === b) continue;
            const up = b > a;
            const crosses = lvl => up ? (lvl > a && lvl <= b) : (lvl < a && lvl >= b);
            const stopSide = dir > 0 ? !up : up;
            if (stopSide && crosses(sl)) { closePos(i, sl, 'SL'); done = true; }
            else if (!stopSide && crosses(tp)) { closePos(i, tp, 'TP'); done = true; }
          }
        }
      }
      exitOrd = null;

      // ---- script: runs at the close of bar i ----
      const eq = P.initialCapital + closedPnl + (pos !== 0 ? pos * (c[i] - avg) * qtyAbs : 0);
      equity[i] = eq;
      const hr = hourOf(t[i]);
      hours[i] = hr;
      const timeAllowed = hr >= P.startHour && hr < P.endHour;
      allowed[i] = timeAllowed;

      const distance = Math.abs(src[i] - emaFast[i]) / src[i];
      const crossUp = i > 0 && src[i] > trail[i] && src[i - 1] <= trail[i - 1];
      const crossDn = i > 0 && trail[i] > src[i] && trail[i - 1] <= src[i - 1];
      const checks = dir => [
        ['fast', dir > 0 ? src[i] > emaFast[i] : src[i] < emaFast[i]],
        ['trend', !P.useEmaFilter || (dir > 0 ? src[i] > emaTrend[i] : src[i] < emaTrend[i])],
        ['ltf', !P.use1minEma || (dir > 0 ? src[i] > ema1[i] : src[i] < ema1[i])],
        ['htf', !P.useHtf || (dir > 0 ? src[i] > ema15[i] : src[i] < ema15[i])],
        ['adx', !P.useAdx || adx[i] > P.adxThreshold],
        ['dist', !P.useDistance || distance > P.distanceFilter],
        ['time', timeAllowed]
      ];

      for (const [dir, fired] of [[1, crossUp], [-1, crossDn]]) {
        if (!fired) continue;
        const ch = checks(dir), F = dir > 0 ? funnel.long : funnel.short;
        F.total++;
        const failed = ch.filter(x => !x[1]);
        if (failed.length === 1) F.excl[failed[0][0]]++;
        let outcome;
        if (failed.length) { F[failed[0][0]]++; outcome = failed[0][0]; }
        else if (pos === dir) { F.same++; outcome = 'same'; }
        else {
          F.entries++; if (pos !== 0) F.reversals++;
          outcome = 'entry';
          orders.push({ type: 'entry', dir, qty: eq / c[i], signalIdx: i });
        }
        signals.push({ i, dir, outcome });
      }

      // TP / SL for the current position, active from the next bar
      if (pos !== 0) {
        const stop = avg * (1 - pos * P.slPercent / 100), limit = avg * (1 + pos * P.tpPercent / 100);
        exitOrd = { dir: pos, stop, limit };
        tpPlot[i] = limit; slPlot[i] = stop;
      }

      // EMA exit
      const cu = i > 0 && emaFast[i] < emaTrend[i] && emaFast[i - 1] >= emaTrend[i - 1];
      const co = i > 0 && emaFast[i] > emaTrend[i] && emaFast[i - 1] <= emaTrend[i - 1];
      if (pos > 0 && cu) orders.push({ type: 'close', dir: 1, reason: 'Salida EMA' });
      if (pos < 0 && co) orders.push({ type: 'close', dir: -1, reason: 'Salida EMA' });

      // Daily close
      if (hr >= P.endHour) orders.push({ type: 'closeAll', reason: 'Cierre diario' });
    }

    // Stats
    const closed = trades.filter(x => x.exitIdx !== null);
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
    const reasons = {};
    closed.forEach(x => {
      const r = reasons[x.reason] || (reasons[x.reason] = { count: 0, wins: 0, pnl: 0 });
      r.count++; if (x.pnl > 0) r.wins++; r.pnl += x.pnl;
    });
    const barsIn = closed.reduce((s, x) => s + (x.exitIdx - x.entryIdx), 0);
    const stats = {
      netProfit: last - P.initialCapital,
      netProfitPct: (last - P.initialCapital) / P.initialCapital * 100,
      closedPnl, openPnl: last - P.initialCapital - closedPnl,
      trades: closed.length, wins: wins.length,
      winRate: closed.length ? wins.length / closed.length * 100 : NaN,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : NaN),
      avgTradePct: closed.length ? closed.reduce((s, x) => s + x.pnlPct, 0) / closed.length : NaN,
      avgBars: closed.length ? barsIn / closed.length : NaN,
      maxDd, maxDdPct: maxDdPct * 100,
      longs: closed.filter(x => x.dir > 0).length, shorts: closed.filter(x => x.dir < 0).length,
      buyHoldPct: n ? (c[n - 1] - c[0]) / c[0] * 100 : 0,
      reasons
    };

    return {
      params: P, n, bars: B, baseTf, chartTf, decimals: inferDecimals(c),
      trail, emaFast, emaTrend, ema1, ema15, adx, ema1Exact: one.exact, ema1EqLen: one.eqLen,
      htfMode: htf.mode, htfExact: htf.exact,
      equity, allowed, hours, tpPlot, slPlot, trades, signals, funnel, stats
    };
  }

  // ---------- sample data (synthetic, BTCUSD-like, 1 minute, 24/7) ----------
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
    const out = { t: [], o: [], h: [], l: [], c: [], v: [], tf: 1 };
    const t0 = Date.UTC(2026, 6, 1);
    const total = (days || 30) * 1440;
    let price = 65000, logVol = 0, drift = 0;
    for (let k = 0; k < total; k++) {
      const t = t0 + k * 60000, hr = new Date(t).getUTCHours();
      const season = hr >= 13 && hr < 21 ? 1.35 : hr >= 7 && hr < 13 ? 1.0 : 0.7;
      logVol += 0.02 * gauss() - 0.004 * logVol;
      if (rnd() < 0.0025) drift = gauss() * 0.000025;
      drift *= 0.9995;
      const sigma = 0.00055 * season * Math.exp(logVol);
      const open = price * (1 + gauss() * sigma * 0.04);
      let p = open, hi = open, lo = open;
      for (let s = 0; s < 4; s++) {
        p *= 1 + drift / 4 + gauss() * sigma / 2;
        if (p > hi) hi = p; if (p < lo) lo = p;
      }
      const r2 = x => Math.round(x * 100) / 100;
      out.t.push(t); out.o.push(r2(open)); out.h.push(r2(hi)); out.l.push(r2(lo)); out.c.push(r2(p));
      out.v.push(Math.round((hi - lo) / price * 4e5 * (0.6 + 0.8 * rnd()) * season));
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
    out.tf = detectTf(out.t);
    return out;
  }

  const api = { DEFAULTS, run, makeSample, parseCSV, detectTf, aggregate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineCincoMin = api;
})(typeof window !== 'undefined' ? window : this);
