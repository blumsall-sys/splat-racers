@echo off
setlocal
cd /d "%~dp0"
echo Checking first ring, ring normals and flight race order...
node scripts\check-flight-course.mjs
set RESULT=%ERRORLEVEL%
echo.
if not "%RESULT%"=="0" echo Correct flight direction warnings in Blender then re-export.
pause
exit /b %RESULT%
