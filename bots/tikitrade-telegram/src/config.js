'use strict';
// Configuración del servidor: todo sale del archivo .env (ver .env.ejemplo).
const path = require('path');
require('dotenv').config({ path: process.env.TIKITRADE_ENV || path.join(__dirname, '..', '.env'), quiet: true });

const env = k => (process.env[k] || '').trim();
const num = (k, d) => { const v = parseFloat(env(k).replace(',', '.')); return isFinite(v) ? v : d; };

// Exchanges para el modo real de cada entrenador (futuros perpetuos: permiten cortos y stops en el exchange)
const EXCHANGES = {
  binanceusdm: { name: 'Binance Futuros USDⓈ-M', quote: 'USDT', creds: ['apiKey', 'secret'], help: '/conectar binanceusdm CLAVE SECRETO' },
  bybit: { name: 'Bybit (perpetuos USDT)', quote: 'USDT', creds: ['apiKey', 'secret'], help: '/conectar bybit CLAVE SECRETO' },
  okx: { name: 'OKX (swaps USDT)', quote: 'USDT', creds: ['apiKey', 'secret', 'password'], help: '/conectar okx CLAVE SECRETO PASSPHRASE' },
  hyperliquid: { name: 'Hyperliquid (DEX con wallet)', quote: 'USDC', creds: ['walletAddress', 'privateKey'], help: '/conectar hyperliquid DIRECCION CLAVE_PRIVADA_DE_LA_API_WALLET' }
};
const symbolFor = (exchangeId, base) => base + '/' + (EXCHANGES[exchangeId] ? EXCHANGES[exchangeId].quote : 'USDT') + ':' + (EXCHANGES[exchangeId] ? EXCHANGES[exchangeId].quote : 'USDT');

function load() {
  const dataExchangeId = (env('EXCHANGE_DATOS') || 'binanceusdm').toLowerCase();
  if (!EXCHANGES[dataExchangeId]) throw new Error('EXCHANGE_DATOS="' + dataExchangeId + '" no está soportado. Opciones: ' + Object.keys(EXCHANGES).join(', '));
  const admin = env('TELEGRAM_ADMIN_ID') || env('TELEGRAM_OWNER_ID');
  return {
    token: env('TELEGRAM_TOKEN'),
    adminId: /^\d+$/.test(admin) ? Number(admin) : null,
    inviteCode: env('CODIGO_INVITACION'),
    maxTeams: num('MAX_EQUIPOS', 500),
    dataExchangeId,
    symbols: (env('MERCADOS') || 'BTC,ETH,SOL,XRP,BNB,DOGE').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    timeframe: '1h',
    dataDir: env('CARPETA_DATOS') || path.join(__dirname, '..', 'datos'),
    demoCapital: num('CAPITAL_DEMO', 10000),
    riskPct: num('RIESGO_PCT', 1),
    maxRiskReal: 2,
    dailyLossPct: num('PERDIDA_DIARIA_MAX_PCT', 3),
    maxDdPct: num('DRAWDOWN_MAX_PCT', 15),
    allowReal: env('PERMITIR_REAL').toLowerCase() === 'true',
    masterKey: env('CLAVE_MAESTRA'),
    // tesorería de MenteColmena: fichas, tarifa por operación aceptada, fondo del club y botes de premios
    fees: {
      enabled: env('TESORERIA').toLowerCase() !== 'false',             // activada salvo TESORERIA=false
      perTrade: Math.max(0, num('TARIFA_POR_OPERACION', 10)),       // fichas por operación aceptada (1 ficha = 1 Star)
      demo: env('TARIFA_EN_DEMO').toLowerCase() !== 'false',
      real: env('TARIFA_EN_REAL').toLowerCase() !== 'false',
      clubPct: Math.min(100, Math.max(0, num('PORCENTAJE_CLUB', 50))),   // el resto va al bote de la división
      prizes: (env('REPARTO_PREMIOS') || '50,30,20').split(',').map(x => parseFloat(x)).filter(x => x > 0),
      welcome: Math.max(0, num('FICHAS_BIENVENIDA', 50)),
      packs: (env('PAQUETES_FICHAS') || '100,250,500').split(',').map(x => Math.round(parseFloat(x))).filter(x => x > 0),
      starsPerFicha: Math.max(1, Math.round(num('ESTRELLAS_POR_FICHA', 1)))
    },
    divisionSize: Math.max(2, Math.round(num('EQUIPOS_POR_DIVISION', 10))),
    seasonWeeks: Math.max(1, Math.round(num('JORNADAS_POR_TEMPORADA', 4))),
    promote: Math.max(0, Math.round(num('ASCIENDEN', 2))),
    bars: 2000,
    tickMs: 20000
  };
}

module.exports = { load, EXCHANGES, symbolFor };
