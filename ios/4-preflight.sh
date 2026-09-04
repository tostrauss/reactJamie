#!/usr/bin/env bash
# Step 4 — Pre-submission preflight for the native iOS project.
# Run from the PROJECT ROOT on the Mac, AFTER `npx cap sync ios`, BEFORE archiving:
#
#   bash ios/4-preflight.sh
#
# Idempotent — safe to run any number of times. It fixes the four things
# `cap sync` does NOT handle (2026-07-03 pre-resubmission audit; push added
# 2026-08-27):
#
#   1. Copies the current PrivacyInfo.xcprivacy into the Xcode project
#      (cap sync never touches it; the repo copy is the source of truth).
#   2. Adds the `jamie` custom URL scheme to Info.plist — required for the
#      Spotify connect deep link (jamie://spotify-callback). Without it the
#      in-app browser can never return to the app after Spotify auth.
#   3. Ensures the three permission usage strings exist — Apple REJECTS or
#      crashes the app when camera/photos/location are used without them.
#      Existing values are left untouched.
#   4. Installs the Push Notifications (APNs) entitlement — copies
#      ios/App.entitlements into the project and wires CODE_SIGN_ENTITLEMENTS
#      into project.pbxproj. `npx cap add ios` does NOT add the Push
#      capability, so without this step register() gets no APNs token and iOS
#      push can never work. See store/PUSH-SETUP.md for the Apple/Railway side.
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

echo "🔔  4/4 Push Notifications entitlement (aps-environment)..."
ENT_SRC="ios/App.entitlements"
ENT_DST="frontend/ios/App/App/App.entitlements"
PBXPROJ="frontend/ios/App/App.xcodeproj/project.pbxproj"
if [ ! -f "$ENT_SRC" ]; then
  echo "    ⚠️  $ENT_SRC missing — SKIPPED. iOS push will NOT work without it."
elif [ ! -f "$PBXPROJ" ]; then
  echo "    ⚠️  $PBXPROJ not found — SKIPPED (native project not generated yet)."
else
  cp "$ENT_SRC" "$ENT_DST"
  echo "    ✓ copied $ENT_SRC → App/App.entitlements"
  if grep -q "CODE_SIGN_ENTITLEMENTS" "$PBXPROJ"; then
    echo "    ✓ CODE_SIGN_ENTITLEMENTS already wired in project.pbxproj"
  else
    # Insert the build setting right after each PRODUCT_BUNDLE_IDENTIFIER line
    # (App target → Debug + Release). App.xcodeproj/project.pbxproj holds ONLY
    # the App target, so this never touches Pods. awk (not BSD sed) so the
    # append behaves identically on macOS; \t is a real tab in awk strings.
    awk '{ print }
         /PRODUCT_BUNDLE_IDENTIFIER = / { print "\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;" }' \
      "$PBXPROJ" > "$PBXPROJ.tmp" && mv "$PBXPROJ.tmp" "$PBXPROJ"
    echo "    + wired CODE_SIGN_ENTITLEMENTS = App/App.entitlements (Debug + Release)"
  fi
fi

echo ""
echo "✅  Preflight done. Remaining manual steps in Xcode:"
echo "    1. Set Version + bump the Build number (last uploaded: 1.4 build 9 → next is 1.4.1 build 10+;"
echo "       a version already in the App Store cannot be re-submitted; duplicate builds are rejected)"
echo "    2. Product → Archive → Distribute App"
echo ""
echo "🔔  For iOS PUSH to actually deliver, the entitlement above is NOT enough:"
echo "    • Apple Developer → Keys: create an APNs Auth Key (.p8), note the Key ID"
echo "    • Enable Push on the App ID (com.jamie-app.app), then in Xcode let"
echo "      automatic signing regenerate the provisioning profile"
echo "    • Railway env: APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY (.p8 contents),"
echo "      APNS_BUNDLE_ID=com.jamie-app.app"
echo "    Full runbook: store/PUSH-SETUP.md"
