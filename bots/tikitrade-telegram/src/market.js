'use strict';
// Datos de mercado públicos (no hacen falta claves): velas cerradas y último precio de un símbolo.
class Market {
  constructor(exchange, symbol, timeframe) {
    this.ex = exchange; this.symbol = symbol; this.timeframe = timeframe;
    this.tf = exchange.parseTimeframe(timeframe) * 1000;
    this.now = () => Date.now();
  }
  lastClosedOpen() { return Math.floor(this.now() / this.tf) * this.tf - this.tf; }
  async candles(n) {
    const end = this.lastClosedOpen();
    let since = end - (n - 1) * this.tf;
    const rows = new Map();
    for (let guard = 0; guard < 40 && since <= end; guard++) {
      const batch = await this.ex.fetchOHLCV(this.symbol, this.timeframe, since, 1000);
      if (!batch || !batch.length) break;
      for (const r of batch) if (r[0] <= end) rows.set(r[0], r);
      const last = batch[batch.length - 1][0];
      if (last <= since) break;
      since = last + this.tf;
    }
    const sorted = [...rows.values()].sort((a, b) => a[0] - b[0]).slice(-n);
    const d = { t: [], o: [], h: [], l: [], c: [], v: [] };
    for (const r of sorted) { d.t.push(r[0]); d.o.push(+r[1]); d.h.push(+r[2]); d.l.push(+r[3]); d.c.push(+r[4]); d.v.push(+r[5] || 0); }
    return d;
  }
  async price() {
    const t = await this.ex.fetchTicker(this.symbol);
    const p = t.last || t.close || (t.bid && t.ask ? (t.bid + t.ask) / 2 : NaN);
    if (!isFinite(p)) throw new Error('El exchange no devolvió precio para ' + this.symbol);
    return p;
  }
}
module.exports = { Market };
