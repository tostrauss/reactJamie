#!/usr/bin/env bash
# Build a signed release AAB for Google Play.
# Set these env vars before running:
#   KEYSTORE_PATH  — path to your .jks keystore file
#   KEYSTORE_PASS  — keystore password
#   KEY_ALIAS      — key alias
#   KEY_PASS       — key password
set -e
cd "$(dirname "$0")/../frontend"

echo "==> Building frontend..."
npm run build

echo "==> Syncing to Android..."
npx cap sync android

echo "==> Building release AAB..."
cd android
./gradlew bundleRelease \
  -Pandroid.injected.signing.store.file="$KEYSTORE_PATH" \
  -Pandroid.injected.signing.store.password="$KEYSTORE_PASS" \
  -Pandroid.injected.signing.key.alias="$KEY_ALIAS" \
  -Pandroid.injected.signing.key.password="$KEY_PASS"

AAB="app/build/outputs/bundle/release/app-release.aab"
echo ""
echo "Done! AAB at: frontend/android/$AAB"
