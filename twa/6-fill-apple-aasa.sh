#!/usr/bin/env bash
# Step 6 — Auto-fill apple-app-site-association with your Apple Team ID.
#
# Find your Team ID at: https://developer.apple.com/account → Membership → Team ID
# It looks like: A1B2C3D4E5  (10 uppercase alphanumeric characters)
#
# Usage:
#   ./6-fill-apple-aasa.sh A1B2C3D4E5
set -e

TEAM_ID="${1:-}"
AASA="$(dirname "$0")/../frontend/public/.well-known/apple-app-site-association"

if [ -z "$TEAM_ID" ]; then
  echo "Usage: ./6-fill-apple-aasa.sh <YOUR_10_CHAR_APPLE_TEAM_ID>"
  echo ""
  echo "Find your Team ID at: https://developer.apple.com/account → Membership → Team ID"
  exit 1
fi

if [ ${#TEAM_ID} -ne 10 ]; then
  echo "❌  Team ID must be exactly 10 characters (got ${#TEAM_ID})"
  exit 1
fi

APP_ID="${TEAM_ID}.jamie.app"

cat > "$AASA" <<EOF
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appIDs": ["${APP_ID}"],
        "components": [
          { "/": "/reset-password*" },
          { "/": "/verify-email*" }
        ]
      }
    ]
  },
  "webcredentials": {
    "apps": ["${APP_ID}"]
  }
}
EOF

echo "✅  apple-app-site-association updated with App ID: ${APP_ID}"
echo ""
echo "Next steps:"
echo "  1. Deploy frontend so https://app.jamie-app.com/.well-known/apple-app-site-association is reachable."
echo "  2. Verify: curl -I https://app.jamie-app.com/.well-known/apple-app-site-association"
echo "     — must return Content-Type: application/json (NOT application/pkcs7-mime)"
echo "  3. In Xcode: enable 'Associated Domains' capability → add applinks:app.jamie-app.com"
echo "  4. Test Universal Links on a physical iOS device (Simulator doesn't support them)."
