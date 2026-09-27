'use strict';
// Estado en disco: un archivo por entrenador (datos/equipos/<id>.json) y la liga (datos/liga.json).
// Escritura atómica; sobrevive a reinicios.
const fs = require('fs');
const path = require('path');

function newAccount(extra) {
  return Object.assign({ pos: null, trades: [], streak: 0, restUntil: 0, day: null, peak: null, halted: null, stopOrderId: null, ownStops: [], curve: [] }, extra || {});
}
function newTeam(id, name, cfg, extra) {
  return Object.assign({
    version: 4, id, name, created: Date.now(),
    settings: { symbol: cfg.symbols[0], tactic: 'auto', direction: 'both', riskPct: cfg.riskPct },
    mode: 'demo', running: false, coachAlerts: true, muted: false,
    lastBar: 0, lastDecision: null, real: null,
    accounts: { demo: newAccount({ cash: cfg.demoCapital, initial: cfg.demoCapital }), real: newAccount({ initial: null }) }
  }, extra || {});
}
function writeJSON(file, obj) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, file); }

class Store {
  constructor(cfg) {
    this.cfg = cfg;
    this.dir = path.join(cfg.dataDir, 'equipos');
    this.leagueFile = path.join(cfg.dataDir, 'liga.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.teams = new Map();
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try { const t = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')); if (t && t.version === 4) this.teams.set(t.id, t); } catch (e) { console.error('No se pudo leer', f, e.message); }
    }
    try { this.league = JSON.parse(fs.readFileSync(this.leagueFile, 'utf8')); } catch (e) { this.league = null; }
  }
  saveTeam(t) { writeJSON(path.join(this.dir, t.id + '.json'), t); }
  saveLeague() { writeJSON(this.leagueFile, this.league); }
  addTeam(id, name, extra) { const t = newTeam(id, name, this.cfg, extra); this.teams.set(id, t); this.saveTeam(t); return t; }
  nameTaken(name) { const n = name.toLowerCase(); for (const t of this.teams.values()) if (t.name.toLowerCase() === n) return true; return false; }
}

module.exports = { Store, newAccount, newTeam };
