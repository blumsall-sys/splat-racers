@echo off
setlocal
cd /d "%~dp0"
echo Checking game logic and asset format tests (no npm installation required)...
call npm.cmd test
if errorlevel 1 (echo TESTS FAILED) else (echo TESTS PASSED)
pause
