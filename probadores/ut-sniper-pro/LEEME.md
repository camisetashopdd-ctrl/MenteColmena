# Probador UT Sniper Pro

Probador en el navegador para el indicador Pine Script v6 guardado en
`estrategias/ut-sniper-pro.pine`. Traduce su lógica a JavaScript: línea UT Bot (opcionalmente
con cierre Heikin Ashi), Bollinger 200, MACD, pivotes de divergencia, setups con caducidad,
filtros de entrada (cuerpo de vela, color, zona de Bollinger, histograma MACD, anti-FOMO,
pico de ATR) y su gestión de operaciones con TP1, TP2 y SL.

## Uso

Abre `probadores/ut-sniper-pro/index.html` en el navegador. No necesita servidor ni compilación;
`engine.js` debe estar en la misma carpeta.

- Al abrirse carga **26 semanas de datos sintéticos** (tipo EURUSD 15 m, no son precios reales).
  El bot es muy selectivo: con 10 semanas apenas da 3 operaciones.
- **Cargar CSV…** acepta exportaciones de TradingView o MetaTrader con columnas
  `time, open, high, low, close`. Hacen falta al menos 250 velas (las Bollinger usan 200).

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/ut-sniper-pro.pine` | Script original de TradingView |
| `probadores/ut-sniper-pro/engine.js` | Motor: indicador, máquina de estados de operaciones, datos de ejemplo y lector de CSV |
| `probadores/ut-sniper-pro/index.html` | Interfaz: gráfico con divergencias y MACD, operaciones, embudo de setups, curva en R |

## Cómo simula

El indicador lleva su propia gestión (`state`): entra al cierre de la vela de señal y cierra en
TP2, en el SL o en la entrada si antes tocó TP1 ("TP1 > ENTRY"). El probador reproduce esa
máquina de estados con el mismo orden de comprobaciones y los mismos contadores de su tabla.
Para la curva de capital cada operación arriesga el mismo importe: TP2 = +TP2 R, SL = −1 R,
TP1 > ENTRY = 0 R.

## Observaciones sobre el script Pine

1. El bloque "CLOSE TRADE" también se evalúa en la vela de entrada, con un máximo y un mínimo que
   ocurrieron antes del cierre en el que se entra.
2. El win rate de la tabla es TP2 / (TP2 + SL): las salidas "TP1 > ENTRY" no cuentan.
3. Con "MACD Hist Divergence" apagado (por defecto) la divergencia es solo de precio.
4. Los pivotes y las bandas usan `src`, pero el toque de banda del setup mira el mínimo o máximo real.

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/ut-sniper-pro/engine.js"); console.log(E.run(E.makeSample(7,26)).stats)'
```
