@echo off
setlocal
cd /d "%~dp0"
echo LAB5 native Bullet vehicle test (flat ground; not a browser test)
where node >nul 2>nul || (echo Node.js required & pause & exit /b 1)
if not exist "public\ammo\ammo.wasm.js" (
  echo Staging Ammo WASM files...
  call npm.cmd run setup:ammo
  if errorlevel 1 (echo Ammo staging failed & pause & exit /b 1)
)
call npm.cmd run qa:native
if errorlevel 1 (echo Native vehicle test FAILED & pause & exit /b 1)
echo PASS: Native vehicle smoke test complete.
pause
