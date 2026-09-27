# Probador Dynamic Grid Engine

Probador en el navegador para el indicador Pine Script v6 «Dynamic Grid Engine v3.0» de AleksDU,
guardado en `estrategias/dynamic-grid-engine.pine`.

## Qué hace el indicador

No opera: dibuja una rejilla de niveles y da alertas.

- **Paso:** ATR 14 × 0,5.
- **Centro:** empieza en el cierre de la primera vela del historial. Con «Auto-recenter» pasa a ser el cierre actual cuando este sale de centro ± 15 pasos.
- **Dibujo:** solo en la última vela (`barstate.islast`):
  - 15 niveles S por encima del centro y 15 niveles B por debajo;
  - la línea MID y la zona neutral B1–S1;
  - flechas «SELL here» y «BUY here» en los niveles más cercanos al cierre;
  - etiquetas con la distancia en % y el «beneficio» teórico del paso (`tamaño × paso / nivel`);
  - un panel con paso, rango, límites y «Total if Full».
- **`barcolor`:** pinta de amarillo las velas con `crossed_level`.
- **Alertas:** «Level Crossed», «Outside Grid», «Above Grid» y «Below Grid».

## Qué muestra el probador

- **Vela analizada:** el gráfico dibuja la rejilla, el panel y las etiquetas como si esa vela fuera la última. Por defecto es la última; se cambia con el deslizador o haciendo clic en una vela.
- **Contexto histórico:** también se ven el centro y los límites de todas las velas, los recentrados y las velas marcadas por `barcolor`.
- **Pestaña «Alertas»:** compara `crossed_level` con el cruce real de una línea de la rejilla y cuenta las velas con «Outside Grid».
- **Datos:** 10 semanas sintéticas tipo BTCUSD 1 h, o un CSV propio (`time, open, high, low, close`).

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/dynamic-grid-engine.pine` | Script original de TradingView |
| `probadores/dynamic-grid-engine/engine.js` | Motor: ATR, centro con recentrado, límites, `crossed_level`, rejilla en cualquier vela, datos de ejemplo y lector de CSV |
| `probadores/dynamic-grid-engine/index.html` | Interfaz: gráfico con la rejilla, panel, diagnóstico de alertas, tabla de niveles y de recentrados |

## Observaciones sobre el script Pine

1. **Con «Auto-recenter» (activado por defecto), las alertas «Outside Grid», «Above Grid» y «Below Grid» nunca saltan.** En la misma vela en que el cierre sale del rango, el centro pasa a ser ese cierre, y `price_in_grid` vuelve a ser verdadero antes de evaluarse. El panel siempre dice «Yes».
2. **«Level Crossed» detecta los puntos medios entre niveles, no los niveles.** `math.round((close − centro)/paso)` cambia al pasar por centro + (k + ½)·paso. Además, el paso cambia en cada vela.
   - En los datos de ejemplo (semilla 7) marca el 75 % de las velas.
   - El 12 % de las velas son alertas falsas (ninguna línea cruzada) y otro 12 % son cruces reales sin alerta.
   - Cada recentrado también se marca como cruce. Con `math.floor` se detectaría el cruce real.
3. **Con un paso de 0,5 ATR, casi todas las velas cruzan un nivel,** así que la alerta «Level Crossed» salta de forma continua.
4. **Sin recentrado, el centro queda fijo en el cierre de la primera vela del historial,** que puede estar muy lejos del precio actual. `if barstate.isfirst grid_center := close` no cambia nada, porque la variable ya empieza con ese valor.
5. **Los niveles se mueven en cada vela** porque el paso depende del ATR actual, aunque el centro no cambie.
6. **Etiquetas con doble signo.** Cuando el precio está al otro lado de un nivel, la etiqueta sale como «S1 +-0.39%» o «B1 --9.14%»: el signo se añade a mano delante de un número que ya es negativo.
7. **El beneficio por nivel y «Total if Full» son teóricos.** No descuentan comisiones: con un 0,1 % por lado, un ciclo cuesta 0,2 % y el paso ronda el 0,2–0,35 %. «Total if Full» suma los 30 niveles como si cada uno completara un ciclo.

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/dynamic-grid-engine/engine.js"); console.log(E.run(E.makeSample(7,10)).stats)'
```
