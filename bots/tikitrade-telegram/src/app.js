'use strict';
// El club: todos los equipos, la liga y el reloj. Cada 20 s vigila los stops; en cada vela cerrada
// hace jugar a cada equipo con los datos compartidos de su mercado; cada lunes cierra la jornada.
const { Team } = require('./team');
const { League } = require('./league');
const { Treasury } = require('./treasury');

class App {
  constructor({ cfg, store, hub, notify, makeExchange, log }) {
    this.cfg = cfg; this.store = store; this.hub = hub;
    this.notify = notify || (async () => {}); this.makeExchange = makeExchange;
    this.log = log || ((...a) => console.log(new Date().toISOString(), ...a));
    this.teams = new Map();
    this.treasury = new Treasury(cfg); this.treasury.now = () => hub.now();
    this.league = new League({ cfg, store, teams: id => store.teams.get(id), prizes: (season, tables, divName) => this.treasury.payPrizes(season, tables, divName) });
    this.league.init(hub.now());
    for (const st of store.teams.values()) {
      this.teams.set(st.id, this.makeTeam(st));
      if (!this.league.divisionOf(st.id)) this.league.addTeam(st.id);
    }
    this.ticks = 0; this.busy = false; this.timer = null;
  }
  makeTeam(st) {
    return new Team(st, { cfg: this.cfg, hub: this.hub, store: this.store, notify: this.notify, makeExchange: this.makeExchange, log: this.log,
      treasury: this.treasury, levelOf: id => { const d = this.league.divisionOf(id); return d ? d.level : 0; } });
  }
  team(id) { return this.teams.get(id) || null; }
  register(id, name, extra) {
    if (this.teams.has(id)) throw new Error('Ya tienes equipo.');
    if (this.teams.size >= this.cfg.maxTeams) throw new Error('La liga está completa (' + this.cfg.maxTeams + ' equipos).');
    name = String(name || '').replace(/\s+/g, ' ').trim();
    if (!/^[\p{L}\p{N} .'\-_]{3,24}$/u.test(name)) throw new Error('El nombre debe tener entre 3 y 24 caracteres (letras, números, espacios, . \' - _).');
    if (this.store.nameTaken(name)) throw new Error('Ya hay un equipo que se llama así. Elige otro nombre.');
    const st = this.store.addTeam(id, name, extra);
    const team = this.makeTeam(st);
    this.teams.set(id, team);
    const div = this.league.addTeam(id);
    this.treasury.welcome(id);
    return { team, div };
  }
  unregister(id) {
    const t = this.team(id); if (!t) return;
    if (t.S.accounts.demo.pos || t.S.accounts.real.pos) throw new Error('Tienes una jugada abierta: ciérrala antes de darte de baja.');
    this.league.removeTeam(id);
    this.teams.delete(id); this.store.teams.delete(id);
    try { require('fs').unlinkSync(require('path').join(this.store.dir, id + '.json')); } catch (e) {}
  }
  start() { if (!this.timer) { this.timer = setInterval(() => this.tick(), this.cfg.tickMs); this.tick(); } }
  stop() { clearInterval(this.timer); this.timer = null; }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.ticks++;
      for (const m of this.league.check(this.hub.now())) await this.notify(m.id, m.html);
      const groups = new Map();
      for (const t of this.teams.values()) { const b = t.base; if (!groups.has(b)) groups.set(b, []); groups.get(b).push(t); }
      const closed = this.hub.lastClosedOpen();
      for (const [base, list] of groups) {
        for (const t of list) if (t.acc.pos && (t.S.mode === 'demo' || this.ticks % 3 === 0)) await this.guard(t, () => t.poll());
        const need = list.filter(t => t.S.lastBar < closed);
        if (!need.length) continue;
        let entry;
        try { entry = await this.hub.bar(base); }
        catch (e) { this.log('Datos de ' + base + ':', e.message); for (const t of need) await t.onError(new Error('No llegan los datos de ' + base + ': ' + e.message)); continue; }
        for (const t of need) await this.guard(t, () => t.onBar(entry));
      }
    } catch (e) { this.log('tick', e && e.stack || e); }
    finally { this.busy = false; }
  }
  async guard(t, fn) {
    try { await fn(); } catch (e) { await t.onError(e); }
    for (const w of t.flushWarnings()) await t.say('⚠️ ' + w);
  }
}
module.exports = { App };
