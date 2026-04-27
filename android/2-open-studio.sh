#!/usr/bin/env bash
# Open the Android project in Android Studio.
set -e
cd "$(dirname "$0")/../frontend"
npx cap open android
