# Probador Continuous Market Grid bot

Probador en el navegador para la estrategia Pine Script v6 guardada en
`estrategias/market-grid-bot.pine`.

## Qué hace la estrategia

Reparte `Number of Grids` líneas entre `Lower Price Limit` y `Upper Price Limit` (por defecto
20 líneas entre 4200 y 4600, paso 21,05). Cada línea salvo la superior es un nivel de compra:

- **Compra** 0,1 unidades cuando una vela baja hasta el nivel (mínimo ≤ nivel y máximo anterior ≥ nivel)
  y ese nivel no tiene compra abierta.
- **Vende** esa compra cuando una vela sube hasta la línea siguiente.
- **Stop loss** opcional (desactivado): con el cierre bajo el precio de stop cierra todo y se detiene
  hasta que el precio vuelve a la rejilla.

## Cómo simula

Igual que el emulador de TradingView con los ajustes del script: el script se evalúa al cierre, las
órdenes son a mercado y se ejecutan en la apertura siguiente, `pyramiding = 200`,
`close_entries_rule = "ANY"`, comisión del 0,035 % en cada ejecución y capital de 10 000.
No se simulan las liquidaciones por margen; el probador muestra la exposición máxima.

## Uso

Abre `probadores/market-grid-bot/index.html` en el navegador (con `engine.js` en la misma carpeta).
Carga 20 semanas de datos sintéticos tipo XAUUSD 1 h alrededor de 4400 o un CSV propio
(`time, open, high, low, close`). Con otro activo, el botón **"Ajustar la rejilla a los datos"**
coloca los límites en los percentiles 10 y 90 de los cierres.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/market-grid-bot.pine` | Script original de TradingView |
| `probadores/market-grid-bot/engine.js` | Motor: rejilla, órdenes a mercado, comisiones, stop, datos de ejemplo y lector de CSV |
| `probadores/market-grid-bot/index.html` | Interfaz: gráfico con la rejilla y niveles comprados, tabla por nivel, operaciones, curva |

## Observaciones sobre el script Pine

1. Las compras y ventas son órdenes a mercado en la apertura siguiente, no al precio del nivel:
   la ganancia de cada ciclo no es exactamente un paso y puede ser negativa.
2. El % de acierto de los ciclos cerrados es muy alto, pero si el precio sale de la rejilla por abajo
   los niveles comprados quedan abiertos con pérdida. Sin stop (por defecto) esa pérdida no tiene límite.
3. La línea superior no compra: con 20 líneas hay 19 niveles de compra.
4. Si el precio de stop está dentro de la rejilla, el bot se reactiva y se vuelve a detener en cada vela
   mientras el cierre siga por debajo del stop.

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/market-grid-bot/engine.js"); console.log(E.run(E.makeSample(7,20)).stats)'
```
