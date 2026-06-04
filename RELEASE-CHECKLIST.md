# JAMIE — Release Day Checklist

Everything an automated tool cannot do for you. Work through this top-to-bottom.

## Domain DNS (one-time)
- [ ] `app.jamie-app.com` → CNAME to Railway service domain (Railway dashboard → Settings → Domains → Add)
- [ ] HTTPS auto-provisioned (Railway/Let's Encrypt — verify cert in browser)

## Railway env vars (paste-and-set)
Use `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` for each random secret.

### Required (server will refuse to start without these)
```
DATABASE_URL                ← Railway Postgres plugin auto-fills
JWT_SECRET                  64 random hex chars
SESSION_SECRET              64 random hex chars
RESEND_API_KEY              re_xxx (resend.com → API Keys)
EMAIL_FROM                  JAMIE <noreply@jamie-app.com>
FRONTEND_URL                https://app.jamie-app.com
NODE_ENV                    production
DB_SSL_REJECT_UNAUTHORIZED  false   (Railway Postgres self-signed cert)
```

### Required for full functionality
```
STORAGE_ENDPOINT            R2 endpoint
STORAGE_ACCESS_KEY          R2 key id
STORAGE_SECRET_KEY          R2 secret
STORAGE_BUCKET              jamie-uploads
STORAGE_PUBLIC_URL          https://pub-xxx.r2.dev
STRIPE_SECRET_KEY           sk_live_...
STRIPE_PUBLISHABLE_KEY      pk_live_...
STRIPE_WEBHOOK_SECRET       whsec_... (boost endpoint)
STRIPE_SUBSCRIPTION_WEBHOOK_SECRET whsec_... (subscription endpoint)
VAPID_PUBLIC_KEY            from `npx web-push generate-vapid-keys`
VAPID_PRIVATE_KEY           from same command
VAPID_SUBJECT               mailto:admin@jamie-app.com
GOOGLE_CLIENT_ID            ...apps.googleusercontent.com
SIGHTENGINE_API_USER        (optional but recommended)
SIGHTENGINE_API_SECRET
OPENAI_API_KEY              for text moderation
REDIS_URL                   if scaling to >1 instance
SENTRY_DSN                  backend error monitoring
ADMIN_EMAIL                 your inbox for content reports
```

### Build-time (set on the Railway build, not runtime)
```
VITE_GOOGLE_MAPS_API_KEY    restrict by HTTP Referrer in GCP
VITE_GOOGLE_CLIENT_ID       same as GOOGLE_CLIENT_ID above
VITE_VAPID_PUBLIC_KEY       same as VAPID_PUBLIC_KEY above
VITE_SENTRY_DSN             frontend Sentry
```

## Resend domain setup
- [ ] Add `jamie-app.com` in Resend dashboard
- [ ] Add the SPF + DKIM TXT records they show you to your DNS
- [ ] Wait for "verified" status (usually <1 hour)
- [ ] Test: register a new account in staging → OTP email arrives

## Stripe webhooks (two endpoints, two secrets)
- [ ] Endpoint 1: `https://app.jamie-app.com/api/boost/stripe/webhook`
      Events: `payment_intent.succeeded`
      Copy "Signing secret" → `STRIPE_WEBHOOK_SECRET`
- [ ] Endpoint 2: `https://app.jamie-app.com/api/subscription/stripe/webhook`
      Events: `customer.subscription.created`, `customer.subscription.updated`,
              `customer.subscription.deleted`, `invoice.payment_succeeded`,
              `invoice.payment_failed`
      Copy "Signing secret" → `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`

## Database
- [ ] One-time: `psql "$DATABASE_URL" -f backend/src/config/schema.sql`
- [ ] Startup migrations run automatically on first boot (see `server.js → runStartupMigrations`)
- [ ] Enable daily backups in Railway → Postgres → Backups
- [ ] Grant your own admin access:
      `psql "$DATABASE_URL" -c "UPDATE users SET is_admin=true WHERE email='tobias.p.strauss@gmail.com';"`

---

## Android (Play Store)

### Keystore (do this ONCE, back it up forever)
```bash
cd twa
bash 1-generate-keystore.sh    # creates keystore/jamie-release.jks
bash 2-get-sha256.sh           # prints DEV SHA-256
# back the .jks file up to a password manager / encrypted drive
```

### Build the app bundle
```bash
cd frontend
bash ../android/1-init.sh      # adds android/ via Capacitor
bash ../android/2-open-studio.sh
# In Android Studio: Build → Generate Signed Bundle/APK → Android App Bundle
# Use keystore/jamie-release.jks, alias jamie-key
```

### Asset links (TWA full-screen)
After uploading the AAB to Play Console → Setup → App integrity:
```bash
# Copy "App signing key certificate" SHA-256 from Play Console
cd twa
bash 5-fill-assetlinks.sh "AA:BB:CC:DD:...PLAY_STORE_SHA256"
# This updates frontend/public/.well-known/assetlinks.json with BOTH fingerprints
# Commit and deploy. Then verify:
bash 4-verify-assetlinks.sh
```

### Play Console listing
- [ ] Short description (≤80 chars): "Triff Menschen, entdecke Events – JAMIE verbindet dich."
- [ ] Full description (≤4000 chars)
- [ ] Phone screenshots (1080×1920 minimum, 8 required)
- [ ] Feature graphic (1024×500)
- [ ] App icon (512×512)
- [ ] Privacy policy URL: `https://app.jamie-app.com/privacy`
- [ ] Content rating: run the questionnaire (social + UGC)
- [ ] Target audience: 18+
- [ ] Data safety form: account, location, photos, messages — all "data collected"

---

## iOS (App Store)

### Native project
```bash
cd frontend
bash ../ios/1-init.sh          # adds ios/ via Capacitor
bash ../ios/2-open-xcode.sh
```

### In Xcode (open frontend/ios/App/App.xcworkspace)
- [ ] Signing & Capabilities → Team: your Apple Developer team
- [ ] Bundle Identifier: `jamie.app` (matches capacitor.config.json)
- [ ] Deployment target: iOS 15.0
- [ ] Drag `PrivacyInfo.xcprivacy` into the App target (root) — File → Add Files → tick the App target
- [ ] Capabilities tab:
  - [ ] + Associated Domains → add `applinks:app.jamie-app.com`
  - [ ] + Push Notifications
  - [ ] + Sign in with Apple (if used)

### Universal Links (deep link to /reset-password and /verify-email)
```bash
# Set your 10-char Apple Team ID first:
export APPLE_TEAM_ID=ABCDE12345
cd twa
bash 6-fill-apple-aasa.sh     # rewrites the AASA file with your Team ID
# Deploy. Verify:
curl -I https://app.jamie-app.com/.well-known/apple-app-site-association
# Must return Content-Type: application/json (server.js already handles this)
```

### APNs (push notifications)
- [ ] Apple Developer → Certificates → Keys → Create new Key with APNs enabled
- [ ] Download the .p8 file (only once — back it up)
- [ ] In Xcode: build for Any iOS Device → Product → Archive → Distribute to App Store Connect

### App Store Connect listing
- [ ] Privacy Policy URL: `https://app.jamie-app.com/privacy`
- [ ] Support URL: `mailto:support@jamie-app.com` or the same domain
- [ ] Screenshots: 6.7" iPhone (1290×2796), 6.1" iPhone if you want broader coverage
- [ ] App description (German primary, English secondary)
- [ ] Age rating: 17+ (social + UGC)
- [ ] In "App Privacy" section: declare Email, Name, Photos/Videos, Precise Location, User Content, Crash Data, Performance Data — all linked to user, none used for tracking

---

## Post-launch smoke tests
- [ ] `/api/health` returns `{"status":"ok"}`
- [ ] Register a new account → OTP email arrives (check spam)
- [ ] Password reset → email arrives, link works, lands in app
- [ ] Create a group → image upload succeeds (R2 URL in response)
- [ ] Stripe test charge in live mode (€0.50 to your own card) → webhook fires → credit added
- [ ] Push notification: subscribe → fire from another account's chat → receive on device
- [ ] Admin dashboard at `/admin` loads with your is_admin user
- [ ] Open the TWA on Android — verify no URL bar (asset links working)
- [ ] Open the password-reset email on iOS — verify it opens the app, not Safari (Universal Links working)
