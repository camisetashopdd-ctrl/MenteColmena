# Probador AI Bot Regime Feed

Probador en el navegador para el indicador Pine Script v6 «AI Bot Regime Feed (v6) — stable»,
guardado en `estrategias/ai-bot-regime-feed.pine`.

## Qué hace el indicador

No opera. Al cierre de la vela envía un JSON con `alert()`:

- **BUY:** la EMA 12 cruza hacia arriba la EMA 35 **y** el RSI 14 está por debajo de 40.
- **SELL:** la EMA 12 cruza hacia abajo la EMA 35 **y** el RSI 14 está por encima de 60.
- **Régimen:**
  - «bullish»: EMA 12 > EMA 35 y RSI > 45;
  - «bearish»: EMA 12 < EMA 35 y RSI < 55;
  - «choppy»: en cualquier otro caso.
- **Confianza:** 0,85 + (ADX − 20) × 0,005 − (ATR/precio − 0,01) × 2, limitada entre 0,50 y 0,99. El ADX se calcula a mano.
- **Gráfico:** dibuja las dos EMA y el ADX sobre el precio.

## Qué muestra el probador

- El gráfico con las EMA, el fondo de régimen y **todos** los cruces: rellenos si envían alerta, huecos si el filtro RSI los bloquea.
- Un panel con el RSI y el ADX.
- Una opción para dibujar el ADX sobre el precio, como hace el script.
- **RSI en los cruces:** histograma del RSI en cada cruce alcista y bajista, con la zona que deja pasar el filtro.
- **Cruces:** tabla con RSI, si pasa o no, régimen, confianza, ADX y rendimiento a H velas.
- **JSON:** la alerta que se enviaría.
- **Parámetros:** umbrales editables (filtro, régimen, longitudes) para ver cuándo empezaría a haber señales.
- **Datos:** 26 semanas sintéticas tipo BTCUSD 1 h, o un CSV propio.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/ai-bot-regime-feed.pine` | Script original de TradingView |
| `probadores/ai-bot-regime-feed/engine.js` | Motor: EMA, RSI, ATR, ADX manual, régimen, confianza, cruces, JSON, datos de ejemplo y lector de CSV |
| `probadores/ai-bot-regime-feed/index.html` | Interfaz |

## Observaciones sobre el script Pine

1. **El filtro RSI casi nunca deja pasar un cruce.** Un cruce alcista de EMA llega después de una subida, con el RSI normalmente por encima de 50, y el script pide RSI < 40. En la venta pasa lo mismo al revés.
   - Datos de ejemplo, 10 semillas × 26 semanas: el RSI en un cruce alcista nunca bajó de 49,8 y en uno bajista nunca pasó de 50,5.
   - Resultado: **0 alertas** en más de 1000 cruces.
2. **El campo «regime» de la alerta siempre sería «choppy».** Una BUY exige RSI < 40 con la EMA rápida arriba, así que no puede ser «bullish» (que pide RSI > 45) ni «bearish». Con SELL pasa lo mismo.
3. **«confidence» no es una probabilidad.** Es una fórmula fija que casi siempre sale entre 0,80 y 0,99.
4. **El ADX (0–100) se dibuja sobre el precio** (`overlay=true`). En BTC aplasta el gráfico.
5. **El JSON puede no ser válido:**
   - `str.tostring()` escribe `NaN` si el ADX aún no existe (primeras ~28 velas).
   - `ts` es la hora de apertura de la vela, aunque la alerta sale al cierre.
   - `alert.freq_once_per_bar_close` evita el repintado, lo cual está bien.

Comprobar el motor desde la terminal (número de alertas: 0 con los datos de ejemplo):

```sh
node -e 'const E=require("./probadores/ai-bot-regime-feed/engine.js"); console.log(E.run(E.makeSample(7,26)).stats)'
```
