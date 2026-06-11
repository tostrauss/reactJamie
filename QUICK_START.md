# QUICK START

Fastest path to a running local dev environment for JAMIE (backend + frontend). For a developer who just cloned the repo. For production deploys, see [DEPLOYMENT.md](DEPLOYMENT.md).

JAMIE is a social activity PWA (German UI, Austria/Germany market). Backend: Node.js + Express + PostgreSQL + Socket.IO. Frontend: React 18 + Vite. Both use ES modules.

## Prerequisites

- [ ] Node.js >= 20.0.0 and npm >= 10.0.0 (enforced by `engines` in both `package.json` files)
- [ ] PostgreSQL running locally (default `localhost:5432`)
- [ ] Git

Check your versions:

```powershell
node --version
npm --version
```

## 1. Install dependencies

Install backend and frontend separately (two `package.json` files, no workspace root).

```powershell
npm install --prefix backend
npm install --prefix frontend
```

Bash equivalent:

```bash
(cd backend && npm install)
(cd frontend && npm install)
```

## 2. Database setup

PostgreSQL must be running first. Create the database and load the seed schema.

```powershell
createdb jamie_db
psql -U postgres -d jamie_db -f backend/src/config/schema.sql
```

You do not need to run the individual `*_migration.sql` files by hand. On boot, `backend/src/server.js` runs startup migrations that self-bootstrap every table and column the app needs (it waits up to 90s for the DB). The standalone `.sql` files in `backend/src/config/` are reference/seed copies only.

> The old MEMORY note saying "ALL 4 migrations must be run" is stale. Startup migrations handle this now.

## 3. Environment variables

Copy the example files. Backend dev does **not** crash on missing keys — the hard `process.exit(1)` checks only run when `NODE_ENV=production`. For local dev, keep `NODE_ENV=development`.

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
```

Bash equivalent:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

### Minimal backend `.env` to not crash (dev)

Edit `backend/.env`. These are the only values you must set for a working local backend:

| Var | Dev value | Notes |
|---|---|---|
| `NODE_ENV` | `development` | Keeps the production env-var guard off |
| `PORT` | `5000` | Backend listens here; Vite proxies to it |
| `DB_HOST` | `localhost` | |
| `DB_PORT` | `5432` | |
| `DB_NAME` | `jamie_db` | Must match the DB you created in step 2 |
| `DB_USER` | `postgres` | |
| `DB_PASSWORD` | your local PG password | |
| `JWT_SECRET` | any string | Dev is lenient; prod requires >=32 chars and rejects `CHANGE_ME`/`change_me`/`your_secret` |
| `FRONTEND_URL` | `http://localhost:3000` | Used for CORS and email links |

Email OTP is bypassed in dev: when `NODE_ENV !== production`, the verification code check is skipped and `sendEmailCode` returns the code as `devCode`, so you can register without a mail provider.

### Optional backend keys (features degrade gracefully if unset)

Leave these empty for a basic local run. The server boots and logs a warning; the feature is disabled.

| Var | Feature when unset |
|---|---|
| `STORAGE_*` (`STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`, `STORAGE_PUBLIC_URL`) | Uploads fall back to local `/uploads` directory (served only in dev) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Real email sending (not needed thanks to dev OTP bypass) |
| `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET` | Image moderation disabled |
| `OPENAI_API_KEY` | Text moderation disabled |
| `GOOGLE_CLIENT_ID` | Google OAuth uses the unverified userinfo endpoint |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web push disabled |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID` | iOS push disabled |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Payments (Pro subscriptions, boosts) disabled |
| `SENTRY_DSN` | Error reporting disabled |

> `DISABLE_RATE_LIMIT=true` is forbidden in production (fatal on boot). Fine to leave unset in dev.

### Minimal frontend `.env.local` (dev)

The defaults in `frontend/.env.example` work for local dev. `VITE_API_URL=/api` lets Vite proxy API calls to the backend, so you do not need to set a host. Optional frontend keys:

| Var | Feature when unset |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | "Sign in with Google" button hidden |
| `VITE_GOOGLE_MAPS_API_KEY` | Karte / map tab will not render |
| `VITE_VAPID_PUBLIC_KEY` | Web push subscribe disabled (must match backend `VAPID_PUBLIC_KEY`) |
| `VITE_SENTRY_DSN` | Frontend error reporting disabled |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Card / Apple Pay checkout disabled |

## 4. Start the servers

Two terminals.

Terminal 1 — backend (auto-reload via nodemon):

```powershell
npm run dev --prefix backend
```

Backend runs on **http://localhost:5000**. Health check: `GET http://localhost:5000/api/health`.

Terminal 2 — frontend (Vite dev server):

```powershell
npm run dev --prefix frontend
```

Frontend runs on **http://127.0.0.1:3000**. Vite proxies `/api`, `/uploads`, and `/socket.io` to the backend at `http://127.0.0.1:5000` (see `frontend/vite.config.js`), so no CORS setup is needed in dev.

## 5. Smoke test

- [ ] Open http://127.0.0.1:3000
- [ ] Register a new account (email OTP is auto-filled in dev)
- [ ] Create a group — the location picker is **Austria-only** (`country: 'AT'` is enforced on the Places autocomplete and again on submit); a non-AT address is rejected. Standalone groups send `is_recurring_weekly: false` and never repeat weekly (weekly repetition is a clubs-events-only feature)
- [ ] Send a chat message in a group (Socket.IO realtime)

## Available scripts

Backend (`backend/`):

| Script | What it does |
|---|---|
| `npm run dev` | Start with nodemon auto-reload |
| `npm start` | `node src/server.js` (production-style start) |
| `npm test` | `vitest run` |
| `npm run test:watch` | `vitest` watch mode |
| `npm run test:coverage` | `vitest run --coverage` |

Frontend (`frontend/`):

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (port 3000) |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |
| `npm test` | `vitest run` |
| `npm run cap:build:ios` | `vite build && npx cap sync ios` |
| `npm run cap:build:android` | `vite build && npx cap sync android` |

> `@capacitor/keyboard` was added to the iOS build. After pulling, run `npx cap sync ios` (or `npm run cap:build:ios`) before opening Xcode, or the native build will be missing the plugin.

## Notes for later (not needed to run locally)

These features exist in the codebase. You do not need them for a local dev loop, but here is where they live:

- **Deal redemption** — one redemption per user, ever (`MAX_REDEMPTIONS_PER_USER = 1`, DB `UNIQUE(deal_id, user_id)`; a duplicate returns `409 Already redeemed`). Proof screen route: `/deal/:id/redeem`. Deals are visible to everyone (the Pro gate was removed 2026-06-09; visibility is controlled by `visible_until`).
- **Pro subscriptions** (backend `PRO_PLANS`): weekly 14,99 €/Woche (`pro_weekly`), monthly ~22,75 €/Monat (`pro_monthly`, default, "Beliebt"), 6-month 58,50 € (`pro_sixmonth`, "Bestes Angebot").
- **Boost consumables** (IAP product IDs): `boost_starter` (1 credit), `boost_popular` (5), `boost_pro` (15).
- **Stripe Customer Portal** — `POST /api/subscription/portal` returns `{ url }`. Web + Android only; hidden on iOS (Apple subs are managed in the App Store). Requires a one-time portal activation in the Stripe Dashboard, or the endpoint returns `503`.
- **Payments split**: web + Android use Stripe; iOS uses native IAP via `@capacitor-community/in-app-purchases`.

## Troubleshooting

**DB connection error** — Confirm PostgreSQL is running and that `DB_NAME`/`DB_USER`/`DB_PASSWORD` in `backend/.env` match your local instance. The server waits up to 90s for the DB on startup migrations.

**Port already in use** — Change `PORT` in `backend/.env` (and update the proxy target in `frontend/vite.config.js`), or change `server.port` in `frontend/vite.config.js`.

**CORS error in dev** — You should not hit one; the Vite proxy avoids cross-origin calls. If you do, verify `FRONTEND_URL=http://localhost:3000` in `backend/.env` and that both servers are on the expected ports (backend 5000, frontend 3000).

**Backend exits immediately with a missing-env error** — You set `NODE_ENV=production`. Set it to `development` for local dev.
