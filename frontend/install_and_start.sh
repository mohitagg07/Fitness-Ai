#!/bin/bash
set -e

echo ""
echo "===================================================="
echo "  FitAI Frontend - Clean Install & Start"
echo "===================================================="
echo ""

echo "[1/4] Cleaning old installs..."
rm -rf node_modules package-lock.json .expo
echo "      Done."
echo ""

echo "[2/4] Installing packages..."
npm install --legacy-peer-deps
echo "      Done."
echo ""

echo "[3/4] Verifying expo..."
if [ ! -f "node_modules/.bin/expo" ]; then
  echo "ERROR: expo not found in node_modules"
  exit 1
fi
echo "      expo found."
echo ""

echo "[4/4] Starting Expo (using local binary)..."
./node_modules/.bin/expo start --clear
