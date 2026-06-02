# JAMIE — Deployment & App Store Guide

## Prerequisites

```
Node.js 20+, npm 10+, PostgreSQL 15+
Railway CLI, Xcode 15+, Android Studio 2023+
Apple Developer Account ($99/yr), Google Play Console ($25 one-time)
```

---

## 1. Environment Variables

### Backend (`backend/.env` in production = Railway variables)

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Railway Postgres connection string |
| `JWT_SECRET` | ✅ | Min 64 random chars |
| `SESSION_SECRET` | ✅ | Min 64 random chars |
| `FRONTEND_URL` | ✅ | e.g. `https://app.jamie-app.com` (comma-separate for multiple origins) |
| `EMAIL_FROM` | ✅ | e.g. `JAMIE <noreply@jamie-app.com>` — must be a verified Resend domain |
| `RESEND_API_KEY` | ✅ | From resend.com → API Keys. Used by `utils/email.js` via the Resend HTTP API. |
| `DB_SSL_REJECT_UNAUTHORIZED` | ⚠️ | Set `false` for Railway Postgres (self-signed cert) |
| `STORAGE_ENDPOINT` | ✅ prod | Cloudflare R2: `https://<id>.r2.cloudflarestorage.com` |
| `STORAGE_ACCESS_KEY` | ✅ prod | R2 Access Key ID |
| `STORAGE_SECRET_KEY` | ✅ prod | R2 Secret Access Key |
| `STORAGE_BUCKET` | ✅ prod | e.g. `jamie-uploads` |
| `STORAGE_PUBLIC_URL` | ✅ prod | e.g. `https://pub-xxx.r2.dev` (must be HTTPS) |
| `STRIPE_SECRET_KEY` | 💳 | Stripe live secret key |
| `STRIPE_WEBHOOK_SECRET` | 💳 | From Stripe dashboard → webhooks |
| `PAYPAL_CLIENT_ID` | 💳 | PayPal live client ID |
| `PAYPAL_CLIENT_SECRET` | 💳 | PayPal live secret |
| `VAPID_PUBLIC_KEY` | 🔔 | Generate: `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | 🔔 | From same command |
| `ADMIN_EMAIL` | 🔒 | Email address to receive report notifications |
| `REDIS_URL` | ⚙️ | Optional — for rate-limit persistence and socket scaling |
| `GOOGLE_CLIENT_ID` | 🔑 | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | 🔑 | Google OAuth 2.0 client secret |
| `SIGHTENGINE_API_USER` | 🛡️ | Image moderation (optional) |
| `SIGHTENGINE_API_SECRET` | 🛡️ | Image moderation (optional) |

### Frontend (`frontend/.env` or Vercel/Vite env)

| Variable | Notes |
|---|---|
| `VITE_API_URL` | Monorepo deploy: leave unset (uses `/api` via same origin). Split deploy: `https://api.jamie-app.com`. |
| `VITE_VAPID_PUBLIC_KEY` | Same as backend `VAPID_PUBLIC_KEY` |
| `VITE_GOOGLE_CLIENT_ID` | Same as `GOOGLE_CLIENT_ID` |
| `VITE_SENTRY_DSN` | Optional — Sentry error tracking |

---

## 2. Database Setup

### First deployment

```bash
# 1. Create Railway Postgres database
railway add postgres

# 2. Run the schema (creates all tables)
psql "$DATABASE_URL" -f backend/src/config/schema.sql

# 3. Startup migrations run automatically on first server boot
# See: backend/src/server.js → runStartupMigrations()
```

See [backend/MIGRATIONS.md](backend/MIGRATIONS.md) for the full migration history.

---

## 3. Backend Deployment (Railway)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and link project
railway login
railway link

# Deploy
railway up

# Set environment variables (repeat for each)
railway variables set JWT_SECRET=<value>
railway variables set SESSION_SECRET=<value>
# ... (see table above)
```

Railway auto-detects Node.js. Start command: `node backend/src/server.js`  
Health check path: `/api/health`

---

## 4. Frontend Deployment

### Build

```bash
cd frontend
npm install
npm run build
# Output: frontend/dist/
```

### Deploy to Vercel (recommended)

```bash
npm install -g vercel
cd frontend
vercel --prod
# Set environment variables in Vercel dashboard
```

Or serve `frontend/dist/` from any static host (S3 + CloudFront, Netlify, etc.).

### Capacitor (mobile) build

```bash
cd frontend
npm run build
npx cap sync          # Copies dist/ to native projects
npx cap open ios      # Opens Xcode
npx cap open android  # Opens Android Studio
```

---

## 5. iOS — App Store Submission

### Setup (once)

```bash
# 1. Register App ID in Apple Developer Portal
# https://developer.apple.com/account/resources/identifiers
# Bundle ID: app.jamie (must match capacitor.config.json)

# 2. Create signing certificate and provisioning profile
# Xcode → Preferences → Accounts → Manage Certificates

# 3. In Xcode, open ios/App/App.xcworkspace
# Set Team, Bundle Identifier, Deployment Target (iOS 15+)
```

### Build & submit

```bash
npx cap open ios
# In Xcode:
# 1. Set scheme to "Any iOS Device (arm64)"
# 2. Product → Archive
# 3. Organizer → Distribute App → App Store Connect
# 4. Follow the upload wizard

# After upload, go to App Store Connect:
# https://appstoreconnect.apple.com
# My Apps → JAMIE → TestFlight (internal testing first)
# → Submit for Review when ready
```

### Required before review

- [ ] Privacy Policy URL (set in App Store Connect → App Information)
- [ ] App screenshots: 6.7" iPhone (1290×2796), 12.9" iPad (2048×2732)
- [ ] App description in German (primary) + English
- [ ] Age rating questionnaire
- [ ] IDFA / ATT dialog if tracking (not required if no ad tracking)
- [ ] `apple-app-site-association` file served at `https://app.jamie-app.com/.well-known/apple-app-site-association` (Content-Type: application/json)

### Push notifications (APNs)

```bash
# In Apple Developer Portal → Certificates → Keys
# Create a new Key with APNs enabled
# Download the .p8 file — upload to Railway as APNS_KEY env var
# Set APNS_KEY_ID and APNS_TEAM_ID
```

---

## 6. Android — Play Store Submission

### Generate release keystore (one-time, keep forever)

```bash
cd twa
# Run the setup scripts in order:
bash 1-generate-keystore.sh   # Creates keystore/jamie-release.jks
bash 2-get-sha256.sh          # Prints SHA-256 fingerprint
# Add the fingerprint to: frontend/public/.well-known/assetlinks.json
# Also add to Railway: ANDROID_SHA256=<fingerprint>
```

**Back up the keystore file.** If lost, you cannot update the app on Play Store.

### Build APK / AAB

```bash
# Option A: Capacitor (recommended for feature-rich apps)
npx cap open android
# In Android Studio: Build → Generate Signed Bundle/APK
# Choose "Android App Bundle (.aab)" → use the keystore above

# Option B: TWA (lightweight, PWA-only)
cd twa
bash 3-build.sh               # Builds jamie-release.apk
bash 4-verify-assetlinks.sh   # Verifies digital asset links
```

### Submit to Play Store

1. Go to https://play.google.com/console
2. Create new app → "JAMIE"
3. Upload the `.aab` file to Internal Testing
4. Complete store listing:
   - Short description (80 chars): "Triff Menschen, entdecke Events – JAMIE verbindet dich."
   - Full description (4000 chars)
   - Screenshots: phone (1080×1920), tablet (1600×900)
   - Feature graphic (1024×500)
5. Set Content Rating (run questionnaire)
6. Set Target Audience (18+)
7. Privacy Policy URL
8. Move to Production when internal testing passes

### Digital Asset Links (required for TWA)

`frontend/public/.well-known/assetlinks.json` must be served at:
`https://app.jamie-app.com/.well-known/assetlinks.json`

Verify with:
```bash
bash twa/4-verify-assetlinks.sh
```

---

## 7. Domain & HTTPS Setup

```
# Monorepo deploy (CURRENT — uses root Dockerfile + railway.toml)
app.jamie-app.com   → Railway (frontend + backend on one origin)
                      Serves assetlinks.json + AASA from /.well-known/

# (Split-deploy alternative — kept here for reference, not active)
# app.jamie-app.com → Frontend (Vercel / static host)
# api.jamie-app.com → Backend (Railway)
```

All must have valid TLS certificates (Let's Encrypt via Railway/Vercel auto-configures this).

---

## 8. Post-Launch Checklist

- [ ] Stripe live mode enabled (not test mode)
- [ ] PayPal live mode (`PAYPAL_ENV=live`)
- [ ] SENTRY_DSN set in both frontend and backend
- [ ] VAPID keys configured for push notifications
- [ ] Railway auto-deploy enabled from `main` branch
- [ ] Database backups configured in Railway (Settings → Backups)
- [ ] `/api/health` responding 200
- [ ] Test registration email arrives (check spam)
- [ ] Test push notification on real iOS + Android device
- [ ] Stripe test payment succeeds in live mode
- [ ] App Store review approved
- [ ] Play Store review approved

---

## 9. Backup Strategy

Railway Postgres backups (recommended):
1. Railway dashboard → your Postgres service → Backups → Enable daily backups
2. Also run weekly manual export:
   ```bash
   railway run pg_dump -Fc > backup-$(date +%Y%m%d).dump
   ```
3. Store backups offsite (S3, Cloudflare R2, or Google Drive)
4. Test restore monthly:
   ```bash
   pg_restore -d jamie_db_staging backup-YYYYMMDD.dump
   ```

---

## 10. Secrets Generation Reference

```bash
# JWT_SECRET and SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# VAPID keys
npx web-push generate-vapid-keys

# Admin access — no secret needed, use DB:
# psql $DATABASE_URL -c "UPDATE users SET is_admin=true WHERE email='you@example.com';"
```
