# Probador 5 perces bot v2.3

Probador en el navegador para la estrategia Pine Script v5 guardada en
`estrategias/5-perces-bot-v2.3.pine` («5 perces» significa «5 minutos» en húngaro).

## Qué hace la estrategia

Pensada para un gráfico de 5 minutos:

- **Señal:** cruce del cierre con el trailing stop del UT Bot (Key Value 2,2, ATR 10).
- **Filtros del largo** (el corto es el espejo):
  - cierre > EMA 21;
  - cierre > EMA 200;
  - cierre > EMA 21 de 1 min;
  - cierre > EMA 200 de 15 min;
  - ADX 14 > 23;
  - distancia del cierre a la EMA 21 > 0,1 %.
- **Horario:** solo entra de 03:00 a 15:00, hora del exchange (fijo en el script).
- **Salidas:**
  - TP +1,5 % / SL −1 % sobre el precio medio;
  - cierre si la EMA 21 cruza la EMA 200 en contra;
  - cierre de todo a partir de las 15:00.
- 100 % del capital por operación, `pyramiding = 1`. Una señal contraria da la vuelta a la posición.

## Cómo simula

Igual que el emulador de TradingView con los ajustes del script:

- El script se evalúa al cierre de cada vela.
- Las entradas y cierres son a mercado en la apertura siguiente.
- El TP/SL de `strategy.exit` actúa desde la vela siguiente a la que se coloca. Dentro de la vela sigue el recorrido apertura → extremo más cercano → otro extremo → cierre.
- No hay comisiones ni deslizamiento, y el capital inicial es 1 000 000, que es el valor por defecto de `strategy()`.

`request.security`:

- **EMA de 15 min** (marco superior, `lookahead_off`): el valor cambia en la vela que cierra cada vela de 15 min.
- **EMA de 1 min** (marco inferior): toma el valor de la última vela de 1 min dentro de cada vela del gráfico.
  - Con datos de 1 min es **exacta**, y los datos de ejemplo son de 1 min, agregados a 5 min para el gráfico.
  - Con datos de 5 min se aproxima con una EMA de coeficiente equivalente; el chip superior indica cuál se usa.

## Uso

Abre `probadores/5-perces-bot-v2.3/index.html` en el navegador, con `engine.js` en la misma carpeta.

- **Datos de ejemplo:** 30 días sintéticos tipo BTCUSD en velas de 1 min.
- **CSV propio:** columnas `time, open, high, low, close`. Si subes datos de 1 min, el selector «Gráfico» agrega a 1, 5 o 15 min.
- **Pestaña «Filtros»:** para cada cruce del UT Bot, muestra qué filtro lo bloqueó primero y cuántas señales bloquea cada filtro por sí solo.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/5-perces-bot-v2.3.pine` | Script original de TradingView |
| `probadores/5-perces-bot-v2.3/engine.js` | Motor: UT trail, EMA, ADX, `request.security` 1/15 min, broker, datos de ejemplo y lector de CSV |
| `probadores/5-perces-bot-v2.3/index.html` | Interfaz: gráfico con EMA, trail, TP/SL, horario y ADX; embudo de filtros; operaciones; curva de capital |

## Observaciones sobre el script Pine

1. **El filtro EMA de 1 min es casi siempre redundante.** El cruce del UT Bot exige que el cierre supere un trail que estaba a 2,2 ATR. Tras ese movimiento, el cierre ya está al otro lado de una EMA de 21 minutos. En los datos de ejemplo no bloquea ninguno de ~450 cruces.
2. **La vela de entrada no tiene TP ni SL.** `strategy.exit` se coloca solo con `position_size != 0`, es decir, al cierre de la vela en la que se llenó la entrada.
3. **`hour(time)` usa la zona horaria del exchange,** no la del usuario. Las horas 3–15 cambian según el símbolo; el probador permite elegir la zona.
4. **El cierre diario se ejecuta en la apertura siguiente** (15:05 con velas de 5 min). Una señal a las 14:55 entra a las 15:00 y sale a las 15:05.
5. **La salida por EMA solo reacciona al cruce.** Si se entra con la EMA 21 ya por debajo de la EMA 200, esa salida no llega.
6. **Margen, comisiones y deslizamiento.** Con el 100 % del capital, la cantidad se calcula con el cierre y se compra en la apertura siguiente, así que puede superar el capital. TradingView podría aplicar una llamada de margen, y el probador no la simula. Sin comisiones ni deslizamiento, el resultado es optimista para un sistema de 5 min.

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/5-perces-bot-v2.3/engine.js"); console.log(E.run(E.makeSample(7,30)).stats)'
```
