'use strict';
// El vestuario común: datos de mercado y pasadas del motor compartidas por todos los entrenadores.
// Una descarga de velas por mercado y vela, y una pasada del motor por mercado y táctica.
const E = require('./engine');
const { Market } = require('./market');
const { symbolFor } = require('./config');

class Hub {
  constructor(exchange, cfg) {
    this.ex = exchange; this.cfg = cfg;
    this.markets = new Map(); this.bars = new Map(); this.prices = new Map();
    this.now = () => Date.now();
  }
  market(base) {
    if (!this.markets.has(base)) {
      const m = new Market(this.ex, symbolFor(this.cfg.dataExchangeId, base), this.cfg.timeframe);
      m.now = () => this.now();
      this.markets.set(base, m);
    }
    return this.markets.get(base);
  }
  get tf() { return this.ex.parseTimeframe(this.cfg.timeframe) * 1000; }
  lastClosedOpen() { return Math.floor(this.now() / this.tf) * this.tf - this.tf; }
  // último precio, compartido unos segundos entre todos los equipos de ese mercado
  async price(base) {
    const c = this.prices.get(base), now = this.now();
    if (c && now - c.at < 10000) return c.p;
    const p = await this.market(base).price();
    this.prices.set(base, { p, at: now });
    return p;
  }
  // velas cerradas hasta la última vela (una descarga por mercado y vela)
  async bar(base) {
    const closed = this.lastClosedOpen(), c = this.bars.get(base);
    if (c && c.closed === closed) return c;
    const d = await this.market(base).candles(this.cfg.bars);
    if (d.c.length < 700) throw new Error('Solo llegaron ' + d.c.length + ' velas de ' + base + '; hacen falta al menos 700.');
    const entry = { closed, d, runs: new Map(), regime: null };
    this.bars.set(base, entry);
    return entry;
  }
  // pasada del motor para una táctica: 'auto' (con el Entrenador) o una táctica fija
  result(entry, tactic) {
    if (!entry.runs.has(tactic)) {
      const P = tactic === 'auto' ? Object.assign({}, E.DEFAULTS, { coach: E.COACH_DEFAULTS })
        : Object.assign({}, E.DEFAULTS, E.TACTICS[tactic].p, { coach: null, direction: 'both' });
      entry.runs.set(tactic, E.run(entry.d, P));
    }
    return entry.runs.get(tactic);
  }
  // el rival que ve el ojeador (para las tácticas fijas, que no llevan Entrenador)
  regime(entry) {
    if (!entry.regime) entry.regime = E.scout(entry.d, E.DEFAULTS, E.COACH_DEFAULTS).label;
    return entry.regime;
  }
}
module.exports = { Hub };
