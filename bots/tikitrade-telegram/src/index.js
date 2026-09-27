'use strict';
process.noDeprecation = true;   // avisos internos de dependencias (punycode) que no afectan al bot
// Arranque del servidor: node src/index.js (o npm start). Lee .env, prepara el club y conecta con Telegram.
const ccxt = require('ccxt');
const { load } = require('./config');
const { Store } = require('./store');
const { Hub } = require('./hub');
const { App } = require('./app');
const { createBot, COMMANDS } = require('./telegram');

// una instancia de ccxt por entrenador en modo real, con sus claves
function makeExchange(exchangeId, creds, sandbox) {
  const options = { defaultType: 'swap' };
  // Hyperliquid: sin la comisión extra de ccxt («builder fee» al 0 %) y sin tocar el referido de la cuenta
  if (exchangeId === 'hyperliquid') Object.assign(options, { builderFee: false, refSet: true });
  const ex = new ccxt[exchangeId](Object.assign({ enableRateLimit: true, options }, creds));
  if (sandbox) ex.setSandboxMode(true);
  return ex;
}

// cola de envío: respeta los límites de Telegram y silencia a quien ha bloqueado el bot
function sender(bot, app) {
  const q = []; let running = false;
  const pump = async () => {
    if (running) return; running = true;
    while (q.length) {
      const { id, html, extra, done } = q.shift();
      try { await bot.api.sendMessage(id, html, Object.assign({ parse_mode: 'HTML', link_preview_options: { is_disabled: true } }, extra || {})); }
      catch (e) {
        if (e.error_code === 403) { const t = app && app.team(id); if (t) { t.S.muted = true; t.save(); } }
        else if (e.error_code === 429) { q.unshift({ id, html, extra, done }); await new Promise(r => setTimeout(r, ((e.parameters && e.parameters.retry_after) || 5) * 1000)); continue; }
        else console.error('Aviso a', id, 'fallido:', e.message);
      }
      done(); await new Promise(r => setTimeout(r, 40));
    }
    running = false;
  };
  return (id, html, extra) => new Promise(done => { q.push({ id, html, extra, done }); pump(); });
}

async function main() {
  const cfg = load();
  if (!cfg.token) { console.error('Falta TELEGRAM_TOKEN en el archivo .env (pídeselo a @BotFather). Mira LEEME.md.'); process.exit(1); }
  if (cfg.allowReal && !cfg.masterKey) { console.error('PERMITIR_REAL=true necesita una CLAVE_MAESTRA larga en .env para cifrar las claves de los entrenadores.'); process.exit(1); }
  const publicEx = new ccxt[cfg.dataExchangeId]({ enableRateLimit: true, options: { defaultType: 'swap' } });
  const store = new Store(cfg);
  const hub = new Hub(publicEx, cfg);
  const { Bot } = require('grammy');
  const bot0 = new Bot(cfg.token);
  let app = null;
  const notify = sender(bot0, { team: id => app && app.team(id) });
  app = new App({ cfg, store, hub, notify, makeExchange });
  const bot = createBot({ cfg, app });

  let me = null;
  while (!me) {
    try { me = await bot.api.getMe(); }
    catch (e) {
      if (e.error_code === 401 || e.error_code === 404) { console.error('Telegram rechaza el TELEGRAM_TOKEN: revísalo en el archivo .env.'); process.exit(1); }
      console.error('Sin conexión con Telegram (' + e.message + '). Reintento en 30 s…');
      await new Promise(r => setTimeout(r, 30000));
    }
  }
  await bot.api.setMyCommands(COMMANDS).catch(e => console.error('setMyCommands:', e.message));
  console.log('TikiTrade · liga en Telegram: @' + me.username + ' · ' + app.teams.size + ' equipos · datos de ' + cfg.dataExchangeId + ' · modo real ' + (cfg.allowReal ? 'activado' : 'desactivado'));
  app.start();
  if (cfg.adminId) notify(cfg.adminId, '🟢 Servidor de TikiTrade en marcha: ' + app.teams.size + ' equipos. /admin');
  const stop = async () => { app.stop(); await bot.stop(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  await bot.start({ allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] });
}

main().catch(e => { console.error('No se pudo arrancar:', e.message); process.exit(1); });
