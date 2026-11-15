@echo off
setlocal
cd /d "%~dp0"
echo Checking the active Blender asset pack...
node scripts\check-assets-v14.mjs
if errorlevel 1 (
 echo ERROR: An asset failed validation. See the specific GLB/SOG/road error above.
) else (
 echo PASS: Files, collision triangles and P1/P2 road coverage validated.
)
pause
