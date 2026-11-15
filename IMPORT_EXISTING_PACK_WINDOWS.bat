@echo off
setlocal
cd /d "%~dp0"
echo Import only your existing Blender-exported track, SOG, and GLBs into this new game.
echo Your original game folder remains unchanged.
echo.
set /p oldroot=Enter FULL PATH of previous Splat Racers game folder: 
if "%oldroot%"=="" (echo Cancelled.&pause&exit /b 1)
node scripts\import-existing-pack.mjs "%oldroot%"
if errorlevel 1 (echo Migration FAILED - check messages above.) else (echo Asset import successful. To add flight rings, re-export using Blender add-on 1.4.0.)
pause
