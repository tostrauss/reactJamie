# JAMIE — Social Activity App

Full-stack Progressive Web App (PWA) for discovering and joining social activities in Austria. Users create groups and clubs, chat in real time, add friends, find events on a map, and redeem partner deals. This README is the top-level overview for any developer or maintainer landing on the repo: what it is, the stack, the layout, how to run it locally, and where the other docs live.

- **Target market:** Austria. UI language: German.
- **Native shell:** Android (Trusted Web Activity) + iOS (Capacitor). Package id: `jamie.app`. Production domain: `app.jamie-app.com`.
- **Brand:** Coral `#FD7666` (primary), dark violet `#231B43` (theme/background).

## Docs index

| Doc | Purpose | Language |
|---|---|---|
| `README.md` (this file) | Project overview, stack, layout, local setup | English |
| `QUICK_START.md` | Fastest path to a running local dev environment | English |
| `DEPLOYMENT.md` | Deploy to Railway: env vars, domain, health, smoke test | English |
| `RELEASE-CHECKLIST.md` | Master pre-release checklist (web / iOS / Android) | English |
| `backend/MIGRATIONS.md` | How DB tables are created/migrated on boot | English |
| `checklist.md` | Quick reference: registration fields, categories, critical env vars | English / DE |
| `twa/RUNBOOK.md` | Android TWA build + signing + assetlinks runbook | German |
| `store/STOREKIT-SETUP.md` | Apple IAP / App Store Connect product + StoreKit setup | English |
| `store/STRIPE-MEETING-CHECKLIST.md` | Stripe live-mode activation runbook (account, products, webhooks) | English |
| `store/PLAY-LISTING.md` | Google Play store listing copy, assets, test account | German listing copy |
| `store/app-store-checklist.md` | Apple submission checklist: screenshot sizes, DE metadata, review account | English / DE metadata |
| `store/DATA-SAFETY.md` | Play Data Safety + content-rating answers (keep in sync with `PrivacyPolicy.jsx`) | English |

## Stack

### Backend (`backend/`)
- Node.js + Express (ES modules). Engines: `node >=20`, `npm >=10`.
- PostgreSQL (`pg`), Socket.IO + Redis adapter (`@socket.io/redis-adapter`, `ioredis`).
- JWT auth + bcrypt.
- `@aws-sdk/client-s3` for Cloudflare R2 / S3 uploads; `sharp` for image processing.
- `web-push` (VAPID) + `@parse/node-apn` (APNs) for push.
- `stripe` for payments; `@sentry/node` for error tracking; `helmet` for CSP.
- `google-auth-library` + `apple-signin-auth` for social login; `node-cron` for scheduled jobs.
- Email via Resend (`RESEND_API_KEY`).

### Frontend (`frontend/`)
- React 18 + Vite, React Router v6, Axios, Socket.IO client.
- Leaflet / react-leaflet (map) and Google Places Autocomplete (address entry).
- Stripe.js (web + Android payments).
- i18next + react-i18next (locales: `de`, `en`; default `de`).
- Capacitor 8 for the native iOS/Android shells.

### Infrastructure
- Backend deploys to Railway from the **root `Dockerfile`** (multi-stage: builds frontend, then serves it from Express `public/`). `railway.toml` health check: `GET /api/health`.
- Both packages use `"type": "module"`.

## Repo layout

```
trys/
├── Dockerfile                 # Multi-stage build used by Railway (frontend + backend)
├── railway.toml               # Railway deploy config (healthcheck /api/health)
├── docker-compose.yml         # Local dev stack
├── backend/
│   ├── Dockerfile             # Local-dev only (single stage)
│   ├── src/
│   │   ├── server.js          # Express + Socket.IO entry; runs startup migrations
│   │   ├── config/            # DB, storage, *_migration.sql files
│   │   ├── controllers/       # auth, groups, clubs, messages, boost, iap, deal, subscription, …
│   │   ├── routes/            # mounted under /api/*
│   │   └── utils/             # geocode.js (Nominatim), helpers
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # React Router v6 routes
│   │   ├── pages/             # Home, Map, CreateGroup, DealRedeem, Admin, …
│   │   ├── utils/             # api.js (Axios), iap.js, proPlans.js
│   │   └── i18n/locales/      # de.json, en.json
│   ├── public/
│   │   ├── manifest.json      # PWA manifest
│   │   └── .well-known/       # assetlinks.json, apple-app-site-association
│   └── capacitor.config.json
├── twa/                       # Android TWA (RUNBOOK.md + numbered build scripts)
├── store/                     # Store listing + IAP/Stripe docs + assets
└── README.md
```

## Local development

### Prerequisites
- Node.js 20+
- PostgreSQL 14+
- Docker (optional, for `docker-compose`)

### Quick start with Docker

```powershell
docker-compose up
```

### Manual setup

1. Backend:

   ```powershell
   cd backend
   npm install
   Copy-Item .env.example .env   # bash: cp .env.example .env
   npm run dev                   # nodemon, starts on :5000
   ```

2. Frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev                   # Vite dev server on :3000
   ```

The Vite dev server proxies `/api` and `/uploads` to `localhost:5000`.

In `NODE_ENV=development`, email OTP is skipped — the verification code is returned in the API response and the frontend auto-confirms it (no SMTP needed).

### Tests

```powershell
cd backend ; npm test     # vitest run
cd frontend ; npm test    # vitest + React Testing Library
```

## Database migrations

You do **not** run SQL files by hand. On boot, `server.js` runs `runStartupMigrations`, which waits up to 90s for the DB and self-bootstraps every table and column in order (email verification, analytics, deals, subscriptions, boost, push, reports, IAP receipts, deal redemptions, DMs, and all `ALTER`/index steps). The standalone `*_migration.sql` files in `backend/src/config/` are reference snapshots only — startup migrations are the source of truth and create more than any single `.sql` file defines.

- [ ] Provide a reachable `DATABASE_URL` before first boot; startup migrations handle the rest.

> Note: the older "run all 4 migrations manually" instruction (and similar lists in MEMORY.md) is stale.

## Environment variables

Copy `backend/.env.example` to `.env` and fill it in. The variables below are the boot-critical and feature-gating ones verified in code.

### Required in production (missing → process exits with code 1)

| Variable | Notes |
|---|---|
| `JWT_SECRET` | Must be ≥32 chars and must not contain `CHANGE_ME` / `change_me` / `your_secret` |
| `DATABASE_URL` | PostgreSQL connection string |
| `EMAIL_FROM` | Sender address for Resend |
| `RESEND_API_KEY` | Email delivery |
| `FRONTEND_URL` | Public frontend origin |
| `STORAGE_ENDPOINT` | R2/S3 endpoint, e.g. `https://<account>.r2.cloudflarestorage.com` |
| `STORAGE_ACCESS_KEY` | |
| `STORAGE_SECRET_KEY` | |
| `STORAGE_BUCKET` | e.g. `jamie-uploads` |
| `STORAGE_PUBLIC_URL` | Public base URL for uploaded objects, e.g. `https://pub-xxx.r2.dev` |
| `VAPID_PUBLIC_KEY` | Web push |
| `VAPID_PRIVATE_KEY` | Web push |
| `SENTRY_DSN` | Error tracking |

Also fatal in production: `DISABLE_RATE_LIMIT=true` is forbidden — it aborts boot.

### Optional — feature degrades if missing (boot continues with a warning)

| Variable(s) | Effect if missing |
|---|---|
| `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET` | Image moderation disabled |
| `OPENAI_API_KEY` | Text moderation disabled |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Subscription webhook signature validation fails |
| `GOOGLE_CLIENT_ID` | Google OAuth falls back to the unverified userinfo endpoint |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID` | iOS push disabled |

### Notes on `.env.example` drift
- Legacy / unused entries in `.env.example`: `SESSION_SECRET` (auth is JWT-only), `ADMIN_SECRET` (legacy), `VAPID_SUBJECT` (not validated), and `SMTP_*` (superseded by Resend; only used by `docker-compose`).
- Referenced in code but not in `.env.example`: `SOCKET_CSP_ORIGIN`, `RAILWAY_PUBLIC_DOMAIN` (Railway-injected, used by the self-ping cron), the `APNS_*` set, and `STRIPE_PRICE_*` (if/when fixed price IDs replace runtime price creation — see Stripe checklist).
- `VITE_GOOGLE_MAPS_API_KEY` is a frontend build ARG (used at `docker build` / Vite build time), not a backend boot check. Other build ARGs: `VITE_SENTRY_DSN`, `VITE_GOOGLE_CLIENT_ID`, `VITE_VAPID_PUBLIC_KEY`.

## API surface

All routes are mounted under `/api`. Prefixes (each via `app.use`):

```
/api/auth        /api/groups       /api/clubs        /api/messages
/api/notifications  /api/users     /api/dm           /api/friends
/api/spotify     /api/upload       /api/reports      /api/push
/api/analytics   /api/admin        /api/reviews      /api/subscription
/api/boost       /api/iap          /api/map          /api/waitlist
/api/deals       /api/suggestions
```

- Health: `GET` / `HEAD /api/health`.
- Raw-body webhook endpoints (registered before `express.json`): `POST /api/subscription/stripe/webhook`, `POST /api/boost/stripe/webhook`, `POST /api/iap/apple/notifications`.
- In production: SPA catch-all `GET *`, and static `.well-known/apple-app-site-association` + `.well-known/assetlinks.json`.
- `/api/auth` is behind `authLimiter` (rate limited).

### Admin access
There is no admin secret env var. Grant access by flipping the DB flag once:

```sql
UPDATE users SET is_admin = true WHERE email = 'you@example.com';
```

## Payments

JAMIE sells **Pro subscriptions** and **Boost credits**. On web and Android, payments go through Stripe. On iOS, both go through Apple In-App Purchase (App Store Guideline 3.1.1).

### Pro subscription tiers (backend is authoritative — `subscriptionController.js`)

| Key | Price | Per week | amount_cents | Interval | Badge |
|---|---|---|---|---|---|
| `weekly` | 4,99 €/Woche | 4,99 € | 499 | week / 1 | baseline |
| `monthly` | 14,99 €/Monat | 3,46 € | 1499 | month / 1 | "Beliebt" (default, "31% sparen") |
| `sixmonth` | 29,99 €/6 Monate | 1,15 € | 2999 | month / 6 | "Bestes Angebot" ("77% sparen") |

> Repriced 2026-06-11 (previously 14,99 / 22,75 / 58,50). Existing Stripe subscriptions keep their old amount; only new checkouts use the new prices. App Store Connect subscription prices must be updated manually to match.

### Boost credit packages (`boostController.js` / `iap.js`)

| Package | Credits | Price |
|---|---|---|
| `boost_starter` | 1 | 1,99 € |
| `boost_popular` | 5 | 7,99 € |
| `boost_pro` | 15 | 19,99 € |

> The prices and the 3rd-package credit count in `store/STRIPE-MEETING-CHECKLIST.md` (§5a/§5b) disagree with the figures above. The backend, `iap.js`, and `STOREKIT-SETUP.md` are internally consistent; treat the checklist's numbers as out of date.

### IAP product IDs (exact strings, shared across `iap.js` and `iapController.js`)
- Boost consumables: `boost_starter`, `boost_popular`, `boost_pro`
- Subscriptions: `pro_weekly`, `pro_monthly`, `pro_sixmonth`
- Apple purchases use `@capacitor-community/in-app-purchases` (iOS-only, dynamic import).

### Stripe Customer Portal
`POST /api/subscription/portal` returns `{ url }` (frontend: `subscription.openPortal()`). Web + Android only — hidden on iOS, where Apple subscriptions are managed in the App Store. Apple-only subscriptions (customer id prefixed `apple:`) are rejected with `400 { managed_by: 'apple' }`.

- [ ] Activate the Customer Portal once in the Stripe Dashboard (Settings → Billing → Customer portal). Until then the endpoint returns `503 "Stripe Customer Portal ist im Dashboard noch nicht aktiviert"`.

## Deal redemption

Partner deals are visible to **everyone** (the Pro gate was removed 2026-06-09); visibility is controlled per deal by `visible_until`.

- Endpoints: `GET /api/deals`, `GET /api/deals/:id`, `GET /api/deals/:id/redemption`, `POST /api/deals/:id/redeem`; admin: `GET /api/deals/admin/list`, `GET /api/deals/admin/:id/redemptions`, plus `POST/PUT/DELETE /api/deals`.
- One redemption per user, ever: `MAX_REDEMPTIONS_PER_USER = 1`, enforced by a DB `UNIQUE(deal_id, user_id)`. A duplicate returns `409 "Already redeemed"` with the existing `redeemed_at`.
- Proof screen route: `/deal/:id/redeem` (the bottom nav is hidden on this route).
- KPI per deal is `redemption_count`. There is no deal-specific CSV export (admin CSV covers users / screens / suggestions only).

## Maps and group rules

- **Austria-only locations:** `CreateGroup.jsx` restricts Google Places Autocomplete to `country: ['at']` and additionally verifies `country === 'AT'` on selection; step 2 cannot advance otherwise, and pasted foreign addresses are rejected. The backend geocodes with Nominatim (`utils/geocode.js`) and does not enforce country server-side.
- **Groups do not repeat weekly:** `CreateGroup.jsx` always sends `is_recurring_weekly: false`. Weekly repetition is a clubs-events-only feature. (The backend still supports the `is_recurring_weekly` column, but only clubs set it.)

## Scheduled jobs (`node-cron`, backend)

| Schedule | Job |
|---|---|
| `*/14 * * * *` | Self-ping frontend health (prod only; needs `RAILWAY_PUBLIC_DOMAIN` + `FRONTEND_URL`) |
| `0 3 * * *` | Purge `analytics_events` older than 90 days |
| `*/15 * * * *` | "JAMIE Moment" push prompt for events 2h–24h past |
| `0 4 * * *` | Expire pending friendships past `expires_at` (status → `expired`) |

## Android (TWA / Play Store)

Full German runbook: `twa/RUNBOOK.md`. Numbered scripts (run from `twa/`, bash):

```bash
bash 1-generate-keystore.sh      # one-time signing keystore
bash 2-get-sha256.sh             # print SHA-256 fingerprint
bash 3-build.sh                  # build APK/AAB
bash 4-verify-assetlinks.sh      # verify assetlinks on the live domain
```

- App identity: `jamie.app`, host `app.jamie-app.com`, versionName `1` / versionCode `4`, minSdk 21 / targetSdk 35 / compileSdk 36.
- `frontend/public/.well-known/assetlinks.json` currently holds one fingerprint (the dev/upload key). Per `RUNBOOK.md` §6, Play App Signing is not used, so the single upload fingerprint suffices.
- [ ] If Play forces App Signing, add the Play fingerprint: `bash 5-fill-assetlinks.sh "<PLAY_SIGNING_SHA256>"`, commit/push, then re-run `4-verify-assetlinks.sh` (both fingerprints must show, HTTP 200).

## iOS (Capacitor)

```powershell
cd frontend
npm run build
npx cap sync ios
# then open ios/App/App.xcworkspace in Xcode to build and submit (run on macOS)
```

- `@capacitor/keyboard` was added recently. After pulling, you **must** run `npx cap sync ios` (the `cap:build:ios` script does `vite build && npx cap sync ios`).
- Keyboard config: `resize: "body"`, `style: DARK`, `resizeOnFullScreen: true`; the iOS accessory bar is hidden via `Keyboard.setAccessoryBarVisible(false)`.
- Setup details and product creation: `store/STOREKIT-SETUP.md`.
- [ ] Replace the placeholder Apple Team ID in `frontend/public/.well-known/apple-app-site-association` (`YOUR_10_CHAR_TEAM_ID.jamie.app`). Universal Links and Apple sign-in webcredentials will not work until this is filled.

## Legal routes

All public (no auth), defined in `frontend/src/App.jsx`: `/privacy`, `/terms`, `/guidelines`, `/impressum`.

## License

ISC
