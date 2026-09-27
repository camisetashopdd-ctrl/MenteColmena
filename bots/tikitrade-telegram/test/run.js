'use strict';
// Pruebas sin red: npm test
const assert = require('assert');
const fs = require('fs'), path = require('path');
const E = require('../src/engine');
const { club, live, replay, compare } = require('./replay');
const { createBot, CONFIRM } = require('../src/telegram');
const { pairings, score } = require('../src/league');

let fails = 0;
async function t(name, fn) {
  if (process.env.SOLO && !name.includes(process.env.SOLO)) return;   // SOLO=liga npm test → solo esas pruebas
  const t0 = Date.now();
  try { await fn(); console.log('✔ ' + name + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)'); }
  catch (e) { fails++; console.log('✘ ' + name + '\n   ' + (e && e.stack || e)); }
}

(async () => {
  await t('el motor del bot es idéntico al del probador', () => {
    const probador = path.join(__dirname, '../../../probadores/tikitrade/engine.js');
    if (fs.existsSync(probador)) assert.strictEqual(fs.readFileSync(path.join(__dirname, '../src/engine.js'), 'utf8'), fs.readFileSync(probador, 'utf8'));
  });

  for (const mode of ['demo', 'real']) {
    await t('en vivo (' + mode + ') repite las jugadas del backtest', async () => {
      const r = await replay({ mode, weeks: 22, stepMin: 20 });
      const c = compare(r);
      console.log('   ', JSON.stringify(c));
      assert(c.bt >= 15, 'pocas jugadas para comparar');
      assert(c.both >= c.bt * 0.9, 'coinciden menos del 90 % de las jugadas del backtest');
      assert(c.onlyLive <= 2, 'demasiadas jugadas que no hizo el backtest');
      assert(Math.abs(c.liveR - c.btR) <= Math.max(2, Math.abs(c.btR) * 0.2), 'el R total se aleja del backtest');
      if (mode === 'real') {
        const open = [...r.fx.orders.values()].filter(o => o.status === 'open');
        assert(r.acc.pos ? open.length === 1 : open.length === 0, 'órdenes stop huérfanas: ' + open.length);
        assert.strictEqual(Math.sign(r.fx.pos), r.acc.pos ? r.acc.pos.dir : 0, 'la posición del exchange no cuadra con la del bot');
        const disk = fs.readFileSync(path.join(r.store.dir, '1.json'), 'utf8');
        assert(!/"apiKey"|"secret":"s"/.test(disk) && /"creds":"/.test(disk), 'las claves no están cifradas en disco');
      }
    });
  }

  await t('real: si el exchange rechaza el stop, la posición se cierra y avisa', async () => {
    const c = club({ weeks: 16 });
    const { team } = c.app.register(1, 'Halcones FC'); team.setRunning(true);
    await team.connectReal('binanceusdm', { apiKey: 'k', secret: 's' }, false); await team.setMode('real');
    c.fx.failStop = true;
    await live(c, 2600);
    assert(team.acc.trades.length > 0, 'no llegó a abrir ninguna jugada');
    assert(team.acc.trades.every(x => x.reason === 'Sin stop: cerrada por seguridad'), 'alguna jugada siguió sin stop');
    assert.strictEqual(c.fx.pos, 0, 'quedó posición abierta en el exchange');
    assert(c.msgs.some(m => m.html.includes('No se pudo colocar el stop')), 'no avisó');
  });

  await t('real: contratos de 0,01 BTC (tipo OKX)', async () => {
    const c = club({ weeks: 16, contractSize: 0.01 });
    const { team } = c.app.register(1, 'Halcones FC'); team.setRunning(true);
    await team.connectReal('okx', { apiKey: 'k', secret: 's', password: 'p' }, false); await team.setMode('real');
    await live(c, 2700);
    const tr = team.acc.trades[0], first = c.fx.log.find(x => x[0] === 'market');
    assert(tr, 'sin jugadas');
    assert(Math.abs(first[2] * 0.01 - tr.qty) < 1e-9, 'contratos ' + first[2] + ' no equivalen a ' + tr.qty + ' BTC');
  });

  await t('freno de pérdida diaria: sin remates hasta el día siguiente', async () => {
    const c = club({ weeks: 16, cfg: { dailyLossPct: 0.3 } });
    const { team } = c.app.register(1, 'Halcones FC'); team.setRunning(true);
    await live(c, 2688);
    const mine = c.msgs.filter(m => m.id === 1).map(m => m.html);
    assert(mine.some(m => m.includes('Freno de pérdida diaria')), 'no saltó el freno');
    let halted = false;
    for (const m of mine) { if (m.includes('Freno de pérdida diaria')) halted = true; else if (m.includes('Nuevo día')) halted = false; else if (halted) assert(!m.includes('¡Remate!'), 'remató con el freno'); }
  });

  await t('liga: emparejamientos y marcador', () => {
    const seen = new Set();
    for (let r = 0; r < 5; r++) for (const [a, b] of pairings([1, 2, 3, 4, 5, 6], r)) seen.add([a, b].sort().join('-'));
    assert.strictEqual(seen.size, 15, 'con 6 equipos, 5 jornadas deben cubrir los 15 cruces');
    assert.deepStrictEqual(score(3.2, -1), [3, 0]); assert.deepStrictEqual(score(1.4, 1.2), [1, 1]); assert.deepStrictEqual(score(-3, -1), [0, 1]);
  });

  await t('liga: 6 entrenadores, 2 divisiones, temporada completa con ascensos y descensos', async () => {
    const c = club({ weeks: 17, seed: 3, kind: 'volatil', cfg: { divisionSize: 3, seasonWeeks: 2, promote: 1 } });
    const setups = [['Halcones FC', 'auto', 'both'], ['Abejas', 'contraataque', 'both'], ['Zánganos', 'catenaccio', 'both'], ['Reinas', 'directo', 'both'], ['Obreras', 'tikitaka', 'both'], ['Panal', 'auto', 'long']];
    setups.forEach(([n, tac, dir], i) => { const { team } = c.app.register(101 + i, n); team.setTactic(tac); team.setDirection(dir); team.setRunning(true); team.S.coachAlerts = false; });
    const L = c.app.league.L;
    assert.deepStrictEqual(L.divisions.map(d => d.teams.length), [3, 3]);
    const div1Before = L.divisions[0].teams.slice(), div2Before = L.divisions[1].teams.slice();
    // se juega hasta cerrar las dos jornadas de la temporada 1 (la semana del alta y la siguiente)
    const end = L.weekStart + 2 * 7 * 86400000 + 3600000;
    const endBar = Math.ceil((end - c.data.t[0]) / 3600000);
    assert(endBar < c.data.t.length, 'faltan datos para la temporada');
    await live(c, endBar, 30);
    const trades = [...c.app.teams.values()].map(t => t.allTrades().length);
    console.log('    jugadas por equipo:', trades.join(', '), '· historia:', L.history.map(h => 'T' + h.season + 'J' + h.jornada + ':' + h.matches.map(m => m.ga + '-' + m.gb).join(',')).join(' | '));
    assert(new Set(trades).size > 1, 'todas las tácticas hicieron lo mismo');
    assert.strictEqual(L.season, 2, 'no terminó la temporada 1');
    assert.strictEqual(L.history.filter(h => h.season === 1).length, 2);
    assert.strictEqual(L.champions.length, 1);
    assert.deepStrictEqual(L.divisions.map(d => d.teams.length), [3, 3], 'las divisiones cambiaron de tamaño');
    const up = L.divisions[0].teams.filter(id => div2Before.includes(id)), down = L.divisions[1].teams.filter(id => div1Before.includes(id));
    assert.strictEqual(up.length, 1, 'debía ascender 1'); assert.strictEqual(down.length, 1, 'debía descender 1');
    assert(c.msgs.some(m => m.id === up[0] && m.html.includes('¡Ascenso!')), 'no avisó del ascenso');
    assert(c.msgs.some(m => m.id === down[0] && m.html.includes('Descenso')), 'no avisó del descenso');
    assert(Object.values(L.table).every(r => r.pts === 0 && r.pj === 0), 'la tabla no se reinició');
    const matches = L.history.flatMap(h => h.matches);
    assert.strictEqual(matches.length, 2 * 2, '2 jornadas × 2 partidos (1 por división, 1 descansa)');
    // cada resultado cuadra con el R de la semana de cada equipo
    for (const m of matches) assert.deepStrictEqual([m.ga, m.gb], score(m.ra, m.rb));
  });

  await t('liga: fichar a mitad de jornada ocupa el descanso; la baja deja descansar al rival', async () => {
    const c = club({ weeks: 14 });
    c.app.register(1, 'Uno'); c.app.register(2, 'Dos'); c.app.register(3, 'Tres');
    await c.app.tick();                                         // primera jornada: 3 equipos, uno descansa
    const L = c.app.league.L, fx = () => L.fixtures[1];
    assert.strictEqual(fx().filter(p => p.includes(null)).length, 1);
    c.app.register(4, 'Cuatro');
    assert.strictEqual(fx().filter(p => p.includes(null)).length, 0, 'el nuevo no ocupó el descanso');
    assert(fx().some(p => p.includes(4)));
    c.app.unregister(4);
    assert(fx().some(p => p.includes(null)), 'el rival del que se fue no pasó a descansar');
    assert(!(4 in L.table));
  });

  await t('cambiar de táctica con una jugada demo abierta no la cierra por velas pasadas', async () => {
    const c = club({ weeks: 16 });
    const { team } = c.app.register(1, 'Halcones FC'); team.setRunning(true);
    const tf = 3600000, d = c.data;
    // busca un momento con jugada abierta en el que una vela pasada bajó más que el precio de ahora
    let bar = 2000, found = false;
    while (bar < d.t.length - 50 && !found) {
      bar += 1; await live(c, bar);
      const p = team.acc.pos; if (!p) continue;
      const last = Math.floor((c.fx.clock - d.t[0]) / tf) - 1, first = Math.floor((p.entryTime - d.t[0]) / tf);
      if (last - first < 3) continue;
      const past = p.dir > 0 ? Math.min(...d.l.slice(first, last)) : Math.max(...d.h.slice(first, last));
      const now = p.dir > 0 ? Math.min(d.l[last], await c.hub.price('BTC')) : Math.max(d.h[last], await c.hub.price('BTC'));
      if (p.dir > 0 ? past < now * 0.999 : past > now * 1.001) { p.stop = (past + now) / 2; found = true; }   // como si el trailing lo hubiera subido ahí
    }
    assert(found, 'no se dio el escenario');
    const n = team.acc.trades.length;
    team.setTactic('catenaccio');
    await c.app.tick();
    assert(team.acc.pos, 'la cerró por una vela pasada');
    assert.strictEqual(team.acc.trades.length, n);
  });

  await t('Telegram: varios entrenadores, fichaje, pizarra, liga, claves y administración', async () => {
    const c = club({ weeks: 14, cfg: { inviteCode: 'COLMENA' } });
    const out = [];
    const bot = createBot({ cfg: c.cfg, app: c.app, botConfig: { botInfo: { id: 1, is_bot: true, first_name: 'Halcones FC', username: 'colmena_fc_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } } });
    bot.api.config.use(async (prev, method, payload) => { out.push({ method, payload }); return { ok: true, result: method === 'sendMessage' ? { message_id: out.length, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: '' } : true }; });
    let uid = 1;
    const texts = () => out.filter(x => x.method === 'sendMessage' || x.method === 'editMessageText').map(x => x.payload.text).join('\n');
    const send = async (from, text) => {
      out.length = 0;
      const entities = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
      await bot.handleUpdate({ update_id: uid++, message: { message_id: uid, date: 0, chat: { id: from, type: 'private' }, from: { id: from, is_bot: false, first_name: 'x', username: 'u' + from }, text, entities } });
      return texts();
    };
    const tap = async (from, data) => {
      out.length = 0;
      await bot.handleUpdate({ update_id: uid++, callback_query: { id: 'q' + uid, from: { id: from, is_bot: false, first_name: 'x' }, chat_instance: 'c', data, message: { message_id: 1, date: 0, chat: { id: from, type: 'private' }, text: 'x' } } });
      return texts();
    };
    assert.match(await send(101, '/estado'), /Primero ficha tu equipo/);
    assert.match(await send(101, '/start'), /código de invitación/);
    assert.match(await send(101, 'OTRO'), /incorrecto/);
    assert.match(await send(101, 'COLMENA'), /¿Cómo se llama tu equipo/);
    assert.match(await send(101, 'Halcones FC'), /inscrito en la <b>Primera División<\/b>/);
    await send(102, '/start'); await send(102, 'COLMENA');
    assert.match(await send(102, 'halcones fc'), /Ya hay un equipo/);
    assert.match(await send(102, 'Las Abejas'), /inscrito/);
    assert.strictEqual(c.app.teams.size, 2);
    await live(c, 2100);
    const est = await send(101, '/estado');
    assert.match(est, /HALCONES FC\s+\d+ : \d+\s+MERCADO/); assert.match(est, /Primera División · \d\.º de 2/); assert.match(est, /DEMO/);
    assert.match(await send(101, '/equipo'), /pizarra de Halcones FC/);
    const b = await tap(102, 'set:tac:contraataque'); assert.match(b, /Contraataque/); assert.strictEqual(c.app.team(102).S.settings.tactic, 'contraataque');
    await tap(102, 'set:dir:long'); await tap(102, 'set:sym:ETH'); await tap(102, 'set:risk:1.5');
    assert.deepStrictEqual(c.app.team(102).S.settings, { symbol: 'ETH', tactic: 'contraataque', direction: 'long', riskPct: 1.5 });
    assert.match(await tap(101, 'marcha'), /En marcha/);
    assert.match(await send(101, '/entrenador'), /Partidos en la sombra[\s\S]*Juego directo/);
    await live(c, 2130);
    assert.match(await send(102, '/entrenador'), /Tu pizarra[\s\S]*Táctica fija/);
    const tab = await send(101, '/liga');
    assert.match(tab, /Primera División/); assert.match(tab, /►Halcones FC/); assert.match(tab, /Las Abejas/);
    assert.match(await send(101, '/jornada'), /Jornada \d+[\s\S]*👉 Halcones FC <b>\d+ – \d+<\/b> Las Abejas/);
    assert.match(await send(101, '/divisiones'), /Primera División<\/b>: 2 equipos/);
    // claves: el mensaje se borra y se guardan cifradas
    const r1 = await send(101, '/conectar binanceusdm MICLAVE MISECRETO testnet');
    assert(out.some(x => x.method === 'deleteMessage'), 'no borró el mensaje con las claves');
    assert.match(r1, /He borrado tu mensaje/); assert.match(r1, /Conectado/);
    const disk = fs.readFileSync(path.join(c.store.dir, '101.json'), 'utf8');
    assert(!disk.includes('MICLAVE') && !disk.includes('MISECRETO'), 'claves en claro en el disco');
    assert.strictEqual(c.app.team(101).S.real.sandbox, true);
    assert.match(await send(101, CONFIRM), /caducado/);
    assert.match(await send(101, '/real'), /CONFIRMO DINERO REAL/);
    const rr = await send(101, CONFIRM);
    if (c.app.team(101).S.accounts.demo.pos) assert.match(rr, /jugada abierta/); else { assert.match(rr, /activado/); assert.strictEqual(c.app.team(101).S.mode, 'real'); }
    // administración: solo el admin
    assert.strictEqual(await send(101, '/admin'), '');
    assert.match(await send(900, '/admin'), /Equipos: 2/);
    assert.match(await send(900, '/anuncio Hola a todos'), /enviado a 2/);
    assert(c.msgs.filter(m => m.html.includes('Hola a todos')).length === 2);
    // baja
    await tap(102, 'baja_si');
    assert.strictEqual(c.app.teams.size, 1); assert(!c.app.league.divisionOf(102));
  });

  await t('tesorería: tarifa por operación, sin fichas no remata, compra con Stars y premios de temporada', async () => {
    const fees = { enabled: true, perTrade: 1, demo: true, real: true, clubPct: 40, prizes: [50, 30, 20], welcome: 1, packs: [50, 200], starsPerFicha: 2 };
    const c = club({ weeks: 17, seed: 3, kind: 'volatil', cfg: { fees, divisionSize: 3, seasonWeeks: 2, promote: 1 } });
    const tz = c.app.treasury;
    const setups = [['Halcones FC', 'contraataque'], ['Abejas', 'directo'], ['Zánganos', 'auto'], ['Reinas', 'contraataque'], ['Obreras', 'directo'], ['Panal', 'auto']];
    setups.forEach(([n, tac], i) => { const { team } = c.app.register(101 + i, n); team.setTactic(tac); team.setRunning(true); team.S.coachAlerts = false; });
    for (let i = 0; i < 6; i++) assert.strictEqual(tz.balance(101 + i), 100, 'bienvenida');
    // la bienvenida es una sola vez: baja y vuelta no dan más fichas
    c.app.unregister(106); c.app.register(106, 'Panal'); assert.strictEqual(tz.balance(106), 100);
    const L = c.app.league.L, end = L.weekStart + 2 * 7 * 86400000 + 3600000;
    await live(c, Math.ceil((end - c.data.t[0]) / 3600000), 30);
    const all = [...c.app.teams.values()];
    const opened = all.map(t => t.allTrades().length + (t.acc.pos ? 1 : 0));
    console.log('    operaciones por equipo:', opened.join(', '), '· saldos:', all.map(t => tz.balance(t.id) / 100).join(', '), '· club', tz.s.club / 100);
    // cada operación aceptada costó 1 ficha, y nadie operó más de lo que tenía (1 de bienvenida + premios)
    assert(opened.some(n => n > 0), 'nadie operó');
    for (const t of all) assert(tz.balance(t.id) >= 0, 'saldo negativo');
    assert.strictEqual(tz.s.stats.fees, opened.reduce((a, b) => a + b, 0) * 100, 'tarifas cobradas ≠ operaciones aceptadas');
    assert.strictEqual(tz.s.club, opened.reduce((a, b) => a + b, 0) * 40, 'el club no recibió su 40 %');
    const broke = all.find(t => tz.balance(t.id) < 100 && c.msgs.some(m => m.id === t.id && m.html.includes('Sin fichas')));
    assert(broke, 'nadie se quedó sin fichas o no se avisó');
    // fin de temporada: premios repartidos por división
    assert.strictEqual(L.season, 2);
    const prizes = tz.s.history.filter(h => h.season === 1);
    assert.strictEqual(prizes.length, 2, 'un reparto por división');
    for (const h of prizes) { const paid = h.winners.reduce((a, w) => a + w.cents, 0); assert(paid <= h.pot && h.pot - paid < 3, 'reparto que no cuadra'); }
    assert(c.msgs.some(m => m.html.includes('Premio de la temporada 1')), 'no se avisó de los premios');
    assert(tz.audit().ok, 'la contabilidad no cuadra: ' + JSON.stringify(tz.audit()));

    // compra con Telegram Stars
    const out = [];
    const bot = createBot({ cfg: c.cfg, app: c.app, botConfig: { botInfo: { id: 1, is_bot: true, first_name: 'x', username: 'x', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } } });
    bot.api.config.use(async (prev, method, payload) => { out.push({ method, payload }); return { ok: true, result: method === 'sendMessage' || method === 'sendInvoice' ? { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } : true }; });
    let uid = 1;
    const up = async u => { out.length = 0; await bot.handleUpdate(Object.assign({ update_id: uid++ }, u)); return out; };
    const from = id => ({ id, is_bot: false, first_name: 'x' });
    const msg = (id, extra) => ({ message: Object.assign({ message_id: uid, date: 0, chat: { id, type: 'private' }, from: from(id) }, extra) });
    let r = await up(msg(101, { text: '/fichas', entities: [{ type: 'bot_command', offset: 0, length: 7 }] }));
    assert.match(r[0].payload.text, /Tus fichas/); assert.match(JSON.stringify(r[0].payload.reply_markup), /comprar:50/);
    r = await up({ callback_query: { id: 'q', from: from(101), chat_instance: 'c', data: 'comprar:50', message: { message_id: 1, date: 0, chat: { id: 101, type: 'private' } } } });
    const inv = r.find(x => x.method === 'sendInvoice');
    assert(inv, 'no envió la factura'); assert.strictEqual(inv.payload.currency, 'XTR'); assert.strictEqual(inv.payload.prices[0].amount, 100);
    const pcq = (amount, payload) => ({ pre_checkout_query: { id: 'p' + uid, from: from(101), currency: 'XTR', total_amount: amount, invoice_payload: payload } });
    r = await up(pcq(100, inv.payload.payload)); assert.strictEqual(r[0].method, 'answerPreCheckoutQuery'); assert.strictEqual(r[0].payload.ok, true);
    r = await up(pcq(1, inv.payload.payload)); assert.strictEqual(r[0].payload.ok, false, 'aceptó un precio manipulado');
    r = await up(pcq(100, 'fichas:102:50')); assert.strictEqual(r[0].payload.ok, false, 'aceptó el pago de otro usuario');
    const before = tz.balance(101);
    const paid = msg(101, { successful_payment: { currency: 'XTR', total_amount: 100, invoice_payload: inv.payload.payload, telegram_payment_charge_id: 'ch_1', provider_payment_charge_id: '' } });
    r = await up(paid); assert.match(r[0].payload.text, /\+50 fichas/);
    await up(Object.assign({}, paid));                                          // el mismo pago dos veces
    assert.strictEqual(tz.balance(101), before + 5000, 'el pago no sumó 50 fichas exactas');
    assert.strictEqual(tz.s.stats.starsIn, 100);
    r = await up(msg(900, { text: '/tesoreria', entities: [{ type: 'bot_command', offset: 0, length: 10 }] }));
    assert.match(r[0].payload.text, /Las cuentas cuadran/); assert.match(r[0].payload.text, /Stars cobradas: 100/);
    r = await up(msg(900, { text: '/reembolsar ch_1', entities: [{ type: 'bot_command', offset: 0, length: 11 }] }));
    assert(r.some(x => x.method === 'refundStarPayment' && x.payload.telegram_payment_charge_id === 'ch_1'), 'no pidió a Telegram devolver las Stars');
    assert.strictEqual(tz.balance(101), before);
    assert(tz.audit().ok);
    r = await up(msg(101, { text: '/bote', entities: [{ type: 'bot_command', offset: 0, length: 5 }] }));
    assert.match(r[0].payload.text, /Botes de la temporada 2/);
  });

  await t('ccxt: peticiones reales a Binance, Bybit e Hyperliquid', async () => {
    const { execFileSync } = require('child_process');
    const txt = execFileSync(process.execPath, [path.join(__dirname, 'ccxt-requests.js')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.match(txt, /algoOrder .*type=STOP_MARKET.*triggerPrice=60000&reduceOnly=true/, 'stop de Binance');
    assert.match(txt, /DELETE fapi\.binance\.com\/fapi\/v1\/algoOrder .*algoId=123/, 'cancelar stop de Binance');
    assert.match(txt, /"triggerDirection":2,"triggerPrice":"60000","reduceOnly":true/, 'stop de Bybit');
    assert.match(txt, /"tpsl":"sl"/, 'stop de Hyperliquid');
    assert.match(txt, /"maxFeeRate":"0%"/, 'Hyperliquid sin comisión extra');
    assert.doesNotMatch(txt, /setReferrer/, 'Hyperliquid no debe tocar el referido');
  });

  console.log(fails ? '\n' + fails + ' prueba(s) fallida(s)' : '\nTodas las pruebas pasan.');
  process.exit(fails ? 1 : 0);
})();
