#!/usr/bin/env bash
# Step 1 — Initialise the Capacitor iOS project.
# Run this ONCE from the project root.
# Requires: Xcode installed (App Store), Node.js, npx
set -e

cd frontend

echo "📦  Building web assets..."
VITE_API_URL="https://REPLACE_WITH_YOUR_BACKEND_DOMAIN/api" \
VITE_SOCKET_URL="https://REPLACE_WITH_YOUR_BACKEND_DOMAIN" \
npm run build

echo "🍎  Adding iOS platform..."
npx cap add ios

echo "🔄  Syncing web assets into native project..."
npx cap sync ios

echo ""
echo "✅  iOS project created at frontend/ios/"
echo ""
echo "Next steps:"
echo "  1. Open Xcode:  bash ios/2-open-xcode.sh"
echo "  2. In Xcode → Signing & Capabilities → set your Team + Bundle ID"
echo "  3. Bundle ID must match capacitor.config.json appId: jamie.app"
