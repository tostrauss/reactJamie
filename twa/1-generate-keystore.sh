#!/usr/bin/env bash
# Step 1 — Generate the Android release keystore
# Run once. Keep jamie-release.jks safe — you need it for every future update.
# If you lose it, you CANNOT update the app on Play Store.
set -e

mkdir -p keystore

keytool -genkey -v \
  -keystore keystore/jamie-release.jks \
  -alias jamie-key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=JAMIE, OU=App, O=JAMIE, L=Vienna, ST=Vienna, C=AT"

echo ""
echo "✅  Keystore created at keystore/jamie-release.jks"
echo "    Run ./2-get-sha256.sh next to get the fingerprint."
