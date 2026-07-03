#!/usr/bin/env bash
# Step 4 — Pre-submission preflight for the native iOS project.
# Run from the PROJECT ROOT on the Mac, AFTER `npx cap sync ios`, BEFORE archiving:
#
#   bash ios/4-preflight.sh
#
# Idempotent — safe to run any number of times. It fixes the three things
# `cap sync` does NOT handle (2026-07-03 pre-resubmission audit):
#
#   1. Copies the current PrivacyInfo.xcprivacy into the Xcode project
#      (cap sync never touches it; the repo copy is the source of truth).
#   2. Adds the `jamie` custom URL scheme to Info.plist — required for the
#      Spotify connect deep link (jamie://spotify-callback). Without it the
#      in-app browser can never return to the app after Spotify auth.
#   3. Ensures the three permission usage strings exist — Apple REJECTS or
#      crashes the app when camera/photos/location are used without them.
#      Existing values are left untouched.
set -e

PB="/usr/libexec/PlistBuddy"
PLIST="frontend/ios/App/App/Info.plist"

if [ ! -f ios/PrivacyInfo.xcprivacy ]; then
  echo "❌  Run me from the project root:  bash ios/4-preflight.sh"
  exit 1
fi
if [ ! -f "$PLIST" ]; then
  echo "❌  $PLIST not found — the native project doesn't exist yet."
  echo "    Run:  cd frontend && npx cap add ios && npx cap sync ios"
  exit 1
fi

echo "📋  1/3 Privacy manifest..."
cp ios/PrivacyInfo.xcprivacy frontend/ios/App/App/PrivacyInfo.xcprivacy
echo "    ✓ copied ios/PrivacyInfo.xcprivacy → frontend/ios/App/App/"
echo "    ⚠️  If it was never added to the Xcode target: File → Add Files → PrivacyInfo.xcprivacy"

echo "🔗  2/3 URL scheme 'jamie' (Spotify deep link)..."
if grep -q "<string>jamie</string>" "$PLIST"; then
  echo "    ✓ already present"
else
  # Create the array if missing, then append a new URL type at the first free index.
  $PB -c "Add :CFBundleURLTypes array" "$PLIST" 2>/dev/null || true
  i=0
  while $PB -c "Print :CFBundleURLTypes:$i" "$PLIST" >/dev/null 2>&1; do i=$((i+1)); done
  $PB -c "Add :CFBundleURLTypes:$i dict" "$PLIST"
  $PB -c "Add :CFBundleURLTypes:$i:CFBundleURLName string com.jamie-app.app" "$PLIST"
  $PB -c "Add :CFBundleURLTypes:$i:CFBundleURLSchemes array" "$PLIST"
  $PB -c "Add :CFBundleURLTypes:$i:CFBundleURLSchemes:0 string jamie" "$PLIST"
  echo "    + added CFBundleURLTypes entry with scheme 'jamie'"
fi

echo "🔒  3/3 Permission usage strings..."
ensure_string () {
  local key="$1" text="$2"
  if $PB -c "Print :$key" "$PLIST" >/dev/null 2>&1; then
    echo "    ✓ $key already set (left untouched)"
  else
    $PB -c "Add :$key string $text" "$PLIST"
    echo "    + $key added"
  fi
}
ensure_string NSCameraUsageDescription        "JAMIE braucht die Kamera, um Profil- und Gruppenfotos aufzunehmen."
ensure_string NSPhotoLibraryUsageDescription  "JAMIE braucht Zugriff auf deine Fotos, um Bilder hochzuladen."
ensure_string NSLocationWhenInUseUsageDescription "JAMIE nutzt deinen Standort, um Aktivitäten in der Nähe zu zeigen."

echo ""
echo "✅  Preflight done. Remaining manual steps in Xcode:"
echo "    1. Bump the Build number (last uploaded: 3 → use 4+; duplicates are rejected)"
echo "    2. Product → Archive → Distribute App"
