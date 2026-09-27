#!/usr/bin/env bash
# TikiTrade · bot de Telegram (Linux y macOS). Deja la terminal abierta mientras quieras que funcione.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Falta Node.js: descárgalo de https://nodejs.org (versión LTS)."; exit 1; }
if [ ! -f .env ]; then cp .env.ejemplo .env; echo "Se ha creado .env: ábrelo, pon tu TELEGRAM_TOKEN y vuelve a ejecutar ./iniciar.sh"; exit 0; fi
[ -d node_modules ] || npm install --omit=dev || exit 1
exec node src/index.js
