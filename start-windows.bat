@echo off
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting Rocket Vibe LAN...
call npm run lan
pause
