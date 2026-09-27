'use strict';
// El equipo de un entrenador: su cartera (demo o real), sus decisiones (mercado, táctica, lado y riesgo)
// y su partido contra el mercado. Cada vela cerrada de 1 h actúa igual que el probador: gestiona la
// posición (trailing chandelier y salida por cambio de sistema), aplica los frenos y remata si la
// jugada está lista. Entre velas vigila el stop.
const E = require('./engine');
const { PaperBroker } = require('./brokers/paper');
const { ExchangeBroker } = require('./brokers/exchange');
const { newAccount } = require('./store');
const { symbolFor, EXCHANGES } = require('./config');
const secret = require('./secret');
const { nf, sgn, esc, REG, SIDE, goals, fday } = require('./util');

const PLAYERS = { cb: 'La Roca', lb: 'El Motor', mc: 'El Cerebro', mp: 'El Termómetro', ex: 'La Chispa', fw: 'El Killer' };
const TACTIC_NAME = k => k === 'auto' ? 'El Entrenador automático' : E.TACTICS[k] ? E.TACTICS[k].name : k;

class Team {
  constructor(state, { cfg, hub, store, notify, makeExchange, log, treasury, levelOf }) {
    this.state = state; this.cfg = cfg; this.hub = hub; this.store = store;
    this.treasury = treasury || null; this.levelOf = levelOf || (() => 0);
    this.notify = notify || (async () => {}); this.makeExchange = makeExchange;
    this.log = log || ((...a) => console.log(new Date().toISOString(), '[' + state.name + ']', ...a));
    this.P = Object.assign({}, E.DEFAULTS);
    const self = this;
    this.demoMarket = { get symbol() { return self.base; }, price: () => self.hub.price(self.base) };
    this.brokers = { demo: new PaperBroker(state.accounts.demo, this.demoMarket, this.P), real: null };
    this.realReady = false; this.busy = false; this.errors = new Map();
  }
  get S() { return this.state; }
  get id() { return this.state.id; }
  get acc() { return this.state.accounts[this.state.mode]; }
  get base() { return this.state.settings.symbol; }
  get tf() { return this.hub.tf; }
  get broker() { return this.state.mode === 'real' ? this.realBroker() : this.brokers.demo; }
  save() { this.store.saveTeam(this.state); }
  barOf(t) { return Math.floor(t / this.tf) * this.tf; }
  async say(html, extra) { if (this.state.muted) return; try { await this.notify(this.id, html, extra); } catch (e) { this.log('aviso fallido', e.message); } }
  async onError(e) {
    const msg = String(e && e.message || e).slice(0, 400);
    this.log('ERROR', msg);
    const last = this.errors.get(msg) || 0, now = Date.now();
    if (now - last > 30 * 60000) { this.errors.set(msg, now); await this.say('⚠️ <b>Problema</b>: ' + esc(msg)); }
  }
  flushWarnings() { const w = this.brokers.real && this.brokers.real.warnings; const out = []; while (w && w.length) out.push(w.shift()); return out; }

  // ---------- modo real: claves cifradas y bróker bajo demanda ----------
  realBroker() {
    if (this.brokers.real) return this.brokers.real;
    const r = this.state.real;
    if (!r) throw new Error('No tienes ningún exchange conectado. Usa /conectar.');
    if (!this.cfg.masterKey) throw new Error('El servidor no tiene CLAVE_MAESTRA: no puede leer claves.');
    const creds = secret.open(r.creds, this.cfg.masterKey);
    const ex = this.makeExchange(r.exchangeId, creds, r.sandbox);
    this.brokers.real = new ExchangeBroker(this.state.accounts.real, ex, symbolFor(r.exchangeId, this.base), this.P);
    return this.brokers.real;
  }
  async ensureReal() {
    if (this.realReady) return;
    const br = this.realBroker();
    await br.init();
    this.realReady = true;
    const a = this.state.accounts.real;
    if (a.initial == null) { a.initial = await br.equity(); this.save(); }
  }
  async connectReal(exchangeId, creds, sandbox) {
    if (!this.cfg.allowReal) throw new Error('El modo real no está activado en este servidor.');
    if (!this.cfg.masterKey) throw new Error('El servidor no tiene CLAVE_MAESTRA configurada.');
    if (this.state.accounts.real.pos) throw new Error('Tienes una jugada real abierta: ciérrala antes de cambiar de conexión.');
    const ex = this.makeExchange(exchangeId, creds, sandbox);
    const br = new ExchangeBroker(newAccount(), ex, symbolFor(exchangeId, this.base), this.P);
    const r = await br.init();                                      // si las claves no valen, falla aquí y no se guardan
    this.state.real = { exchangeId, sandbox: !!sandbox, creds: secret.seal(creds, this.cfg.masterKey), at: Date.now() };
    this.brokers.real = null; this.realReady = false;
    this.save();
    return r.text;
  }
  disconnectReal() {
    if (this.state.mode === 'real') throw new Error('Estás en modo real: pasa a /demo antes de desconectar.');
    this.state.real = null; this.brokers.real = null; this.realReady = false; this.save();
  }

  // ---------- entre velas ----------
  async poll() {
    if (!this.acc.pos) return;
    const ex = this.S.mode === 'demo' ? await this.brokers.demo.poll(await this.hub.price(this.base)) : await (await this.readyBroker()).poll();
    if (ex) await this.finish(ex, this.hub.now());
  }
  async readyBroker() { if (this.S.mode === 'real') await this.ensureReal(); return this.broker; }

  // ---------- cada vela cerrada ----------
  async onBar(entry) {
    const d = entry.d, n = d.c.length, i = n - 1, T = d.t[i], tf = this.tf, prev = this.S.lastBar;
    if (T <= prev) return;
    const res = this.hub.result(entry, this.S.settings.tactic);
    const br = await this.readyBroker(), acc = this.acc;

    // 1. stops tocados dentro de las velas cerradas (demo) o comprobación en el exchange (real)
    if (acc.pos && br.kind === 'demo') {
      for (let k = 0; k < n && acc.pos; k++) {
        if ((prev && d.t[k] <= prev) || d.t[k] + tf <= acc.pos.entryTime) continue;
        const ex = await br.poll(acc.pos.dir > 0 ? d.l[k] : d.h[k]);
        if (ex) await this.finish(ex, d.t[k]);
      }
    } else if (acc.pos) {
      const ex = await br.poll();
      if (ex) await this.finish(ex, T + tf);
    }

    // 2. la posición abierta: extremo, trailing chandelier y salida si se rompe la tendencia de fondo
    let trendExit = false;
    if (acc.pos) {
      const p = acc.pos;
      for (let k = 0; k < n; k++) if (d.t[k] > p.extBar && d.t[k] + tf > p.entryTime) { p.ext = p.dir > 0 ? Math.max(p.ext, d.h[k]) : Math.min(p.ext, d.l[k]); p.extBar = d.t[k]; }
      const chand = p.ext - p.dir * this.P.trailAtr * res.atr[i];
      const broken = this.P.useTrendExit && (p.dir > 0 ? res.emaM[i] < res.emaS[i] || d.c[i] < res.emaS[i] : res.emaM[i] > res.emaS[i] || d.c[i] > res.emaS[i]);
      if (broken) {
        trendExit = true;
        const ex = await br.close();
        await this.finish(Object.assign(ex, { reason: 'Cambio de sistema' }), T + tf);
      } else if (isFinite(chand) && (p.dir > 0 ? chand > p.stop : chand < p.stop)) {
        await br.moveStop(chand);
        p.stop = chand;
        this.save();
      }
    }

    // 3. la decisión
    const dec = this.decision(res, i, d, entry);
    const before = this.S.lastDecision;
    this.S.lastDecision = dec;
    if (before && this.S.coachAlerts && this.S.settings.tactic === 'auto' && (before.regime !== dec.regime || before.tactic !== dec.tactic || before.side !== dec.side))
      await this.say('🧑‍🏫 <b>El Entrenador cambia</b>: ve ' + REG[dec.regime] + ' en ' + this.base + ' → ' + (dec.side === 'none' ? 'banquillo' : E.TACTICS[dec.tactic].name + ', ' + SIDE[dec.side]) + '.');

    // 4. frenos de seguridad (solo frenan jugadas nuevas; los stops siguen)
    const eq = await br.equity(d.c[i]);
    const day = new Date(T + tf).toISOString().slice(0, 10);
    if (!acc.day || acc.day.date !== day) {
      if (acc.day) { const rep = this.dayReport(acc, eq); if (rep) await this.say(rep); }
      acc.day = { date: day, start: eq };
      if (acc.halted && acc.halted.kind === 'diaria') { acc.halted = null; await this.say('▶️ Nuevo día: se levanta el freno de pérdida diaria.'); }
    }
    acc.peak = Math.max(acc.peak || eq, eq);
    acc.curve.push([T + tf, Math.round(eq * 100) / 100]);
    if (acc.curve.length > 24 * 90) acc.curve.splice(0, acc.curve.length - 24 * 90);
    if (!acc.halted) {
      if (eq <= acc.day.start * (1 - this.cfg.dailyLossPct / 100)) {
        acc.halted = { kind: 'diaria', at: T + tf };
        await this.say('🛑 <b>Freno de pérdida diaria</b>: la cuenta ha bajado un ' + nf(this.cfg.dailyLossPct, 1) + ' % hoy. No habrá jugadas nuevas hasta mañana (UTC). Las abiertas siguen con su stop.');
      } else if (eq <= acc.peak * (1 - this.cfg.maxDdPct / 100)) {
        acc.halted = { kind: 'drawdown', at: T + tf };
        await this.say('🛑 <b>Freno de drawdown</b>: la cuenta está un ' + nf(this.cfg.maxDdPct, 1) + ' % por debajo de su máximo. No se abrirán más jugadas hasta que lo reanudes con /reanudar.');
      }
    }

    // 5. el remate (por el lado que permiten el Entrenador y el míster); una sola vez por vela
    this.S.lastBar = T;
    this.save();
    const resting = T <= acc.restUntil;
    if (!acc.pos && !trendExit && this.S.running && !acc.halted && !resting) {
      const okL = dec.side === 'long' || dec.side === 'both', okS = dec.side === 'short' || dec.side === 'both';
      const dir = res.readyL[i] && okL ? 1 : res.readyS[i] && okS ? -1 : 0;
      if (dir) await this.enter(dir, res, i, d, dec, br);
    }
    this.S.lastBar = T;
    this.save();
  }

  async enter(dir, res, i, d, dec, br) {
    const acc = this.acc, S = this.S, tz = this.treasury;
    // la tarifa de MenteColmena: sin fichas suficientes, no hay remate
    if (tz && !tz.canPay(this.id, S.mode)) { await this.noFunds(); return; }
    const dist = res.atr[i] * this.P.stopAtr, ref = d.c[i];
    const riskPct = Math.min(S.settings.riskPct, S.mode === 'real' ? this.cfg.maxRiskReal : 5);
    const eq = await br.equity(ref);
    const qty = Math.min(eq * riskPct / 100 / dist, eq * this.P.maxExposure / ref);
    if (!(qty > 0)) return;
    const f = await br.open(dir, qty);
    acc.pos = {
      dir, qty: f.qty, entry: f.price, ref, stop0: ref - dir * dist, stop: ref - dir * dist, ext: f.price, extBar: d.t[i],
      entryTime: this.hub.now(), signalBar: d.t[i], riskCash: f.qty * dist, fees: f.fee, tactic: dec.tactic, regime: dec.regime, symbol: this.base
    };
    // operación aceptada: se cobra la tarifa (club + bote de la división)
    if (tz) acc.pos.paid = tz.charge(this.id, S.mode, this.levelOf(this.id), (dir > 0 ? 'largo ' : 'corto ') + this.base + ' · ' + S.mode);
    this.save();
    if (br.protect) {
      try { await br.protect(); }
      catch (e) {
        const ex = await br.marketClose(), paid = acc.pos.paid;
        await this.finish(Object.assign(ex, { reason: 'Sin stop: cerrada por seguridad' }), this.hub.now());
        if (tz && paid) tz.refund(this.id, paid, 'operación cerrada por no poder poner el stop');
        throw new Error('No se pudo colocar el stop en el exchange (' + e.message + '). La posición se cerró por seguridad.');
      }
    }
    this.save();
    const p = acc.pos;
    await this.say('⚽ <b>¡Remate!</b> ' + (dir > 0 ? 'Largo' : 'Corto') + ' en ' + esc(this.base) + (S.mode === 'demo' ? ' <i>(demo)</i>' : ' <b>(dinero real)</b>')
      + '\nEntrada ' + nf(p.entry, 2) + ' · stop ' + nf(p.stop, 2) + ' · tamaño ' + nf(p.qty, 4)
      + '\nArriesga ' + nf(p.riskCash, 2) + ' (' + nf(riskPct, 1) + ' % de la cuenta)'
      + '\n🧑‍🏫 ' + E.TACTICS[dec.tactic].name + ' · ve ' + REG[dec.regime]);
    if (dir > 0 ? p.entry <= p.stop : p.entry >= p.stop) {
      const ex = await br.close();
      await this.finish(Object.assign(ex, { reason: 'Stop (hueco en la entrada)' }), this.hub.now());
    }
  }

  async finish(ex, when) {
    const acc = this.acc, p = acc.pos;
    if (!p) return;
    const pnl = p.dir * (ex.price - p.entry) * p.qty - p.fees - ex.fee;
    const r = pnl / p.riskCash;
    const reason = ex.reason || ((p.dir > 0 ? p.stop > p.stop0 : p.stop < p.stop0) ? 'Trailing' : 'Stop');
    const tr = { dir: p.dir, symbol: p.symbol || this.base, tactic: p.tactic, regime: p.regime, entryTime: p.entryTime, exitTime: when, entry: p.entry, exit: ex.price, qty: p.qty, pnl, r, reason, mode: this.S.mode };
    acc.trades.push(tr);
    if (acc.trades.length > 1000) acc.trades.splice(0, acc.trades.length - 1000);
    acc.pos = null; acc.stopOrderId = null;
    if (this.broker.sweep) { try { await this.broker.sweep(); } catch (e) {} }
    acc.streak = pnl < 0 ? acc.streak + 1 : 0;
    if (acc.streak >= this.P.lossStreak) { acc.restUntil = this.barOf(when) + this.P.restBars * this.tf; acc.streak = 0; tr.rest = true; }
    this.save();
    const g = goals(acc.trades);
    await this.say((pnl > 0 ? '🥅⚽ <b>¡GOOOL!</b> ' : '❌ <b>Encajado</b>: ') + reason.toLowerCase() + ' · ' + sgn(r, 2) + ' R (' + sgn(pnl, 2) + ')'
      + (ex.external ? '\n⚠️ La posición del exchange no coincide con la del bot: revísala.' : '')
      + '\nMarcador: ' + esc(this.S.name) + ' <b>' + g.f + ' : ' + g.a + '</b> Mercado'
      + (tr.rest ? '\n😮‍💨 Dos encajados seguidos: el equipo descansa ' + this.P.restBars + ' velas.' : ''));
  }

  decision(res, i, d, entry) {
    const set = this.S.settings, keys = Object.keys(E.TACTICS);
    const limit = side => set.direction === 'both' ? side : side === 'both' ? set.direction : side === set.direction ? side : 'none';
    let dec;
    if (set.tactic === 'auto') {
      const pl = res.plan;
      dec = {
        auto: true, regime: pl.regime[i], tactic: pl.tactic[i], coachSide: pl.side[i], side: limit(pl.side[i]),
        scores: Object.fromEntries(keys.map(k => [k, pl.score[k][i]])), counts: Object.fromEntries(keys.map(k => [k, pl.count[k][i]])),
        sideScores: Object.fromEntries(keys.map(k => [k, { long: pl.sideScore[k].long[i], short: pl.sideScore[k].short[i] }]))
      };
    } else dec = { auto: false, regime: this.hub.regime(entry)[i], tactic: set.tactic, side: set.direction };
    Object.assign(dec, { time: d.t[i], close: d.c[i], symbol: this.base, direction: set.direction });
    dec.play = this.explain(res, i, d, dec);
    return dec;
  }

  // hasta dónde llega el balón en la última vela, por los lados permitidos
  explain(res, i, d, dec) {
    const A = Object.assign({}, this.P, E.TACTICS[dec.tactic].p), sides = dec.side === 'long' ? [1] : dec.side === 'short' ? [-1] : dec.side === 'both' ? [1, -1] : [];
    let best = null;
    for (const dir of sides) {
      const L = dir > 0, c = d.c[i], sl = A.slopeLen;
      const rs = res.rsi.slice(i - A.pullbackLookback + 1, i + 1), lo = Math.min(...rs), hi = Math.max(...rs);
      const vAvg = d.v.slice(i - 19, i + 1).reduce((s, x) => s + x, 0) / 20;
      const steps = [
        ['cb', L ? res.emaM[i] > res.emaS[i] && c > res.emaS[i] && res.emaS[i] > res.emaS[i - sl] : res.emaM[i] < res.emaS[i] && c < res.emaS[i] && res.emaS[i] < res.emaS[i - sl], 'EMA 50 ' + nf(res.emaM[i], 2) + ' / EMA 200 ' + nf(res.emaS[i], 2)],
        ['lb', res.adx[i] >= A.adxMin, 'ADX ' + nf(res.adx[i], 1) + ' (mínimo ' + A.adxMin + ')'],
        ['mc', !A.usePullback || (L ? lo <= A.pullbackRsi : hi >= 100 - A.pullbackRsi), A.usePullback ? 'RSI ' + nf(L ? lo : hi, 1) + ' (pausa ' + (L ? '≤ ' + A.pullbackRsi : '≥ ' + (100 - A.pullbackRsi)) + ')' : 'sin pausa en esta táctica'],
        ['mp', res.rank[i] >= A.volPctMin && res.rank[i] <= A.volPctMax, 'volatilidad en el percentil ' + nf(res.rank[i], 0)],
        ['ex', !d.v.some(x => x > 0) || d.v[i] >= vAvg * A.volMult, 'volumen ' + nf(d.v[i] / vAvg, 2) + ' × la media'],
        ['fw', L ? res.readyL[i] : res.readyS[i], A.donLen > 0 ? 'ruptura de ' + A.donLen + ' velas' : 'ruptura de la vela anterior']
      ];
      const k = steps.findIndex(s => !s[1]);
      const reach = k < 0 ? 6 : k;
      if (!best || reach > best.reach) best = { dir, reach, lostBy: k < 0 ? null : PLAYERS[steps[k][0]], detail: k < 0 ? null : steps[k][2] };
    }
    return best;
  }

  async noFunds() {
    const now = this.hub.now();
    if (now - (this.S.noFundsAt || 0) < 12 * 3600000) return;
    this.S.noFundsAt = now; this.save();
    const { fichasTxt } = require('./treasury');
    await this.say('🪙 <b>Sin fichas</b>: tu equipo tenía una jugada lista, pero cada operación cuesta ' + fichasTxt(this.treasury.fee(this.S.mode)) + ' y tienes ' + fichasTxt(this.treasury.balance(this.id)) + '. Recarga con /fichas.');
  }

  dayReport(acc, eq) {
    const day = acc.day, t0 = Date.parse(day.date), tr = acc.trades.filter(x => x.exitTime >= t0 && x.exitTime < t0 + 86400000);
    if (!tr.length && !acc.pos) return null;
    const g = goals(tr);
    return '📅 <b>Resumen del ' + fday(t0) + '</b> (' + (this.S.mode === 'demo' ? 'demo' : 'real') + ')\nJugadas cerradas: ' + tr.length + ' · goles ' + g.f + ' : ' + g.a + (acc.pos ? ' · una jugada sigue abierta' : '')
      + '\nCartera ' + nf(eq, 2) + ' (' + sgn((eq / day.start - 1) * 100, 2) + ' % en el día)';
  }

  // ---------- órdenes del míster ----------
  async setMode(mode) {
    if (mode === this.S.mode) return;
    if (this.acc.pos) throw new Error('Hay una jugada abierta en modo ' + this.S.mode + '. Ciérrala con /cerrar o espera a que termine.');
    if (mode === 'real') { if (!this.cfg.allowReal) throw new Error('El modo real no está activado en este servidor.'); await this.ensureReal(); }
    this.S.mode = mode; this.save();
  }
  setRunning(on) { this.S.running = !!on; this.save(); }
  resume() { this.acc.halted = null; this.acc.peak = null; this.S.running = true; this.save(); }
  setRisk(x) {
    if (!(x >= 0.1 && x <= 5)) throw new Error('El riesgo por jugada va de 0,1 a 5 %.');
    this.S.settings.riskPct = x; this.save();
    return this.S.mode === 'real' ? Math.min(x, this.cfg.maxRiskReal) : x;
  }
  setSymbol(base) {
    if (!this.cfg.symbols.includes(base)) throw new Error('Mercado no disponible. Opciones: ' + this.cfg.symbols.join(', '));
    if (this.S.accounts.demo.pos || this.S.accounts.real.pos) throw new Error('Tienes una jugada abierta: cambia de mercado cuando termine.');
    this.S.settings.symbol = base; this.S.lastDecision = null; this.S.lastBar = 0;
    this.brokers.real = null; this.realReady = false; this.save();
  }
  // la nueva táctica juega desde la próxima vela (no se revisan velas pasadas: con una jugada abierta
  // se volverían a mirar sus mínimos con el stop ya subido)
  setTactic(k) { if (k !== 'auto' && !E.TACTICS[k]) throw new Error('Táctica desconocida.'); this.S.settings.tactic = k; this.S.lastDecision = null; this.save(); }
  setDirection(dir) { if (!['both', 'long', 'short'].includes(dir)) throw new Error('Lado desconocido.'); this.S.settings.direction = dir; this.save(); }
  resetDemo(capital) {
    if (this.S.accounts.demo.pos) throw new Error('Hay una jugada demo abierta.');
    const a = this.S.accounts.demo;
    for (const k of Object.keys(a)) delete a[k];
    Object.assign(a, newAccount({ cash: capital, initial: capital }));
    this.save();
  }
  async closeNow() {
    if (!this.acc.pos) return false;
    const br = await this.readyBroker();
    const ex = await br.close();
    await this.finish(Object.assign(ex, { reason: 'Cierre manual' }), this.hub.now());
    return true;
  }
  allTrades() { return this.S.accounts.demo.trades.concat(this.S.accounts.real.trades).sort((a, b) => a.exitTime - b.exitTime); }

  // qué vería el equipo con su configuración actual en la última vela ya descargada (sin operar)
  preview() {
    const entry = this.hub.bars.get(this.base);
    if (this.S.lastDecision || !entry) return;
    const i = entry.d.c.length - 1;
    this.S.lastDecision = this.decision(this.hub.result(entry, this.S.settings.tactic), i, entry.d, entry);
  }
  async status() {
    this.preview();
    const S = this.S, acc = this.acc;
    let price = NaN, eq = NaN;
    try { price = await this.hub.price(this.base); eq = S.mode === 'demo' ? await this.brokers.demo.equity(price) : (this.realReady ? await this.broker.equity() : NaN); } catch (e) {}
    const p = acc.pos;
    return {
      name: S.name, mode: S.mode, running: S.running, halted: acc.halted, resting: acc.restUntil && S.lastBar <= acc.restUntil ? acc.restUntil : 0,
      symbol: this.base, settings: S.settings, real: S.real ? { exchange: EXCHANGES[S.real.exchangeId].name, sandbox: S.real.sandbox } : null,
      price, equity: eq, initial: acc.initial, peak: acc.peak, trades: acc.trades, curve: acc.curve || [],
      pos: p ? Object.assign({}, p, { openR: isFinite(price) ? p.dir * (price - p.entry) * p.qty / p.riskCash : NaN }) : null,
      decision: S.lastDecision, lastBar: S.lastBar, tf: this.tf,
      fichas: this.treasury && this.treasury.on ? { balance: this.treasury.balance(this.id), fee: this.treasury.fee(S.mode) } : null
    };
  }
}

module.exports = { Team, TACTIC_NAME };
