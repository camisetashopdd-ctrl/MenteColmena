'use strict';
// Textos de Telegram (HTML), en castellano y con el lenguaje del probador.
const E = require('./engine');
const { nf, sgn, esc, REG, SIDE, fdate, fday, goals } = require('./util');
const { divName } = require('./league');
const { TACTIC_NAME } = require('./team');
const { EXCHANGES } = require('./config');
const { fmt, fichasTxt } = require('./treasury');

const BARS = '▁▂▃▄▅▆▇█';
function spark(values, n) {
  const v = values.slice(-n); if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), step = Math.max(1, Math.floor(v.length / 24));
  if (hi - lo < hi * 1e-4) return '';
  let s = '';
  for (let i = 0; i < v.length; i += step) s += BARS[Math.round((v[i] - lo) / (hi - lo) * 7)];
  return s;
}
const DIRS = { both: 'ambos lados', long: 'solo largos', short: 'solo cortos' };
const settingsLine = s => '⚙️ ' + s.symbol + ' · ' + TACTIC_NAME(s.tactic) + ' · ' + DIRS[s.direction] + ' · riesgo ' + nf(s.riskPct, 1) + ' %';

function scoreboard(st, pos) {
  const g = goals(st.trades), eqPct = st.initial ? (st.equity / st.initial - 1) * 100 : NaN;
  const res = g.f > g.a ? '🟢 ganando' : g.f < g.a ? '🔴 perdiendo' : '⚪ empate';
  const dd = st.peak && isFinite(st.equity) ? (1 - st.equity / st.peak) * 100 : 0;
  const L = [
    '⚽ <b>' + esc(st.name.toUpperCase()) + '  ' + g.f + ' : ' + g.a + '  MERCADO</b>  ' + res,
    '<i>cada gol = 1 R ganado (≈ ' + nf(st.settings.riskPct, 1) + ' % de la cuenta)</i>',
    pos ? '🏟 ' + divName(pos.level) + ' · ' + pos.pos + '.º de ' + pos.of + ' · /liga' : '',
    '',
    (st.mode === 'demo' ? '🎮 <b>DEMO</b> (cartera ficticia, precios reales)' : '💰 <b>DINERO REAL</b> · ' + esc(st.real ? st.real.exchange : '') + (st.real && st.real.sandbox ? ' · testnet' : '')),
    settingsLine(st.settings),
    st.halted ? '🛑 Frenado: ' + (st.halted.kind === 'diaria' ? 'pérdida diaria máxima (se levanta mañana, UTC)' : 'drawdown máximo (usa /reanudar)')
      : st.running ? (st.resting ? '😮‍💨 Descansando tras dos encajados (hasta ' + fdate(st.resting + st.tf) + ' UTC)' : '▶️ En marcha: busca jugadas cada hora') : '⏸ En pausa: no abre jugadas nuevas (usa /marcha)',
    '💼 Cartera: <b>' + nf(st.equity, 2) + '</b>' + (isFinite(eqPct) ? ' (' + sgn(eqPct, 2) + ' %)' : '') + (dd > 0.05 ? ' · a ' + nf(dd, 1) + ' % de su máximo' : '')
  ].filter((x, i) => x !== '' || i === 3);
  if (st.fichas) L.push('🪙 Fichas: <b>' + fmt(st.fichas.balance) + '</b> · ' + (st.fichas.fee ? 'cada operación cuesta ' + fichasTxt(st.fichas.fee) : 'sin tarifa en este modo') + ' · /fichas');
  const sp = spark(st.curve.map(x => x[1]), 24 * 14);
  if (sp) L.push('📈 ' + sp + ' <i>(últimos 14 días)</i>');
  if (st.decision) {
    const d = st.decision;
    L.push('🧑‍🏫 ' + (d.auto ? 'El Entrenador ve ' : 'El ojeador ve ') + REG[d.regime] + ' → ' + (d.side === 'none' ? '<b>banquillo</b>' : '<b>' + E.TACTICS[d.tactic].name + '</b>, ' + SIDE[d.side]));
  }
  if (st.pos) L.push('📍 <b>' + (st.pos.dir > 0 ? 'Largo' : 'Corto') + '</b> ' + nf(st.pos.qty, 4) + ' ' + esc(st.symbol) + ' desde ' + nf(st.pos.entry, 2) + ' · stop ' + nf(st.pos.stop, 2) + ' · va ' + sgn(st.pos.openR, 2) + ' R');
  else L.push('📍 Sin jugada abierta' + (isFinite(st.price) ? ' · ' + esc(st.symbol) + ' a ' + nf(st.price, 2) : ''));
  L.push('🕐 Última vela revisada: ' + (st.lastBar ? fdate(st.lastBar) + ' UTC' : 'todavía ninguna (tarda hasta un minuto)'));
  return L.join('\n');
}

function coach(st) {
  const d = st.decision;
  if (!d) return '🧑‍🏫 Todavía no hay datos de ' + esc(st.symbol) + '. Se revisa al cerrar cada vela (cada hora en punto); dale un minuto.';
  const L = ['🧑‍🏫 <b>' + (d.auto ? 'El Entrenador' : 'Tu pizarra') + '</b> · ' + esc(d.symbol) + ' · vela de ' + fdate(d.time) + ' UTC', '',
    '👀 Rival: <b>' + REG[d.regime] + '</b>',
    '📋 Táctica: <b>' + (d.side === 'none' ? '— (banquillo)' : E.TACTICS[d.tactic].name) + '</b> · lado: ' + SIDE[d.side] + (d.direction !== 'both' ? ' <i>(tú limitas a ' + DIRS[d.direction] + ')</i>' : '')];
  if (d.auto) {
    L.push('', '<b>Partidos en la sombra</b> (R de los últimos 30 días):');
    for (const k of Object.keys(E.TACTICS)) {
      const on = k === d.tactic && d.side !== 'none';
      L.push((on ? '👉 ' : '▫️ ') + E.TACTICS[k].name + ': <b>' + sgn(d.scores[k], 1) + ' R</b> en ' + d.counts[k] + ' jugadas (largos ' + sgn(d.sideScores[k].long, 1) + ', cortos ' + sgn(d.sideScores[k].short, 1) + ')');
    }
  } else L.push('<i>Táctica fija elegida por ti: juega siempre, también en lateral. El Entrenador automático se queda en el banquillo cuando nada funciona.</i>');
  L.push('');
  if (d.side === 'none') L.push(d.regime === 'lateral' ? '🪑 Mercado lateral: ahí pierden todas las tácticas, así que no juega.' : '🪑 Ninguna táctica (o ningún lado permitido) va en positivo: espera.');
  else if (d.play) L.push(d.play.lostBy ? '⚽ La jugada de ' + (d.play.dir > 0 ? 'largos' : 'cortos') + ' la corta <b>' + d.play.lostBy + '</b>: ' + esc(d.play.detail) + '.' : '⚽ ¡La jugada llega al área! ' + (st.running ? 'Remate en la apertura.' : 'Pero el equipo está en pausa.'));
  return L.join('\n');
}

function plays(trades, n) {
  if (!trades.length) return '📋 Todavía no hay jugadas cerradas en este modo.';
  const last = trades.slice(-n).reverse(), g = goals(trades), wins = trades.filter(x => x.pnl > 0).length;
  const L = ['📋 <b>Últimas ' + last.length + ' jugadas</b> (de ' + trades.length + ')', ''];
  for (const x of last) L.push((x.pnl > 0 ? '⚽' : '❌') + ' ' + fdate(x.exitTime) + ' · ' + esc(x.symbol || '') + ' ' + (x.dir > 0 ? 'L' : 'C') + ' · ' + (E.TACTICS[x.tactic] ? E.TACTICS[x.tactic].name : '') + ' · ' + esc(x.reason) + ' · <b>' + sgn(x.r, 2) + ' R</b> (' + sgn(x.pnl, 2) + ')');
  L.push('', 'Marcador ' + g.f + ' : ' + g.a + ' · ' + wins + ' en verde y ' + (trades.length - wins) + ' en rojo · R medio ' + sgn((g.pos - g.neg) / trades.length, 2));
  return L.join('\n');
}

const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };
const lpad = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
function table(league, level, me, cfg) {
  const rows = league.standings(level), L = league.L, n = rows.length, k = cfg.promote, last = L.divisions.length;
  const head = '🏟 <b>' + divName(level) + '</b> · temporada ' + L.season + ' · jornada ' + Math.min(L.jornada, cfg.seasonWeeks) + ' de ' + cfg.seasonWeeks;
  const lines = [' #  Equipo          PJ  G  E  P  DG Pts'];
  rows.forEach((r, i) => {
    const mark = level > 1 && i < k ? '↑' : level < last && i >= n - k ? '↓' : ' ';
    lines.push(lpad(i + 1, 2) + mark + pad((r.id === me ? '►' : '') + r.name, 15) + lpad(r.pj, 3) + lpad(r.g, 3) + lpad(r.e, 3) + lpad(r.p, 3) + lpad((r.gf - r.gc > 0 ? '+' : '') + (r.gf - r.gc), 4) + lpad(r.pts, 4));
  });
  return head + '\n<pre>' + esc(lines.join('\n')) + '</pre>' + (k ? '\n<i>↑ asciende · ↓ desciende al final de la temporada</i>' : '');
}
function jornada(league, level, me, now) {
  const L = league.L, from = L.weekStart;
  const L2 = ['🗓 <b>Jornada ' + L.jornada + '</b> · ' + divName(level) + ' · ' + fday(from) + ' → ' + fday(from + 6 * 86400000) + ' (UTC)', '<i>Gana quien más R neto suma en la semana. En directo:</i>', ''];
  for (const m of league.live(level, now)) {
    if (m.bye !== undefined) { if (m.bye !== null) L2.push('😴 ' + (m.bye === me ? '<b>' + esc(m.name) + '</b>' : esc(m.name)) + ' descansa'); continue; }
    const mine = m.a === me || m.b === me;
    const s = esc(m.na) + ' <b>' + m.ga + ' – ' + m.gb + '</b> ' + esc(m.nb) + ' <i>(' + sgn(m.ra, 1) + ' / ' + sgn(m.rb, 1) + ' R)</i>';
    L2.push((mine ? '👉 ' : '⚽ ') + s);
  }
  return L2.join('\n');
}
function divisions(league) {
  const L = league.L, out = ['🏟 <b>La liga</b> · temporada ' + L.season + ' · jornada ' + L.jornada, ''];
  for (const d of L.divisions) { const top = league.standings(d.level)[0]; out.push('• <b>' + divName(d.level) + '</b>: ' + d.teams.length + ' equipos' + (top ? ' · líder ' + esc(top.name) + ' (' + top.pts + (top.pts === 1 ? ' punto)' : ' puntos)') : '')); }
  if (L.champions.length) out.push('', '🏆 Campeones: ' + L.champions.slice(-5).map(c => 'T' + c.season + ' ' + esc(c.name)).join(' · '));
  return out.join('\n');
}

function connection(cfg, st) {
  const L = ['🔌 <b>Modo real: conecta tu exchange o tu wallet</b>', ''];
  if (!cfg.allowReal) return L.concat(['Este servidor solo tiene activado el <b>modo demo</b> (la liga se juega igual). El administrador puede activar el modo real.', '', walletNote()]).join('\n');
  L.push(st.real ? '✅ Conectado: ' + esc(st.real.exchange) + (st.real.sandbox ? ' (testnet)' : '') + '. Para quitarlo: /desconectar' : '❌ Sin conexión.', '',
    '<b>Cómo conectar</b> (escribe el comando con tus datos; el bot borra tu mensaje al instante y guarda las claves cifradas):');
  for (const [id, e] of Object.entries(EXCHANGES)) L.push('• ' + e.name + ':\n<code>' + e.help + '</code>');
  L.push('Añade <code>testnet</code> al final para la red de pruebas del exchange.', '',
    '🔒 <b>Importante</b>',
    '• Usa una clave API <b>solo de trading, sin permiso de retiro</b>. En Hyperliquid, una <b>API wallet</b> (app.hyperliquid.xyz → More → API): opera pero no retira. Nunca la clave de tu wallet principal.',
    '• La cuenta de futuros debe estar en modo unidireccional (one-way).',
    '• Aunque el bot borre tu mensaje, las claves pasan por Telegram: si alguna vez sospechas, bórralas en el exchange y crea otras.',
    '', walletNote());
  return L.join('\n');
}
function walletNote() {
  return '👛 <b>¿Y la Wallet de Telegram?</b> Es una cartera custodial: Telegram no ofrece ninguna API para que un bot opere con ella (la única, Wallet Pay, sirve para cobrar pagos). Lo que sí puedes hacer es <b>enviar USDT desde la Wallet de Telegram</b> a tu cuenta del exchange y que el bot opere allí. Antes de enviar, comprueba que el exchange acepta la red elegida (TON, TRON…).';
}

const MOV = { bienvenida: '🎁 Bienvenida', tarifa: '⚽ Operación', devolucion_tarifa: '↩️ Tarifa devuelta', compra: '⭐ Compra', devolucion_compra: '↩️ Compra devuelta', premio: '💰 Premio', regalo: '🎁 Regalo' };
function wallet(cfg, tz, id, level) {
  const f = cfg.fees, L = ['🪙 <b>Tus fichas: ' + fmt(tz.balance(id)) + '</b>', ''];
  L.push('Cada operación aceptada (la que se abre de verdad) cuesta <b>' + fichasTxt(Math.round(f.perTrade * 100)) + '</b>' + (f.demo && f.real ? '' : f.real ? ' (solo en modo real)' : ' (solo en modo demo)') + '. Sin fichas, tu equipo no remata.');
  L.push('De cada tarifa, el <b>' + nf(f.clubPct, 0) + ' %</b> va al fondo de MenteColmena y el <b>' + nf(100 - f.clubPct, 0) + ' %</b> al bote de tu división, que se reparte al final de la temporada (/bote).');
  L.push('', 'Recarga con Telegram Stars (1 ficha = ' + f.starsPerFicha + ' ⭐):');
  const mv = tz.movements(id, 6);
  if (mv.length) { L.push('', '<b>Últimos movimientos</b>'); for (const m of mv) L.push((MOV[m.type] || m.type) + ' · ' + fday(m.t) + ' · <b>' + (m.fichas > 0 ? '+' : '') + nf(m.fichas, m.fichas % 1 ? 2 : 0) + '</b>'); }
  return L.join('\n');
}
function pots(cfg, tz, league, myLevel) {
  const L2 = league.L, sh = cfg.fees.prizes;
  const out = ['💰 <b>Botes de la temporada ' + L2.season + '</b> (jornada ' + Math.min(L2.jornada, cfg.seasonWeeks) + ' de ' + cfg.seasonWeeks + ')', '',
    'Se llenan con el ' + nf(100 - cfg.fees.clubPct, 0) + ' % de las tarifas de cada división y se reparten al terminar la temporada entre los primeros: ' + sh.map((x, i) => (i + 1) + '.º ' + nf(x, 0) + ' %').join(' · ') + ' (en fichas).', ''];
  for (const d of L2.divisions) {
    const p = tz.pot(d.level), top = league.standings(d.level);
    out.push((d.level === myLevel ? '👉 ' : '• ') + '<b>' + divName(d.level) + '</b>: ' + fichasTxt(p) + (top.length ? ' · ahora mismo: ' + sh.slice(0, top.length).map((x, i) => esc(top[i].name) + ' ' + fmt(Math.floor(p * x / 100))).join(', ') : ''));
  }
  return out.join('\n');
}
function treasuryAdmin(tz) {
  const s = tz.s, st = s.stats, a = tz.audit();
  const pend = Object.values(s.pots).reduce((x, y) => x + y, 0), carry = Object.values(s.carry).reduce((x, y) => x + y, 0);
  return ['🏦 <b>Tesorería de MenteColmena</b>', '',
    '⭐ Stars cobradas: ' + st.starsIn + (st.starsRefunded ? ' (devueltas ' + st.starsRefunded + ')' : ''),
    '🏛 Fondo del club: <b>' + fichasTxt(s.club) + '</b>',
    '💰 Botes en juego: ' + fichasTxt(pend) + (carry ? ' + ' + fichasTxt(carry) + ' que pasan de temporada' : ''),
    '👛 Fichas en manos de los entrenadores: ' + fichasTxt(a.held),
    '📈 Tarifas cobradas: ' + fichasTxt(st.fees) + (st.feesRefunded ? ' (devueltas ' + fichasTxt(st.feesRefunded) + ')' : '') + ' · premios pagados: ' + fichasTxt(st.prizes),
    '🎁 Bienvenida: ' + fichasTxt(st.welcome) + ' · regalos: ' + fichasTxt(st.gifts),
    '', a.ok ? '✅ Las cuentas cuadran.' : '❌ Las cuentas NO cuadran: revisa datos/movimientos.jsonl',
    '', 'Las Stars se retiran desde Telegram (@BotFather → tu bot → Balance / Fragment), no desde el bot.'].join('\n');
}

function help(cfg) {
  return ['⚽ <b>TikiTrade · la liga de entrenadores</b>', '',
    'Cada entrenador tiene su equipo, su cartera y sus decisiones: mercado, táctica (o el Entrenador automático), lado y riesgo. Cada hora el equipo juega contra el mercado y cada semana contra otro entrenador de tu división: gana quien más R neto suma.', '',
    '/estado — tu marcador, cartera y posición',
    '/equipo — mercado, táctica, lado y riesgo',
    '/entrenador — qué ve y por qué juega (o no)',
    '/jugadas — últimas jugadas',
    '/liga · /jornada · /divisiones — clasificación y partidos',
    '/marcha · /pausa — buscar jugadas o no abrir más',
    '/demo' + (cfg.allowReal ? ' · /real · /conectar' : '') + ' — modos',
    '/riesgo 1 · /capital 10000 · /cerrar · /reanudar · /avisos · /baja',
    cfg.fees && cfg.fees.enabled ? '/fichas · /bote — tus fichas (cada operación aceptada cuesta ' + fichasTxt(Math.round(cfg.fees.perTrade * 100)) + ') y los premios de la temporada' : '', '',
    '⚠️ Ningún bot garantiza beneficios. Los resultados del probador son con datos sintéticos.'
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
}

module.exports = { scoreboard, coach, plays, table, jornada, divisions, connection, help, settingsLine, DIRS, wallet, pots, treasuryAdmin };
