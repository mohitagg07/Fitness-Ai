#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo
echo "===================================================="
echo "  VYRN Mobile - Install & Start"
echo "===================================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed or is not on PATH." >&2
  echo "Install the version pinned in the repository .nvmrc file." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not available on PATH." >&2
  exit 1
fi

if [[ ! -f package-lock.json ]]; then
  echo "ERROR: frontend/package-lock.json is missing." >&2
  echo "Restore it from Git; do not regenerate it casually." >&2
  exit 1
fi

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Verify EXPO_PUBLIC_API_URL before testing."
fi

if [[ ! -x node_modules/.bin/expo ]]; then
  echo "Installing exact locked dependencies with npm ci..."
  npm ci
else
  echo "Existing locked dependency install found."
fi

if [[ ! -x node_modules/.bin/expo ]]; then
  echo "ERROR: Expo CLI was not installed. Run npm ci and inspect the error." >&2
  exit 1
fi

echo
echo "Starting Expo. Use --clear only when you need to reset Metro's cache."
echo
npm run start -- "$@"
