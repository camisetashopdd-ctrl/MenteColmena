# Probador UT Bot + STC (v4.6 Lag Window)

Backtester en el navegador para la estrategia Pine Script v6 guardada en
`estrategias/ut-bot-stc-v4.6.pine`. Traduce toda la lógica del script a JavaScript:
UT Bot, STC, filtros de sesión, rango de vela, volumen, mecha y velocidad, ventana de
retraso, breakeven, TP parcial, régimen de volatilidad y cortacircuitos semanal.

## Uso

Abre `probadores/ut-bot-stc-v4.6/index.html` en el navegador. No necesita servidor ni compilación;
`engine.js` debe estar en la misma carpeta.

- Al abrirse carga **datos sintéticos** (tipo EURUSD 15 m, no son precios reales).
- **Cargar CSV…** acepta exportaciones de TradingView o MetaTrader con columnas
  `time, open, high, low, close, volume`. El archivo se procesa solo en el navegador.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/ut-bot-stc-v4.6.pine` | Script original de TradingView |
| `probadores/ut-bot-stc-v4.6/engine.js` | Motor de backtest, generador de datos de ejemplo y lector de CSV |
| `probadores/ut-bot-stc-v4.6/index.html` | Interfaz: gráfico, parámetros, operaciones, curva de capital, embudo de señales |

## Cómo simula

- El script se evalúa al cierre de cada vela; las entradas a mercado se llenan en la apertura siguiente.
- Stops y límites colocados al cierre se prueban en la vela siguiente: apertura, extremo más cercano,
  extremo opuesto, cierre (regla del emulador de TradingView).
- Sin comisiones ni deslizamiento. La semana del cortacircuitos empieza el lunes 00:00 UTC.

## Observaciones sobre el script Pine

1. La vela de entrada no tiene stop: `strategy.exit` solo se llama con posición abierta.
2. `dynamicOffsetValue` cambia el cálculo de riesgo y objetivo, pero la orden es a mercado;
   el breakeven usa el `close` de la vela de señal, no el precio real de entrada.
3. Los valores `0.00001` y `0.00100` suponen pares de 5 decimales (EURUSD y similares).

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/ut-bot-stc-v4.6/engine.js"); console.log(E.run(E.makeSample(7,10)).stats)'
```
