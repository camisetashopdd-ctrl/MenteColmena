# Probador Inyerneck UT Bot 9 EMA Filter

Probador en el navegador para el indicador Pine Script v5 guardado en
`estrategias/inyerneck-ut-9ema.pine`, con una versión corregida en
`estrategias/inyerneck-ut-9ema-corregido.pine`.

## El original no da señales

```pine
upperBand = src + mult * atr
lowerBand = src - mult * atr
buySignal  = ta.crossover(src, lowerBand) and close > ema9
sellSignal = ta.crossunder(src, upperBand) and close < ema9
```

Las bandas se calculan a partir del propio `src` en cada vela, así que `src` siempre queda entre
ellas. `ta.crossover(src, lowerBand)` exige que en la vela anterior `src <= lowerBand`, es decir,
que el ATR anterior fuera 0 o negativo. En la práctica no se cumple nunca: con los datos de
ejemplo da 0 señales con cualquier fuente. Además, pese al nombre, no hay trailing stop de UT Bot.

## Versión corregida (propuesta)

`inyerneck-ut-9ema-corregido.pine` usa el trailing stop clásico de UT Bot (QuantNomad) con
Key = "ATR Multiplier" y conserva el filtro de EMA 9: compra cuando `src` cruza la línea hacia
arriba con el cierre sobre la EMA 9, y vende al revés. Es una propuesta que no forma parte del
script original; compruébala en TradingView antes de usarla.

## Uso

Abre `probadores/inyerneck-ut-9ema/index.html` en el navegador (con `engine.js` en la misma
carpeta). Arriba se elige **Original** o **Corregido**. Carga datos sintéticos tipo EURUSD 15 m
o un CSV propio (`time, open, high, low, close`).

Modelo de operación (el indicador solo da señales): siempre en el mercado, entrada al cierre de la
señal y giro al cierre de la señal contraria; las señales repetidas en la misma dirección se
ignoran. Tamaño fijo en unidades, sin comisiones ni spread.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/inyerneck-ut-9ema.pine` | Script original |
| `estrategias/inyerneck-ut-9ema-corregido.pine` | Versión corregida (propuesta) |
| `probadores/inyerneck-ut-9ema/engine.js` | Motor con los dos modos, datos de ejemplo y lector de CSV |
| `probadores/inyerneck-ut-9ema/index.html` | Interfaz con diagnóstico, gráfico, operaciones y curva |

Comprobar el motor desde la terminal (el original debe dar 0 señales):

```sh
node -e 'const E=require("./probadores/inyerneck-ut-9ema/engine.js"); const d=E.makeSample(7,10); console.log(E.run(d).stats.signals, E.run(d,{mode:"corregido"}).stats.signals)'
```
