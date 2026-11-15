@echo off
cd /d "%~dp0"
echo Inspecting road mesh triangles, orientation, and geometric density...
call npm.cmd run road:check
if errorlevel 1 (echo ROAD GEOMETRY CHECK FAILED. Inspect RACE_COLLISION. ) else (echo Road geometry inspection complete; warnings are recommendations.)
pause
