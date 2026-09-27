# Probador Bot Webhook v8.4 [BTC]

Probador en el navegador para el indicador Pine Script v5 «Bot Webhook v8.4 [BTC]» (BTCUSD, Kraken Futures),
guardado en `estrategias/bot-webhook-v8.4-btc.pine`.

## Es el mismo script que la versión [SOL]

Comparado línea a línea con `estrategias/bot-webhook-v8.4-sol.pine`, solo cambian 6 líneas:

- la cabecera (`BTC/USD`, `BTCUSD`);
- el título del indicador (`[BTC]`);
- el símbolo del JSON de las dos alertas (`"BTCUSD"`);
- la primera celda de la tabla (`v8.4 BTC`).

Los 176 umbrales por marco, los interruptores, los «WR esperados», la confianza y el squeeze son idénticos. La cabecera cita el mismo análisis de 136 señales. Es decir, nada se ha ajustado a BTC, aunque el comentario diga «Symbol-spezifisch».

Tampoco se puede trasladar la «$20-Rate» de la cabecera: 20 $ son un 0,03 % en BTC y un 14 % en SOL.

La descripción completa del funcionamiento está en `probadores/bot-webhook-v8.4-sol/LEEME.md`. Este probador es el mismo con dos cambios: el símbolo del JSON (`BTCUSD`) y datos de ejemplo tipo BTCUSD (velas de 15 s alrededor de 65 000).

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/bot-webhook-v8.4-btc.pine` | Script original de TradingView |
| `probadores/bot-webhook-v8.4-btc/engine.js` | Motor (el de SOL con símbolo BTCUSD y datos tipo BTC) |
| `probadores/bot-webhook-v8.4-btc/index.html` | Interfaz: gráfico, alertas con su JSON y resultado TP/SL, filtros, comparación de los 22 marcos |

## Observaciones sobre el script Pine

Son las mismas que en la versión [SOL]:

- sobreajuste con «100 % WR» sacados de muestras diminutas;
- el bloqueo WEAK_UP también anula los cortos;
- marcas de Squeeze sin alerta;
- confianza sobrescrita cuando coinciden LONG y SHORT;
- alertas repetidas en velas seguidas;
- filtro ADX casi inactivo;
- marcos fuera de la lista sin señales base.

Con los datos de ejemplo tipo BTC (semilla 7, 10 días):

- Hay 453 alertas entre los 22 marcos.
- En 5 min, 2 de 53 alertas LONG tocan el TP antes que el SL, y 26 alertas repiten la de la vela anterior.

Son datos sintéticos, así que sirven para ver cómo se comporta la lógica, no para juzgar el sistema. Para eso hay que cargar un CSV real.

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/bot-webhook-v8.4-btc/engine.js"); const r=E.run(E.makeSample(7,10)); console.log(r.stats)'
```
