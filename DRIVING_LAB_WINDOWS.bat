@echo off
cd /d "%~dp0"
echo Driving Lab runs without npm, PlayCanvas, Ammo or Blender.
echo Open http://localhost:5174/ in Chrome.
echo Ctrl+C stops the test server.
node scripts/serve-driving-lab.mjs
pause
