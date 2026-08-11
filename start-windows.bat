@echo off
where go >nul 2>nul
if errorlevel 1 (
  echo Go 1.23 oder neuer fehlt: https://go.dev/dl/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm ci
)
echo Starting Rocket Vibe LAN...
call npm run lan
pause
