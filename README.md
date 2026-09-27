# MenteColmena · TikiTrade

Bot de trading autónomo para Telegram con liga de entrenadores. Cada usuario es un **entrenador** que elige mercado, táctica y lado; el bot opera en su nombre cada hora.

## Estructura

```
estrategias/       Pine Script v6: estrategias para TradingView
probadores/        Testers en navegador + motor Node.js para cada estrategia
bots/
  tikitrade-telegram/   Bot de Telegram multi-usuario (TikiTrade v3)
```

## TikiTrade v3

Estrategia de seguimiento de tendencia con metáfora de fútbol: cada herramienta es un jugador que tiene que pasar el balón al siguiente para llegar al gol (cerrar la operación en verde).

| # | Jugador | Herramienta |
|---|---------|-------------|
| 1 | El Muro | Riesgo y descanso |
| 4 | La Roca | Tendencia EMA 50/200 |
| 3 | El Motor | Fuerza ADX ≥ 25 |
| 8 | El Cerebro | Pausa RSI ≤ 45 |
| 10 | El Termómetro | Volatilidad ATR% percentil 10–90 |
| 7 | La Chispa | Volumen ≥ 0,9 × media 20 |
| 9 | El Killer | Gatillo: cierre > máximo anterior |

**El Entrenador** juega las 4 tácticas en la sombra y elige la que más R ha sumado en los últimos 30 días. Si ninguna va en positivo, no juega.

### Resultados (datos sintéticos, velas 1h, 26 semanas, riesgo 1%)

| Grupo | Semillas | Net % medio |
|-------|----------|-------------|
| Ajuste | 1–24 | +3.85% |
| Validación | 25–48 | +3.41% |
| Examen | 49–72 | +3.27% |

360 partidos totales (24 semillas × 5 tipos de mercado × 26 semanas por grupo).

## Arrancar el bot (demo)

```bash
cd bots/tikitrade-telegram
npm install
cp .env.ejemplo .env
# Edita .env: pon tu TELEGRAM_TOKEN (de @BotFather)
node src/index.js
```

## Tests

```bash
cd bots/tikitrade-telegram
npm test   # 13 pruebas, ~1 min
```

## Exchanges soportados (modo real)

Binance (USDM), Bybit, OKX, Hyperliquid. Cada entrenador conecta su propio exchange con `/conectar`.

## Seguridad (modo real)

- Stop colocado en el exchange desde la entrada
- Cierre inmediato si el exchange rechaza el stop
- Stop nuevo creado **antes** de cancelar el viejo
- Claves cifradas en disco con `CLAVE_MAESTRA`; nunca aparecen en logs
- Tope de riesgo: 2% máximo en real
- Frenos de pérdida diaria (`PERDIDA_DIARIA_MAX_PCT`) y drawdown (`DRAWDOWN_MAX_PCT`)
- El modo real requiere escribir `CONFIRMO DINERO REAL` al activarlo
