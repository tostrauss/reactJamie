#!/usr/bin/env bash
# Step 4 — Verify that assetlinks.json is correctly served.
# The Play Store validation will fail if this is wrong.
set -e

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: ./4-verify-assetlinks.sh your-domain.railway.app"
  exit 1
fi

URL="https://${DOMAIN}/.well-known/assetlinks.json"
echo "Checking: $URL"
echo ""

RESULT=$(curl -sf "$URL")
echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"

echo ""
# Verify expected values
PACKAGE=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['target']['package_name'])" 2>/dev/null)
SHA=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['target']['sha256_cert_fingerprints'][0])" 2>/dev/null)

if [ "$PACKAGE" = "jamie.app" ]; then
  echo "✅  package_name: $PACKAGE"
else
  echo "❌  package_name is '$PACKAGE' — expected 'jamie.app'"
  echo "    Set ANDROID_PACKAGE=jamie.app in Railway env vars"
fi

if echo "$SHA" | grep -qE "^[A-F0-9]{2}(:[A-F0-9]{2}){31}$"; then
  echo "✅  sha256_cert_fingerprints: set"
else
  echo "❌  sha256_cert_fingerprints looks wrong: $SHA"
  echo "    Run ./2-get-sha256.sh and set ANDROID_SHA256 in Railway env vars"
fi
