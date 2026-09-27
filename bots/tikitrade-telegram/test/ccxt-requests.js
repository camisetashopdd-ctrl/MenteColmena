const ccxt = require('ccxt');
(async () => {
  const mk = (id, sym, base, quote, extra) => Object.assign({ id, symbol: sym, base, quote, settle: quote, baseId: base, quoteId: quote, settleId: quote, type: 'swap', spot: false, margin: false, swap: true, future: false, option: false, active: true, contract: true, linear: true, inverse: false, contractSize: 1,
    precision: { amount: 0.001, price: 0.1 }, limits: { amount: { min: 0.001 }, price: {}, cost: {}, leverage: {} }, info: {} }, extra || {});
  // Binance USDM
  const b = new ccxt.binanceusdm({ apiKey: 'k', secret: 's' });
  b.setMarkets([mk('BTCUSDT', 'BTC/USDT:USDT', 'BTC', 'USDT', { info: { orderTypes: ['LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET'] } })]);
  const reqs = [];
  b.fetch = async (url, method, headers, body) => { reqs.push(method + ' ' + url.split('?')[0].replace('https://', '') + ' ' + (url.split('?')[1] || body || '').replace(/&timestamp.*$/, '').replace(/&signature.*/, '')); return { orderId: 1, symbol: 'BTCUSDT', status: 'NEW', type: 'STOP_MARKET', side: 'SELL', avgPrice: '0', origQty: '0.01', executedQty: '0', updateTime: 1 }; };
  await b.createOrder('BTC/USDT:USDT', 'market', 'sell', 0.01, undefined, { stopLossPrice: 60000, reduceOnly: true });
  await b.createOrder('BTC/USDT:USDT', 'market', 'buy', 0.01, undefined, {});
  await b.createOrder('BTC/USDT:USDT', 'market', 'buy', 0.01, undefined, { reduceOnly: true });
  await b.cancelOrder('123', 'BTC/USDT:USDT', { trigger: true });
  try { await b.fetchOrder('123', 'BTC/USDT:USDT', { trigger: true }); } catch (e) {}
  console.log('BINANCE\n' + reqs.join('\n'));
  // Bybit
  const y = new ccxt.bybit({ apiKey: 'k', secret: 's' }); y.options.enableUnifiedAccount = true; y.options.enableUnifiedMargin = true;
  y.setMarkets([mk('BTCUSDT', 'BTC/USDT:USDT', 'BTC', 'USDT')]);
  const r2 = []; y.fetch = async (url, method, h, body) => { r2.push(method + ' ' + url.split('?')[0].replace('https://', '') + ' ' + (body || '')); return { retCode: 0, result: { orderId: 'x' }, time: 1 }; };
  try { await y.createOrder('BTC/USDT:USDT', 'market', 'sell', 0.01, 61000, { stopLossPrice: 60000, reduceOnly: true }); } catch (e) { console.log('bybit err', e.message); }
  console.log('BYBIT\n' + r2.join('\n'));
  // Hyperliquid
  const hl = new ccxt.hyperliquid({ walletAddress: '0x' + '1'.repeat(40), privateKey: '0x' + '2'.repeat(64), options: { builderFee: false, refSet: true } });
  hl.setMarkets([mk('0', 'BTC/USDC:USDC', 'BTC', 'USDC', { baseId: 0, settle: 'USDC', precision: { amount: 0.00001, price: 1 }, info: { szDecimals: 5 } })]);
  const r3 = []; hl.fetch = async (url, method, h, body) => { r3.push(method + ' ' + url + ' ' + body.slice(0, 400)); return { status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 7 } }] } } }; };
  try { await hl.createOrder('BTC/USDC:USDC', 'market', 'sell', 0.01, 60000, { stopLossPrice: 60000, reduceOnly: true }); } catch (e) { console.log('hl err', e.message); }
  try { await hl.createOrder('BTC/USDC:USDC', 'market', 'buy', 0.01, 65000, {}); } catch (e) { console.log('hl err2', e.message); }
  try { await hl.cancelOrder('7', 'BTC/USDC:USDC', {}); } catch (e) { console.log('hl err3', e.message); }
  console.log('HYPERLIQUID\n' + r3.join('\n'));
})();
