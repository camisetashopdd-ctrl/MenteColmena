'use strict';
// La tesorería de MenteColmena.
//  · Cada entrenador tiene fichas (las compra con Telegram Stars; recibe unas de bienvenida).
//  · Cada operación aceptada (la que se abre de verdad) cuesta la tarifa. Sin fichas, no hay remate.
//  · De cada tarifa, PORCENTAJE_CLUB va al fondo del club y el resto al bote de la división del
//    entrenador en esa temporada.
//  · Al final de la temporada, cada división reparte su bote entre sus primeros (REPARTO_PREMIOS),
//    en fichas. Lo que no se reparte pasa a la temporada siguiente.
// Todas las cantidades se guardan en centésimas de ficha (enteros): las cuentas cuadran al céntimo.
// Cada movimiento se apunta en datos/movimientos.jsonl (registro para auditar).
const fs = require('fs');
const path = require('path');

const C = 100;
const fichas = cents => cents / C;

class Treasury {
  constructor(cfg) {
    this.cfg = cfg; this.f = cfg.fees;
    this.file = path.join(cfg.dataDir, 'tesoreria.json');
    this.logFile = path.join(cfg.dataDir, 'movimientos.jsonl');
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    let s = null;
    try { s = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { s = null; }
    this.s = s || { balances: {}, club: 0, pots: {}, carry: {}, payments: {}, history: [], welcomed: {},
      stats: { starsIn: 0, starsRefunded: 0, bought: 0, fees: 0, feesRefunded: 0, prizes: 0, gifts: 0, welcome: 0 } };
    this.now = () => Date.now();
  }
  get on() { return this.f.enabled; }
  save() { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.s)); fs.renameSync(tmp, this.file); }
  log(type, id, cents, detail) {
    const line = JSON.stringify({ t: this.now(), type, id, fichas: fichas(cents), detail: detail || '' });
    fs.appendFileSync(this.logFile, line + '\n');
  }
  balance(id) { return this.s.balances[id] || 0; }
  add(id, cents) { this.s.balances[id] = (this.s.balances[id] || 0) + cents; }
  // tarifa (en centésimas) de una operación en ese modo
  fee(mode) { return this.on && (mode === 'real' ? this.f.real : this.f.demo) ? Math.round(this.f.perTrade * C) : 0; }
  canPay(id, mode) { const f = this.fee(mode); return f === 0 || this.balance(id) >= f; }
  split(cents) { const club = Math.floor(cents * this.f.clubPct / 100); return { club, pot: cents - club }; }

  // fichas de bienvenida: una sola vez por usuario (aunque se dé de baja y vuelva)
  welcome(id) {
    this.s.welcomed = this.s.welcomed || {};
    if (!this.on || !this.f.welcome || this.s.welcomed[id]) return 0;
    this.s.welcomed[id] = true;
    const c = Math.round(this.f.welcome * C);
    this.add(id, c); this.s.stats.welcome += c; this.log('bienvenida', id, c); this.save();
    return c;
  }
  // cobra la tarifa de una operación aceptada; devuelve { cents, level } para poder devolverla
  charge(id, mode, level, detail) {
    const cents = this.fee(mode);
    if (!cents) return null;
    const sp = this.split(cents), key = String(level);
    this.add(id, -cents);
    this.s.club += sp.club;
    this.s.pots[key] = (this.s.pots[key] || 0) + sp.pot;
    this.s.stats.fees += cents;
    this.log('tarifa', id, -cents, detail + ' · club ' + fichas(sp.club) + ' · bote ' + key + ' ' + fichas(sp.pot));
    this.save();
    return { cents, level: key };
  }
  // devuelve una tarifa (operación que el bot tuvo que cerrar por un fallo suyo)
  refund(id, paid, detail) {
    if (!paid) return;
    const sp = this.split(paid.cents);
    this.add(id, paid.cents);
    this.s.club -= sp.club;
    this.s.pots[paid.level] = (this.s.pots[paid.level] || 0) - sp.pot;
    this.s.stats.feesRefunded += paid.cents;
    this.log('devolucion_tarifa', id, paid.cents, detail);
    this.save();
  }
  // compra con Telegram Stars (idempotente: el mismo cobro no suma dos veces)
  purchase(id, chargeId, stars, n) {
    if (this.s.payments[chargeId]) return false;
    const c = Math.round(n * C);
    this.s.payments[chargeId] = { id, stars, fichas: n, t: this.now(), refunded: false };
    this.add(id, c); this.s.stats.starsIn += stars; this.s.stats.bought += c;
    this.log('compra', id, c, stars + ' estrellas · ' + chargeId);
    this.save();
    return true;
  }
  refundPurchase(chargeId) {
    const p = this.s.payments[chargeId];
    if (!p) throw new Error('No hay ningún pago con ese identificador.');
    if (p.refunded) throw new Error('Ese pago ya estaba devuelto.');
    const c = Math.round(p.fichas * C);
    p.refunded = true; this.add(p.id, -c); this.s.stats.starsRefunded += p.stars;
    this.log('devolucion_compra', p.id, -c, p.stars + ' estrellas · ' + chargeId);
    this.save();
    return p;
  }
  gift(id, n, detail) {
    const c = Math.round(n * C);
    this.add(id, c); this.s.stats.gifts += c; this.log('regalo', id, c, detail); this.save();
  }
  // últimos movimientos de un entrenador (del registro)
  movements(id, n) {
    let lines = [];
    try { lines = fs.readFileSync(this.logFile, 'utf8').trim().split('\n'); } catch (e) { return []; }
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) { try { const m = JSON.parse(lines[i]); if (m.id === id) out.push(m); } catch (e) {} }
    return out;
  }
  pot(level) { const k = String(level); return (this.s.pots[k] || 0) + (this.s.carry[k] || 0); }

  // fin de temporada: cada división reparte su bote (tablas ordenadas ANTES de ascensos y descensos)
  payPrizes(season, tables, divName) {
    const out = [];
    if (!this.on) return out;
    const shares = this.f.prizes;
    for (const { level, rows } of tables) {
      const k = String(level), pot = this.pot(level);
      const rec = { season, level, pot, winners: [] };
      let paid = 0;
      shares.forEach((sh, i) => {
        const row = rows[i]; if (!row) return;
        const amt = Math.floor(pot * sh / 100); if (amt <= 0) return;
        this.add(row.id, amt); paid += amt; this.s.stats.prizes += amt;
        rec.winners.push({ id: row.id, pos: i + 1, cents: amt });
        this.log('premio', row.id, amt, 'temporada ' + season + ' · ' + divName(level) + ' · ' + (i + 1) + '.º');
        out.push({ id: row.id, html: '💰 <b>Premio de la temporada ' + season + '</b>: ' + (i + 1) + '.º de la ' + divName(level) + ' → <b>+' + fichasTxt(amt) + '</b> del bote.' });
      });
      this.s.carry[k] = pot - paid;            // lo que no se reparte (redondeos, divisiones cortas) sigue en el bote
      this.s.pots[k] = 0;
      this.s.history.push(rec);
    }
    if (this.s.history.length > 200) this.s.history.splice(0, this.s.history.length - 200);
    this.save();
    return out;
  }
  // comprobación de la contabilidad: lo que entró = lo que tienen los entrenadores + club + botes
  audit() {
    const st = this.s.stats;
    const inflow = st.bought + st.welcome + st.gifts;
    const refundedBuys = Object.values(this.s.payments).filter(p => p.refunded).reduce((a, p) => a + Math.round(p.fichas * C), 0);
    const held = Object.values(this.s.balances).reduce((a, b) => a + b, 0);
    const pots = Object.values(this.s.pots).reduce((a, b) => a + b, 0) + Object.values(this.s.carry).reduce((a, b) => a + b, 0);
    const expected = inflow - refundedBuys;
    return { ok: held + this.s.club + pots === expected, held, club: this.s.club, pots, expected };
  }
}
const fmt = cents => (cents / C).toLocaleString('es-ES', { minimumFractionDigits: cents % C ? 2 : 0, maximumFractionDigits: 2 });
const fichasTxt = cents => fmt(cents) + (cents === C ? ' ficha' : ' fichas');

module.exports = { Treasury, fmt, fichasTxt, C };
