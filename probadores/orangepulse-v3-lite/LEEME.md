# Probador OrangePulse v3.0 Lite

Probador en el navegador para la estrategia Pine Script v6 «OrangePulse v3.0 Lite» (DCA de reversión a la media),
guardada en `estrategias/orangepulse-v3-lite.pine`.

## Qué hace la estrategia

- **Orden base (BO), 1000 $:** cuando el precio toca la Bollinger inferior (20, 2) con el RSI 14 < 50. En modo SHORT, la superior con RSI > 70.
- **Hasta 3 órdenes de seguridad (SO):**
  - Niveles: −3 %, −3,75 % y −4,69 %, cada uno desde el anterior (en total, unos −11 % desde la BO).
  - Tamaños: 1000, 2000 y 4000 $. Con la BO, hasta 8000 $ invertidos.
  - Compra al cierre cuando el mínimo toca el nivel y el cierre queda por debajo.
  - Enfriamientos: 2 velas tras la BO y 1 entre SO.
- **Salida:** TP del 1 % sobre el precio medio. SL del 3 % y TP dinámico disponibles, pero desactivados por defecto.
- **Ajustes de ejecución:** `process_orders_on_close = true`, `calc_on_order_fills = true`, pyramiding 4, capital 10 000, sin comisiones.

## Cómo simula

- El script se evalúa al cierre de cada vela, y sus órdenes se ejecutan a ese mismo cierre (`process_orders_on_close`).
- La posición cambia después de esa ejecución, así que el script la ve distinta desde la vela siguiente.
- **Simplificación:** con `calc_on_order_fills`, TradingView vuelve a ejecutar el script tras cada ejecución en la misma vela. El probador lo evalúa una vez por vela, así que puede haber pequeñas diferencias.

## Uso

Abre `probadores/orangepulse-v3-lite/index.html` en el navegador, con `engine.js` en la misma carpeta.

- **Datos:** 16 semanas sintéticas tipo BTCUSD 1 h, o un CSV propio. La ventana del script empieza el 21 ene 2025, así que el CSV debe llegar hasta esa fecha o más allá.
- **Pestaña «Ciclos»:** cada ciclo BO → cierre, con las órdenes usadas, el capital invertido, el nivel del TP frente al precio real de salida y el peor momento (mayor pérdida abierta).
- **Panel lateral:** reproduce la tabla de estado del script en la vela bajo el cursor.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/orangepulse-v3-lite.pine` | Script original de TradingView |
| `probadores/orangepulse-v3-lite/engine.js` | Motor: Bollinger, RSI, escalera DCA, enfriamientos, TP/SL/trailing, broker al cierre, datos de ejemplo y lector de CSV |
| `probadores/orangepulse-v3-lite/index.html` | Interfaz: gráfico con precio medio, TP y próxima SO; RSI y capital invertido; ciclos; curva de capital |

## Observaciones sobre el script Pine

1. **El TP se cobra al cierre, no al precio del TP.** `tp_trigger` mira si el máximo tocó el TP, pero `strategy.close_all` se ejecuta al cierre de la vela.
   - Con la semilla 7, 11 de las 27 salidas «TP» se ejecutan por debajo del nivel y una da pérdida.
   - Con el SL pasa lo mismo: el precio de salida no es el del SL.
2. **Sin stop loss, el % de acierto engaña.** Casi todos los ciclos ganan (96–100 % en los datos de ejemplo), pero cada ciclo gana poco (≈ 1 % del capital invertido) y puede estar muchas velas en pérdida.
   - Semilla 7: +468 $ de beneficio frente a un drawdown de 1232 $ (12 %).
   - Semilla 11, con caída del 29 %: la escalera completa (8000 $) queda abierta y el drawdown llega al 30 %.
3. **El «RSI Oversold» por defecto es 50,** que no es sobreventa.
4. **Las SO exigen que el cierre quede por debajo del nivel,** además de que la mecha lo toque, y respetan los enfriamientos. Por eso compran a precios peores que el nivel.
5. **Sin comisiones.** Con un TP del 1 %, una comisión del 0,1 % por lado se lleva cerca del 20 % de cada ganancia.
6. **`calc_on_order_fills = true` puede cambiar resultados en TradingView,** por ejemplo con salidas en la misma vela de la entrada. El probador no lo reproduce.

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/orangepulse-v3-lite/engine.js"); console.log(E.run(E.makeSample(7,16)).stats)'
```
