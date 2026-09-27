/*
 * TikiTrade v3: motor del bot propio de MenteColmena.
 *
 * Idea: seguir la tendencia y entrar en el retroceso. Cada herramienta es un «jugador» que tiene que
 * pasar el balón al siguiente; si uno lo pierde, no hay remate. El orden de la jugada:
 *   0 Portero     (El Muro)       sin posición abierta, sin descanso por racha de pérdidas, lado permitido
 *   1 Central     (La Roca)       tendencia: EMA 50 > EMA 200, cierre > EMA 200 y EMA 200 subiendo
 *   2 Lateral     (El Motor)      fuerza: ADX >= 25 (umbral clásico de Wilder)
 *   3 Mediocentro (El Cerebro)    pausa: el RSI retrocedió (<= 45 en largo) en las últimas velas
 *   4 Mediapunta  (El Termómetro) volatilidad: percentil del ATR% entre 10 y 90
 *   5 Extremo     (La Chispa)     volumen >= 0,9 × media 20 (se salta si no hay volumen)
 *   6 Delantero   (El Killer)     gatillo: cierre > máximo anterior, > EMA 20 y vela alcista
 * Remate: entrada a mercado en la apertura siguiente con el stop (2 ATR) ya colocado, así que protege
 * desde la misma vela de entrada. La posición entera corre con el trailing chandelier (3 ATR desde el
 * extremo) hasta que salta o hasta que la tendencia de fondo se rompe («cambio de sistema»: EMA 50
 * cruza la EMA 200 o el cierre cruza la EMA 200). El TP1 parcial existe (tp1Pct) pero va apagado:
 * en el estudio v3, cobrar la mitad a 1,5 R recortaba justo las jugadas que pagan el partido.
 * El Entrenador (coach) elige en cada vela táctica y lado según los partidos en la sombra.
 * Tamaño por riesgo (1 % del capital por operación), comisión 0,05 % por lado y deslizamiento 0,02 %.
 * Cortos: todo en espejo.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    direction: 'both', initialCapital: 10000, riskPct: 1.0, maxExposure: 1.0, commissionPct: 0.05, slippagePct: 0.02,
    useTrend: true, emaFast: 20, emaMid: 50, emaSlow: 200, slopeLen: 20,
    useStrength: true, adxLen: 14, adxMin: 25,
    usePullback: true, rsiLen: 14, pullbackRsi: 45, pullbackLookback: 5,
    useVolatility: true, atrLen: 14, volLookback: 100, volPctMin: 10, volPctMax: 90,
    useVolume: true, volMult: 0.9,
    stopAtr: 2.0, tp1R: 1.5, tp1Pct: 0, trailAtr: 3.0, useTrendExit: true, donLen: 0,
    useCooldown: true, lossStreak: 2, restBars: 10
  };

  // Tácticas: la equilibrada por defecto, una ofensiva, una defensiva y una de ruptura larga.
  // Cada una fija el gatillo (donLen) para que cambiar de táctica no arrastre el de otra.
  const TACTICS = {
    tikitaka: { name: 'Tiki-Taka', desc: 'Equilibrada: tendencia, fuerza, pausa y ruptura de la vela anterior.', p: { donLen: 0 } },
    contraataque: { name: 'Contraataque', desc: 'Ofensiva: sin esperar la pausa y con ADX 20. Más remates; sufre en mercado lateral.', p: { usePullback: false, adxMin: 20, donLen: 0 } },
    catenaccio: { name: 'Catenaccio', desc: 'Defensiva: ADX 30 y pausa más profunda (RSI 40). Muy pocos remates.', p: { adxMin: 30, pullbackRsi: 40, donLen: 0 } },
    directo: { name: 'Juego directo', desc: 'Ruptura larga: sin pausa, ADX 20 y cierre por encima del máximo de 48 velas (2 días). Caza tendencias que arrancan sin retroceso; sola, se hunde en lateral.', p: { usePullback: false, adxMin: 20, donLen: 48 } }
  };

  const PLAYERS = [
    { key: 'gk', num: 1, name: 'El Muro', role: 'Portero', tool: 'Riesgo y descanso', short: 'Riesgo', toggle: null },
    { key: 'cb', num: 4, name: 'La Roca', role: 'Central', tool: 'Tendencia EMA 50/200', short: 'Tendencia', toggle: 'useTrend' },
    { key: 'lb', num: 3, name: 'El Motor', role: 'Lateral', tool: 'Fuerza ADX', short: 'Fuerza ADX', toggle: 'useStrength' },
    { key: 'mc', num: 8, name: 'El Cerebro', role: 'Mediocentro', tool: 'Pausa RSI', short: 'Pausa RSI', toggle: 'usePullback' },
    { key: 'mp', num: 10, name: 'El Termómetro', role: 'Mediapunta', tool: 'Volatilidad ATR%', short: 'Volatilidad', toggle: 'useVolatility' },
    { key: 'ex', num: 7, name: 'La Chispa', role: 'Extremo', tool: 'Volumen', short: 'Volumen', toggle: 'useVolume' },
    { key: 'fw', num: 9, name: 'El Killer', role: 'Delantero', tool: 'Gatillo de ruptura', short: 'Gatillo', toggle: null }
  ];

  // ---------- series helpers ----------
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
  function sma(src, len) {
    const n = src.length, out = nanArr(n); let s = 0, bad = 0;
    for (let i = 0; i < n; i++) {
      const x = src[i]; if (isNaN(x)) bad++; else s += x;
      if (i >= len) { const y = src[i - len]; if (isNaN(y)) bad--; else s -= y; }
      if (i >= len - 1 && !bad) out[i] = s / len;
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
  function adxSeries(h, l, c, len) {
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
  // ta.percentrank(src, len): % of the previous len values <= current value
  function percentRank(src, len) {
    const n = src.length, out = nanArr(n);
    for (let i = len; i < n; i++) {
      const x = src[i]; if (isNaN(x)) continue;
      let cnt = 0, ok = true;
      for (let k = i - len; k < i; k++) { if (isNaN(src[k])) { ok = false; break; } if (src[k] <= x) cnt++; }
      if (ok) out[i] = cnt / len * 100;
    }
    return out;
  }
  const lowestAt = (a, i, len) => { let m = Infinity; for (let k = Math.max(0, i - len + 1); k <= i; k++) if (a[k] < m) m = a[k]; return i >= len - 1 ? m : NaN; };
  const highestAt = (a, i, len) => { let m = -Infinity; for (let k = Math.max(0, i - len + 1); k <= i; k++) if (a[k] > m) m = a[k]; return i >= len - 1 ? m : NaN; };
  function inferDecimals(c) {
    let dec = 0;
    for (let i = 0; i < Math.min(c.length, 300); i++) { const s = String(c[i]), p = s.indexOf('.'); if (p >= 0) dec = Math.max(dec, Math.min(8, s.length - p - 1)); }
    return dec;
  }

  // ---------- El Entrenador: ojeador del rival ----------
  // Clasifica cada vela solo con datos pasados:
  //   volátil   si el ATR% está en el percentil >= volHigh de las últimas volLen velas;
  //   tendencia si la distancia EMA 50–EMA 200 es >= spreadTrend ATR y la eficiencia del movimiento
  //             (Kaufman, erLen velas) es >= erTrend, con el precio al lado de la tendencia;
  //   lateral   si la distancia es < spreadRange ATR y la eficiencia < erTrend;
  //   transición en otro caso.
  function scout(data, P, C) {
    const { h, l, c } = data, n = c.length;
    const emaM = ema(c, P.emaMid), emaS = ema(c, P.emaSlow);
    const atr = rma(trueRange(h, l, c, true), P.atrLen);
    const rank = percentRank(atr.map((x, i) => x / c[i]), C.volLen);
    const er = nanArr(n), label = new Array(n);
    for (let i = 0; i < n; i++) {
      if (i >= C.erLen) {
        let path = 0; for (let k = i - C.erLen + 1; k <= i; k++) path += Math.abs(c[k] - c[k - 1]);
        er[i] = path > 0 ? Math.abs(c[i] - c[i - C.erLen]) / path : 0;
      }
      let lb = 'transicion';
      const spread = (emaM[i] - emaS[i]) / atr[i];
      if (isNaN(er[i]) || isNaN(emaS[i]) || isNaN(spread)) lb = 'transicion';
      else if (rank[i] >= C.volHigh) lb = 'volatil';
      else if (er[i] >= C.erTrend && spread >= C.spreadTrend && c[i] > emaS[i]) lb = 'alcista';
      else if (er[i] >= C.erTrend && spread <= -C.spreadTrend && c[i] < emaS[i]) lb = 'bajista';
      else if (Math.abs(spread) < C.spreadRange && er[i] < C.erTrend) lb = 'lateral';
      label[i] = lb;
    }
    return { label, er, rank };
  }
  const COACH_DEFAULTS = { erLen: 100, erTrend: 0.08, spreadTrend: 2.5, spreadRange: 1.5, volLen: 500, volHigh: 80, window: 720, minTrades: 3, benchLateral: true, needPositive: true, sideByShadow: true };
  const SIDE_BY_REGIME = { alcista: 'long', bajista: 'short', lateral: 'none', volatil: 'both', transicion: 'both' };

  // Partidos en la sombra: cada táctica juega sola (sin dinero) y el entrenador mira su R reciente
  function coachPlan(data, P, C) {
    const n = data.c.length, sc = scout(data, P, C);
    const keys = Object.keys(TACTICS), score = {}, count = {}, sideScore = {};
    for (const k of keys) {
      const sh = run(data, Object.assign({}, P, TACTICS[k].p, { direction: 'both', coach: null }));
      const addR = new Array(n + 1).fill(0), addN = new Array(n + 1).fill(0), addL = new Array(n + 1).fill(0);
      sh.trades.forEach(t => { if (t.exitIdx !== null) { addR[t.exitIdx + 1] += t.r; addN[t.exitIdx + 1]++; if (t.dir > 0) addL[t.exitIdx + 1] += t.r; } });
      // rolling sums of R / trades closed in (i - window, i - 1]: decided at the close of i with trades already closed before i
      const cumR = new Array(n + 1).fill(0), cumN = new Array(n + 1).fill(0), cumL = new Array(n + 1).fill(0);
      for (let i = 1; i <= n; i++) { cumR[i] = cumR[i - 1] + addR[i]; cumN[i] = cumN[i - 1] + addN[i]; cumL[i] = cumL[i - 1] + addL[i]; }
      score[k] = new Array(n); count[k] = new Array(n); sideScore[k] = { long: new Array(n), short: new Array(n) };
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - C.window);
        score[k][i] = cumR[i] - cumR[a]; count[k][i] = cumN[i] - cumN[a];
        sideScore[k].long[i] = cumL[i] - cumL[a]; sideScore[k].short[i] = score[k][i] - sideScore[k].long[i];
      }
    }
    const tactic = new Array(n), side = new Array(n), changes = [];
    let prev = '';
    for (let i = 0; i < n; i++) {
      const reg = sc.label[i];
      let sd = SIDE_BY_REGIME[reg];
      if (reg === 'lateral' && !C.benchLateral) sd = 'both';
      let best = null, bestScore = -Infinity;
      for (const k of keys) if (count[k][i] >= C.minTrades && score[k][i] > bestScore) { best = k; bestScore = score[k][i]; }
      let tk = best && (bestScore > 0 || !C.needPositive) ? best : (C.needPositive && best ? null : 'tikitaka');
      if (!tk) sd = 'none';
      // el lado también se gana en la sombra: un lado que va en negativo con esta táctica no juega
      if (tk && C.sideByShadow && sd !== 'none') {
        const aL = sd !== 'short' && sideScore[tk].long[i] >= 0, aS = sd !== 'long' && sideScore[tk].short[i] >= 0;
        sd = aL && aS ? 'both' : aL ? 'long' : aS ? 'short' : 'none';
      }
      tactic[i] = tk || 'tikitaka'; side[i] = sd;
      const key = reg + '|' + tactic[i] + '|' + sd;
      if (key !== prev) { changes.push({ i, regime: reg, tactic: tactic[i], side: sd, scores: Object.fromEntries(keys.map(k => [k, score[k][i]])), counts: Object.fromEntries(keys.map(k => [k, count[k][i]])) }); prev = key; }
    }
    return { regime: sc.label, er: sc.er, volRank: sc.rank, tactic, side, score, count, sideScore, changes };
  }

  // ---------- backtest ----------
  function run(data, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const { t, o, h, l, c } = data, n = c.length;
    const v = data.v && data.v.some(x => x > 0) ? data.v : null;
    const emaF = ema(c, P.emaFast), emaM = ema(c, P.emaMid), emaS = ema(c, P.emaSlow);
    const atr = rma(trueRange(h, l, c, true), P.atrLen);
    const adx = adxSeries(h, l, c, P.adxLen);
    const rsi = rsiSeries(c, P.rsiLen);
    const atrPct = atr.map((x, i) => x / c[i]);
    const rank = percentRank(atrPct, P.volLookback);
    const volSma = v ? sma(v, 20) : null;
    const comm = P.commissionPct / 100, slip = P.slippagePct / 100;
    const C = P.coach ? Object.assign({}, COACH_DEFAULTS, P.coach === true ? {} : P.coach) : null;
    const plan = C ? coachPlan(data, P, C) : null;
    const TP = {}; Object.keys(TACTICS).forEach(k => { TP[k] = Object.assign({}, P, TACTICS[k].p); });
    let allowL = P.direction !== 'short', allowS = P.direction !== 'long';

    // broker / campaign state
    let equityRealized = P.initialCapital, pos = 0, qty = 0, qty0 = 0, avg = NaN, trade = null, pending = null;
    let stopLvl = NaN, tp1Lvl = NaN, tp1Done = false, ext = NaN, entryRef = NaN, exitNext = null;
    let streak = 0, restUntil = -1, commissionPaid = 0;
    const trades = [];
    const equity = new Array(n), stopPlot = nanArr(n), tpPlot = nanArr(n), progL = new Array(n), progS = new Array(n), inPos = new Array(n).fill(0);
    // readyL/readyS: la jugada está lista en la vela i (todo menos la posición y el descanso del backtest).
    // El bot en vivo lleva su propia posición y su descanso, y remata cuando la última vela cerrada está lista.
    const readyL = new Array(n).fill(false), readyS = new Array(n).fill(false);
    const funnel = { long: new Array(8).fill(0), short: new Array(8).fill(0) };  // index = step where the ball was lost; 7 = shot taken
    let peak = -Infinity, maxDd = 0, maxDdPct = 0, barsIn = 0;

    const fillExit = (i, price, q, reason) => {
      const fee = price * q * comm; commissionPaid += fee;
      const pnl = pos * (price - avg) * q - fee;
      equityRealized += pnl;
      trade.exits.push({ i, price, q, reason, pnl });
      qty -= q;
      if (qty <= qty0 * 1e-9) closeCampaign(i);
    };
    const closeCampaign = i => {
      const tr = trade;
      tr.exitIdx = i;
      tr.pnl = tr.exits.reduce((s, x) => s + x.pnl, 0) - tr.entryFee;
      tr.r = tr.pnl / tr.riskCash;
      tr.exitPrice = tr.exits.reduce((s, x) => s + x.price * x.q, 0) / tr.qty;
      const last = tr.exits[tr.exits.length - 1].reason;
      tr.reason = tr.exits.length > 1 && tr.exits[0].reason === 'TP1' ? 'TP1 + ' + last : last;
      tr.result = tr.pnl > 0 ? 'gol' : 'encajado';
      if (P.useCooldown) {
        streak = tr.pnl < 0 ? streak + 1 : 0;
        if (streak >= P.lossStreak) { restUntil = i + P.restBars; tr.restAfter = true; streak = 0; }
      }
      pos = 0; qty = 0; qty0 = 0; avg = NaN; trade = null; stopLvl = NaN; tp1Lvl = NaN; tp1Done = false; ext = NaN; exitNext = null;
    };

    for (let i = 0; i < n; i++) {
      // ---- fills at the open of bar i ----
      if (exitNext && pos !== 0) {           // market exit decided at the previous close
        const px = o[i] * (1 - pos * slip);
        fillExit(i, px, qty, exitNext);
      }
      exitNext = null;
      if (pending) {
        const pe = pending; pending = null;
        const px = pe.dir > 0 ? o[i] * (1 + slip) : o[i] * (1 - slip);
        const fee = px * pe.qty * comm; commissionPaid += fee; equityRealized -= fee;
        pos = pe.dir; qty = pe.qty; qty0 = pe.qty; avg = px;
        stopLvl = pe.stop; tp1Lvl = pe.tp1; tp1Done = false; ext = pe.dir > 0 ? h[i] : l[i]; entryRef = pe.ref;
        trade = { dir: pe.dir, tactic: pe.tactic, regime: pe.regime, signalIdx: pe.signalIdx, entryIdx: i, entry: px, qty: pe.qty, stop0: pe.stop, tp1: pe.tp1, riskCash: pe.riskCash,
          entryFee: fee, exits: [], snap: pe.snap, exitIdx: null };
        trades.push(trade);
        equityRealized += fee;              // the fee is accounted in the campaign pnl
        equityRealized -= fee;
      }
      // ---- stop / TP1 during bar i (orders already live on the entry bar) ----
      if (pos !== 0) {
        const dir = pos, op = o[i];
        const tp1Q = qty0 * P.tp1Pct / 100;
        const stopHit = px => fillExit(i, px * (1 - dir * slip), qty, tp1Done ? (dir > 0 ? (px >= entryRef ? 'Trailing' : 'Stop') : (px <= entryRef ? 'Trailing' : 'Stop')) : (dir > 0 ? (stopLvl > trade.stop0 ? 'Trailing' : 'Stop') : (stopLvl < trade.stop0 ? 'Trailing' : 'Stop')));
        const tpHit = px => { fillExit(i, px, Math.min(tp1Q, qty), 'TP1'); tp1Done = true; };
        if (dir > 0 ? op <= stopLvl : op >= stopLvl) stopHit(op);
        else {
          if (!tp1Done && P.tp1Pct > 0 && (dir > 0 ? op >= tp1Lvl : op <= tp1Lvl)) tpHit(op);
          if (pos !== 0) {
            const highFirst = (h[i] - op) < (op - l[i]);
            const path = highFirst ? [op, h[i], l[i], c[i]] : [op, l[i], h[i], c[i]];
            for (let s = 0; s < 3 && pos !== 0; s++) {
              const a = path[s], b = path[s + 1]; if (a === b) continue;
              const up = b > a, crosses = lv => up ? (lv > a && lv <= b) : (lv < a && lv >= b);
              const stopSide = dir > 0 ? !up : up;
              if (stopSide && crosses(stopLvl)) stopHit(stopLvl);
              else if (!stopSide && !tp1Done && P.tp1Pct > 0 && crosses(tp1Lvl)) tpHit(tp1Lvl);
            }
          }
        }
      }

      // ---- script at the close of bar i ----
      const eqNow = equityRealized + (pos !== 0 ? pos * (c[i] - avg) * qty : 0);
      equity[i] = eqNow;
      if (eqNow > peak) peak = eqNow;
      if (peak - eqNow > maxDd) maxDd = peak - eqNow;
      if ((peak - eqNow) / peak > maxDdPct) maxDdPct = (peak - eqNow) / peak;
      if (pos !== 0) { barsIn++; inPos[i] = pos; }

      // manage the open position (levels change at the close, active from the next bar)
      if (pos !== 0) {
        ext = pos > 0 ? Math.max(ext, h[i]) : Math.min(ext, l[i]);
        const chand = pos > 0 ? ext - P.trailAtr * atr[i] : ext + P.trailAtr * atr[i];
        if (pos > 0) { if (isFinite(chand)) stopLvl = Math.max(stopLvl, chand); if (tp1Done) stopLvl = Math.max(stopLvl, entryRef); }
        else { if (isFinite(chand)) stopLvl = Math.min(stopLvl, chand); if (tp1Done) stopLvl = Math.min(stopLvl, entryRef); }
        if (P.useTrendExit && (pos > 0 ? emaM[i] < emaS[i] || c[i] < emaS[i] : emaM[i] > emaS[i] || c[i] > emaS[i])) exitNext = 'Cambio de sistema';
        stopPlot[i] = stopLvl; if (!tp1Done && P.tp1Pct > 0) tpPlot[i] = tp1Lvl;
      }

      // the play: each player must pass the ball
      const flat = pos === 0 && !pending;
      const resting = P.useCooldown && i <= restUntil;
      const volOk = !v || !P.useVolume || (isFinite(volSma[i]) && v[i] >= volSma[i] * P.volMult);
      const rankOk = !P.useVolatility || (rank[i] >= P.volPctMin && rank[i] <= P.volPctMax);
      const slopeUp = i >= P.slopeLen && emaS[i] > emaS[i - P.slopeLen], slopeDn = i >= P.slopeLen && emaS[i] < emaS[i - P.slopeLen];
      const rsiLo = lowestAt(rsi, i, P.pullbackLookback), rsiHi = highestAt(rsi, i, P.pullbackLookback);
      let A = P;
      if (plan) { A = TP[plan.tactic[i]]; allowL = plan.side[i] === 'long' || plan.side[i] === 'both'; allowS = plan.side[i] === 'short' || plan.side[i] === 'both'; }
      const chain = dir => [
        flat && !resting && (dir > 0 ? allowL : allowS),
        !P.useTrend || (dir > 0 ? emaM[i] > emaS[i] && c[i] > emaS[i] && slopeUp : emaM[i] < emaS[i] && c[i] < emaS[i] && slopeDn),
        !A.useStrength || adx[i] >= A.adxMin,
        !A.usePullback || (dir > 0 ? rsiLo <= A.pullbackRsi : rsiHi >= 100 - A.pullbackRsi),
        rankOk,
        volOk,
        A.donLen > 0 ? i > A.donLen && (dir > 0 ? c[i] > highestAt(h, i - 1, A.donLen) : c[i] < lowestAt(l, i - 1, A.donLen))
          : i > 0 && (dir > 0 ? c[i] > h[i - 1] && c[i] > emaF[i] && c[i] > o[i] : c[i] < l[i - 1] && c[i] < emaF[i] && c[i] < o[i])
      ];
      let shot = 0;
      for (const [dir, arr, F] of [[1, progL, funnel.long], [-1, progS, funnel.short]]) {
        const ch = chain(dir);
        if ((dir > 0 ? allowL : allowS) && isFinite(atr[i]) && atr[i] > 0 && ch.every((x, j) => j === 0 || x)) (dir > 0 ? readyL : readyS)[i] = true;
        let k = ch.findIndex(x => !x); if (k < 0) k = 7;
        arr[i] = k;
        if (ch[0]) F[k]++;                  // only count plays where the keeper had the ball
        if (k === 7 && !shot && isFinite(atr[i]) && atr[i] > 0) shot = dir;
      }
      if (shot) {
        const dir = shot, stopDist = atr[i] * P.stopAtr;
        const riskCash = eqNow * P.riskPct / 100;
        const q = Math.min(riskCash / stopDist, eqNow * P.maxExposure / c[i]);
        if (q > 0) {
          pending = {
            tactic: plan ? plan.tactic[i] : null, regime: plan ? plan.regime[i] : null,
            dir, qty: q, signalIdx: i, ref: c[i], riskCash: q * stopDist,
            stop: c[i] - dir * stopDist, tp1: P.tp1Pct > 0 ? c[i] + dir * P.tp1R * stopDist : NaN,
            snap: { don: A.donLen, adx: adx[i], rsi: dir > 0 ? rsiLo : rsiHi, rank: rank[i], vol: v ? v[i] / volSma[i] : NaN, emaM: emaM[i], emaS: emaS[i], atr: atr[i], close: c[i] }
          };
        }
      }
    }

    // stats
    const closed = trades.filter(x => x.exitIdx !== null);
    const wins = closed.filter(x => x.pnl > 0), losses = closed.filter(x => x.pnl <= 0);
    const gp = wins.reduce((s, x) => s + x.pnl, 0), gl = -losses.reduce((s, x) => s + x.pnl, 0);
    let best = 0, cur = 0; closed.forEach(x => { cur = x.pnl > 0 ? cur + 1 : 0; best = Math.max(best, cur); });
    const reasons = {};
    closed.forEach(x => { reasons[x.reason] = (reasons[x.reason] || 0) + 1; });
    const last = n ? equity[n - 1] : P.initialCapital;
    const stats = {
      trades: closed.length, wins: wins.length, losses: losses.length,
      winRate: closed.length ? wins.length / closed.length * 100 : NaN,
      netProfit: last - P.initialCapital, netPct: (last - P.initialCapital) / P.initialCapital * 100,
      profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN),
      avgR: closed.length ? closed.reduce((s, x) => s + x.r, 0) / closed.length : NaN,
      avgWinR: wins.length ? wins.reduce((s, x) => s + x.r, 0) / wins.length : NaN,
      avgLossR: losses.length ? losses.reduce((s, x) => s + x.r, 0) / losses.length : NaN,
      maxDd, maxDdPct: maxDdPct * 100, exposurePct: n ? barsIn / n * 100 : 0, commissionPaid,
      bestStreak: best, reasons, longs: closed.filter(x => x.dir > 0).length, shorts: closed.filter(x => x.dir < 0).length,
      buyHoldPct: n ? (c[n - 1] - c[0]) / c[0] * 100 : 0, openTrade: trades.find(x => x.exitIdx === null) || null
    };
    return { params: P, plan, n, decimals: inferDecimals(c), hasVolume: !!v, emaF, emaM, emaS, atr, adx, rsi, rank, equity, stopPlot, tpPlot, progL, progS, readyL, readyS, inPos, funnel, trades, stats };
  }

  // Metrics of the trades whose entry falls in [from, to)
  function slice(res, from, to) {
    const tr = res.trades.filter(x => x.exitIdx !== null && x.entryIdx >= from && x.entryIdx < to);
    const w = tr.filter(x => x.pnl > 0), gp = w.reduce((s, x) => s + x.pnl, 0), gl = -tr.filter(x => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
    return { trades: tr.length, wins: w.length, net: tr.reduce((s, x) => s + x.pnl, 0), pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN), avgR: tr.length ? tr.reduce((s, x) => s + x.r, 0) / tr.length : NaN };
  }

  // Pre-season (in-sample) search on a small grid, then the league (out-of-sample) with the chosen line-up
  const GRID = { stopAtr: [1.5, 2, 2.5, 3], trailAtr: [2, 2.5, 3, 4], adxMin: [18, 22, 25, 30] };
  function preseason(data, params, split) {
    const n = data.c.length, cut = Math.floor(n * (split || 0.6));
    const rows = [];
    for (const stopAtr of GRID.stopAtr) for (const trailAtr of GRID.trailAtr) for (const adxMin of GRID.adxMin) {
      const r = run(data, Object.assign({}, params, { stopAtr, trailAtr, adxMin }));
      rows.push({ stopAtr, trailAtr, adxMin, train: slice(r, 0, cut), test: slice(r, cut, n) });
    }
    const eligible = rows.filter(x => x.train.trades >= 8);
    const pool = eligible.length ? eligible : rows;
    pool.sort((a, b) => b.train.net - a.train.net);
    const base = run(data, params);
    return { cut, rows, best: pool[0], base: { train: slice(base, 0, cut), test: slice(base, cut, n) },
      testPositive: rows.filter(x => x.test.net > 0).length, total: rows.length };
  }

  // Bench test: run without each player to see what they bring
  function bench(data, params) {
    const base = run(data, params).stats;
    const keys = [['useTrend', 'La Roca'], ['useStrength', 'El Motor'], ['usePullback', 'El Cerebro'], ['useVolatility', 'El Termómetro'], ['useVolume', 'La Chispa'], ['useCooldown', 'El Muro (descanso)'], ['useTrendExit', 'El Killer (salida por cambio)']];
    return { base, rows: keys.filter(([k]) => params[k] !== false).map(([k, name]) => ({ key: k, name, stats: run(data, Object.assign({}, params, { [k]: false })).stats })) };
  }

  // ---------- sample data: synthetic BTC-like 1 h markets ("rivales") ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const RIVALS = {
    mixto: 'Liga Mixta', alcista: 'Tendencia FC', bajista: 'Real Bajista', lateral: 'Lateral United', volatil: 'Volátil CF'
  };
  function makeSample(seed, weeks, kind) {
    kind = kind || 'mixto';
    const rnd = mulberry32((seed >>> 0) + (kind === 'mixto' ? 0 : kind.length * 7919));
    const gauss = () => { let u = 0, w = 0; while (u === 0) u = rnd(); while (w === 0) w = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
    const out = { t: [], o: [], h: [], l: [], c: [], v: [], kind, regime: [] };
    const t0 = Date.UTC(2026, 0, 5), total = (weeks || 16) * 7 * 24;
    let price = 90000, logVol = 0, regime = kind === 'mixto' ? 'lateral' : kind, left = 0, anchor = price, drift = 0;
    const kinds = ['alcista', 'bajista', 'lateral', 'volatil'];
    for (let k = 0; k < total; k++) {
      if (kind === 'mixto' && left-- <= 0) { regime = kinds[Math.floor(rnd() * 4)]; left = 240 + Math.floor(rnd() * 560); anchor = price; }
      const t = t0 + k * 3600000, hr = new Date(t).getUTCHours();
      const season = hr >= 13 && hr < 21 ? 1.25 : hr >= 7 && hr < 13 ? 1.0 : 0.8;
      logVol += 0.06 * gauss() - 0.04 * logVol;
      let sigma = 0.0042 * season * Math.exp(logVol);
      if (regime === 'alcista') drift = 0.00018 + 0.00006 * gauss();
      else if (regime === 'bajista') drift = -0.00018 + 0.00006 * gauss();
      else if (regime === 'lateral') drift = -0.03 * Math.log(price / anchor);
      else { drift = 0; sigma *= 1.9; if (rnd() < 0.01) drift = gauss() * 0.02; }
      const open = price;
      let p = open, hi = open, lo = open;
      for (let s = 0; s < 6; s++) { p *= 1 + drift / 6 + gauss() * sigma / Math.sqrt(6); if (p > hi) hi = p; if (p < lo) lo = p; }
      const r2 = x => Math.round(x * 100) / 100;
      out.t.push(t); out.o.push(r2(open)); out.h.push(r2(hi)); out.l.push(r2(lo)); out.c.push(r2(p)); out.regime.push(regime);
      out.v.push(Math.round((hi - lo) / price * 3e4 * (0.5 + rnd()) * (regime === 'volatil' ? 1.4 : 1)));
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
    if (rows.length < 300) throw new Error('Se leyeron ' + rows.length + ' velas válidas; hacen falta al menos 300 (la EMA 200 necesita historia).');
    rows.sort((a, b) => a[0] - b[0]);
    const out = { t: [], o: [], h: [], l: [], c: [], v: [], kind: 'csv' };
    for (const r of rows) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(isFinite(r[5]) ? r[5] : 0); }
    return out;
  }

  const api = { DEFAULTS, COACH_DEFAULTS, SIDE_BY_REGIME, scout, TACTICS, PLAYERS, RIVALS, GRID, run, slice, preseason, bench, makeSample, parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineTikiTrade = api;
})(typeof window !== 'undefined' ? window : this);
