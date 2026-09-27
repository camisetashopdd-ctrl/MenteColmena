# Probador Bot Webhook v8.4 [SOL]

Probador en el navegador para el indicador Pine Script v5 «Bot Webhook v8.4 [SOL]» (SOLUSD, Kraken Futures),
guardado en `estrategias/bot-webhook-v8.4-sol.pine`.

## Qué hace el indicador

No opera. Envía alertas JSON (`alert()`) a un bot externo:

- **LONG / SHORT v7.3:** RSI, pendiente del RSI (5 velas), Stoch RSI K y ADX máximo. Los umbrales son distintos en cada marco: 30S, 45S y de 1 a 20 min. En total son 176 umbrales, con interruptores por marco.
- **Squeeze SHORT:** las Bollinger salen del Keltner y además el momentum MACD es bajista, el precio se ha movido > 0,1 % en 3 velas, el volumen supera 1,2 × la media y el RSI es > 25.
- **Régimen:** `WEAK_TREND_UP` (precio sobre la EMA 200 sin EMA ordenadas) bloquea todas las señales. El régimen de volatilidad (ADX y percentil del ATR) modifica la confianza.
- **Confianza:** se envía la alerta si es ≥ 0,70.
- **Contenido de la alerta:** SL/TP = 1,5/2,5 ATR (1,2/3,0 en el Squeeze) y unos 20 campos de metadatos.

## Qué muestra el probador

- El gráfico con las EMA 200/50/20, las Bollinger, el Keltner y el fondo de régimen.
- Las marcas LONG, SHORT y Squeeze, incluidas las señales que no se envían.
- Un panel con RSI y Stoch K y la tabla de información del script.
- **Alertas:** cada alerta con su resultado (si el precio toca antes el TP o el SL, desde la vela siguiente) y el JSON exacto que recibiría el bot.
- **Filtros:** el embudo de condiciones de LONG, SHORT y Squeeze.
- **Todos los marcos:** los mismos datos agregados a los 22 marcos del script (y a 25/30/60 min), con el número de alertas y el % de TP de cada uno, junto al «WR» que anuncia el script.
- **Datos:** sintéticos tipo SOLUSD en velas de 15 s (10, 20 o 30 días), o un CSV propio con volumen. Un CSV de 1 min no permite los marcos 30S y 45S.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/bot-webhook-v8.4-sol.pine` | Script original de TradingView |
| `probadores/bot-webhook-v8.4-sol/engine.js` | Motor: indicadores, umbrales por marco, squeeze, régimen, confianza, JSON de la alerta, evaluación TP/SL, datos de ejemplo y lector de CSV |
| `probadores/bot-webhook-v8.4-sol/index.html` | Interfaz |

## Observaciones sobre el script Pine

1. **Los «100 % WR» salen de muestras diminutas.** Los comentarios dicen que se ajustó con 136 señales, unas 3 por marco y lado, para 176 umbrales. Es sobreajuste casi seguro.
   - Con los datos de ejemplo (semilla 7, 10 días), los marcos de 1–5 min dan 24–67 alertas LONG con un 17–34 % de TP antes que SL. El equilibrio con R:R 2,5/1,5 está en el 37,5 %.
   - Los marcos altos dan 0–4 alertas en 10 días, demasiado pocas para medir nada.
2. **El bloqueo WEAK_TREND_UP también anula los cortos,** pero en STRONG_TREND_UP sí se permiten (con −0,10 de confianza).
3. **Marcas sin alerta.** El `plotshape` del Squeeze SHORT no mira el bloqueo WEAK_UP y usa la confianza guardada (`var float`) de la última señal. Puede dibujar rombos sin que se envíe nada.
4. **Si LONG y SHORT (Squeeze) coinciden en la misma vela,** la confianza del corto sobrescribe la del largo y `signal_type` dice «LONG_V73» también en la alerta corta.
5. **Alertas repetidas.** La condición suele cumplirse varias velas seguidas y cada una envía otra alerta. En 1–5 min, entre un 20 % y un 40 % de las alertas repiten la de la vela anterior.
6. **El filtro ADX (ADX < 35–60) casi nunca actúa.**
7. **Marcos fuera de la lista** (25 min, 30 min, 1 h…): no hay señales base, solo el Squeeze SHORT, y la tabla muestra los umbrales de 20 min.
8. **30S y 45S** requieren un plan de TradingView con marcos de segundos.

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/bot-webhook-v8.4-sol/engine.js"); const r=E.run(E.makeSample(7,10)); console.log(r.stats)'
```
