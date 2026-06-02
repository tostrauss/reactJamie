#!/usr/bin/env bash
# Step 5 — Auto-fill assetlinks.json with real SHA-256 fingerprints.
#
# Run AFTER steps 1-2 (keystore generated + SHA256 known).
# Also requires the Play Store signing fingerprint from:
#   Google Play Console → App → Setup → App integrity → App signing key certificate → SHA-256
#
# Usage:
#   ./5-fill-assetlinks.sh "AA:BB:CC:...(Play Store SHA256)"
#
# The dev-keystore fingerprint is read automatically.
set -e

ASSETLINKS="$(dirname "$0")/../frontend/public/.well-known/assetlinks.json"
KEYSTORE="$(dirname "$0")/keystore/jamie-release.jks"

if [ ! -f "$KEYSTORE" ]; then
  echo "❌  Keystore not found. Run ./1-generate-keystore.sh first."
  exit 1
fi

# Get dev keystore fingerprint
DEV_SHA=$(keytool -list -v -keystore "$KEYSTORE" -alias jamie-key 2>/dev/null \
  | grep "SHA256:" | awk '{print $2}')

if [ -z "$DEV_SHA" ]; then
  echo "❌  Could not read SHA256 from keystore. Check keystore alias 'jamie-key'."
  exit 1
fi

PLAY_SHA="${1:-}"
if [ -z "$PLAY_SHA" ]; then
  echo "⚠️   No Play Store SHA256 provided. Only dev fingerprint will be written."
  echo "    Get it from: Play Console → Your app → Setup → App integrity → SHA-256"
  echo ""
fi

# Build JSON
if [ -n "$PLAY_SHA" ]; then
  FINGERPRINTS="\"$DEV_SHA\",\n        \"$PLAY_SHA\""
else
  FINGERPRINTS="\"$DEV_SHA\""
fi

cat > "$ASSETLINKS" <<EOF
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "jamie.app",
      "sha256_cert_fingerprints": [
        $(printf "$FINGERPRINTS")
      ]
    }
  }
]
EOF

echo "✅  assetlinks.json updated:"
echo "    Dev SHA256:       $DEV_SHA"
[ -n "$PLAY_SHA" ] && echo "    Play Store SHA256: $PLAY_SHA"
echo ""
echo "Next: deploy frontend so https://app.jamie-app.com/.well-known/assetlinks.json serves this file."
echo "Then run: ./4-verify-assetlinks.sh"
