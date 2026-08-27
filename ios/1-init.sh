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

echo "📋  Copying NSPrivacyManifest..."
cp ../ios/PrivacyInfo.xcprivacy ios/App/App/PrivacyInfo.xcprivacy
echo "    ⚠️  Open Xcode and add PrivacyInfo.xcprivacy to the App target (File → Add Files)."

echo ""
echo "✅  iOS project created at frontend/ios/"
echo ""
echo "Next steps:"
echo "  1. Open Xcode:  bash ios/2-open-xcode.sh"
echo "  2. In Xcode → Signing & Capabilities → set your Team + Bundle ID"
echo "  3. Bundle ID must match capacitor.config.json appId: com.jamie-app.app"
echo "  4. In Xcode: right-click App group → Add Files → select PrivacyInfo.xcprivacy"
echo "  5. Run  bash ios/4-preflight.sh  (privacy manifest, URL scheme,"
echo "     permission strings, AND the Push/APNs entitlement)"
echo "  6. For iOS push delivery, follow store/PUSH-SETUP.md (Apple key + Railway env)"
