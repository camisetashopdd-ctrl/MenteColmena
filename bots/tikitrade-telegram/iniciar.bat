@echo off
chcp 65001 >nul
title TikiTrade - bot de Telegram
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Descargalo de https://nodejs.org ^(version LTS^) e instalalo. & pause & exit /b 1)
if not exist .env copy .env.ejemplo .env >nul
set "TOKEN="
findstr /r /c:"^TELEGRAM_TOKEN=[0-9]" .env >nul || set /p "TOKEN=Pega el token de @BotFather (clic derecho para pegar) y pulsa Enter: "
if defined TOKEN powershell -NoProfile -Command "$t=$env:TOKEN.Trim(); $c=Get-Content .env -Encoding UTF8; $c | ForEach-Object { if ($_ -like 'TELEGRAM_TOKEN=*') { 'TELEGRAM_TOKEN=' + $t } else { $_ } } | Set-Content .env -Encoding UTF8"
set "TOKEN="
findstr /r /c:"^TELEGRAM_TOKEN=[0-9]" .env >nul || (echo No se ha guardado el token. Vuelve a ejecutar iniciar.bat y pegalo. & pause & exit /b 1)
if not exist node_modules (echo Instalando dependencias, solo la primera vez... & call npm install --omit=dev || (pause & exit /b 1))
echo TikiTrade arrancando. Deja esta ventana abierta mientras quieras que el bot funcione.
echo Si sale "Telegram rechaza el TELEGRAM_TOKEN", borra el archivo .env y vuelve a ejecutar iniciar.bat.
node src\index.js
pause
