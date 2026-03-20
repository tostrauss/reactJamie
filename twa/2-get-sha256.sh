#!/usr/bin/env bash
# Step 2 — Print the SHA-256 fingerprint of your keystore.
# Copy the fingerprint and set it as ANDROID_SHA256 in Railway env vars.
set -e

KEYSTORE="keystore/jamie-release.jks"

if [ ! -f "$KEYSTORE" ]; then
  echo "❌  Keystore not found. Run ./1-generate-keystore.sh first."
  exit 1
fi

echo "SHA-256 fingerprint for jamie-key:"
keytool -list -v \
  -keystore "$KEYSTORE" \
  -alias jamie-key \
  | grep "SHA256:" | awk '{print $2}'

echo ""
echo "Set this value as ANDROID_SHA256 in your Railway environment variables."
echo "Format: AA:BB:CC:DD:... (colon-separated uppercase hex)"
