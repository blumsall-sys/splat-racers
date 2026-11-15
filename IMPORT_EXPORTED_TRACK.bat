@echo off
setlocal
cd /d "%~dp0"
echo ======================================================
echo LAB5 Splat Racers - Import Blender Exported Asset Pack
 echo ======================================================
echo Locate the ORIGINAL v1.3/v1.4 game directory Blender exported to.
echo It must contain assets\asset-pack.json and assets\track.json.
echo.
echo Example: D:\Splat Racers\v7\Splat_Racers_Modular_v1_3
echo.
set /p "OLDGAME=Folder containing exported assets: "
if "%OLDGAME%"=="" (echo ERROR: No path provided. & pause & exit /b 1)
where node >nul 2>nul || (echo ERROR: Node.js is required. & pause & exit /b 1)
node scripts\import-v13-assets.mjs "%OLDGAME%"
if errorlevel 1 (echo ERROR: Could not import the asset pack. See messages above. & pause & exit /b 1)
echo.
echo Export imported. Checking road geometry beneath both starts...
node scripts\check-assets-v14.mjs
if errorlevel 1 (echo WARNING: Road/spawn geometry failed. Fix the source Blender track and export again. & pause & exit /b 1)
echo.
echo SUCCESS: Now run START_WINDOWS.bat, hard refresh Chrome (Ctrl+Shift+R).
pause
