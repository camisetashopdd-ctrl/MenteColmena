# Probador UT Bot + LinReg Candles + Longevity Zones + S/R + Dashboard

Probador en el navegador para el indicador Pine Script v6 guardado en
`estrategias/ut-linreg-dashboard.pine`. Traduce a JavaScript sus cinco partes:

1. **UT Bot** con líneas separadas de compra y venta y el estado `posState`, que solo acepta
   señales alternas (las que disparan las alertas "UT Long" y "UT Short").
2. **Velas de regresión lineal** (`ta.linreg` de apertura, máximo, mínimo y cierre), coloreadas por
   el estado de posición, y su línea de señal.
3. **Zonas de longevidad**: nacen en máximos o mínimos de `len_z` velas, miden media ATR(20) y
   desaparecen al romperse o al superar 10 por lado. El probador guarda también las ya rotas.
4. **Soportes y resistencias**: máximos y mínimos de 10, 50, 100, 250, 500, 750 y 1000 velas.
5. **Panel de mercado** en la última vela: volatilidad, volumen, VWAP, MACD, estocástico, RSI,
   tendencia EMA 9/21 por marco temporal, rango de hoy y de ayer, estado del ATR y trailing stop.

## Uso

Abre `probadores/ut-linreg-dashboard/index.html` en el navegador (con `engine.js` en la misma
carpeta). Carga datos sintéticos tipo EURUSD 15 m o un CSV propio
(`time, open, high, low, close, volume`).

Modelo de operación (el indicador solo da señales): se sigue `posState`, con entrada y giro al
cierre de cada señal confirmada, tamaño fijo en unidades y sin comisiones.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/ut-linreg-dashboard.pine` | Script original de TradingView |
| `probadores/ut-linreg-dashboard/engine.js` | Motor: señales, velas LinReg, zonas, S/R, panel, datos de ejemplo y lector de CSV |
| `probadores/ut-linreg-dashboard/index.html` | Interfaz: gráfico, operaciones, panel, tabla de zonas, curva |

## Observaciones sobre el script Pine

1. Las líneas de compra y venta usan el mismo cálculo y solo cambia el valor inicial: con los
   mismos ajustes coinciden en todas las velas tras las primeras, así que las señales siempre alternan.
2. Con "ATR Period" = 1 la distancia de la línea es 2 veces el rango de la vela anterior: muchas señales.
3. Las etiquetas Buy/Sell usan la señal sin filtrar; las alertas y el color de las velas usan `posState`.
4. `labels_at_root = lab_pos == "LastBar"` está invertido: "LastBar" pone la etiqueta en el origen.
5. La entrada "Support & Resistance Lines" (`srLines`) no se usa; las líneas dependen de `showSR`.
   Tampoco se usan "Panel Right Shift", "Panel anchor bars" ni "Panel vertical padding".

## Diferencias con TradingView

- Las tendencias del panel solo se calculan para marcos iguales o mayores que el de las velas cargadas.
- La VWAP se reinicia cada día UTC; "hoy" y "ayer" son días UTC.

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/ut-linreg-dashboard/engine.js"); console.log(E.run(E.makeSample(7,10)).stats)'
```
