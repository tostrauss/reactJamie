# JAMIE — Deployment Guide (Railway)

How to deploy the JAMIE backend (with the bundled frontend) to Railway: set env vars, point the domain, verify health, run the smoke test. Audience: whoever runs the deploy.

The backend serves the built frontend from the same origin in production. There is no separate frontend host. Native app store submission is covered elsewhere (`twa/RUNBOOK.md`, `store/STOREKIT-SETUP.md`, `store/PLAY-LISTING.md`) — not in this doc.

## What gets deployed

- One Railway service built from the **root `Dockerfile`** (two-stage: build the Vite frontend, then run the Node backend and serve the frontend `dist/` as static `public/`).
- Production domain: `app.jamie-app.com`. Frontend and `/api/*` are the same origin.
- The backend creates/updates its own DB tables on boot (see [Migrations on boot](#7-migrations-on-boot)). You do not run migration files by hand.

## Prerequisites

```
Node.js 20+, npm 10+ (build is done in Docker, so local versions only matter for local runs)
Railway account + Railway CLI
A PostgreSQL database (Railway Postgres)
Cloudflare R2 (or S3-compatible) bucket for uploads
Resend account (transactional email)
Sentry project (error tracking)
```

## 1. Required env vars

Set these in the Railway service. With `NODE_ENV=production`, if **any** of these is missing the server logs the missing keys and calls `process.exit(1)` — the deploy will crash-loop until they are all set.

| Variable | Notes |
|---|---|
| `JWT_SECRET` | Must be **≥ 32 chars** and must **not** contain `CHANGE_ME` / `change_me` / `your_secret`. Generate one below. |
| `DATABASE_URL` | Postgres connection string (Railway Postgres). |
| `EMAIL_FROM` | e.g. `JAMIE <noreply@jamie-app.com>` — must be on a verified Resend domain. |
| `RESEND_API_KEY` | From resend.com → API Keys. |
| `FRONTEND_URL` | e.g. `https://app.jamie-app.com`. Comma-separate for multiple allowed origins. |
| `STORAGE_ENDPOINT` | R2: `https://<account>.r2.cloudflarestorage.com` |
| `STORAGE_ACCESS_KEY` | R2 Access Key ID |
| `STORAGE_SECRET_KEY` | R2 Secret Access Key |
| `STORAGE_BUCKET` | e.g. `jamie-uploads` |
| `STORAGE_PUBLIC_URL` | Public bucket URL, e.g. `https://pub-xxx.r2.dev` |
| `VAPID_PUBLIC_KEY` | Web push. Generate below. |
| `VAPID_PRIVATE_KEY` | Web push. Generate below. |
| `SENTRY_DSN` | Backend error tracking. |

Also enforced as **FATAL** in production:

- [ ] `DISABLE_RATE_LIMIT=true` is **forbidden** in production. Leave it unset (or `false`). If set to `true`, the server refuses to start.

Generate secrets (PowerShell, calling Node):

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET (≥32 chars)
npx web-push generate-vapid-keys                                            # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

bash equivalent is identical (`node -e ...` and `npx web-push generate-vapid-keys`).

## 2. Warned env vars (optional)

These are **not** required to boot. If missing, the server logs a warning and starts with the matching feature degraded.

| Variable(s) | If missing |
|---|---|
| `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET` | Image moderation disabled |
| `OPENAI_API_KEY` | Text moderation disabled |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Subscription webhook signature validation fails |
| `GOOGLE_CLIENT_ID` | Google OAuth falls back to the unverified userinfo endpoint |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID` | iOS push disabled |

Other env vars that are referenced but **not** boot-checked (set as needed):

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Stripe live key + boost/one-time-purchase webhook secret (payments / boost).
- `REDIS_URL` — optional; enables the Socket.IO Redis adapter and shared rate-limit state across instances.
- `SOCKET_CSP_ORIGIN` — extra origin allowed in the CSP for sockets, if needed.
- `RAILWAY_PUBLIC_DOMAIN` — injected by Railway; used by the self-ping cron.

> Legacy / unused — do **not** rely on these: `SESSION_SECRET` (auth is JWT-only), `ADMIN_SECRET` (legacy), `SMTP_HOST/PORT/USER/PASS` (superseded by Resend). They may appear in `.env.example` or `docker-compose` but the production server does not use them.

## 3. Frontend build args (baked at Docker build time)

The frontend is built inside the Dockerfile. These are **build ARGs**, not runtime env vars — set them as Railway build variables so they get compiled into the bundle:

| Build ARG | Notes |
|---|---|
| `VITE_SENTRY_DSN` | Frontend Sentry DSN |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Places/Maps (Austria-restricted autocomplete on group/club create) |
| `VITE_VAPID_PUBLIC_KEY` | Same value as backend `VAPID_PUBLIC_KEY` |

## 4. Railway configuration (already in repo)

`railway.toml`:

```toml
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/api/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

The root `Dockerfile` sets `PORT=5000` and `NODE_ENV=production`, runs `CMD node src/server.js`, and `EXPOSE 5000`. There is no `PORT` in `railway.toml`. The server uses `keepAliveTimeout` 65s / `headersTimeout` 66s.

> `backend/Dockerfile` is for **local dev only**. Railway uses the **root** `Dockerfile`.

## 5. Deploy

```powershell
# Install + log in (once)
npm install -g @railway/cli
railway login
railway link

# Set required env vars (repeat for each row in section 1)
railway variables set JWT_SECRET=<value>
railway variables set DATABASE_URL=<value>
# ...etc

# Deploy
railway up
```

Railway builds the root `Dockerfile`, runs the healthcheck against `/api/health`, and on failure retries up to 3 times. If the build keeps restarting, check the logs for the "missing required env var" list (section 1) or the `DISABLE_RATE_LIMIT` fatal.

## 6. Domain

- [ ] In the Railway service → **Settings → Networking → Custom Domain**, add `app.jamie-app.com` and create the CNAME it shows at your DNS provider.
- [ ] Wait for the certificate to provision (Railway issues TLS automatically).

Frontend and API share this one origin. The server also serves, in production:

- `GET /.well-known/assetlinks.json` (Android TWA digital asset links)
- `GET /.well-known/apple-app-site-association` (iOS Universal Links / Apple sign-in)
- SPA catch-all `GET *` (serves the React app)

## 7. Migrations on boot

There is **no manual migration step**. On startup the server runs `runStartupMigrations()`, which waits for the DB (up to 90s — 18 retries × 5s) and then creates tables if they don't exist, in this order:

```
email_verification_codes → waitlist_votes → analytics_events → category_suggestions →
event_reviews → waitlist → country_votes → pioneer_claims → deals → subscriptions →
referral_codes → boost_credits → boosts → boost_transactions → push_subscriptions →
reports → password_reset_tokens → direct_messages → dm_conversations → iap_receipts →
deal_redemptions
```

`deal_redemptions` comes **last**, after `deals`, because of its FK `deal_id REFERENCES deals(id)`. Startup also runs idempotent `ALTER`/index/`CHECK` steps on existing `users`, `groups`, `friendships`, and `group_members`.

Notes:

- This bootstrap is the source of truth. The standalone `*_migration.sql` files in `backend/src/config/` are historical; the startup routine creates **more** than any of them define. Do not run them by hand against production.
- A truly empty database also works — boot will create everything. (`schema.sql` is a seed/reference, not required.)

## 8. Background jobs (run automatically)

`node-cron` schedules these once the server is up:

| Schedule | Job |
|---|---|
| `*/14 * * * *` | Self-ping the frontend health URL (prod only; needs `RAILWAY_PUBLIC_DOMAIN` + `FRONTEND_URL`) |
| `0 3 * * *` | Purge `analytics_events` older than 90 days |
| `*/15 * * * *` | "JAMIE Moment" push prompt for events 2h–24h past |
| `0 4 * * *` | Expire pending friendships past `expires_at` (status → `expired`) |

## 9. Verify health

```powershell
# Liveness — expect HTTP 200
curl.exe -i https://app.jamie-app.com/api/health
```

The healthcheck path is `GET`/`HEAD /api/health`. Railway also probes it during deploy (`healthcheckPath = /api/health`, 30s timeout).

## 10. Post-deploy smoke test

Run these against production after a deploy. Check each off:

- [ ] `GET /api/health` returns 200 (`curl.exe -i https://app.jamie-app.com/api/health`).
- [ ] App loads: open `https://app.jamie-app.com/` — SPA renders, no console errors.
- [ ] Asset links served:
      `curl.exe -i https://app.jamie-app.com/.well-known/assetlinks.json` (200, JSON) and
      `curl.exe -i https://app.jamie-app.com/.well-known/apple-app-site-association` (200, JSON).
- [ ] Auth: request an email login code on `/login`, confirm the email arrives via Resend (check spam).
- [ ] Upload: create/edit a profile or group photo — confirm the image URL points at `STORAGE_PUBLIC_URL` (R2), not a local `/uploads` path.
- [ ] Deals: open a deal, redeem it via the proof screen `/deal/:id/redeem`. Redeeming the same deal again must return **409 "Already redeemed"** (one redemption per user, ever).
- [ ] Group create is **Austria-only**: address autocomplete only offers AT results, and a pasted foreign address is rejected at step 2. New standalone groups are created with `is_recurring_weekly: false` (weekly repeat is a clubs-events-only feature).
- [ ] Push: subscribe to web push and confirm a notification arrives on a real device.
- [ ] Sentry: confirm the backend (and frontend, if `VITE_SENTRY_DSN` was set) reports into the Sentry project.

## 11. Payments — one-time setup (not per-deploy)

These do not block boot but must be done before charging real users. Full runbook: `store/STRIPE-MEETING-CHECKLIST.md`.

- [ ] **Stripe Customer Portal**: activate it once in the Stripe Dashboard
      (`https://dashboard.stripe.com/test/settings/billing/portal`, or live `/settings/billing/portal`).
      If not activated, `POST /api/subscription/portal` returns **503 "Stripe Customer Portal ist im Dashboard noch nicht aktiviert"**.
      The portal is web + Android only; on iOS it is hidden (Apple subs are managed in the App Store). Apple-only subscriptions (`stripe_customer_id` starting `apple:`) are rejected with 400 `{ managed_by: 'apple' }`.
- [ ] Set live `STRIPE_SECRET_KEY` and both webhook secrets: `STRIPE_WEBHOOK_SECRET` (boost / one-time purchases), `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` (Pro subscriptions).
- [ ] Register the two raw-body webhook endpoints in Stripe (see [API surface](#api-surface-reference)).

### Pricing reference (backend = source of truth)

Pro subscriptions (`subscriptionController.js` `PRO_PLANS`):

| Plan | Price | Per week | Interval | Note |
|---|---|---|---|---|
| `weekly` | 14,99 €/Woche | 14,99 € | week / 1 | baseline |
| `monthly` | 22,75 €/Monat | 5,25 € | month / 1 | default; badge "Beliebt", "65% sparen" |
| `sixmonth` | 58,50 €/6 Monate | 2,25 € | month / 6 | badge "Bestes Angebot", "85% sparen" |

Boost consumables (`boostController.js` `BOOST_PACKAGES`):

| Package | Credits | Price |
|---|---|---|
| `boost_starter` | 1 | 1,99 € |
| `boost_popular` | 5 | 7,99 € |
| `boost_pro` | 15 | 19,99 € |

> `store/STRIPE-MEETING-CHECKLIST.md` lists **different** boost/Pro prices and credit counts (e.g. 12 credits, 4,99 €). Those are outdated. The backend controllers, `frontend/src/utils/iap.js`, and `store/STOREKIT-SETUP.md` agree on the values above — use them.

## 12. In-app purchases (IAP)

IAP product IDs (must match App Store Connect; `iapController.js` `APPLE_PRODUCTS` / `frontend/src/utils/iap.js`):

- Consumables: `boost_starter`, `boost_popular`, `boost_pro`
- Subscriptions: `pro_weekly`, `pro_monthly`, `pro_sixmonth`

Notes:

- iOS uses the `@capacitor-community/in-app-purchases` plugin (iOS-only, dynamic import). Web and Android use Stripe.
- Apple server-to-server notifications hit `POST /api/iap/apple/notifications` (raw body). V2 statuses map: `DID_RENEW`/`SUBSCRIBED` → active, `DID_CHANGE_RENEWAL_STATUS` (auto-renew off) → canceling, `EXPIRED`/`GRACE_PERIOD_EXPIRED` → expired, `REVOKE`/`REFUND` → revoked.
- Apple-granted subscriptions are stored with `stripe_subscription_id = apple:<origTxId>` and `stripe_customer_id = apple:<userId>`.

## 13. Capacitor sync (mobile, after a frontend change)

`@capacitor/keyboard` was added, so an iOS native sync is required:

```powershell
cd frontend
npm run build
npx cap sync ios       # required after the @capacitor/keyboard addition; also `npm run cap:build:ios`
npx cap sync android
```

App identity: `appId` is `jamie.app`; server hostname `app.jamie-app.com`. PWA manifest: name "JAMIE - Social Activity App", short_name "JAMIE", theme/background `#231B43`, display standalone, portrait, lang `de`.

## API surface (reference)

Mounted route prefixes (all under `/api`):

```
auth (rate-limited), groups, clubs, messages, notifications, users, dm, friends,
spotify, upload, reports, push, analytics, admin, reviews, subscription, boost,
iap, map, waitlist, deals, suggestions
```

Raw-body webhook endpoints (registered **before** `express.json`):

```
POST /api/subscription/stripe/webhook   (Stripe subscription events)
POST /api/boost/stripe/webhook          (Stripe boost events)
POST /api/iap/apple/notifications        (Apple server notifications)
```

Stripe subscription webhook listens for: `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.

## Backups

- [ ] Enable daily Railway Postgres backups: Railway dashboard → Postgres service → Backups.
- [ ] Periodic manual export:
      ```powershell
      railway run pg_dump -Fc > backup-$(Get-Date -Format yyyyMMdd).dump
      ```
      bash: `railway run pg_dump -Fc > backup-$(date +%Y%m%d).dump`
- [ ] Store backups offsite (R2 / S3 / Drive) and test a restore periodically:
      ```powershell
      pg_restore -d jamie_db_staging backup-YYYYMMDD.dump
      ```

## Admin access

No secret env var. Promote a user directly in the DB:

```powershell
psql $env:DATABASE_URL -c "UPDATE users SET is_admin=true WHERE email='you@example.com';"
```
