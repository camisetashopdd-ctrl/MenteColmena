# TikiTrade · la liga de entrenadores en Telegram

El bot autónomo de MenteColmena (TikiTrade v3) funcionando de verdad, para muchos usuarios a la vez.

Cada persona que escribe al bot es un **entrenador**, identificado por su id de Telegram. Tiene:
- su **equipo**, con un nombre único;
- su **cartera**: demo con precios reales o, si el servidor lo permite, real con su propio exchange o wallet;
- sus **decisiones**: mercado, táctica, lado y riesgo.

Cada hora su equipo juega contra el mercado. Cada semana juega contra otro entrenador de su **división**, en una **liga** con clasificación, campeón, y ascensos y descensos.

## Cómo funciona la liga

- **Divisiones** de `EQUIPOS_POR_DIVISION` equipos (10). Los nuevos entran en la división más baja con sitio; si no hay, se abre una nueva por debajo.
- **Jornadas** de lunes a domingo (UTC). Todos contra todos por turnos (método del círculo); si una división es impar, cada semana descansa uno.
- **Partidos en R, no en dinero.** Gana quien más R neto suma en la semana. Cada R entero es un gol; si empatan a goles pero uno sacó al menos medio R más, gana por uno. Así cuentan las decisiones del entrenador y no cuánto arriesga: con un 2 % de riesgo se gana más dinero, pero no más puntos.
- **Victoria 3 puntos, empate 1.** Desempates: diferencia de goles, goles a favor y R total.
- **Temporadas** de `JORNADAS_POR_TEMPORADA` jornadas (4). Al final: campeón de Primera, y suben y bajan `ASCIENDEN` equipos (2) entre cada par de divisiones.
- **Cuentan todas las jugadas cerradas** del equipo, en demo y en real.

### Qué decide cada entrenador (`/equipo`)

| Decisión | Opciones |
|---|---|
| Mercado | `MERCADOS` (BTC, ETH, SOL, XRP, BNB, DOGE) |
| Táctica | **El Entrenador automático** (elige cada hora entre las cuatro y se queda en el banquillo si nada funciona), o una fija: Tiki-Taka, Contraataque, Catenaccio o Juego directo |
| Lado | Ambos, solo largos o solo cortos |
| Riesgo | 0,5 %, 1 %, 1,5 % o 2 % por jugada (o `/riesgo x`) |

Los datos y el motor se comparten: una descarga de velas por mercado y una pasada del motor por mercado y táctica, sirva a uno o a mil entrenadores.

## La tesorería de MenteColmena

Está **activada por defecto**; se desactiva con `TESORERIA=false`.

- **Fichas:** cada entrenador tiene un saldo de fichas. Al fichar recibe `FICHAS_BIENVENIDA` (50, es decir, 5 operaciones gratis para probar), una sola vez por usuario aunque se dé de baja y vuelva. Después las compra en Telegram con **Telegram Stars**: `/fichas`, paquetes de 100, 250 y 500 (`PAQUETES_FICHAS`), a 1 ficha = 1 ⭐ (`ESTRELLAS_POR_FICHA`).
- **Tarifa por operación aceptada:** cada operación que se abre de verdad cuesta `TARIFA_POR_OPERACION` fichas (10), en demo y en real (`TARIFA_EN_DEMO`, `TARIFA_EN_REAL`).
  - Si la orden falla, no se cobra.
  - Si el bot tiene que cerrar la operación porque el exchange rechazó el stop, se devuelve.
  - Sin fichas suficientes, el equipo no remata y el entrenador recibe un aviso (como mucho uno cada 12 horas).
- **Reparto de cada tarifa:** el `PORCENTAJE_CLUB` (50 %) va al **fondo de MenteColmena** y el resto al **bote de la división** del entrenador en esa temporada.
- **Premios:** al terminar la temporada, antes de ascensos y descensos, cada división reparte su bote entre sus primeros según `REPARTO_PREMIOS` (50 % / 30 % / 20 %), **en fichas**. Lo que no se reparte (redondeos, divisiones con menos equipos) pasa a la temporada siguiente. `/bote` muestra los botes en directo y cuánto se llevaría cada uno ahora.
- **Contabilidad:**
  - todas las cantidades se guardan en centésimas de ficha (enteros), así que cuadran al céntimo;
  - cada movimiento se apunta en `datos/movimientos.jsonl`: bienvenida, tarifa, devolución, compra, premio y regalo;
  - `/tesoreria` (solo el administrador) comprueba que lo que entró es igual a los saldos más el fondo del club más los botes.
- **Pagos con Stars:**
  - antes de cobrar, el bot comprueba que el paquete, el precio y el usuario coinciden; un pago manipulado se rechaza;
  - un mismo pago nunca suma dos veces;
  - `/reembolsar ID_DEL_PAGO` devuelve las Stars a través de Telegram y retira las fichas.
- **Las Stars del club** se acumulan en el saldo del bot y se retiran desde Telegram (@BotFather → el bot → *Balance*, vía Fragment), no desde el bot. Mínimo 1.000 Stars, y cada Star tiene que esperar 21 días desde que se recibió.

### ¿Cuánto vale una ficha?

| | Valor |
|---|---|
| 1 ficha | 1 Telegram Star |
| Precio para el entrenador | ≈ 0,02 $ por Star comprando en la app (algo menos en Fragment) |
| Lo que recibe el club al retirar | ≈ 0,013 $ por Star |
| Una operación (10 fichas) | ≈ 0,13 $ para el club |
| Un entrenador activo (10–20 operaciones al mes) | ≈ 1,3–2,6 $ al mes |

**Qué es dinero de verdad y qué no.** El dinero de verdad son las **Stars que compran los entrenadores**: van enteras al saldo del bot, es decir, al club. Las fichas son la moneda interna de la liga: no se pueden retirar ni cambiar por dinero. El reparto «50 % club / 50 % bote» es de fichas: el bote se devuelve en fichas a los ganadores, que así juegan gratis sus siguientes operaciones. Para el club, un premio es consumo que deja de cobrar, no dinero que sale.

Fuentes de las cifras de Stars: [Telegram Stars para desarrolladores](https://dev.to/starsearn/telegram-stars-economics-for-bot-developers-what-your-stars-are-actually-worth-in-2026-2742), [retirada y límites](https://adminhub.tools/blog/withdraw-telegram-stars/).

> Nota legal: cobrar por participar en una competición con premios puede estar regulado como juego en algunos países. Aquí los premios son fichas, que no se pueden cambiar por dinero. Si algún día se quieren dar premios en dinero, conviene consultarlo antes.

## Montar el servidor (unos 10 minutos)

1. **Instala Node.js** (versión LTS) desde https://nodejs.org.
2. **Crea el bot:** en Telegram, [@BotFather](https://t.me/BotFather) → `/newbot` → copia el token.
3. **Configura:** copia `.env.ejemplo` como `.env` y rellena `TELEGRAM_TOKEN` y `TELEGRAM_ADMIN_ID`. Tu id te lo da [@userinfobot](https://t.me/userinfobot). Si quieres una liga privada, rellena también `CODIGO_INVITACION`.
4. **Arranca:**

   | Sistema | Cómo |
   |---|---|
   | Windows | doble clic en `iniciar.bat` |
   | macOS | doble clic en `iniciar.command` |
   | Linux | `./iniciar.sh` |

5. **Invita** a los entrenadores: que abran tu bot y escriban `/start`.

Para que la liga funcione 24 horas, lo normal es un servidor o VPS:

```sh
docker build -t tikitrade .
docker run -d --restart unless-stopped --env-file .env -v "$PWD/datos:/app/datos" tikitrade
```

Todo el estado se guarda en `datos/`: un archivo por entrenador en `datos/equipos/` y la liga en `datos/liga.json`. Sobrevive a los reinicios. Haz copia de esa carpeta.

## Comandos

| Comando | Qué hace |
|---|---|
| `/start` | Fichar el equipo (con código de invitación si lo hay) o volver al menú |
| `/estado` | Marcador en R, puesto en la liga, cartera, qué ve el Entrenador y la jugada abierta |
| `/equipo` | La pizarra: mercado, táctica, lado y riesgo, con botones |
| `/entrenador` | Rival detectado, táctica, lado, partidos en la sombra y qué jugador corta la jugada |
| `/jugadas` | Últimas jugadas cerradas |
| `/liga` · `/jornada` · `/divisiones` | Clasificación de tu división, partidos de la semana en directo y resumen de todas |
| `/marcha` · `/pausa` | Buscar jugadas o dejar de abrir nuevas. Las abiertas siguen con su stop |
| `/demo` · `/real` | Cambiar de modo, solo sin jugada abierta. El real pide escribir `CONFIRMO DINERO REAL` |
| `/conectar` · `/desconectar` | Conectar o quitar el exchange o la wallet propios |
| `/riesgo 1` · `/capital 10000` · `/cerrar` · `/reanudar` · `/avisos` · `/baja` | Riesgo, reiniciar la demo, cerrar ya, quitar el freno, avisos y darse de baja |
| `/fichas` · `/bote` | Saldo, tarifa, últimos movimientos y recarga con Telegram Stars · botes y premios de la temporada |
| `/admin` · `/anuncio texto` | Solo el administrador: estado del servidor y mensaje a todos |
| `/tesoreria` · `/regalar ID FICHAS` · `/reembolsar ID_DEL_PAGO` | Solo el administrador: cuentas del club, regalar fichas y devolver una compra |

Avisos que llegan solos a cada entrenador:
- remates, goles y goles encajados;
- cambios del Entrenador;
- frenos de seguridad y problemas;
- resumen diario, si hubo partido;
- el resultado de cada jornada, su puesto, los ascensos y descensos y el campeón.

## Modo real

El modo real está desactivado por defecto (`PERMITIR_REAL=false`): la liga se juega entera en demo. Para activarlo:

1. Pon `PERMITIR_REAL=true` y una `CLAVE_MAESTRA` larga en `.env`.
2. Cada entrenador conecta **su propio** exchange o wallet con `/conectar`:

   ```
   /conectar binanceusdm CLAVE SECRETO
   /conectar bybit CLAVE SECRETO
   /conectar okx CLAVE SECRETO PASSPHRASE
   /conectar hyperliquid DIRECCION CLAVE_PRIVADA_DE_LA_API_WALLET
   ```

   Si se añade `testnet` al final, usa la red de pruebas del exchange.
3. El bot **borra el mensaje al instante**, prueba la conexión y guarda las claves **cifradas** (AES-256-GCM con la `CLAVE_MAESTRA`). Nunca las muestra ni las escribe en claro en el disco.

Recomendaciones para cada entrenador:
- **Clave API solo de trading, sin permiso de retiro.** En Hyperliquid, una **API wallet** (app.hyperliquid.xyz → More → API): puede operar pero no retirar. Nunca la clave de la wallet principal.
- **Cuenta de futuros en modo unidireccional** (*one-way*).
- Aunque el bot borre el mensaje, las claves pasan por Telegram. Ante cualquier duda: borrarlas en el exchange y crear otras.

En Hyperliquid, el bot desactiva la comisión extra que ccxt añade por defecto y no toca el referido de la cuenta.

### ¿Y la Wallet de Telegram?

La Wallet de Telegram (@wallet) es una cartera **custodial**: no hay ninguna API para que un bot opere con ella. Su única API, *Wallet Pay*, sirve para que un comercio cobre pagos. Su parte autocustodiada (la cuenta DeFi o TON Space) firma cada operación a mano, así que un bot no puede operar solo con ella.

**Cómo usarla con el bot:** cada entrenador envía USDT desde su Wallet de Telegram a su cuenta del exchange y el bot opera allí. Antes de enviar hay que comprobar que la red elegida (TON, TRON…) coincide en los dos lados.

### Operar con dinero de otros

Si abres el modo real a otras personas, **tu servidor guarda sus claves y ejecuta órdenes en sus cuentas**. Eso implica una responsabilidad técnica: seguridad del servidor, copias de `datos/` y custodia de la `CLAVE_MAESTRA`. También puede implicar una responsabilidad legal: en muchos países, gestionar o automatizar inversiones de terceros es una actividad regulada. Infórmate antes de activarlo para otros. Lo más sencillo es jugar la liga en demo y que cada uno use el modo real en su propio servidor.

## Seguridad

- **Stop desde la entrada, en el propio exchange.** Si el exchange lo rechaza, la posición se cierra al momento y se avisa. Al moverlo, primero se crea el nuevo y después se cancela el viejo. Al acabar cada jugada se limpian los stops propios; nunca se tocan órdenes ajenas.
- **Frenos automáticos por entrenador:**
  - pérdida diaria (3 %): sin jugadas nuevas hasta el día siguiente;
  - drawdown (15 %): frenado hasta `/reanudar`;
  - tope de riesgo del 2 % en real;
  - descanso de 10 velas tras dos encajados seguidos.
- **Cada usuario solo ve y maneja su equipo.** El modo real pide confirmación escrita, y no se puede cambiar de modo ni de mercado con una jugada abierta.
- **Remate una sola vez por vela:** si una orden falla, no se reintenta cada 20 segundos.
- **Mensajes:** los envíos a Telegram van en cola, respetando sus límites. Si alguien bloquea el bot, deja de recibir avisos.

**Aviso:** los resultados del probador son con datos sintéticos. Ningún bot garantiza beneficios, y con dinero real se puede perder.

## Pruebas

`npm test` (sin red, unos 2 minutos). `SOLO=liga npm test` pasa solo las pruebas cuyo nombre contiene «liga».

- **Motor:** es idéntico al del probador.
- **En vivo contra el backtest:** un entrenador vive un mercado sintético hora a hora, en demo y en real contra un exchange simulado. Repite el 100 % de las jugadas del backtest (26 de 26) y solo añade una al arrancar. En real, sin stops huérfanos y con las claves cifradas en disco.
- **Seguridad en real:**
  - stop rechazado → cierre y aviso;
  - contratos de 0,01 BTC (tipo OKX);
  - freno de pérdida diaria.
- **Liga:** emparejamientos (6 equipos en 5 jornadas cubren los 15 cruces) y marcador. Una temporada completa con 6 entrenadores y tácticas distintas en 2 divisiones: jornadas, resultados que cuadran con el R de cada equipo, campeón, un ascenso y un descenso, y tabla reiniciada.
- **Telegram con varios usuarios:**
  - fichaje con código de invitación y nombres únicos;
  - pizarra con botones, estado, liga y jornada;
  - `/conectar` borra el mensaje y no deja las claves en claro;
  - confirmación del modo real;
  - administración solo para el admin, y bajas.
- **Tesorería:**
  - en una temporada simulada con 6 entrenadores, cada operación aceptada cobra exactamente su tarifa y el club recibe su porcentaje;
  - sin fichas no se remata, y se avisa;
  - los premios se reparten por división y las cuentas cuadran;
  - compra con Stars completa: factura en XTR, confirmación de Telegram, rechazo de un precio manipulado y del pago de otro usuario, abono sin duplicados, devolución y panel del administrador.
- **Peticiones reales de ccxt** a Binance, Bybit e Hyperliquid.

**No se ha podido probar desde aquí** la conexión real con Telegram y con los exchanges, porque este entorno no tiene salida a esas webs. Por eso: demo, testnet y poco dinero, en ese orden.

## Archivos

| Archivo | Qué es |
|---|---|
| `src/index.js` | Arranque del servidor, cola de mensajes y conexión con cada exchange |
| `src/app.js` | El club: todos los equipos, la liga y el reloj |
| `src/team.js` | El equipo de un entrenador: decisiones, posición, frenos, modo real |
| `src/league.js` | Divisiones, jornadas, clasificación, ascensos y descensos |
| `src/treasury.js` | La tesorería: fichas, tarifa por operación, fondo del club, botes y premios, registro de movimientos |
| `src/hub.js` | Datos de mercado y pasadas del motor compartidas |
| `src/engine.js` | El motor v3 del probador, idéntico |
| `src/brokers/paper.js`, `src/brokers/exchange.js` | Bróker demo (precios reales) y real (ccxt, stops en el exchange) |
| `src/telegram.js`, `src/format.js` | Comandos, botones y mensajes |
| `src/store.js`, `src/secret.js`, `src/config.js`, `src/util.js` | Estado en disco, cifrado de claves, configuración y utilidades |
| `test/` | Pruebas, exchange simulado y liga simulada |
