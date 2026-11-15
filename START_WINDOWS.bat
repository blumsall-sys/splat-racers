@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title LAB5 Splat Racers v2.3.0 - Diagnostic Launcher
echo ==========================================================
echo   SPLAT RACERS v2.3.0 - FULL PROJECT STARTUP
echo   Custom Blender track / SOG / Ammo / PlayCanvas
echo ==========================================================
echo Project: %CD%
echo.
where node >nul 2>nul
if errorlevel 1 goto missingnode
where npm.cmd >nul 2>nul
if errorlevel 1 goto missingnpm
if not exist "node_modules\vite\bin\vite.js" (
 echo [1/3] Installing local JavaScript dependencies...
 call npm.cmd install --include=dev
 if errorlevel 1 goto dependencyfailure
) else (
 echo [1/3] Local Vite dependencies available.
)
if not exist "public\ammo\ammo.wasm.js" goto installammo
if not exist "public\ammo\ammo.wasm.wasm" goto installammo
if not exist "public\ammo\ammo.js" goto installammo
goto validate
:installammo
echo [2/3] Staging Ammo.js runtime files...
call npm.cmd run setup:ammo
if errorlevel 1 goto ammofailure
:validate
echo [3/3] Validating active Blender road and SOG...
call npm.cmd run assets:check
if errorlevel 1 goto validationfailure
echo.
echo Starting Vite. Keep THIS window open while playing.
echo Browser address: http://localhost:5173/?debug=1
echo Runtime output will also be saved to STARTUP_LAST_LOG.txt.
echo.
node scripts\dev-with-log.mjs
set "DEV_EXIT=%ERRORLEVEL%"
echo.
echo The development server ended with exit code %DEV_EXIT%.
echo Full startup log: %CD%\STARTUP_LAST_LOG.txt
echo If it closed unexpectedly, copy the LAST ERROR from that log.
pause
exit /b %DEV_EXIT%
:missingnode
echo ERROR: Node.js is missing. Install Node.js 22 LTS or newer.
goto fail
:missingnpm
echo ERROR: npm.cmd not found on PATH. Reinstall Node.js.
goto fail
:dependencyfailure
echo ERROR: npm install failed. Review output above.
goto fail
:ammofailure
echo ERROR: Ammo setup failed. Review output above.
goto fail
:validationfailure
echo ERROR: Active asset validation failed. This is separate from npm unit tests.
goto fail
:fail
echo.
echo Resolve the error above before retrying the launcher.
pause
exit /b 1
