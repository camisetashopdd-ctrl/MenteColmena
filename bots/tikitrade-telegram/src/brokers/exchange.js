'use strict';
// Modo real: opera en un exchange de futuros perpetuos (o en Hyperliquid con wallet) vía ccxt.
// El stop vive en el propio exchange como orden stop-market «reduce only», así que protege
// aunque el bot o el ordenador se apaguen. Al mover el stop se crea el nuevo antes de cancelar el viejo.
class ExchangeBroker {
  constructor(acc, exchange, symbol, P) {
    this.acc = acc; this.ex = exchange; this.symbol = symbol;
    this.comm = P.commissionPct / 100; this.maxExposure = P.maxExposure;
    this.kind = 'real';
    this.market = null;
    this.warnings = [];
  }
  get needsPrice() { return this.ex.id === 'hyperliquid'; }   // Hyperliquid pide precio también en órdenes a mercado
  // Binance y OKX guardan los stops como órdenes «algo»: para cancelarlos o consultarlos hay que decirlo
  get trig() { return this.ex.id === 'hyperliquid' ? {} : { trigger: true }; }
  async init() {
    await this.ex.loadMarkets();
    this.market = this.ex.market(this.symbol);
    if (!this.market.contract) throw new Error(this.symbol + ' no es un contrato perpetuo. El modo real necesita futuros perpetuos (permiten cortos y stops en el exchange).');
    this.settleCcy = this.market.settle || this.market.quote;
    try { await this.ex.setLeverage(Math.max(1, Math.ceil(this.maxExposure)), this.symbol); } catch (e) { /* no todos lo permiten; la exposición ya la limita el tamaño */ }
    const eq = await this.equity();
    return { ok: true, text: 'Conectado a ' + this.ex.name + ' · ' + this.symbol + ' · saldo ' + eq.toFixed(2) + ' ' + this.settleCcy };
  }
  async equity() {
    const b = await this.ex.fetchBalance();
    const tot = b.total && b.total[this.settleCcy];
    if (!isFinite(tot)) throw new Error('No se pudo leer el saldo en ' + this.settleCcy);
    return tot;
  }
  async lastPrice() { const t = await this.ex.fetchTicker(this.symbol); return t.last || t.close; }
  // el motor trabaja en unidades del activo (BTC); algunos exchanges cuentan contratos (OKX: 0,01 BTC)
  get cs() { return this.market.contractSize || 1; }
  contracts(q) { return parseFloat(this.ex.amountToPrecision(this.symbol, q / this.cs)); }
  async open(dir, qty) {
    const amt = this.contracts(qty), lim = this.market.limits || {};
    if (!(amt > 0) || (lim.amount && lim.amount.min && amt < lim.amount.min)) throw new Error('Tamaño ' + qty + ' por debajo del mínimo del exchange (' + (lim.amount && lim.amount.min) + ' contratos). Sube el capital o el riesgo.');
    const px = this.needsPrice ? await this.lastPrice() : undefined;
    const o = await this.ex.createOrder(this.symbol, 'market', dir > 0 ? 'buy' : 'sell', amt, px);
    let fill = o.average || o.price;
    if (!fill && o.id) { try { const f = await this.ex.fetchOrder(o.id, this.symbol); fill = f.average || f.price; } catch (e) {} }
    if (!fill) fill = await this.lastPrice();
    const base = amt * this.cs, fee = o.fee && isFinite(o.fee.cost) ? o.fee.cost : fill * base * this.comm;
    return { price: fill, qty: base, fee };
  }
  async placeStop(stop) {
    const p = this.acc.pos, px = this.ex.priceToPrecision(this.symbol, stop);
    const o = await this.ex.createOrder(this.symbol, 'market', p.dir > 0 ? 'sell' : 'buy', this.contracts(p.qty), this.needsPrice ? parseFloat(px) : undefined,
      { stopLossPrice: parseFloat(px), reduceOnly: true });
    (this.acc.ownStops = this.acc.ownStops || []).push(o.id);
    return o.id;
  }
  // coloca el stop inicial en el exchange (si falla, el Trader cierra la posición: nunca sin protección)
  async protect() { this.acc.stopOrderId = await this.placeStop(this.acc.pos.stop); return true; }
  async moveStop(stop) {
    const old = this.acc.stopOrderId;
    const id = await this.placeStop(stop);           // primero el nuevo...
    this.acc.stopOrderId = id;
    if (old) await this.cancel(old);                  // ...luego fuera el viejo
    return true;
  }
  async cancel(id) {
    try { await this.ex.cancelOrder(id, this.symbol, this.trig); this.forget(id); return true; }
    catch (e) {
      // si ya no está abierta (se ejecutó o se canceló) no pasa nada; si sigue viva, avisar
      try { const o = await this.ex.fetchOrder(id, this.symbol, this.trig); if (o && o.status !== 'open') { this.forget(id); return true; } } catch (e2) {}
      this.warnings.push('No se pudo cancelar la orden stop ' + id + ' (' + e.message + '). Revísala en el exchange.');
      return false;
    }
  }
  forget(id) { this.acc.ownStops = (this.acc.ownStops || []).filter(x => x !== id); }
  // al terminar una jugada: cancela cualquier stop propio que siguiera vivo (nunca toca órdenes que no creó el bot)
  async sweep() { for (const id of (this.acc.ownStops || []).slice()) await this.cancel(id); }
  async cancelStop() {
    const id = this.acc.stopOrderId; this.acc.stopOrderId = null;
    if (id) await this.cancel(id);
  }
  async marketClose() {
    const p = this.acc.pos;
    const px = this.needsPrice ? await this.lastPrice() : undefined;
    const o = await this.ex.createOrder(this.symbol, 'market', p.dir > 0 ? 'sell' : 'buy', this.contracts(p.qty), px, { reduceOnly: true });
    let fill = o.average || o.price || await this.lastPrice();
    const fee = o.fee && isFinite(o.fee.cost) ? o.fee.cost : fill * p.qty * this.comm;
    return { price: fill, fee };
  }
  async close() {
    await this.cancelStop();
    return this.marketClose();
  }
  async exchangeSize() {
    const ps = await this.ex.fetchPositions([this.symbol]);
    const x = (ps || []).find(q => q.symbol === this.symbol && Math.abs(q.contracts || 0) > 0);
    return x ? (x.side === 'short' ? -1 : 1) * Math.abs(x.contracts) * this.cs : 0;
  }
  // ¿sigue abierta la posición en el exchange? Si no, la cerró el stop.
  async poll() {
    const p = this.acc.pos; if (!p) return null;
    const size = await this.exchangeSize();
    if (size !== 0 && Math.sign(size) === p.dir) return null;
    let fill = p.stop, fee = p.stop * p.qty * this.comm;
    if (this.acc.stopOrderId) {
      try { const o = await this.ex.fetchOrder(this.acc.stopOrderId, this.symbol, this.trig); if (o.average) fill = o.average; if (o.fee && isFinite(o.fee.cost)) fee = o.fee.cost; } catch (e) {}
      this.forget(this.acc.stopOrderId);
    }
    this.acc.stopOrderId = null;
    return { price: fill, fee, external: size !== 0 };
  }
}
module.exports = { ExchangeBroker };
