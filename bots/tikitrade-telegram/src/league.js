'use strict';
// La liga: divisiones, jornadas semanales (lunes a domingo, UTC), clasificación y ascensos y descensos.
// Cada partido enfrenta a dos entrenadores de la misma división: gana el que más R neto suma esa semana
// (en R, no en dinero: cuenta la calidad de las decisiones, no cuánto arriesga cada uno).
const { esc, sgn, nf, fday } = require('./util');

const DAY = 86400000, WEEK = 7 * DAY;
const DIV_NAMES = ['Primera División', 'Segunda División', 'Tercera División', 'Cuarta División', 'Quinta División', 'Sexta División'];
const divName = level => DIV_NAMES[level - 1] || ('División ' + level);
function mondayOf(t) { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY; }
const zero = () => ({ pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0, r: 0 });

// todos contra todos (método del círculo): la jornada k enfrenta a cada equipo con uno distinto
function pairings(ids, round) {
  const a = ids.slice(); if (a.length % 2) a.push(null);
  const n = a.length; if (n < 2) return [];
  const rest = a.slice(1), r = round % (n - 1);
  const line = [a[0]].concat(rest.slice(r), rest.slice(0, r));
  const out = [];
  for (let i = 0; i < n / 2; i++) out.push([line[i], line[n - 1 - i]]);
  return out;
}
// del R neto de la semana a goles: cada R entero es un gol; si empatan a goles pero uno sacó al menos medio R más, gana por uno
function score(ra, rb) {
  let ga = Math.max(0, Math.round(ra)), gb = Math.max(0, Math.round(rb));
  if (ga === gb && Math.abs(ra - rb) >= 0.5) { if (ra > rb) ga++; else gb++; }
  return [ga, gb];
}

class League {
  constructor({ cfg, store, teams, prizes }) { this.cfg = cfg; this.store = store; this.teams = teams; this.prizes = prizes || null; }
  get L() { return this.store.league; }
  init(now) {
    if (!this.store.league) {
      this.store.league = { season: 1, jornada: 1, weekStart: mondayOf(now), divisions: [], table: {}, fixtures: {}, history: [], champions: [] };
      this.store.saveLeague();
    }
  }
  name(id) { const t = this.teams(id); return t ? t.name : '(retirado)'; }
  divisionOf(id) { return this.L.divisions.find(d => d.teams.includes(id)) || null; }
  addTeam(id) {
    const L = this.L;
    let div = L.divisions[L.divisions.length - 1];
    if (!div || div.teams.length >= this.cfg.divisionSize) { div = { level: L.divisions.length + 1, teams: [] }; L.divisions.push(div); }
    div.teams.push(id);
    L.table[id] = zero();
    // si ya hay jornada en curso: ocupa el hueco de quien descansaba o descansa él
    if (L.fixtures && Object.keys(L.fixtures).length) {
      const fx = L.fixtures[div.level] || (L.fixtures[div.level] = []);
      const bye = fx.find(p => p.includes(null));
      if (bye) bye[bye.indexOf(null)] = id; else fx.push([id, null]);
    }
    this.store.saveLeague();
    return div;
  }
  removeTeam(id) {
    const L = this.L;
    for (const d of L.divisions) d.teams = d.teams.filter(x => x !== id);
    for (const fx of Object.values(L.fixtures || {})) for (const p of fx) { const k = p.indexOf(id); if (k >= 0) p[k] = null; }
    delete L.table[id];
    this.store.saveLeague();
  }
  makeFixtures() {
    const L = this.L; L.fixtures = {};
    for (const d of L.divisions) L.fixtures[d.level] = pairings(d.teams.slice().sort((a, b) => a - b), L.jornada - 1);
  }
  weekR(id, from, to) {
    const t = this.teams(id); if (!t) return { r: 0, n: 0 };
    let r = 0, n = 0;
    for (const a of Object.values(t.accounts)) for (const x of a.trades) if (x.exitTime >= from && x.exitTime < to) { r += x.r; n++; }
    return { r, n };
  }
  standings(level) {
    const d = this.L.divisions.find(x => x.level === level); if (!d) return [];
    return d.teams.map(id => Object.assign({ id, name: this.name(id) }, this.L.table[id] || zero()))
      .sort((a, b) => b.pts - a.pts || (b.gf - b.gc) - (a.gf - a.gc) || b.gf - a.gf || b.r - a.r || a.id - b.id);
  }
  position(id) { const d = this.divisionOf(id); if (!d) return null; return { level: d.level, pos: this.standings(d.level).findIndex(x => x.id === id) + 1, of: d.teams.length }; }
  // la jornada en curso con los R de la semana hasta ahora
  live(level, now) {
    const L = this.L, from = L.weekStart, to = Math.min(now, from + WEEK);
    const fx = (L.fixtures[level] || []);
    return fx.map(([a, b]) => {
      if (a === null || b === null) { const id = a === null ? b : a; return { bye: id, name: this.name(id) }; }
      const ra = this.weekR(a, from, to), rb = this.weekR(b, from, to), [ga, gb] = score(ra.r, rb.r);
      return { a, b, na: this.name(a), nb: this.name(b), ra: ra.r, rb: rb.r, ga, gb };
    });
  }
  // cierra las jornadas vencidas; devuelve los avisos [{ id, html }]
  check(now) {
    const out = [];
    if (!this.L.fixtures || !Object.keys(this.L.fixtures).length) { this.makeFixtures(); this.store.saveLeague(); }
    while (now >= this.L.weekStart + WEEK) out.push(...this.closeJornada());
    return out;
  }
  closeJornada() {
    const L = this.L, from = L.weekStart, to = from + WEEK, out = [], rec = { season: L.season, jornada: L.jornada, from, matches: [] };
    for (const d of L.divisions) {
      for (const m of this.live(d.level, to)) {
        if (m.bye !== undefined) { if (m.bye !== null) out.push({ id: m.bye, html: '🗓 Jornada ' + L.jornada + ': tu equipo descansaba esta semana.' }); continue; }
        const A = L.table[m.a] || (L.table[m.a] = zero()), B = L.table[m.b] || (L.table[m.b] = zero());
        A.pj++; B.pj++; A.gf += m.ga; A.gc += m.gb; B.gf += m.gb; B.gc += m.ga; A.r += m.ra; B.r += m.rb;
        if (m.ga > m.gb) { A.g++; B.p++; A.pts += 3; } else if (m.ga < m.gb) { B.g++; A.p++; B.pts += 3; } else { A.e++; B.e++; A.pts++; B.pts++; }
        rec.matches.push({ level: d.level, a: m.a, b: m.b, ga: m.ga, gb: m.gb, ra: m.ra, rb: m.rb });
        const line = '<b>' + esc(m.na) + ' ' + m.ga + ' – ' + m.gb + ' ' + esc(m.nb) + '</b> (' + sgn(m.ra, 1) + ' R frente a ' + sgn(m.rb, 1) + ' R)';
        for (const [id, mine, theirs] of [[m.a, m.ga, m.gb], [m.b, m.gb, m.ga]])
          out.push({ id, html: (mine > theirs ? '🏆 ¡Victoria!' : mine < theirs ? '😞 Derrota' : '🤝 Empate') + ' · Jornada ' + L.jornada + ' de la ' + divName(d.level) + '\n' + line });
      }
    }
    L.history.push(rec); if (L.history.length > 60) L.history.splice(0, L.history.length - 60);
    L.jornada++; L.weekStart += WEEK;
    for (const d of L.divisions) for (const id of d.teams) {
      const p = this.position(id), row = L.table[id];
      out.push({ id, html: '📊 ' + divName(d.level) + ': vas <b>' + p.pos + '.º de ' + p.of + '</b> con ' + row.pts + (row.pts === 1 ? ' punto' : ' puntos') + '. /liga' });
    }
    if (L.jornada > this.cfg.seasonWeeks) out.push(...this.endSeason());
    this.makeFixtures();
    this.store.saveLeague();
    return this.merge(out);
  }
  endSeason() {
    const L = this.L, out = [], k = this.cfg.promote;
    const tables = L.divisions.map(d => this.standings(d.level));
    const champion = tables[0] && tables[0][0];
    if (champion) { L.champions.push({ season: L.season, id: champion.id, name: champion.name }); out.push({ id: champion.id, html: '🏆🏆 <b>¡CAMPEONES de la ' + divName(1) + '!</b> Temporada ' + L.season + '. ¡Enhorabuena, míster!' }); }
    if (this.prizes) out.push(...this.prizes(L.season, L.divisions.map((d, i) => ({ level: d.level, rows: tables[i] })), divName));
    for (let l = 0; l < L.divisions.length - 1; l++) {
      const upper = tables[l], lower = tables[l + 1], n = Math.min(k, upper.length, lower.length);
      if (!n) continue;
      const down = upper.slice(-n).map(x => x.id), up = lower.slice(0, n).map(x => x.id);
      const U = L.divisions[l], D = L.divisions[l + 1];
      U.teams = U.teams.filter(id => !down.includes(id)).concat(up);
      D.teams = D.teams.filter(id => !up.includes(id)).concat(down);
      for (const id of up) out.push({ id, html: '⬆️ <b>¡Ascenso!</b> La próxima temporada juegas en ' + divName(l + 1) + '.' });
      for (const id of down) out.push({ id, html: '⬇️ Descenso: la próxima temporada juegas en ' + divName(l + 2) + '.' });
    }
    for (const id of Object.keys(L.table)) L.table[id] = zero();
    L.season++; L.jornada = 1;
    for (const d of L.divisions) for (const id of d.teams) out.push({ id, html: '🎉 Empieza la temporada ' + L.season + ' en la ' + divName(d.level) + '. ¡Suerte, míster!' });
    return out;
  }
  // un solo mensaje por entrenador
  merge(list) {
    const m = new Map();
    for (const x of list) m.set(x.id, (m.has(x.id) ? m.get(x.id) + '\n\n' : '') + x.html);
    return [...m.entries()].map(([id, html]) => ({ id, html }));
  }
}

module.exports = { League, divName, pairings, score, mondayOf, WEEK };
