# Probador UT Bot Stochastic RSI

Probador en el navegador para el indicador Pine Script v5 guardado en
`estrategias/ut-bot-stoch-rsi.pine`.

## Qué hace el indicador

Tiene un "optimizador" integrado:

1. Calcula una línea UT Bot (ATR 3, sensibilidad 2) y el canal FRAMA de BigBeluga.
2. Ejecuta **8 variantes** de la señal de compra: sin filtro, FRAMA, Estocástico, RSI y sus
   combinaciones. Todas venden igual: cuando la línea UT cruza el precio hacia abajo.
3. Hace un backtest de cada variante: solo largos, 1000 $ por operación, entrada y salida al cierre.
4. **En cada vela usa la compra y la venta de la variante con más beneficio acumulado** hasta ese
   momento (o mejor winrate, según "Optimization Metric").
5. Hace un último backtest con esas señales combinadas. Es el que muestra su tabla: balance final,
   beneficio, crecimiento del precio, entradas/salidas, ganadas/perdidas y winrate.

El probador reproduce todo eso y muestra además el resultado de cada variante por separado y qué
variante estaba "al mando" en cada vela (franja de color bajo el gráfico).

## Uso

Abre `probadores/ut-bot-stoch-rsi/index.html` en el navegador (con `engine.js` en la misma
carpeta). Carga datos sintéticos tipo EURUSD 15 m o un CSV propio (`time, open, high, low, close`,
al menos 250 velas).

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/ut-bot-stoch-rsi.pine` | Script original de TradingView |
| `probadores/ut-bot-stoch-rsi/engine.js` | Motor: línea UT, FRAMA, 8 variantes, elección vela a vela, backtest combinado |
| `probadores/ut-bot-stoch-rsi/index.html` | Interfaz: gráfico con franja de variantes, tabla de variantes, operaciones, curva |

## Observaciones sobre el script Pine

1. El resultado de la tabla es el de las señales mezcladas: la variante elegida cambia con el tiempo,
   y el combinado suele quedar por debajo de la mejor variante vista a posteriori.
2. En las variantes con RSI o Estocástico la compra no exige que el precio cruce la línea UT:
   basta la primera vela de la fase alcista en la que el filtro se cumple.
3. "Signals Data", "Lables Size" y `globalKCrossD` no afectan a las señales.
4. Con "Low-Risk Entry" los filtros de esa variante cambian vela a vela y el script solo calcula RSI y
   Estocástico en algunas velas; el probador los calcula en todas, así que ese modo es aproximado.
5. El backtest del script empieza el 28-07-2021; el probador usa todas las velas cargadas.

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/ut-bot-stoch-rsi/engine.js"); console.log(E.run(E.makeSample(7,10)).stats)'
```
