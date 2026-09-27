/*
 * Motor: port a JavaScript de "DCA Liquidation Calculation [ChartPrime]" (Pine Script v5, indicator).
 *
 * El indicador no mira el gráfico: toma el cierre diario de ayer del símbolo elegido como precio de la
 * orden base (BO) y calcula una escalera DCA (safety orders, SO) con su precio medio, un «PNL» y un precio
 * de liquidación por fila, y dos tablas. Aquí se reproducen esos valores tal cual y, al lado, los
 * valores corregidos (PnL de toda la posición, liquidación correcta también en corto, y si cada SO
 * llega a ejecutarse antes de la liquidación o por falta de margen).
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    wallet: 1000, symbol: 'BTCUSDT', isLong: true,
    baseOrder: 200, safetyOrder: 300, leverage: 10, safetyOrders: 10,
    priceDeviation: 2.2, volumeScale: 1.5, stepScale: 1.0,
    mmPct: 0.5   // fija en el script: (0.5 / 100)
  };
  const DEC = 3;
  // Pine math.round(x, d): half away from zero
  const pr = (x, d) => { const f = Math.pow(10, d || 0); return Math.sign(x) * Math.round(Math.abs(x) * f) / f; };

  function run(input, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const bo = input.boPrice, W = P.wallet, lev = Math.max(1, Math.round(P.leverage)), dir = P.isLong ? 1 : -1;
    const N = Math.max(0, Math.floor(P.safetyOrders));
    const mm = P.mmPct / 100;
    const stepped = i => { let sd = 0; for (let k = 1; k <= i; k++) sd += P.priceDeviation * Math.pow(P.stepScale, k - 1); return sd; };
    const soPrice = i => bo * (1 - dir * stepped(i) / 100);
    const soUsd = i => P.safetyOrder * Math.pow(P.volumeScale, i - 1);
    // Script: liq_balance() uses the long formula for both directions
    const liqScript = (size, entry) => pr(pr((W + 0 - size * entry) / (Math.abs(size) * (0.5 / 100 - 1)), 2), DEC);
    // Cross margin, whole wallet as collateral, maintenance margin mm
    const liqReal = (size, entry) => {
      const p = P.isLong ? (size * entry - W) / (size * (1 - mm)) : (W + size * entry) / (size * (1 + mm));
      return p > 0 ? p : NaN;
    };

    const boSize = P.baseOrder / bo;
    let tSize = boSize, tVol = bo * boSize;
    const rows = [{
      k: 0, label: 'BO', dev: 0, price: bo, qty: boSize, usd: bo * boSize, tSize, tVol, avg: pr(tVol / tSize, DEC), avgExact: tVol / tSize,
      rowOk: tVol < W, liqReal: liqReal(tSize, tVol / tSize), marginUsed: tVol / lev
    }];
    rows[0].reachable = true; rows[0].equityBefore = W; rows[0].marginOk = rows[0].marginUsed <= W;

    for (let i = 1; i <= N; i++) {
      const price = soPrice(i), usd = soUsd(i), qty = usd / price;
      const prevSize = tSize, prevAvg = tVol / tSize, prevLiq = rows[i - 1].liqReal;
      tSize += qty; tVol += qty * price;
      const avg = pr(tVol / tSize, DEC);
      const pnlScript = P.isLong ? qty * price - qty * avg : qty * avg - qty * price;
      const liqS = liqScript(tSize, avg);
      const capOk = tVol < W * lev;
      const liqColor2 = Math.abs(pnlScript) + tVol / lev > W;
      const liqcon = liqS > 0 && capOk && liqColor2, _liqcon = liqS > 0 && capOk && !liqColor2;
      const liqCls = liqcon ? 'yellow' : liqS < 0 && capOk ? 'green' : _liqcon ? 'magenta' : 'red';
      // Corrected view
      const equityBefore = W + dir * (price - prevAvg) * prevSize;          // equity when price reaches this SO
      const liquidatedBefore = isFinite(prevLiq) && (P.isLong ? prevLiq >= price : prevLiq <= price);
      const marginUsed = tVol / lev;
      const marginOk = marginUsed <= equityBefore;
      const pnlReal = dir * (price - tVol / tSize) * tSize;                  // whole position right after the fill
      rows.push({
        k: i, label: String(i), dev: pr(stepped(i), DEC), price, qty, usd, tSize, tVol, avg, avgExact: tVol / tSize,
        pnlScript, liqScript: liqS, liqCls, rowOk: capOk, liqReal: liqReal(tSize, tVol / tSize),
        equityBefore, liquidatedBefore, marginUsed, marginOk, pnlReal,
        reachable: !liquidatedBefore && rows[i - 1].reachable, fillable: false
      });
    }
    // An SO fills only if every earlier one filled, it is reached before liquidation and there is margin for it
    let chain = true;
    for (const r of rows) { chain = chain && r.reachable && r.marginOk; r.fillable = chain; }
    const lastFill = rows.filter(r => r.fillable).pop();
    const last = rows[rows.length - 1];
    const stats = {
      requiredCapital: pr(tVol / lev, DEC), requiredOk: !(W < pr(tVol / lev, DEC)),
      maxDealValue: pr(tVol, DEC), maxDealOk: !(W * lev < pr(tVol, DEC)), leverage: lev,
      coverage: pr(stepped(N), DEC),
      trades: lastFill ? lastFill.k : 0,              // safety orders that can really fill
      lastFillable: lastFill ? lastFill.k : -1,
      liqAfterLast: lastFill ? lastFill.liqReal : NaN,
      liqDistPct: lastFill && isFinite(lastFill.liqReal) ? (lastFill.liqReal - bo) / bo * 100 : NaN,
      scriptGreenRows: rows.slice(1).filter(r => r.rowOk).length,
      scriptSafeLiqRows: rows.slice(1).filter(r => r.liqCls === 'green').length,
      firstBlocked: rows.find(r => !r.fillable) || null,
      totalSize: last.tSize, totalVol: last.tVol
    };
    return { params: P, bo, rows, stats, base: P.symbol.replace(/^.*:/, '').replace('USDT', '') };
  }

  // Sample input: previous daily close of the symbol (the script uses request.security(symbol, "D", close[1]))
  function makeSample() { return { boPrice: 65000 }; }

  const api = { DEFAULTS, run, makeSample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineDLC = api;
})(typeof window !== 'undefined' ? window : this);
