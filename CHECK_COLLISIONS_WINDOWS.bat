@echo off
cd /d "%~dp0"
title LAB5 Collision inspection
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js is not installed. Install Node.js and retry.
 pause
 exit /b 1
)
node scripts\check-collisions.mjs
if errorlevel 1 echo Collision inspection found issues. Please share the output.
pause
