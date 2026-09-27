@echo off
chcp 65001 >nul
title TikiTrade - bot de Telegram
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Descargalo de https://nodejs.org ^(version LTS^) e instalalo. & pause & exit /b 1)
if not exist .env (copy .env.ejemplo .env >nul & echo Se ha creado el archivo .env. Abrelo con el Bloc de notas, pon tu TELEGRAM_TOKEN y vuelve a ejecutar este archivo. & notepad .env & pause & exit /b 0)
if not exist node_modules (echo Instalando dependencias, solo la primera vez... & call npm install --omit=dev || (pause & exit /b 1))
echo TikiTrade arrancando. Deja esta ventana abierta mientras quieras que el bot funcione.
node src\index.js
pause
