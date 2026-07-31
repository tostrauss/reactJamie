# JAMIE — Release Checklist

Master pre-release checklist across web (Railway), iOS (App Store), and Android (Play Store). For the release manager (Tobi / Tina). Work through it top-to-bottom. Boxes marked `- [ ]` are still outstanding.

Commands are PowerShell (this is a Windows project). Bash alternatives are noted where they differ.

---

## Outstanding blockers (do these before submitting)

- [ ] Apple Team ID is still a placeholder in `frontend/public/.well-known/apple-app-site-association` (`YOUR_10_CHAR_TEAM_ID.jamie.app`). Universal Links and Sign in with Apple will not work until replaced. See [iOS → Universal Links](#universal-links).
- [ ] Stripe live activation not finished. Keys were rotated (done), but account activation, Apple Pay domain, products/prices, Stripe Tax, webhooks and Railway env vars are outstanding. See [Web → Stripe](#stripe-live-activation).
- [ ] `SENTRY_DSN` must be set in Railway. It is a required prod env var — the backend calls `process.exit(1)` on boot if it is missing. See [Web → Railway env vars](#railway-env-vars).
- [ ] Run `npx cap sync ios` — `@capacitor/keyboard` was just added and the native iOS project must be synced. See [iOS → Native project](#native-project).
- [ ] Verify iOS IAP product IDs in App Store Connect match the code exactly. See [iOS → IAP](#ios-iap).
- [ ] Activate the Stripe Customer Portal once in the Stripe Dashboard. Until then `POST /api/subscription/portal` returns 503. See [Web → Stripe Customer Portal](#stripe-customer-portal).
- [ ] Run a 3D Secure / real-card test (charge + refund) in live mode. See [Post-launch smoke tests](#post-launch-smoke-tests).

---

## Web (Railway)

### Domain DNS (one-time)
- [ ] `app.jamie-app.com` → CNAME to the Railway service domain (Railway dashboard → Settings → Domains → Add)
- [ ] HTTPS auto-provisioned (Railway / Let's Encrypt) — verify the cert in a browser

### Railway env vars

The backend refuses to boot in production (`process.exit(1)`) if any **required** var below is missing. Generate random secrets with:

```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Bash is identical (`node -e "..."`).

#### Required — boot fails without these
| Var | Notes |
| --- | --- |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | ≥32 chars; must NOT contain `CHANGE_ME` / `change_me` / `your_secret` |
| `DATABASE_URL` | Railway Postgres plugin auto-fills |
| `EMAIL_FROM` | e.g. `JAMIE <noreply@jamie-app.com>` |
| `RESEND_API_KEY` | `re_...` (resend.com → API Keys) |
| `FRONTEND_URL` | `https://app.jamie-app.com` |
| `STORAGE_ENDPOINT` | R2/S3 endpoint |
| `STORAGE_ACCESS_KEY` | R2 key id |
| `STORAGE_SECRET_KEY` | R2 secret |
| `STORAGE_BUCKET` | e.g. `jamie-uploads` |
| `STORAGE_PUBLIC_URL` | `https://pub-xxx.r2.dev` |
| `VAPID_PUBLIC_KEY` | from `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | from the same command |
| `SENTRY_DSN` | **outstanding** — backend error monitoring |

- [ ] `DISABLE_RATE_LIMIT` must NOT be `true` in production — it is a fatal boot error.

#### Recommended — boot continues, feature degrades if missing
| Var | If missing |
| --- | --- |
| `SIGHTENGINE_API_USER` / `SIGHTENGINE_API_SECRET` | image moderation disabled |
| `OPENAI_API_KEY` | text moderation disabled |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | subscription webhook signature validation fails |
| `GOOGLE_CLIENT_ID` | Google OAuth falls back to the unverified userinfo endpoint |
| `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_KEY` / `APNS_BUNDLE_ID` | iOS push disabled |
| `REDIS_URL` | needed only when scaling to >1 instance (Socket.IO Redis adapter) |
| `ADMIN_EMAIL` | inbox for content-report alerts |

Stripe live keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`) are covered under [Stripe live activation](#stripe-live-activation).

#### Build-time (set on the Railway build / Docker ARGs, not runtime)
| Var |
| --- |
| `VITE_SENTRY_DSN` |
| `VITE_GOOGLE_CLIENT_ID` (same value as `GOOGLE_CLIENT_ID`) |
| `VITE_GOOGLE_MAPS_API_KEY` (restrict by HTTP Referrer in GCP) |
| `VITE_VAPID_PUBLIC_KEY` (same value as `VAPID_PUBLIC_KEY`) |

Note: `SESSION_SECRET`, `ADMIN_SECRET`, `VAPID_SUBJECT`, and `SMTP_*` appear in older `.env.example` / docker-compose but are legacy/unused in production (auth is JWT-only; mail is Resend).

### Resend domain setup
- [ ] Add `jamie-app.com` in the Resend dashboard
- [ ] Add the SPF + DKIM TXT records they show you to your DNS
- [ ] Wait for "verified" status (usually <1 hour)
- [ ] Test: register a new account → OTP email arrives

### Database
- [ ] One-time seed: `psql "$env:DATABASE_URL" -f backend/src/config/schema.sql` (bash: `psql "$DATABASE_URL" -f ...`)
- [x] Startup migrations self-bootstrap on first boot (`server.js → runStartupMigrations`) — they create every table and ALTER needed (waits up to 90s for the DB). You do NOT need to run individual `*_migration.sql` files; that old "run all 4 migrations" note is stale.
- [ ] Enable daily backups in Railway → Postgres → Backups
- [ ] Grant yourself admin:
  ```powershell
  psql "$env:DATABASE_URL" -c "UPDATE users SET is_admin=true WHERE email='tobias.p.strauss@gmail.com';"
  ```

### Stripe live activation
Tracked in `store/STRIPE-MEETING-CHECKLIST.md`. Note: the boost/Pro prices in that doc are **outdated** — the authoritative prices are in `iap.js` / `STOREKIT-SETUP.md` / `boostController.js` (see [Pricing reference](#pricing-reference)). Use those.

- [x] Step 1 — rotate keys. Old leaked `sk_live` / `rk_live` revoked; new `sk_live` / `pk_live` captured.
- [ ] Step 2 — activate the Stripe account. Tina (IMPIBAG e.U., sole proprietorship AT): business details, VAT `ATU82812645`, Firmenbuch `FN 670339v`, owner identity verification (selfie + ID), banking IBAN, public statement descriptor `JAMIE`.
- [ ] Step 3 — Apple Pay domain. Host `apple-developer-merchantid-domain-association` at `/.well-known/` in `backend/src/server.js`.
- [ ] Steps 5–7 — create the 6 Stripe products/prices and wire the fixed `price_...` IDs into the backend (currently prices are created at runtime via `prices.create()`); enable Stripe Tax (AT VAT / OSS); add the two webhook endpoints.
- [ ] Steps 8–10 — set the Railway live keys + 2 webhook secrets; run an end-to-end real-card test + refund.
- [ ] Dev cleanup — embed the Apple Pay domain file; replace runtime price creation with fixed price IDs; delete the leaked keys still referenced in `to-do.md`.

#### Stripe webhooks (two endpoints, two secrets)
These POST routes read the raw body before `express.json`, so the signing secret must match exactly.

- [ ] Endpoint 1 — boost: `https://app.jamie-app.com/api/boost/stripe/webhook`
  - Copy "Signing secret" → `STRIPE_WEBHOOK_SECRET`
- [ ] Endpoint 2 — subscription: `https://app.jamie-app.com/api/subscription/stripe/webhook`
  - Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`
  - Copy "Signing secret" → `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`

(The Apple IAP server notification webhook is separate: `https://app.jamie-app.com/api/iap/apple/notifications` — also raw-body, configured in App Store Connect, not Stripe.)

### Stripe Customer Portal
`POST /api/subscription/portal` returns `{ url }` for web + Android users. iOS hides it (Apple subs are managed in the App Store, Guideline 3.1.1; `apple:`-prefixed customers are rejected 400).

- [ ] Activate the portal once in the Stripe Dashboard, otherwise the endpoint returns 503 ("Stripe Customer Portal ist im Dashboard noch nicht aktiviert"):
  - Test: https://dashboard.stripe.com/test/settings/billing/portal
  - Live: https://dashboard.stripe.com/settings/billing/portal

---

## Android (Play Store)

German runbook with full detail: `twa/RUNBOOK.md`. App identity: package `jamie.app`, host `app.jamie-app.com`, versionName `1` / versionCode `4`, minSdk 21 / targetSdk 35.

### Keystore (do this ONCE, back it up forever)
```bash
cd twa
bash 1-generate-keystore.sh    # creates keystore/jamie-release.jks (alias jamie-key)
bash 2-get-sha256.sh           # prints DEV SHA-256
```
- [ ] Back up `jamie-release.jks` to a password manager / encrypted drive — losing it means you can never update the app.

### Asset links
`frontend/public/.well-known/assetlinks.json` already contains the dev/upload key fingerprint (`FD:AC:47:...:62`, package `jamie.app`).

- [x] Decision (RUNBOOK §6): Play App Signing is NOT used — Play uses the upload key directly and the single dev fingerprint is sufficient.
- [ ] Fallback only: if Play forces App Signing (mandatory for new apps since Aug 2021), add the Play fingerprint, then commit/push and verify:
  ```bash
  cd twa
  bash 5-fill-assetlinks.sh "<PLAY_SIGNING_SHA256>"   # ADDS the Play fingerprint, keeps the dev one
  bash 4-verify-assetlinks.sh                          # both must show, HTTP 200
  ```

### Play Console listing
Copy and assets live in `store/PLAY-LISTING.md` and `store/assets/`. Data Safety answers in `store/DATA-SAFETY.md` — keep them in sync with `PrivacyPolicy.jsx`.

- [x] App icon 512×512 (`store/assets/play-icon-512.png`)
- [x] Feature graphic 1024×500 (`store/assets/play-feature-graphic-1024x500.png`)
- [x] Phone screenshots (`store/assets/screenshots/android-phone-01..05.png`, ≥2 required — met)
- [ ] Short + full description (German)
- [ ] Privacy policy URL: `https://app.jamie-app.com/privacy`
- [ ] Content rating questionnaire (social + UGC)
- [ ] Target audience: 18+
- [ ] Data safety form (account, location, photos, messages) — matches `DATA-SAFETY.md`
- [ ] Internal-test account: `playreview@jamie-app.com` — generate a password
- [ ] Note: `twa-manifest.json` `playBilling.enabled = false`. IAP on Android goes through Stripe, not Play Billing.

---

## iOS (App Store)

App Store Connect runbook: `store/STOREKIT-SETUP.md`. Screenshot sizes + DE metadata: `store/app-store-checklist.md`. Bundle id `jamie.app`, host `app.jamie-app.com`.

### Native project
`@capacitor/keyboard` (^8.0.3) was just added, so the iOS project must be re-synced.

```powershell
cd frontend
npm run cap:build:ios      # = vite build && npx cap sync ios
```
- [ ] If you only want to sync without rebuilding: `npx cap sync ios`
- [ ] Open `frontend/ios/App/App.xcworkspace` in Xcode

### In Xcode
- [ ] Signing & Capabilities → Team: your Apple Developer team
- [ ] Bundle Identifier: `jamie.app` (matches `capacitor.config.json`)
- [ ] Capabilities: + Associated Domains → `applinks:app.jamie-app.com`; + Push Notifications; + Sign in with Apple
- [ ] Build for Any iOS Device → Product → Archive → Distribute to App Store Connect

### Universal Links
The AASA file handles `/reset-password*` and `/verify-email*`. It is currently a placeholder.

- [ ] Replace `YOUR_10_CHAR_TEAM_ID` with your real 10-char Apple Team ID in `frontend/public/.well-known/apple-app-site-association` (both `appIDs` and `webcredentials`).
- [ ] Deploy, then verify the file is served as JSON:
  ```powershell
  curl.exe -I https://app.jamie-app.com/.well-known/apple-app-site-association
  # Must return Content-Type: application/json (server.js handles this in prod)
  ```
  Bash: `curl -I https://app.jamie-app.com/.well-known/apple-app-site-association`

### APNs (push notifications)
- [ ] Apple Developer → Certificates → Keys → create a Key with APNs enabled
- [ ] Download the `.p8` (only once — back it up)
- [ ] Set the APNs Railway env vars (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID`) — otherwise iOS push is disabled

<a id="ios-iap"></a>
### IAP (App Store Connect)
Detailed steps in `store/STOREKIT-SETUP.md`.

- [ ] Create all 6 products in App Store Connect with these exact product IDs (must match `frontend/src/utils/iap.js`):
  - Consumables: `boost_starter`, `boost_popular`, `boost_pro`
  - Subscriptions: `pro_weekly`, `pro_monthly`, `pro_sixmonth`
- [ ] Confirm the Capacitor IAP plugin is installed (`@capacitor-community/in-app-purchases`, iOS-only, dynamic import)
- [ ] Set `APPLE_IAP_*` Railway env vars (placeholders for UUID / Key-ID / `.p8`)
- [ ] Sandbox test the purchase + restore flow
- [ ] Flip `APPLE_IAP_ENVIRONMENT` from Sandbox → Production before submitting

### App Store Connect listing
- [ ] Privacy policy URL: `https://app.jamie-app.com/privacy`
- [ ] Support URL on the same domain
- [ ] Screenshots present: `store/assets/screenshots/ios-6_7-inch-01..03`, `ios-6_5-inch-01..03`, `ios-5_5-inch-01..03`. **Verify 6.9" coverage** — `app-store-checklist.md` marks 6.9" (1320×2868) as required, but the folder is named `6_7`, not `6_9`. Re-shoot or rename as needed.
- [ ] App description (German primary)
- [ ] Age rating: 17+ (social + UGC)
- [ ] App Privacy section: Email, Name, Photos/Videos, Precise Location, User Content, Crash Data, Performance Data — linked to user, none used for tracking
- [ ] Review test account: `review@jamie-test.com` — create and set a password (`app-store-checklist.md`)

---

## Legal routes (already live, just confirm)
All public, no auth required (`frontend/src/App.jsx`):
- [x] `/privacy`, `/terms`, `/guidelines`, `/impressum`

---

<a id="pricing-reference"></a>
## Pricing reference (authoritative)
Source of truth: `backend/src/controllers/subscriptionController.js`, `boostController.js`, `frontend/src/utils/iap.js`, `store/STOREKIT-SETUP.md`. (Ignore the conflicting numbers in `STRIPE-MEETING-CHECKLIST.md`.)

### Pro subscriptions
| Plan | Product ID | Price | Per week | Note |
| --- | --- | --- | --- | --- |
| Wöchentlich | `pro_weekly` | 14,99 €/Woche | 14,99 € | baseline |
| Monatlich | `pro_monthly` | ca. 22,75 €/Monat | 5,25 € | "65% sparen", DEFAULT, badge "Beliebt" |
| 6 Monate | `pro_sixmonth` | 58,50 €/6 Monate | 2,25 € | "85% sparen", badge "Bestes Angebot" |

### Boost consumables
| Package | Product ID | Credits | Price |
| --- | --- | --- | --- |
| Starter | `boost_starter` | 1 | 1,99 € |
| Popular | `boost_popular` | 5 | 7,99 € |
| Pro | `boost_pro` | 15 | 19,99 € |

---

## Feature notes for review (current behavior)
- **Deal redemption** — visible to everyone (Pro gate removed 2026-06-09; controlled by `visible_until`). One redemption per user, ever (`MAX_REDEMPTIONS_PER_USER = 1`, DB `UNIQUE(deal_id, user_id)`, duplicate → 409). Proof screen route `/deal/:id/redeem` (bottom nav hidden there). Admin views: `GET /api/deals/admin/list`, `GET /api/deals/admin/:id/redemptions`. No CSV export for deals.
- **Austria-only locations** — group/club creation is hard-restricted to Austria (`CreateGroup.jsx`: Google Places `country: ['at']` + explicit `country === 'AT'` check; manual foreign addresses rejected). Backend geocodes via Nominatim without country enforcement.
- **Groups no longer repeat weekly** — `CreateGroup.jsx` always sends `is_recurring_weekly: false`. Weekly repetition is a clubs-events-only feature now.

---

<a id="post-launch-smoke-tests"></a>
## Post-launch smoke tests
- [ ] `GET /api/health` returns ok (also responds to HEAD)
- [ ] Register a new account → OTP email arrives (check spam)
- [ ] Password reset → email arrives, link works, lands in the app
- [ ] Create a group (Austrian address) → image upload succeeds (R2 URL in response)
- [ ] Create a group with a foreign address → rejected
- [ ] Stripe live-mode charge to your own card → webhook fires → boost credit added
- [ ] 3D Secure / SCA test: use a card that requires authentication → flow completes → then refund it
- [ ] Stripe Customer Portal opens from the web/Android subscription screen (not 503)
- [ ] Deal redemption: redeem a deal → proof screen shows → second attempt returns 409
- [ ] Push notification: subscribe → fire from another account's chat → receive on device
- [ ] iOS IAP: sandbox-buy a boost and a Pro plan → credits/entitlement granted
- [ ] Admin dashboard at `/admin` loads for your `is_admin` user
- [ ] Open the TWA on Android — no URL bar (asset links working)
- [ ] Open the password-reset email on iOS — opens the app, not Safari (Universal Links working)








//// 31.07 Last changes — STATUS (Claude, 2026-07-31)

1. ✅ **Anfragen abgeschnitten** — Anfragen-Modal (ChatList) hing an fixem `85vh` +
   `aspect-ratio`-Bild; auf Tinas privater Gruppe wuchs das Hochkant-Foto über den
   Screen und schob ✓/✗ raus. Fix: Sheet `height:auto` (max 90vh) + Bild mit
   fester Höhe (`34vh`, max 300px) statt aspect-ratio. → `chat.css`
2. ✅ **Bubble wie Nomadtable** — Join-Request-Bubble zeigt jetzt das **Profilbild
   des Anfragenden + „Neue Anfrage"** (bei mehreren: „N neue Anfragen"). Kein
   „Travelers Here"-Text. Backend liefert `latest_avatar`. → `MapView.jsx`,
   `home.css`, `mapController.js`
3. ✅ **Glocke pro Gruppe** — Bell im Chat-Header stellt Push-Benachrichtigungen
   pro Gruppe an/aus. Neue Spalte `group_members.notifications_muted` (Auto-
   Migration), Endpoint `PUT /groups/:id/notifications`, Push-Fan-out überspringt
   gemutete Mitglieder (In-App-Badge bleibt). → ChatPage + groupController +
   messageController + i18n (de/en/it)
4. ✅ **Emojis 📅/📍 weg** — im Chat-Header neben Datum & Ort entfernt. → `ChatPage.jsx`
5. ⏳ **iOS Splash-Logo zu klein** — Ursache liegt im nativen iOS-Projekt (nicht im
   Repo, nur auf Tinas Mac). Splash-Quelle ist neu generiert:
   `frontend/assets/splash.png` + `splash-dark.png` (2732², #231B43, Wortmark
   mittig, gut sichtbar). **Auf dem Mac ausführen:**
   ```
   cd frontend
   npm run build && npx cap sync ios
   npx @capacitor/assets generate --ios \
     --splashBackgroundColor '#231B43' --splashBackgroundColorDark '#231B43'
   npx cap sync ios
   ```
   Danach in Xcode am Simulator prüfen (Logo groß & mittig auf Lila, kein Schwarz).
   Fallback ohne Tool: in `App/App/Assets.xcassets/Splash.imageset/` die 3 PNGs
   durch `frontend/assets/splash.png` ersetzen; LaunchScreen-Storyboard-Hintergrund
   = #231B43, ImageView contentMode = Aspect Fill.

### Vor dem Upload (manuell — nicht im Repo automatisiert)
- **Android versionCode**: steht auf **10** (twa-manifest + build.gradle). Wenn 10
  schon mal hochgeladen wurde → auf 11 erhöhen (Play verlangt streng steigend).
  ⚠️ Bubblewrap-Falle: nach twa-manifest-Edit Checksum neu schreiben, beim Build
  **nie** „update project" bestätigen (macht targetSdk zurück auf 35).
- **iOS Build-Nummer**: CFBundleVersion in Xcode für neuen App-Store-Build erhöhen.
- versionName ggf. 1.1 → 1.2 (substantielle Changes).
- Tests grün: Backend 95 ✓, Frontend 15 ✓, Vite-Build ✓ (Stand 31.07).