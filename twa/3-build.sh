#!/usr/bin/env bash
# Step 3 — Build the TWA Android App Bundle (.aab) for Play Store.
# Requires: Node.js, JDK 11, Bubblewrap CLI installed.
# Install bubblewrap: npm install -g @bubblewrap/cli
set -e

# Validate twa-manifest.json has been updated
if grep -q "REPLACE_WITH_YOUR_DOMAIN" twa-manifest.json; then
  echo "❌  Update twa-manifest.json first:"
  echo "    Replace all 'REPLACE_WITH_YOUR_DOMAIN' with your actual domain."
  exit 1
fi

echo "Building TWA app bundle..."
bubblewrap build

echo ""
echo "✅  Build complete! Files:"
echo "    app-release-bundle.aab  → upload to Play Store (recommended)"
echo "    app-release-signed.apk  → for direct installation / testing"
echo ""
echo "Before submitting to Play Store:"
echo "  1. Set ANDROID_PACKAGE=jamie.app on Railway"
echo "  2. Set ANDROID_SHA256=<your-fingerprint> on Railway"
echo "  3. Verify: curl https://your-domain/.well-known/assetlinks.json"
