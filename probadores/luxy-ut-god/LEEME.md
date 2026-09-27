# Probador Luxy UT GOD (UT-BOT Forecast)

Probador en el navegador para el indicador Pine Script v6 guardado en
`estrategias/luxy-ut-god.pine`. Traduce su lógica a JavaScript: la línea UT adaptativa
(estilos preestablecidos, multiplicador por activo y volatilidad, filtro de chop con
Efficiency Ratio, ponderación por volumen), los filtros de señal (ADX, enfriamiento,
confirmación, volumen, volatilidad, RSI, Hull, SuperTrend, MTF, zonas S/R, swing, % de cambio,
2 velas, vela completa), la puntuación de confianza, las divergencias RSI, los 7 métodos de stop,
los TP en múltiplos de R, la estadística del indicador y la predicción de duración de tendencia.

## Uso

Abre `probadores/luxy-ut-god/index.html` en el navegador. No necesita servidor ni compilación;
`engine.js` debe estar en la misma carpeta.

- Al abrirse carga **datos sintéticos** (tipo EURUSD 15 m, no son precios reales).
- **Cargar CSV…** acepta exportaciones de TradingView o MetaTrader con columnas
  `time, open, high, low, close, volume`. El archivo se procesa solo en el navegador.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/luxy-ut-god.pine` | Script original de TradingView |
| `probadores/luxy-ut-god/engine.js` | Motor: indicador, estadística, modelo de operación, datos de ejemplo y lector de CSV |
| `probadores/luxy-ut-god/index.html` | Interfaz: gráfico, parámetros, señales, tabla del indicador, curva de capital, embudo de filtros |

## Qué mide

El original es un `indicator`, no una `strategy`: no abre operaciones. El probador calcula:

1. **Estadística del indicador:** una señal gana si toca algún TP activado antes que el stop.
   La tabla "Stats (Nd)" solo cuenta las señales de los últimos N días.
2. **Modelo de operación:** entrada al cierre de la vela de señal, salida en el stop, en el TP
   más lejano activado o al cierre de la siguiente señal. Tamaño según la calculadora de riesgo
   del indicador, sobre capital fijo y sin comisiones.

## Diferencias con TradingView

- El estilo "Auto" se deduce de la duración de las velas y el tick mínimo de los decimales del precio.
- El MTF se calcula remuestreando las velas cargadas; cada vela superior aparece al cerrar (`lookahead_off`).
- "Auto-Detect" del tipo de activo usa `syminfo.type`; aquí se elige a mano (por defecto Forex).
- "Stats Days" cuenta desde la última vela cargada, no desde `timenow`.
- La predicción usa los modos Simple y Standard; Advanced se calcula como Standard.

## Observaciones sobre el script Pine

1. Con MTF en "Auto (×4)" en un gráfico de 1H el script genera "4H", que el `switch` no reconoce,
   así que usa la tendencia de 1H (el mismo marco que el gráfico). En 5m ocurre algo parecido ("20").
2. Sin volumen, `volume / ta.sma(volume, 20)` da `na` y la línea UT adaptativa deja de funcionar;
   solo el "Classic UT-Bot Mode" funciona sin volumen.
3. Con "Freeze Lines on Hit" apagado, las ganancias solo se cuentan cuando llega la siguiente señal.

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/luxy-ut-god/engine.js"); console.log(E.run(E.makeSample(7,10)).stats)'
```
