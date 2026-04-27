#!/usr/bin/env bash
# Run once to scaffold the Android project.
# Prerequisites: JDK 17+, Android Studio with SDK 34 installed.
set -e
cd "$(dirname "$0")/../frontend"

echo "==> Building frontend..."
npm run build

echo "==> Adding Android platform..."
npx cap add android

echo "==> Syncing assets..."
npx cap sync android

echo ""
echo "Done! Open Android Studio with: ./2-open-studio.sh"
