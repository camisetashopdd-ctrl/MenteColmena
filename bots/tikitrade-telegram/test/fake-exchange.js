'use strict';
// Exchange simulado con la interfaz de ccxt que usa el bot: velas sintéticas del probador que se
// «viven» con un reloj, precio dentro de la vela (apertura → extremo cercano → otro extremo → cierre),
// órdenes a mercado y stops «reduce only» que se disparan al tocarse.
class FakeExchange {
  constructor(data, opts) {
    opts = opts || {};
    this.d = data; this.id = opts.id || 'fake'; this.name = 'Exchange simulado';
    this.tfMs = 3600000; this.clock = data.t[0];
    this.cs = opts.contractSize || 1; this.slip = 0.0002; this.comm = 0.0005;
    this.cash = opts.cash || 10000; this.pos = 0; this.entry = 0;       // pos en contratos (+ largo, − corto)
    this.orders = new Map(); this.seq = 1; this.log = [];
    this.failStop = false;
  }
  parseTimeframe() { return 3600; }
  idx(t) { return Math.floor((t - this.d.t[0]) / this.tfMs); }
  priceAt(t) {
    const k = Math.min(this.idx(t), this.d.t.length - 1), d = this.d;
    const f = Math.max(0, Math.min(1, (t - d.t[k]) / this.tfMs));
    const o = d.o[k], h = d.h[k], l = d.l[k], c = d.c[k];
    const path = (h - o) < (o - l) ? [o, h, l, c] : [o, l, h, c];
    const s = Math.min(2, Math.floor(f * 3)), u = f * 3 - s;
    return path[s] + (path[s + 1] - path[s]) * u;
  }
  async fetchOHLCV(sym, tf, since, limit) {
    const out = [];
    for (let k = Math.max(0, this.idx(since)); k < this.d.t.length && out.length < limit; k++) {
      if (this.d.t[k] > this.clock) break;
      const forming = this.d.t[k] + this.tfMs > this.clock;
      out.push([this.d.t[k], this.d.o[k], forming ? Math.max(this.d.o[k], this.priceAt(this.clock)) : this.d.h[k], forming ? Math.min(this.d.o[k], this.priceAt(this.clock)) : this.d.l[k], forming ? this.priceAt(this.clock) : this.d.c[k], this.d.v[k]]);
    }
    return out;
  }
  async fetchTicker() { return { last: this.priceAt(this.clock) }; }
  // --- trading ---
  async loadMarkets() { return {}; }
  market() { return { contract: true, settle: 'USDT', quote: 'USDT', contractSize: this.cs, limits: { amount: { min: 0.001 } } }; }
  async setLeverage() {}
  amountToPrecision(s, q) { return (Math.floor(q * 1000) / 1000).toFixed(3); }
  priceToPrecision(s, p) { return p.toFixed(2); }
  async fetchBalance() { return { total: { USDT: this.cash } }; }
  fill(side, amt, px) {
    const dir = side === 'buy' ? 1 : -1, q = amt * this.cs, fill = px * (1 + dir * this.slip), fee = fill * q * this.comm;
    // realiza pnl si reduce
    if (this.pos !== 0 && Math.sign(this.pos) !== dir) { this.cash += Math.sign(this.pos) * (fill - this.entry) * q; this.pos += dir * amt; if (Math.abs(this.pos) < 1e-9) this.pos = 0; }
    else { this.entry = fill; this.pos += dir * amt; }
    this.cash -= fee;
    return { fill, fee };
  }
  async createOrder(sym, type, side, amt, price, params) {
    params = params || {};
    const id = String(this.seq++);
    if (params.stopLossPrice) {
      if (this.failStop) throw new Error('rechazada (simulado)');
      const o = { id, side, amt, trigger: params.stopLossPrice, status: 'open' };
      this.orders.set(id, o); this.log.push(['stop', side, amt, params.stopLossPrice]);
      return { id };
    }
    if (params.reduceOnly && this.pos === 0) throw new Error('ReduceOnly sin posición');
    const r = this.fill(side, amt, this.priceAt(this.clock));
    this.log.push(['market', side, amt, r.fill]);
    return { id, average: r.fill, fee: { cost: r.fee } };
  }
  async cancelOrder(id) { const o = this.orders.get(id); if (!o || o.status !== 'open') throw new Error('no existe'); o.status = 'canceled'; }
  async fetchOrder(id) { const o = this.orders.get(id); return { id, average: o && o.average, status: o && o.status, fee: o && o.fee }; }
  async fetchPositions() { return this.pos ? [{ symbol: 'BTC/USDT:USDT', contracts: Math.abs(this.pos), side: this.pos > 0 ? 'long' : 'short' }] : []; }
  // avanza el reloj minuto a minuto disparando stops
  advance(ms) {
    const end = this.clock + ms;
    while (this.clock < end) {
      this.clock = Math.min(end, this.clock + 60000);
      const px = this.priceAt(this.clock);
      for (const o of this.orders.values()) {
        if (o.status !== 'open' || this.pos === 0) continue;
        const hit = o.side === 'sell' ? px <= o.trigger : px >= o.trigger;
        if (hit) { const r = this.fill(o.side, Math.min(o.amt, Math.abs(this.pos)), o.trigger); o.status = 'closed'; o.average = r.fill; o.fee = { cost: r.fee }; }
      }
    }
  }
}
module.exports = { FakeExchange };
