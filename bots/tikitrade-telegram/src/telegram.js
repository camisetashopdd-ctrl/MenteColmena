'use strict';
// Capa de Telegram multiusuario: cada persona es un entrenador con su equipo (identificado por su id de
// Telegram). Fichaje, pizarra de ajustes, partido, liga y modo real con sus propias claves.
const { Bot, InlineKeyboard } = require('grammy');
const E = require('./engine');
const F = require('./format');
const { EXCHANGES } = require('./config');
const { divName } = require('./league');
const { nf, esc } = require('./util');
const { fichasTxt } = require('./treasury');

const CONFIRM = 'CONFIRMO DINERO REAL';

function menu(t) {
  const st = t.S;
  const kb = new InlineKeyboard()
    .text('📊 Estado', 'estado').text('🧑‍🏫 Entrenador', 'entrenador').text('📋 Jugadas', 'jugadas').row()
    .text('⚙️ Mi equipo', 'equipo').text('🏟 Liga', 'liga').text('🗓 Jornada', 'jornada').row()
    .text(st.running ? '⏸ Pausar' : '▶️ Poner en marcha', st.running ? 'pausa' : 'marcha').text('🆘 Cerrar jugada', 'cerrar').row()
    .text((st.mode === 'demo' ? '✅ ' : '') + '🎮 Demo', 'demo').text((st.mode === 'real' ? '✅ ' : '') + '💰 Real', 'real').text('🔌 Conexión', 'conexion');
  if (t.treasury && t.treasury.on) kb.row().text('🪙 Fichas', 'fichas');
  return kb;
}
function board(t, cfg) {
  const s = t.S.settings, kb = new InlineKeyboard();
  cfg.symbols.forEach((b, i) => { kb.text((s.symbol === b ? '✅ ' : '') + b, 'set:sym:' + b); if (i % 4 === 3) kb.row(); });
  kb.row().text((s.tactic === 'auto' ? '✅ ' : '') + '🧑‍🏫 Automático', 'set:tac:auto').row();
  Object.keys(E.TACTICS).forEach((k, i) => { kb.text((s.tactic === k ? '✅ ' : '') + E.TACTICS[k].name, 'set:tac:' + k); if (i % 2 === 1) kb.row(); });
  kb.row();
  for (const [k, v] of [['both', 'Ambos lados'], ['long', 'Solo largos'], ['short', 'Solo cortos']]) kb.text((s.direction === k ? '✅ ' : '') + v, 'set:dir:' + k);
  kb.row();
  for (const r of [0.5, 1, 1.5, 2]) kb.text((s.riskPct === r ? '✅ ' : '') + nf(r, 1) + ' %', 'set:risk:' + r);
  return kb;
}
const boardText = t => '⚙️ <b>La pizarra de ' + esc(t.S.name) + '</b>\n\n' + F.settingsLine(t.S.settings)
  + '\n\n• <b>Mercado</b>: dónde juega tu equipo.\n• <b>Táctica</b>: el Entrenador automático elige cada hora entre las cuatro (y se sienta en el banquillo si nada funciona) o fijas tú una.'
  + '\n• <b>Lado</b>: limita a largos o cortos.\n• <b>Riesgo</b>: % de la cartera por jugada. No cambia los puntos de liga (se cuentan en R), solo el dinero.';

function createBot({ cfg, app, botConfig }) {
  const bot = new Bot(cfg.token, botConfig);
  const html = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  const pending = new Map();       // fichajes y confirmaciones en curso: id → { step, until }

  bot.use(async (ctx, next) => {
    // chats privados (y la confirmación de pago de Telegram, que no trae chat)
    if (ctx.from && !ctx.from.is_bot && ((ctx.chat && ctx.chat.type === 'private') || ctx.preCheckoutQuery)) { ctx.team = app.team(ctx.from.id); await next(); }
  });
  const show = async (ctx, text, kb) => {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(text, Object.assign({}, html, kb ? { reply_markup: kb } : {}));
  };
  const guard = fn => async ctx => { try { await fn(ctx); } catch (e) { await show(ctx, '⚠️ ' + esc(e.message)); } };
  const needTeam = fn => guard(async ctx => { if (!ctx.team) return show(ctx, 'Primero ficha tu equipo: /start'); await fn(ctx, ctx.team); });
  const isAdmin = ctx => cfg.adminId && ctx.from.id === cfg.adminId;

  // ---------- fichaje ----------
  bot.command('start', guard(async ctx => {
    if (ctx.team) return show(ctx, '👋 ¡Hola de nuevo, míster de <b>' + esc(ctx.team.S.name) + '</b>!\n\n' + F.help(cfg), menu(ctx.team));
    pending.set(ctx.from.id, { step: cfg.inviteCode ? 'code' : 'name', until: Date.now() + 15 * 60000 });
    await show(ctx, '⚽ <b>Bienvenido a la liga de TikiTrade</b>\n\nAquí cada entrenador tiene su equipo: un bot de trading que juega cada hora contra el mercado, y cada semana contra otro entrenador de su división. Empiezas en <b>modo demo</b> con ' + nf(cfg.demoCapital, 0) + ' ficticios y precios reales.\n\n'
      + (cfg.inviteCode ? '🔑 Escribe el <b>código de invitación</b>:' : '✍️ ¿Cómo se llama tu equipo? (de 3 a 24 caracteres)'));
  }));
  async function onboarding(ctx, p) {
    const txt = ctx.message.text.trim();
    if (p.step === 'code') {
      if (txt !== cfg.inviteCode) return show(ctx, 'Código incorrecto. Pídeselo a quien te invitó.');
      pending.set(ctx.from.id, { step: 'name', until: Date.now() + 15 * 60000 });
      return show(ctx, '✍️ ¿Cómo se llama tu equipo? (de 3 a 24 caracteres)');
    }
    const { team, div } = app.register(ctx.from.id, txt, { username: ctx.from.username || null });
    pending.delete(ctx.from.id);
    await show(ctx, '🎉 <b>' + esc(team.S.name) + '</b> ya está inscrito en la <b>' + divName(div.level) + '</b> (' + div.teams.length + ' equipos).\n\n'
      + 'Tu equipo empieza en demo con ' + nf(cfg.demoCapital, 0) + ', en ' + team.base + ', con el Entrenador automático. Cámbialo en «Mi equipo» y pulsa <b>▶️ Poner en marcha</b>.\n'
      + 'Los partidos de liga se juegan de lunes a domingo (UTC): gana quien más R neto suma.', menu(team));
  }

  // ---------- el partido ----------
  const estado = needTeam(async (ctx, t) => show(ctx, F.scoreboard(await t.status(), app.league.position(t.id)), menu(t)));
  const entrenador = needTeam(async (ctx, t) => show(ctx, F.coach(await t.status())));
  const jugadas = needTeam(async (ctx, t) => show(ctx, F.plays(t.acc.trades, 12)));
  const equipo = needTeam(async (ctx, t) => show(ctx, boardText(t), board(t, cfg)));
  const marcha = needTeam(async (ctx, t) => { t.setRunning(true); await show(ctx, '▶️ <b>En marcha</b> (' + (t.S.mode === 'demo' ? 'demo' : 'dinero real') + '). Cada hora, al cerrar la vela, tu equipo decide. Te aviso de cada remate y de cada gol.', menu(t)); });
  const pausa = needTeam(async (ctx, t) => { t.setRunning(false); await show(ctx, '⏸ <b>En pausa</b>: no se abren jugadas nuevas. Si hay una abierta, sigue con su stop y su trailing. Para cerrarla ya: /cerrar.', menu(t)); });
  const demo = needTeam(async (ctx, t) => { await t.setMode('demo'); await show(ctx, '🎮 <b>Modo demo</b>: cartera ficticia con precios reales. Nada toca tu dinero.', menu(t)); });
  const real = needTeam(async (ctx, t) => {
    if (!cfg.allowReal) return show(ctx, 'Este servidor solo tiene el modo demo. La liga se juega igual (en R).');
    if (t.S.mode === 'real') return show(ctx, '💰 Ya estás en modo real.', menu(t));
    if (!t.S.real) return show(ctx, F.connection(cfg, await t.status()));
    await t.ensureReal();
    pending.set(ctx.from.id, { step: 'real', until: Date.now() + 120000 });
    await show(ctx, '💰 <b>Modo dinero real</b> en ' + esc(EXCHANGES[t.S.real.exchangeId].name) + (t.S.real.sandbox ? ' (testnet)' : '') + '\n\nTu equipo abrirá y cerrará posiciones <b>de verdad</b> con un riesgo del '
      + nf(Math.min(t.S.settings.riskPct, cfg.maxRiskReal), 1) + ' % por jugada (tope ' + cfg.maxRiskReal + ' %), frenos de pérdida diaria del ' + nf(cfg.dailyLossPct, 1) + ' % y de drawdown del ' + nf(cfg.maxDdPct, 1) + ' %.'
      + '\nPuedes perder dinero. Ningún bot garantiza beneficios.\n\nSi estás seguro, escribe exactamente:\n<code>' + CONFIRM + '</code>\n(tienes 2 minutos)');
  });
  const cerrar = needTeam(async (ctx, t) => {
    if (!t.acc.pos) return show(ctx, 'No hay ninguna jugada abierta.');
    await show(ctx, '¿Cerrar ya la jugada abierta a mercado?', new InlineKeyboard().text('Sí, cerrar', 'cerrar_si').text('No', 'nada'));
  });
  const conexion = needTeam(async (ctx, t) => show(ctx, F.connection(cfg, await t.status())));
  const liga = needTeam(async (ctx, t) => { const d = app.league.divisionOf(t.id); await show(ctx, F.table(app.league, d.level, t.id, cfg)); });
  const jornada = needTeam(async (ctx, t) => { const d = app.league.divisionOf(t.id); await show(ctx, F.jornada(app.league, d.level, t.id, app.hub.now())); });

  bot.command(['ayuda', 'help', 'menu'], guard(async ctx => show(ctx, F.help(cfg), ctx.team ? menu(ctx.team) : undefined)));
  bot.command('estado', estado); bot.command('entrenador', entrenador); bot.command('jugadas', jugadas); bot.command('equipo', equipo);
  bot.command(['marcha', 'iniciar'], marcha); bot.command('pausa', pausa); bot.command('demo', demo); bot.command('real', real);
  bot.command('cerrar', cerrar); bot.command('conexion', conexion); bot.command('liga', liga); bot.command('jornada', jornada);
  bot.command('divisiones', guard(async ctx => show(ctx, F.divisions(app.league))));
  bot.command('reanudar', needTeam(async (ctx, t) => { t.resume(); await show(ctx, '▶️ Freno quitado y equipo en marcha. El drawdown se vuelve a medir desde aquí.', menu(t)); }));
  bot.command('avisos', needTeam(async (ctx, t) => { t.S.coachAlerts = !t.S.coachAlerts; t.save(); await show(ctx, t.S.coachAlerts ? '🔔 Te avisaré cuando el Entrenador cambie de táctica o de lado.' : '🔕 Sin avisos del Entrenador (los remates, los goles y la liga se siguen avisando).'); }));
  bot.command('riesgo', needTeam(async (ctx, t) => {
    const x = parseFloat(String(ctx.match || '').replace(',', '.'));
    if (!isFinite(x)) return show(ctx, 'Riesgo actual: ' + nf(t.S.settings.riskPct, 1) + ' % por jugada. Para cambiarlo: <code>/riesgo 1</code>');
    const eff = t.setRisk(x);
    await show(ctx, 'Riesgo por jugada: <b>' + nf(x, 1) + ' %</b>' + (eff !== x ? ' (en modo real se aplica el tope: ' + nf(eff, 1) + ' %)' : '') + '.');
  }));
  bot.command('capital', needTeam(async (ctx, t) => {
    const x = parseFloat(String(ctx.match || '').replace(/\./g, '').replace(',', '.'));
    if (!(x >= 100 && x <= 1e9)) return show(ctx, 'Para reiniciar tu cartera demo: <code>/capital 10000</code>');
    await show(ctx, '¿Reiniciar tu cartera demo con ' + nf(x, 0) + '? Se borran sus jugadas (los puntos de liga ya ganados se mantienen).', new InlineKeyboard().text('Sí, reiniciar', 'capital_' + x).text('No', 'nada'));
  }));
  bot.command('baja', needTeam(async (ctx, t) => show(ctx, '¿Dar de baja a <b>' + esc(t.S.name) + '</b>? Se borran el equipo, su cartera demo y sus claves.', new InlineKeyboard().text('Sí, dar de baja', 'baja_si').text('No', 'nada'))));

  // ---------- modo real: conectar las claves (el mensaje se borra al instante) ----------
  bot.command('conectar', needTeam(async (ctx, t) => {
    await ctx.deleteMessage().catch(() => {});
    if (!cfg.allowReal) return show(ctx, 'Este servidor solo tiene el modo demo.');
    const a = String(ctx.match || '').trim().split(/\s+/).filter(Boolean);
    const exId = (a.shift() || '').toLowerCase(), ex = EXCHANGES[exId];
    if (!ex) return show(ctx, '🗑 He borrado tu mensaje.\n\n' + F.connection(cfg, await t.status()));
    let sandbox = false; if (a.length && a[a.length - 1].toLowerCase() === 'testnet') { sandbox = true; a.pop(); }
    if (a.length !== ex.creds.length) return show(ctx, '🗑 He borrado tu mensaje. Faltan datos. Formato:\n<code>' + ex.help + '</code>');
    const creds = {}; ex.creds.forEach((k, i) => { creds[k] = a[i]; });
    await show(ctx, '🗑 He borrado tu mensaje. Probando la conexión con ' + ex.name + '…');
    const txt = await t.connectReal(exId, creds, sandbox);
    await show(ctx, '✅ ' + esc(txt) + '\nClaves guardadas cifradas. Cuando quieras: /real', menu(t));
  }));
  bot.command('desconectar', needTeam(async (ctx, t) => { t.disconnectReal(); await show(ctx, '🔌 Claves borradas del servidor. Recuerda borrarlas también en el exchange si no vas a usarlas.'); }));

  // ---------- fichas: la tarifa de MenteColmena, pagada con Telegram Stars ----------
  const tz = app.treasury, fcfg = cfg.fees;
  const fichas = needTeam(async (ctx, t) => {
    if (!tz.on) return show(ctx, 'En esta liga no hay tarifa por operación: juega gratis.');
    const d = app.league.divisionOf(t.id), kb = new InlineKeyboard();
    fcfg.packs.forEach(n => kb.text(n + ' fichas · ' + n * fcfg.starsPerFicha + ' ⭐', 'comprar:' + n));
    await show(ctx, F.wallet(cfg, tz, t.id, d && d.level), kb);
  });
  const bote = needTeam(async (ctx, t) => {
    if (!tz.on) return show(ctx, 'En esta liga no hay botes: juega gratis.');
    const d = app.league.divisionOf(t.id); await show(ctx, F.pots(cfg, tz, app.league, d && d.level));
  });
  bot.command('fichas', fichas); bot.callbackQuery('fichas', fichas); bot.command('bote', bote);
  bot.callbackQuery(/^comprar:(\d+)$/, needTeam(async (ctx, t) => {
    const n = parseInt(ctx.match[1], 10);
    if (!tz.on || !fcfg.packs.includes(n)) return show(ctx, 'Ese paquete no existe.');
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.replyWithInvoice(n + ' fichas de TikiTrade', 'Fichas para pagar la tarifa por operación de tu equipo en la liga de MenteColmena. No son dinero ni se pueden cambiar por dinero.',
      'fichas:' + t.id + ':' + n, 'XTR', [{ label: n + ' fichas', amount: n * fcfg.starsPerFicha }]);
  }));
  // Telegram pregunta antes de cobrar: se comprueba que el paquete y el precio son los nuestros
  bot.on('pre_checkout_query', async ctx => {
    const q = ctx.preCheckoutQuery, m = /^fichas:(\d+):(\d+)$/.exec(q.invoice_payload || '');
    const ok = !!(tz.on && m && Number(m[1]) === q.from.id && app.team(q.from.id) && fcfg.packs.includes(Number(m[2])) && q.currency === 'XTR' && q.total_amount === Number(m[2]) * fcfg.starsPerFicha);
    await ctx.answerPreCheckoutQuery(ok, ok ? undefined : { error_message: 'Este pago ya no es válido. Vuelve a pedirlo con /fichas.' });
  });
  bot.on('message:successful_payment', guard(async ctx => {
    const sp = ctx.message.successful_payment, m = /^fichas:(\d+):(\d+)$/.exec(sp.invoice_payload || '');
    if (!m) return;
    const n = Number(m[2]), fresh = tz.purchase(ctx.from.id, sp.telegram_payment_charge_id, sp.total_amount, n);
    if (fresh) await show(ctx, '⭐ ¡Gracias! <b>+' + n + ' fichas</b>. Ahora tienes ' + fichasTxt(tz.balance(ctx.from.id)) + '.', ctx.team ? menu(ctx.team) : undefined);
  }));

  // ---------- administración ----------
  bot.command('admin', guard(async ctx => {
    if (!isAdmin(ctx)) return;
    const all = [...app.teams.values()];
    await show(ctx, '🛠 <b>Administración</b>\nEquipos: ' + all.length + ' · en marcha: ' + all.filter(t => t.S.running).length + ' · en real: ' + all.filter(t => t.S.mode === 'real').length
      + ' · con jugada abierta: ' + all.filter(t => t.acc.pos).length + '\nMercados: ' + [...new Set(all.map(t => t.base))].join(', ') + '\n\n' + F.divisions(app.league));
  }));
  bot.command('tesoreria', guard(async ctx => { if (!isAdmin(ctx)) return; await show(ctx, F.treasuryAdmin(tz)); }));
  bot.command('regalar', guard(async ctx => {
    if (!isAdmin(ctx)) return;
    const [id, n] = String(ctx.match || '').trim().split(/\s+/).map(Number);
    if (!app.team(id) || !(n > 0)) return show(ctx, 'Uso: <code>/regalar ID_DE_TELEGRAM FICHAS</code>');
    tz.gift(id, n, 'regalo del administrador'); await app.notify(id, '🎁 El club te regala <b>' + n + ' fichas</b>.');
    await show(ctx, 'Hecho: +' + n + ' fichas a ' + esc(app.team(id).S.name) + '.');
  }));
  bot.command('reembolsar', guard(async ctx => {
    if (!isAdmin(ctx)) return;
    const charge = String(ctx.match || '').trim(), p = tz.s.payments[charge];
    if (!p) return show(ctx, 'Uso: <code>/reembolsar ID_DEL_PAGO</code> (está en datos/movimientos.jsonl).');
    await ctx.api.refundStarPayment(p.id, charge);          // primero Telegram devuelve las Stars...
    tz.refundPurchase(charge);                              // ...y después se retiran las fichas
    await show(ctx, 'Devueltas ' + p.stars + ' ⭐ y retiradas ' + p.fichas + ' fichas.');
  }));
  bot.command('anuncio', guard(async ctx => {
    if (!isAdmin(ctx)) return;
    const txt = String(ctx.match || '').trim(); if (!txt) return show(ctx, 'Uso: <code>/anuncio texto</code>');
    for (const t of app.teams.values()) await app.notify(t.id, '📣 ' + esc(txt));
    await show(ctx, 'Anuncio enviado a ' + app.teams.size + ' entrenadores.');
  }));

  // ---------- botones ----------
  for (const [k, fn] of Object.entries({ estado, entrenador, jugadas, equipo, marcha, pausa, demo, real, cerrar, conexion, liga, jornada })) bot.callbackQuery(k, fn);
  bot.callbackQuery('nada', async ctx => { await ctx.answerCallbackQuery('Vale'); });
  bot.callbackQuery('cerrar_si', needTeam(async (ctx, t) => { const ok = await t.closeNow(); await show(ctx, ok ? 'Jugada cerrada.' : 'Ya no había jugada abierta.'); }));
  bot.callbackQuery('baja_si', needTeam(async (ctx, t) => { app.unregister(t.id); await show(ctx, '👋 Equipo dado de baja. Si vuelves, /start.'); }));
  bot.callbackQuery(/^capital_(\d+(\.\d+)?)$/, needTeam(async (ctx, t) => { const x = parseFloat(ctx.match[1]); t.resetDemo(x); await show(ctx, '🎮 Cartera demo reiniciada con ' + nf(x, 0) + '.'); }));
  bot.callbackQuery(/^set:(sym|tac|dir|risk):(.+)$/, needTeam(async (ctx, t) => {
    const [, what, v] = ctx.match;
    if (what === 'sym') t.setSymbol(v); else if (what === 'tac') t.setTactic(v); else if (what === 'dir') t.setDirection(v); else t.setRisk(parseFloat(v));
    await ctx.answerCallbackQuery('Hecho').catch(() => {});
    await ctx.editMessageText(boardText(t), Object.assign({}, html, { reply_markup: board(t, cfg) })).catch(() => ctx.reply(boardText(t), Object.assign({}, html, { reply_markup: board(t, cfg) })));
  }));

  // ---------- textos libres: fichaje y confirmación del modo real ----------
  bot.on('message:text', guard(async ctx => {
    const p = pending.get(ctx.from.id);
    if (p && Date.now() > p.until) pending.delete(ctx.from.id);
    const txt = ctx.message.text.trim();
    if (p && Date.now() <= p.until && (p.step === 'code' || p.step === 'name') && !ctx.team) return onboarding(ctx, p);
    if (txt === CONFIRM) {
      if (!ctx.team) return show(ctx, 'Primero ficha tu equipo: /start');
      if (!p || p.step !== 'real' || Date.now() > p.until) return show(ctx, 'La confirmación ha caducado. Vuelve a pedir /real.');
      pending.delete(ctx.from.id);
      await ctx.team.setMode('real');
      return show(ctx, '💰 <b>Modo dinero real activado.</b> ' + (ctx.team.S.running ? 'Tu equipo ya está en marcha.' : 'Pulsa «Poner en marcha» cuando quieras empezar.'), menu(ctx.team));
    }
    await show(ctx, ctx.team ? 'No te he entendido. Prueba /ayuda.' : 'Para empezar, ficha tu equipo: /start');
  }));

  bot.catch(err => console.error('Error de Telegram:', err.error && err.error.message || err.message));
  return bot;
}

const COMMANDS = [
  ['estado', 'Tu marcador, cartera y posición'], ['equipo', 'Mercado, táctica, lado y riesgo'], ['entrenador', 'Qué ve tu equipo'], ['jugadas', 'Últimas jugadas'],
  ['liga', 'Clasificación de tu división'], ['jornada', 'Partidos de esta semana'], ['divisiones', 'Todas las divisiones'],
  ['marcha', 'Buscar jugadas'], ['pausa', 'No abrir jugadas nuevas'], ['demo', 'Modo demo'], ['real', 'Modo dinero real'], ['conectar', 'Conectar exchange o wallet'],
  ['cerrar', 'Cerrar la jugada abierta'], ['riesgo', 'Riesgo por jugada en %'], ['capital', 'Reiniciar la cartera demo'], ['reanudar', 'Quitar el freno de drawdown'],
  ['fichas', 'Tus fichas y recargas'], ['bote', 'Botes y premios de la temporada'],
  ['avisos', 'Avisos del Entrenador'], ['baja', 'Dar de baja tu equipo'], ['ayuda', 'Ayuda']
].map(([command, description]) => ({ command, description }));

module.exports = { createBot, COMMANDS, CONFIRM };
