#!/usr/bin/env bash
# Step 3 — Build and run on a connected iOS device (no Xcode GUI needed).
# Requires: Xcode command-line tools, ios-deploy (npm install -g ios-deploy)
set -e

BACKEND="${BACKEND_URL:-https://REPLACE_WITH_YOUR_BACKEND_DOMAIN}"

cd frontend

echo "📦  Building web assets..."
VITE_API_URL="${BACKEND}/api" \
VITE_SOCKET_URL="${BACKEND}" \
npm run build

echo "🔄  Syncing to iOS..."
npx cap sync ios

echo "📱  Running on device..."
npx cap run ios
