'use strict';
// Modo demo: cartera ficticia con precios reales del mercado. Mismos costes que el probador:
// comisión 0,05 % por lado y deslizamiento 0,02 % en cada ejecución a mercado o por stop.
class PaperBroker {
  constructor(acc, market, P) {
    this.acc = acc; this.market = market;
    this.comm = P.commissionPct / 100; this.slip = P.slippagePct / 100;
    this.kind = 'demo';
  }
  async init() { return { ok: true, text: 'Cartera demo con precios reales de ' + this.market.symbol }; }
  async equity(price) {
    const p = this.acc.pos;
    if (!p) return this.acc.cash;
    const px = price || await this.market.price();
    return this.acc.cash + p.dir * (px - p.entry) * p.qty;
  }
  async open(dir, qty) {
    const px = await this.market.price();
    const fill = px * (1 + dir * this.slip), fee = fill * qty * this.comm;
    this.acc.cash -= fee;
    return { price: fill, qty, fee };
  }
  async moveStop() { return true; }        // el stop demo lo vigila el propio bot
  settle(price, fee) {
    const p = this.acc.pos;
    this.acc.cash += p.dir * (price - p.entry) * p.qty - fee;
  }
  async close() {
    const p = this.acc.pos, px = await this.market.price();
    const fill = px * (1 - p.dir * this.slip), fee = fill * p.qty * this.comm;
    this.settle(fill, fee);
    return { price: fill, fee };
  }
  // ¿ha tocado el precio el stop? (con el último precio o con el mínimo/máximo de una vela)
  async poll(extreme) {
    const p = this.acc.pos; if (!p) return null;
    const px = extreme !== undefined ? extreme : await this.market.price();
    if (p.dir > 0 ? px > p.stop : px < p.stop) return null;
    const fill = p.stop * (1 - p.dir * this.slip), fee = fill * p.qty * this.comm;
    this.settle(fill, fee);
    return { price: fill, fee };
  }
}
module.exports = { PaperBroker };
