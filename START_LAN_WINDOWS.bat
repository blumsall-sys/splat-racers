@echo off
setlocal
cd /d "%~dp0"
title Splat Racers v2.0.0 - LAN Host Experiment
where node >nul 2>nul
if errorlevel 1 (echo Node 22+ required. & pause & exit /b 1)
if not exist "node_modules\vite\bin\vite.js" (
 echo Installing dependencies for LAN host...
 call npm install --include=dev
 if errorlevel 1 (echo npm install failed. & pause & exit /b 1)
)
echo LAN host: http://localhost:3000/LAN.html
call npm run lan
pause
