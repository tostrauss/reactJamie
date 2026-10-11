#!/usr/bin/env bash
# Opens the native iOS project in the Xcode that `xcode-select` points to.
# Run from the PROJECT ROOT on the Mac:  bash ios/open-xcode.sh
#
# Why not `npx cap open ios`: that goes through Launch Services, which picks
# whichever Xcode it likes (usually the newest). With Xcode 26 and 27 installed
# side by side, that choice decides whether the archive launches on iOS 27 at
# all — see ios/4-preflight.sh, step 0, and store/IOS-UPDATE-TINA.md, step 0.
set -e

DEV_DIR=$(xcode-select -p)
XCODE_APP=${DEV_DIR%/Contents/Developer}
XCODE_VER=$(xcodebuild -version 2>/dev/null | awk '/^Xcode/ {print $2; exit}')

if [ -d frontend/ios/App/App.xcworkspace ]; then
  PROJECT=frontend/ios/App/App.xcworkspace      # CocoaPods project
elif [ -d frontend/ios/App/App.xcodeproj ]; then
  PROJECT=frontend/ios/App/App.xcodeproj        # Swift Package Manager project
else
  echo "❌  frontend/ios/App not found — run from the project root after npx cap sync ios"
  exit 1
fi

echo "🚀  Opening $PROJECT with $XCODE_APP (Xcode ${XCODE_VER:-?})"
case "${XCODE_VER%%.*}" in
  27|28|29) echo "⚠️  This is Xcode ${XCODE_VER} — JAMIE must be archived with Xcode 26 until the UIScene migration (step 0 of the runbook)." ;;
esac
open -a "$XCODE_APP" "$PROJECT"
