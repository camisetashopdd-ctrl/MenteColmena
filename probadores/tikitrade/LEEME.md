# TikiTrade v3 (bot autónomo)

El bot propio de MenteColmena. Estrategia en Pine Script v6 (`estrategias/tikitrade.pine`)
y probador en el navegador con interfaz de partido de fútbol: cada herramienta es un jugador que tiene que
pasar el balón al siguiente para llegar al gol, es decir, cerrar la operación en verde.

## El equipo

| # | Jugador | Puesto | Herramienta | Qué pide para pasar el balón |
|---|---|---|---|---|
| 1 | El Muro | Portero | Riesgo y descanso | Sin posición abierta, sin descanso por racha de pérdidas (2 seguidas → 10 velas), lado permitido |
| 4 | La Roca | Central | Tendencia | EMA 50 > EMA 200, cierre > EMA 200 y EMA 200 subiendo en 20 velas (en corto, al revés) |
| 3 | El Motor | Lateral | Fuerza | ADX 14 ≥ 25 (umbral clásico de Wilder) |
| 8 | El Cerebro | Mediocentro | Pausa | El RSI 14 bajó a 45 o menos en las últimas 5 velas (en corto, subió a 55 o más) |
| 10 | El Termómetro | Mediapunta | Volatilidad | Percentil del ATR/precio en 100 velas entre 10 y 90 |
| 7 | La Chispa | Extremo | Volumen | Volumen ≥ 0,9 × media de 20 (no juega si los datos no tienen volumen) |
| 9 | El Killer | Delantero | Gatillo y definición | Cierre > máximo anterior, > EMA 20 y vela alcista; en el Juego directo, cierre > máximo de las 48 velas anteriores (en corto, en espejo) |

**Remate y salida:**
- La entrada es a mercado en la apertura siguiente, con el **stop (2 ATR)** ya colocado: protege desde la misma vela de entrada.
- La posición entera corre con el trailing chandelier (3 ATR desde el extremo), hasta que salta o hasta que se rompe la tendencia de fondo: la EMA 50 cruza la EMA 200 o el cierre cruza la EMA 200.
- Hay un TP1 parcial opcional (`tp1Pct`), apagado por defecto. En el estudio v3, cobrar la mitad a 1,5 R recortaba justo las jugadas que pagan el partido.

**Costes y tamaño:**
- Se arriesga el 1 % de la cuenta por operación.
- Comisión del 0,05 % por lado y deslizamiento del 0,02 % en el probador. En Pine, el deslizamiento se ajusta en Propiedades.

**Tácticas:**
- **Tiki-Taka:** la de por defecto.
- **Contraataque:** sin esperar la pausa y con ADX 20; más remates, sufre en mercado lateral.
- **Catenaccio:** ADX 30 y RSI 40; muy pocos remates.
- **Juego directo (v3):** ruptura del máximo o mínimo de 48 velas (el canal de Donchian de las tortugas), sin pausa y con ADX 20. Sola se hunde en lateral; el Entrenador la alinea solo cuando va bien.

## El Entrenador: el bot decide solo

En cada vela, y usando solo datos pasados, el Entrenador hace tres cosas:

1. **Ojea al rival.** Clasifica el mercado:
   - **volátil** si el ATR/precio está en el percentil ≥ 80 de las últimas 500 velas;
   - **tendencia alcista o bajista** si la EMA 50 está a ≥ 2,5 ATR de la EMA 200, la eficiencia de Kaufman (100 velas) es ≥ 0,08 y el precio está del lado de la tendencia;
   - **lateral** si la distancia es < 1,5 ATR y la eficiencia < 0,08;
   - **transición** en cualquier otro caso.
2. **Elige la táctica.** Juega en la sombra, sin dinero, las cuatro tácticas. Alinea la que más R ha sumado en los últimos 30 días (720 velas de 1 h, con al menos 3 jugadas). Si ninguna va en positivo, no juega.
3. **Elige el lado:**
   - solo largos en tendencia alcista, solo cortos en bajista, banquillo en lateral y los dos lados en volátil o transición;
   - además (v3), el lado se gana en la sombra: si con la táctica elegida los largos (o los cortos) van en negativo en la ventana, ese lado no juega.

## El último repaso (v3)

Objetivo: más autónomo y más rentable, sin engañarnos. Los 360 mercados sintéticos se partieron en tres grupos que no se mezclan: **ajuste** (semillas 1–24), **validación** (25–48) y **examen** (49–72). Cada grupo son 120 partidos: 5 rivales × 24 semillas de 26 semanas. El examen se jugó una sola vez, al final.

| Equipo | Ajuste | Validación | Examen | Lateral (examen) | Drawdown (examen) | En positivo (examen) |
|---|---|---|---|---|---|---|
| Tiki-Taka fija | −0,27 % | +0,43 % | +0,42 % | −2,70 % | 4,4 % | 58/120 |
| Contraataque fija | −0,61 % | −2,88 % | −2,30 % | −32,79 % | 18,6 % | 60/120 |
| Catenaccio fija | −0,06 % | +0,10 % | +0,42 % | −0,17 % | 1,6 % | 44/120 |
| Juego directo fija | +0,91 % | −0,91 % | −0,26 % | −18,66 % | 12,6 % | 61/120 |
| Entrenador v2 | +1,48 % | +0,53 % | +0,89 % | −1,21 % | 6,7 % | 45/120 |
| **Entrenador v3** | **+3,85 %** | **+3,41 %** | **+3,27 %** | −1,02 % | 7,0 % | 57/120 |

**Qué cambió:**
- **Sin TP parcial.** Es el cambio que más aporta: de +1,48 a +3,72 % en ajuste y de +0,53 a +3,00 % en validación.
- **Cuarta táctica, el Juego directo.** Suma +0,25 en ajuste y +0,49 en validación.
- **El lado se gana en la sombra.** La media queda igual y el drawdown baja de 7,2 a 6,6 % en ajuste y de 7,3 a 6,6 % en validación.

**Qué se descartó**, porque no aguantó en validación:
- el riesgo según la confianza del Entrenador;
- un freno de riesgo tras un 5–8 % de drawdown (baja el drawdown y el beneficio en la misma proporción);
- el breakeven a 1 R;
- cambiar la ventana del Entrenador o los umbrales del ojeador.

La rejilla de stop (1,5–3 ATR) × trailing (2,5–4 ATR) da entre +2 y +4 % en todas sus casillas. Es una meseta, no un pico, así que se mantienen los valores de manual: 2 y 3 ATR.

El Entrenador gana en los mercados con tendencia y en los volátiles, casi no juega en lateral y sufre en la liga mixta. En Tendencia FC, comprar y mantener gana muchísimo más, pero pierde lo mismo en Real Bajista.

**Pine:** el Entrenador está dentro de la estrategia. Tiene cuatro objetos `Shadow` que simulan cada táctica en R, un ojeador y la decisión por vela. Se puede pasar a modo manual desde los inputs. El R de las sombras en Pine es una aproximación, con la comisión restada en R, del que calcula el probador.

## Cómo se eligió (primera versión)

TradingView bloquea el acceso desde el entorno de trabajo. El estudio parte de los 14 scripts de la sección «bot» analizados en MenteColmena (paquetes 01–14) y de una búsqueda web. Se ficharon las ideas que funcionaban y se evitaron los errores medidos:

- vela de entrada sin stop (01, 08);
- TP cobrado al cierre (12);
- rejillas y DCA sin stop (07, 12);
- 176 umbrales sobreajustados (10, 11);
- filtros que se contradicen (14) o redundantes (08);
- sin comisiones.

Los valores son de manual, no optimizados. Se probaron 16 variantes en 120 mercados sintéticos (5 tipos × 24 semillas × 26 semanas). Quitar cualquiera de los tres jugadores clave empeora la media:

| Variante | Media por partido |
|---|---|
| Alineación elegida | −0,52 % |
| Sin tendencia | −5,06 % |
| Sin ADX | −4,94 % |
| Sin pausa | −2,13 % |

En el calendario del probador (media de 8 semillas por rival), el Tiki-Taka gana a Liga Mixta (+0,52 %), Tendencia FC (+2,22 %) y Volátil CF (+1,86 %), empata con Real Bajista y pierde con Lateral United (−2,35 %).

**Aviso:** los datos sintéticos son un paseo aleatorio con rachas de tendencia, y esas rachas son justo lo que aprovecha un bot de tendencia. Que gane aquí no demuestra que gane en un mercado real. El examen real es con un CSV de datos reales, mirando la «liga» (fuera de muestra) y probando en papel. Ningún bot garantiza beneficios.

## El probador

- **Marcador:** cuenta dinero, no operaciones. Cada gol es 1 R ganado; cada gol del Mercado es 1 R perdido. Con un 1 % de riesgo por jugada, 1 R ≈ 1 % de la cuenta. Un remate de +3,2 R son 3 goles y un stop de −1 R es un gol encajado. El resultado (Victoria, Empate o Derrota) sale de ese marcador. Aparte se muestran las operaciones en verde y en rojo, y el beneficio neto.
  - Por qué: un bot de tendencia acierta solo 1 de cada 3 operaciones, pero gana más en cada acierto. Si el marcador contara operaciones, perdería casi todos los partidos aunque ganara dinero. Con el marcador antiguo, el Entrenador «ganaba» 1 partido de cada 40.
  - Con el marcador en R, victorias, empates y derrotas del Entrenador (semillas 1–40 por rival, 26 semanas):

    | Rival | v2 | v3 |
    |---|---|---|
    | Liga Mixta | 11 – 3 – 26 | 15 – 3 – 22 |
    | Tendencia FC | 18 – 2 – 20 | 29 – 1 – 10 |
    | Real Bajista | 21 – 3 – 16 | 26 – 2 – 12 |
    | Lateral United | 0 – 25 – 15 | 1 – 25 – 14 |
    | Volátil CF | 18 – 1 – 21 | 22 – 1 – 17 |

    En Lateral United casi no juega. El partido de ejemplo (semilla 7, Liga Mixta) es de los malos: −8 % en la v2 y −5,8 % en la v3.
- **El Entrenador:** automático (por defecto) o manual. Su panel muestra el rival detectado (y el real en datos sintéticos), la táctica, el lado y el marcador de los partidos en la sombra (total, largos y cortos), con una línea de tiempo de todas sus decisiones.
- **Campo y narración:** reproducen la jugada seleccionada pase a pase. Al pasar el ratón por el gráfico, el campo muestra dónde se perdió el balón en esa vela.
- **Estadísticas del partido y curva de capital** («marcador acumulado»).
- **Repetición:** gráfico con EMA, remates, goles y goles encajados.
- **Pestañas:**
  - **Jugadas:** tabla de operaciones.
  - **Alineación:** parámetros por jugador y prueba de banquillo (el partido sin cada jugador).
  - **Pretemporada:** 64 alineaciones (stop × trailing × ADX) entrenadas en el 60 % inicial y evaluadas en el 40 % final.
  - **Calendario:** 4 tácticas y el Entrenador × 5 rivales × 8 semillas.
  - **Estudio** y **Código Pine**.
- **Datos:** mercados sintéticos tipo BTC 1 h (Liga Mixta, Tendencia FC, Real Bajista, Lateral United, Volátil CF) o un CSV propio con al menos 300 velas.

## Archivos

| Archivo | Contenido |
|---|---|
| `estrategias/tikitrade.pine` | Estrategia para TradingView |
| `probadores/tikitrade/engine.js` | Motor: ojeador, partidos en la sombra y decisiones del Entrenador, indicadores, cadena de pases, broker con stop (y TP1 opcional) desde la vela de entrada, trailing, costes, tácticas, pretemporada, prueba de banquillo, datos de ejemplo y lector de CSV |
| `probadores/tikitrade/index.html` | Interfaz |

Comprobar el motor desde la terminal:

```sh
node -e 'const E=require("./probadores/tikitrade/engine.js"); console.log(E.run(E.makeSample(7,26), {coach: true}).stats)'
```
