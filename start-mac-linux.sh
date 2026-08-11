#!/usr/bin/env sh
set -e
if ! command -v go >/dev/null 2>&1; then
  echo "Go 1.23 oder neuer fehlt: https://go.dev/dl/"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm ci
fi
echo "Starting Rocket Vibe LAN..."
npm run lan
