#!/usr/bin/env bash
# Step 2 — Build web assets, sync to iOS, and open Xcode.
# Run this every time you want to test a build on device/simulator.
# Requires: Xcode, macOS
set -e

BACKEND="${BACKEND_URL:-https://REPLACE_WITH_YOUR_BACKEND_DOMAIN}"

cd frontend

echo "📦  Building web assets..."
VITE_API_URL="${BACKEND}/api" \
VITE_SOCKET_URL="${BACKEND}" \
npm run build

echo "🔄  Syncing to iOS..."
npx cap sync ios

echo "🚀  Opening Xcode..."
npx cap open ios
