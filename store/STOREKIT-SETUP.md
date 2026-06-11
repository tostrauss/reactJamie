# Apple In-App Purchase (StoreKit) Setup

What this is: the runbook for setting up Apple In-App Purchases for JAMIE. Who it's for: the person submitting the iOS app. Android (TWA) does not need any of this — it uses Stripe.

Apple Guideline 3.1.1 requires StoreKit for all digital goods sold inside an iOS app. So on iOS, boosts and Pro subscriptions go through StoreKit. Stripe stays live on web and Android only. The iOS Stripe path must be completely hidden.

The code skeleton already exists. Your job is the App Store Connect config, the env vars, and the Sandbox test.

## What's already in the code

| Piece | Location |
|---|---|
| Frontend IAP abstraction | `frontend/src/utils/iap.js` (`IAP_PRODUCTS`) |
| iOS purchase routing | `frontend/src/components/BoostModal.jsx`, `frontend/src/components/ProModal.jsx` |
| Backend verify + grant | `backend/src/controllers/iapController.js` (`APPLE_PRODUCTS`) |
| Backend routes | `backend/src/routes/iapRoutes.js` |
| Server notifications webhook | `backend/src/controllers/iapController.js` `appleServerNotification` |
| Receipt table | `iap_receipts` — auto-created on server boot (startup migration). No SQL to run by hand. |

Backend routes (all under the `/api/iap` prefix):

| Method + path | Handler | Auth |
|---|---|---|
| `POST /api/iap/apple/verify` | `verifyApple` | JWT + strict rate limit |
| `POST /api/iap/apple/restore` | `restoreApple` | JWT + strict rate limit |
| `POST /api/iap/apple/notifications` | `appleServerNotification` | none (raw-body JWS webhook, mounted before `express.json`) |

## Product IDs (must match the code exactly)

The product IDs you create in App Store Connect must match the constants in `frontend/src/utils/iap.js` (`IAP_PRODUCTS`) and `backend/src/controllers/iapController.js` (`APPLE_PRODUCTS`). The backend is authoritative on what each product grants — a tampered client cannot fake the credit count.

These six IDs are verified identical across the frontend, the backend, and this doc.

### Boost credits — Consumable

| Product ID | Type | Credits granted | Price |
|---|---|---|---|
| `boost_starter` | Consumable | 1 | 1,99 € |
| `boost_popular` | Consumable | 5 | 7,99 € |
| `boost_pro` | Consumable | 15 | 19,99 € |

The prices and credit counts above match the backend `boostController` `BOOST_PACKAGES` (1 credit / 199, 5 credits / 799, 15 credits / 1999) and the `IAP_PRODUCTS` credit counts (1 / 5 / 15).

> Price-mismatch flag: `store/STRIPE-MEETING-CHECKLIST.md` lists DIFFERENT values — boosts 1.99 / 4.99 / 9.99 € for 1 / 5 / 12 credits, and Pro 3.49 / 9.99 / 19.99 €. Those numbers are wrong. The code (`iap.js`, `iapController.js`, `boostController.js`) and this doc are internally consistent; STRIPE-MEETING-CHECKLIST is the outlier. Use the values in this doc. The third boost is 15 credits, not 12.

### Pro subscription — Auto-Renewable

Create one Subscription Group first ("JAMIE Pro"), then these three subscriptions inside it.

| Product ID | Duration | Price | Per week | Note |
|---|---|---|---|---|
| `pro_weekly` | 1 Week | 4,99 € | 4,99 € | baseline |
| `pro_monthly` | 1 Month | 14,99 € | 3,46 € | "31% sparen", default, badge "Beliebt" |
| `pro_sixmonth` | 6 Months | 29,99 € | 1,15 € | "77% sparen", badge "Bestes Angebot" |

These match the backend `subscriptionController.js` `PRO_PLANS` (amount_cents 499 week/1, 1499 month/1, 2999 month/6) and the frontend `frontend/src/utils/proPlans.js`. (Repriced 2026-06-11 — previously 14,99 / 22,75 / 58,50.)

> Apple price tiers are discrete — pick the closest tier to each target. If a tier cannot match the exact amount, change `PRO_PLANS` in `backend/src/controllers/subscriptionController.js` to match Apple's tier so web/iOS show the same price.

## How verification works (so you know what "good" looks like)

This uses StoreKit 2 JWS, not the legacy `verifyReceipt` endpoint.

1. iOS buys the product through `@capacitor-community/in-app-purchases`. StoreKit returns a JWS-signed `transactionReceipt`.
2. The app POSTs `{ product_type, product_id, receipt, transaction_id }` to `POST /api/iap/apple/verify`.
3. The backend verifies the JWS against Apple's signing chain using `@apple/app-store-server-library` (`SignedDataVerifier.verifyAndDecodeTransaction`).
4. It re-checks `bundleId`, `productId`, and `transactionId` against what the client claimed (defense in depth).
5. It inserts into `iap_receipts` (UNIQUE per transaction → idempotent) and atomically grants credits (boost) or activates the subscription.
6. For subscriptions, the Apple row is keyed by `stripe_subscription_id = apple:<originalTransactionId>` and `stripe_customer_id = apple:<userId>`, so the Pro status getter reads it the same as a Stripe row.

Server Notifications V2 (`POST /api/iap/apple/notifications`) keep the subscription in sync after the first purchase. Status mapping:

| Apple notification | Subscription status |
|---|---|
| `DID_RENEW`, `SUBSCRIBED` | `active` (period end extended) |
| `DID_CHANGE_RENEWAL_STATUS` + subtype `AUTO_RENEW_DISABLED` | `canceling` |
| `DID_CHANGE_RENEWAL_STATUS` + subtype `AUTO_RENEW_ENABLED` | `active` |
| `EXPIRED`, `GRACE_PERIOD_EXPIRED` | `expired` |
| `REVOKE`, `REFUND` | `revoked` (Pro lost immediately) |

Apple retries on 5xx with exponential backoff. The endpoint returns 202 for undecodable payloads so Apple stops retrying garbage, and 200 for non-transaction notifications (TEST, PRICE_INCREASE).

## 1. Install dependencies

```powershell
# Backend — Apple's StoreKit 2 server library (JWS verification)
npm --prefix backend install @apple/app-store-server-library

# Frontend — Capacitor IAP plugin
npm --prefix frontend install @capacitor-community/in-app-purchases

# Sync into the iOS project (REQUIRED — @capacitor/keyboard was also just added)
npm --prefix frontend run cap:build:ios
```

Bash equivalent if you prefer:

```bash
cd backend  && npm install @apple/app-store-server-library
cd ../frontend && npm install @capacitor-community/in-app-purchases && npx cap sync ios
```

Notes:
- `cap:build:ios` runs `vite build && npx cap sync ios`. Because `@capacitor/keyboard` (^8.0.3) was added recently, you must run `npx cap sync ios` (covered by `cap:build:ios`) so the iOS project picks it up.
- `cap add ios` must already have run once, or `cap sync` has no iOS project to sync into.

- [ ] Dependencies installed and `cap sync ios` run

## 2. Create the products in App Store Connect

https://appstoreconnect.apple.com → My Apps → JAMIE → **In-App Purchases**

For the three consumables (`boost_starter`, `boost_popular`, `boost_pro`), each needs:

1. Reference Name (internal; the reviewer sees it).
2. Product ID — exactly as in the table above. Must match `IAP_PRODUCTS` in `frontend/src/utils/iap.js`.
3. Pricing (tier closest to the price in the table).
4. Localization → German (Austria) + German + English: Display Name + Description.
5. Review Screenshot of the boost purchase screen.
6. Review Notes: "User purchases a one-time credit consumed when boosting a group/club. No subscription, no recurring."

For the Pro subscriptions: create the Subscription Group "JAMIE Pro" first, then add the three subscriptions inside it. Each additionally needs:

1. Subscription Group Localization (German + English group title).
2. Subscription Localization per product.
3. Subscription Level inside the group: `pro_weekly` = Level 1, `pro_monthly` = Level 2, `pro_sixmonth` = Level 3 (higher = upgrade).
4. Subscription Terms link: `https://app.jamie-app.com/terms`
5. Privacy Policy link: `https://app.jamie-app.com/privacy`
6. Review Notes: "Auto-renewable Pro subscription unlocks the JAMIE Pro feature set."

All products start as "Missing Metadata". When every field is green they move to "Ready to Submit". Do not click "Submit for Review" before the first build upload, or they lock.

- [ ] 3 consumables created, all "Ready to Submit"
- [ ] Subscription Group + 3 subscriptions created, all "Ready to Submit"
- [ ] Product IDs verified character-for-character against `iap.js`

## 3. Generate the App Store Connect In-App Purchase key

Needed for server-to-server verification and renewal lookups (the App Store Server API).

1. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API**.
2. Open the **In-App Purchase** key tab (NOT the general "App Store Connect API" key).
3. **Generate API Key** → name it e.g. `JAMIE IAP Server`.
4. Download the `.p8` immediately — it can only be downloaded once. Back it up in a password manager.
5. Record the **Issuer ID** (UUID, top of the page) and the **Key ID** (10 chars, next to the key).

- [ ] `.p8` downloaded and backed up
- [ ] Issuer ID and Key ID recorded

## 4. Set the env vars in Railway

| Env var | Value |
|---|---|
| `APPLE_IAP_BUNDLE_ID` | `jamie.app` |
| `APPLE_IAP_ENVIRONMENT` | `Sandbox` while testing, `Production` before submitting |
| `APPLE_IAP_ISSUER_ID` | Issuer ID UUID from step 3 |
| `APPLE_IAP_KEY_ID` | 10-char Key ID from step 3 |
| `APPLE_IAP_PRIVATE_KEY` | full `.p8` contents, newlines escaped as `\n` |

Defaults if unset: `APPLE_IAP_BUNDLE_ID` falls back to `jamie.app`; `APPLE_IAP_ENVIRONMENT` falls back to Sandbox. The other three are required — without `APPLE_IAP_ISSUER_ID` / `APPLE_IAP_KEY_ID` / `APPLE_IAP_PRIVATE_KEY` the verifier throws "Apple IAP not configured".

The `.p8` looks like this:

```
-----BEGIN PRIVATE KEY-----
MIGTAgEAMB...
...x7n6gI7=
-----END PRIVATE KEY-----
```

On a single line for the env var, replace each newline with a literal `\n`:

```
APPLE_IAP_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIGTAgEAMB...\n...x7n6gI7=\n-----END PRIVATE KEY-----
```

The backend does `.replace(/\\n/g, '\n')` on read, so the escaped form is correct.

- [ ] All 5 `APPLE_IAP_*` vars set in Railway

## 5. Enable the In-App Purchase capability in Xcode

Open `frontend/ios/App/App.xcworkspace`:

1. App target → **Signing & Capabilities**.
2. **+ Capability** → **In-App Purchase**.
3. Build and run on a physical iPhone (the simulator does not support Sandbox login).

- [ ] In-App Purchase capability added

## 6. Create a Sandbox tester

App Store Connect → **Users and Access** → **Sandbox** tab.

1. **+ Test Account**.
2. Email (does not need to exist, e.g. `sandbox-tobi@jamie-app.com`), Country/Region: Austria.
3. Password (Apple rules: min 8 chars, upper + lower + number + special).
4. On the test iPhone: Settings → **App Store** → Sandbox Account → sign in with these Sandbox credentials.

- [ ] Sandbox tester created and signed in on the test device

## 7. First Sandbox test

1. Install the app on the test device (Xcode Build & Run).
2. Open the Boost modal → pick a package → tap the Apple purchase button.
3. The StoreKit sheet shows with a `[Sandbox]` price prefix.
4. Buy → enter the Sandbox account password.
5. Check the backend: `iap_receipts` gets a row, `boost_credits.credits` increments.
6. The app shows the new credit total immediately.

If it hangs, check in this order:
- Sentry for `Apple IAP verify failed` logs.
- `SELECT * FROM iap_receipts ORDER BY id DESC LIMIT 5;` — is there a row with `environment='Sandbox'`?
- If not, were the `APPLE_IAP_*` env vars set correctly? Check the server boot logs.

For the Pro subscription, Apple accelerates renewal cycles in Sandbox (1 week ≈ 3 min, 1 month ≈ 5 min, 6 months ≈ 30 min), so you can confirm auto-renewal within an hour. `subscriptions.current_period_end` should roll forward as the Server Notifications arrive.

- [ ] One boost consumable purchased and credited in Sandbox
- [ ] One Pro subscription purchased and renewed at least once in Sandbox

## 8. Configure App Store Server Notifications V2

The webhook handler already exists. You only need to point Apple at it.

1. App Store Connect → JAMIE → **App Information**.
2. Section **App Store Server Notifications** → Version: **V2**.
3. **Production Server URL**: `https://app.jamie-app.com/api/iap/apple/notifications`
4. **Sandbox Server URL**: same URL.
5. Save.
6. Click "Send Test Notification" and confirm the backend logs it.

- [ ] V2 notification URLs set (Production + Sandbox)
- [ ] Test notification received by the backend

## 9. Restore Purchases — Apple Guideline 3.1.1 requirement

Apple rejects subscription apps that have no "Restore Purchases" button. The flow is already wired:

- Frontend: `restorePurchases()` in `frontend/src/utils/iap.js` calls `@capacitor-community/in-app-purchases` `restorePurchases()`, then POSTs the receipts to `POST /api/iap/apple/restore`.
- Backend: `restoreApple` re-verifies each receipt and relies on the same `iap_receipts` dedup, so restoring never double-grants.

The button must be visible in at least two places:

- [ ] "Restore Purchases" / "Käufe wiederherstellen" button visible in `frontend/src/pages/SettingsPage.jsx`
- [ ] "Restore Purchases" button visible in `frontend/src/components/ProModal.jsx`

## 10. Stripe Customer Portal vs Apple (do not mix them on iOS)

On web and Android, Pro subscriptions are managed through the Stripe Customer Portal (`POST /api/subscription/portal`). On iOS this is hidden — Apple subscriptions are managed in the iOS Settings / App Store, per Guideline 3.1.1.

The backend enforces this: a subscription whose `stripe_customer_id` starts with `apple:` is rejected by the portal endpoint with `400 { managed_by: 'apple' }`. The iOS UI checks `isNativeIOS` and does not show the portal button at all.

- [ ] No Stripe portal link or "Manage subscription on the web" link is reachable in the iOS build

## 11. Pre-submission checklist

- [ ] All 6 IAP products created and "Ready to Submit"
- [ ] Sandbox purchase tested for at least one boost and one subscription
- [ ] `APPLE_IAP_ENVIRONMENT=Production` set in Railway (NOT Sandbox) before submitting
- [ ] The Stripe path is invisible on iOS — StoreKit sheet only, no outbound links to web payment
- [ ] "Restore Purchases" visible in Settings and in the Pro modal
- [ ] Subscription Terms (`/terms`) and Privacy Policy (`/privacy`) linked in the app (Guideline 3.1.2)
- [ ] App Store Connect → App Privacy → "Purchase History → Yes, collected" matches `store/DATA-SAFETY.md` and the Privacy Policy
- [ ] Account deletion is reachable after login (already in `frontend/src/pages/SettingsPage.jsx`)

## Common Apple rejections

| Rejection | Fix |
|---|---|
| "Subscription terms not displayed" | Show in ProModal: "Wöchentlich / Monatlich / 6 Monate. Verlängert sich automatisch. Jederzeit kündbar in den iOS-Einstellungen." plus a link to Terms. |
| "Restore purchases not available" | Make the button visible in Settings AND the Pro modal. Both call `restorePurchases()` from `frontend/src/utils/iap.js`. |
| "App offers digital content via external payment" | The Stripe path must be invisible on iOS — no hints, no outbound links to web Stripe. |
| "Account deletion not visible to reviewer" | Must be hidden before login, clearly reachable after login. Already in `frontend/src/pages/SettingsPage.jsx`. |
