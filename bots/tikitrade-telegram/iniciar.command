#!/bin/bash
# TikiTrade · bot de Telegram (macOS y Linux). Deja esta ventana abierta mientras quieras que funcione.
cd "$(dirname "$0")" || exit 1
salir() { echo "$1"; read -r -p "Pulsa Enter para cerrar."; exit 1; }

NODE_V=22.23.3
export PATH="$PWD/node/bin:$PATH"
if ! command -v node >/dev/null; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  PLAT=darwin-arm64; SUM=23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53 ;;
    Darwin-x86_64) PLAT=darwin-x64;   SUM=8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8 ;;
    Linux-x86_64)  PLAT=linux-x64;    SUM=1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af ;;
    *) salir "Falta Node.js: descárgalo de https://nodejs.org (versión LTS) e instálalo." ;;
  esac
  echo "Descargando Node.js, solo la primera vez. Puede tardar un par de minutos..."
  mkdir -p node
  curl -L --fail -o node/node.tar.gz "https://nodejs.org/dist/v$NODE_V/node-v$NODE_V-$PLAT.tar.gz" || salir "No se pudo descargar Node.js. Revisa tu conexión a internet."
  echo "$SUM  node/node.tar.gz" | shasum -a 256 -c - >/dev/null 2>&1 || { rm -f node/node.tar.gz; salir "La descarga de Node.js llegó dañada. Vuelve a intentarlo."; }
  tar -xzf node/node.tar.gz -C node --strip-components=1 && rm node/node.tar.gz || salir "No se pudo descomprimir Node.js."
fi

[ -f .env ] || cp .env.ejemplo .env
if ! grep -q '^TELEGRAM_TOKEN=[0-9]' .env; then
  read -r -p "Pega el token de @BotFather y pulsa Enter: " TOKEN
  TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
  awk -v t="$TOKEN" '/^TELEGRAM_TOKEN=/ { print "TELEGRAM_TOKEN=" t; next } { print }' .env > .env.tmp && mv .env.tmp .env
  grep -q '^TELEGRAM_TOKEN=[0-9]' .env || salir "No se ha guardado el token. Vuelve a abrir este archivo y pégalo."
fi

[ -d node_modules ] || { echo "Instalando dependencias, solo la primera vez..."; npm install --omit=dev || salir "No se pudieron instalar las dependencias."; }
echo "TikiTrade arrancando. Deja esta ventana abierta mientras quieras que el bot funcione."
echo "Si sale \"Telegram rechaza el TELEGRAM_TOKEN\", borra el archivo .env y vuelve a abrir este archivo."
node src/index.js
read -r -p "El bot se ha parado. Pulsa Enter para cerrar."
