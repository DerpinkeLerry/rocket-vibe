#!/usr/bin/env sh
set -e
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi
echo "Starting Rocket Vibe LAN..."
npm run lan
