# Calculadora DCA Liquidation Calculation [ChartPrime]

Calculadora en el navegador para el indicador Pine Script v5 «DCA Liquidation Calculation [ChartPrime]»,
guardado en `estrategias/dca-liquidation-chartprime.pine`.

## Qué hace el indicador

No opera ni da señales: solo dibuja dos tablas.

- **Precio de la orden base (BO):** el cierre diario de ayer del símbolo del input (`request.security(symbol, "D", close[1])`, BTCUSDT por defecto).
- **Escalera de safety orders (SO):** hasta 10.
  - Desviación acumulada: 2,2 % × escala de paso.
  - Tamaño: 300 × 1,5^(i−1), con una BO de 200.
- **Tabla principal, por orden:** tamaño, volumen (con y sin apalancamiento), precio, precio medio, «PNL», precio de liquidación y totales, coloreados según cartera (1000) × apalancamiento (10).
- **Tabla de estadísticas:** capital necesario (volumen / apalancamiento), valor máximo del trato, apalancamiento y cobertura máxima.

## Qué muestra la calculadora

- **Precio BO manual:** se escribe a mano, en vez de leer el cierre de ayer.
- **Tabla del script:** reproduce las dos tablas del script con sus colores.
- **Comprobación:** para cada orden muestra:
  - el PnL real de toda la posición;
  - la liquidación correcta en largo y en corto (margen cruzado, toda la cartera como garantía, 0,5 % de mantenimiento);
  - el capital disponible cuando el precio llega a la orden y el margen que necesita;
  - si la orden se llena de verdad.
- **Gráfico:** escalera de precios con el precio medio, las dos liquidaciones y las órdenes que no llegan.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/dca-liquidation-chartprime.pine` | Script original de TradingView |
| `probadores/dca-liquidation-chartprime/engine.js` | Motor: escalera DCA con los valores del script (redondeos incluidos) y la comprobación corregida |
| `probadores/dca-liquidation-chartprime/index.html` | Interfaz: parámetros, tabla del script, comprobación, gráfico de la escalera |

## Observaciones sobre el script Pine

1. **La liquidación en corto está mal.** `liq_balance()` usa siempre la fórmula de largo. En modo short da precios por debajo de la entrada.
   - Ejemplo por defecto en corto: el script da 60 488 tras la SO 6. Lo correcto es unos 81 926 (+26 % sobre la BO de 65 000).
2. **La columna «PNL» no es el PnL de la posición.** Solo usa la cantidad de la última SO: −571,74 en la SO 10, cuando la posición entera va −1615 en ese punto.
3. **Los colores dicen que hay margen cuando no lo hay.** Con los valores por defecto (cartera 1000, ×10, BO 65 000, largo):
   - Siete filas de SO salen en verde, pero solo se llenan 6 SO.
   - En la SO 7 el capital que queda (607) no cubre el margen (985), y con la 8 la posición se liquidaría antes de la 9.
   - La liquidación real con las 6 SO está en 49 712 (−23,5 %), frente a una cobertura «máxima» del 22 % que exigiría 3420 de capital.
4. **El apalancamiento no entra en la fórmula de liquidación** (margen cruzado con mantenimiento fijo del 0,5 %). Solo cambia colores y el capital necesario. Con margen aislado el resultado sería distinto.
5. **El precio de la BO es el cierre de ayer del símbolo del input,** pero las cabeceras usan la moneda del gráfico (`syminfo.currency`).
6. **Rendimiento.** Las tablas se crean en cada vela (sin `var` ni `barstate.islast`), y la de estadísticas otra vez en cada vuelta del bucle. Además, la fila 2 queda vacía y `color2` no se usa.

Comprobar el motor desde la terminal (número de SO que se llenan de verdad con los valores por defecto):

```sh
node -e 'const E=require("./probadores/dca-liquidation-chartprime/engine.js"); console.log(E.run(E.makeSample()).stats)'
```
