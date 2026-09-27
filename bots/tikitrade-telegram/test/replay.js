'use strict';
// Vive un mercado sintético hora a hora con el club (uno o varios entrenadores, demo o real contra
// el exchange simulado) y compara las jugadas con el backtest del motor sobre los mismos datos.
const path = require('path'), os = require('os'), fs = require('fs');
const E = require('../src/engine');
const { FakeExchange } = require('./fake-exchange');
const { Store } = require('../src/store');
const { Hub } = require('../src/hub');
const { App } = require('../src/app');

function club(opts) {
  opts = opts || {};
  const data = E.makeSample(opts.seed || 3, opts.weeks || 22, opts.kind || 'volatil');
  const fx = new FakeExchange(data, { contractSize: opts.contractSize || 1, cash: 10000 });
  const cfg = Object.assign({ token: '1:x', adminId: 900, inviteCode: '', maxTeams: 100, dataExchangeId: 'binanceusdm', symbols: ['BTC', 'ETH'], timeframe: '1h',
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cfc-')), demoCapital: 10000, riskPct: 1, maxRiskReal: 2, dailyLossPct: 100, maxDdPct: 100,
    allowReal: true, masterKey: 'clave-maestra-de-prueba', divisionSize: 10, seasonWeeks: 4, promote: 2, bars: 2000, tickMs: 20000,
    fees: { enabled: false, perTrade: 1, demo: true, real: true, clubPct: 50, prizes: [50, 30, 20], welcome: 10, packs: [50, 200], starsPerFicha: 1 } }, opts.cfg || {});
  fx.clock = data.t[opts.startBar || 2000] + 30000;
  const store = new Store(cfg);
  const hub = new Hub(fx, cfg); hub.now = () => fx.clock;
  const msgs = [];
  const app = new App({ cfg, store, hub, notify: async (id, html) => { msgs.push({ id, html }); }, makeExchange: () => fx, log: () => {} });
  return { data, fx, cfg, store, hub, app, msgs, startBar: opts.startBar || 2000 };
}
async function live(c, toBar, stepMin) {
  const end = c.data.t[Math.min(toBar || c.data.t.length - 1, c.data.t.length - 1)];
  while (c.fx.clock < end) { await c.app.tick(); c.fx.advance((stepMin || 20) * 60000); }
}
async function replay(opts) {
  opts = opts || {};
  const c = club(opts);
  const { team } = c.app.register(1, 'Halcones FC');
  team.S.coachAlerts = false; team.setRunning(true);
  if (opts.mode === 'real') { await team.connectReal('binanceusdm', { apiKey: 'k', secret: 's' }, false); await team.setMode('real'); }
  await live(c, null, opts.stepMin);
  c.team = team; c.acc = team.acc;
  c.bt = E.run(c.data, Object.assign({}, E.DEFAULTS, { coach: E.COACH_DEFAULTS }));
  return c;
}
function compare(r) {
  const tf = 3600000, t0 = r.data.t[r.startBar];
  const live = r.acc.trades.map(x => ({ bar: Math.floor((x.entryTime - r.data.t[0]) / tf) - 1, dir: x.dir, r: x.r }));
  const bt = r.bt.trades.filter(x => x.exitIdx !== null && r.data.t[x.signalIdx] >= t0).map(x => ({ bar: x.signalIdx, dir: x.dir, r: x.r }));
  const key = x => x.bar + ':' + x.dir, bset = new Set(bt.map(key)), lset = new Set(live.map(key)), sum = a => a.reduce((s, x) => s + x.r, 0);
  return { live: live.length, bt: bt.length, both: live.filter(x => bset.has(key(x))).length, onlyLive: live.filter(x => !bset.has(key(x))).length, onlyBt: bt.filter(x => !lset.has(key(x))).length, liveR: +sum(live).toFixed(2), btR: +sum(bt).toFixed(2) };
}
module.exports = { club, live, replay, compare };
