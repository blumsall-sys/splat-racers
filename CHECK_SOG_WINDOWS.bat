@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title LAB5 SOG Asset Check
where npm.cmd >nul 2>nul
if errorlevel 1 (
 echo ERROR: Node.js/npm is not installed on PATH.
 pause
 exit /b 1
)
echo Checking SOG asset referenced by this game's assets\asset-pack.json...
call npm.cmd run assets:sog:require
if errorlevel 1 (
 echo.
 echo ERROR: SOG manifest, archive or content integrity failed.
 pause
 exit /b 1
)
echo.
echo Inspection completed. A configured bundled SOG was confirmed in this game manifest.
pause
