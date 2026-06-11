# Stripe Go-Live Checklist

What this is: the step-by-step runbook to take Stripe live for JAMIE. Who it's for: Tina (business owner, IMPIBAG e.U.). Tobi handles the dev-only follow-ups marked "DEV TODO".

Do the steps in order. Each step depends on the one before it. Steps marked **BLOCKING** must be done before payments can go live at all.

---

## Step 1 — Rotate the leaked live keys (BLOCKING, do this first)

Two live keys were committed in plain text in `to-do.md` and must be assumed compromised. Rotate them before anything else.

1. dashboard.stripe.com -> **Developers** (bottom-left) -> **API keys**
2. Find the secret key `sk_live_51TZRNj…` -> "..." menu -> **Roll key**
3. Confirm with Stripe password + 2FA
4. The new key is shown **once**. Copy it immediately into a password manager (not WhatsApp, not Slack, not email). You set it in Railway in Step 9.
5. Do the same for the restricted key `rk_live_51TZRNj…`
6. Stripe now shows "Key rolled X seconds ago" — the old key is dead.

- [x] New `sk_live_…` secret key copied to a safe place
- [x] New `pk_live_…` publishable key noted (Developers -> API keys -> Standard keys -> "Publishable key")
- [x] Old `sk_live_51TZRNj…` rolled, old `rk_live_51TZRNj…` rolled

DEV TODO: delete the leaked keys from `to-do.md`, commit and push.

---

## Step 2 — Activate the account: business + banking verification (BLOCKING, depends on Tina)

If there is still an "Activate payments" banner top-right, the account is not live yet.

1. dashboard.stripe.com -> **Settings** -> **Account & business** -> **Activate account**
2. **Business details** (Tina fills this in — she is the legal owner):

| Field | Value |
|---|---|
| Business type | Sole proprietorship (Einzelunternehmen) |
| Country | Austria |
| Legal business name | IMPIBAG e.U. |
| Business address | Wien |
| Business website | https://app.jamie-app.com |
| Product description | Social activity discovery app — paid features (boost credits, Pro subscription) |
| Industry | Apps and software -> Mobile app |
| VAT number | ATU82812645 |
| Firmenbuchnummer | FN 670339v |

3. **Owner / representative details** (Tina):
   - Full name (as on passport)
   - Date of birth
   - Home address
   - Phone
   - Email
   - **Identity verification** — Stripe takes a selfie + photo of ID (passport recommended; national ID works too). Make sure the photo is sharp; a rejected ID does not block test charges but freezes payouts for 7-14 days.
4. **Banking** — IBAN of Tina's IMPIBAG e.U. business account (or her private account if the business has none). Choose daily (default) or weekly payouts.

- [ ] "Activate payments" banner is gone
- [ ] Sidebar mode toggle is on **Live mode**, not Test mode
- [ ] Identity verification submitted
- [ ] Bank account (IBAN) added

---

## Step 3 — Set the public statement descriptor (BLOCKING)

This is what customers see on their bank/credit-card statement. If it is wrong they will not recognize the charge and may file chargebacks.

1. dashboard.stripe.com -> **Settings** -> **Business** -> **Public details** (in Live mode)
2. Set:

| Field | Value |
|---|---|
| Public business name | JAMIE |
| Statement descriptor | JAMIE (max 22 chars, shown on the customer's statement) |
| Shortened descriptor | JAMIE (max 12 chars) |
| Customer support email | office@jamie-app.com |
| Customer support URL | https://app.jamie-app.com |
| Customer support phone | optional, can stay empty |

- [ ] Statement descriptor reads exactly `JAMIE`

---

## Step 4 — Register BOTH webhook endpoints (BLOCKING)

The backend listens on two separate raw-body webhook routes — one for boost (one-time) purchases, one for subscriptions. Both must be registered or paid users will not get what they bought.

### 4a. Boost webhook

1. dashboard.stripe.com -> **Developers -> Webhooks -> + Add endpoint**
2. Endpoint URL: `https://app.jamie-app.com/api/boost/stripe/webhook`
3. Listen to: Events on your account
4. Select events: `payment_intent.succeeded`
5. Add endpoint -> "Reveal" signing secret -> copy the `whsec_…` value
6. Save it for Step 9 as `STRIPE_WEBHOOK_SECRET`

### 4b. Subscription webhook

1. **+ Add endpoint**
2. Endpoint URL: `https://app.jamie-app.com/api/subscription/stripe/webhook`
3. Listen to: Events on your account
4. Select events (all 5):
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Add endpoint -> copy the `whsec_…` value
6. Save it for Step 9 as `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`

- [ ] Both endpoints visible in the Dashboard with status "Enabled"
- [ ] Two `whsec_…` values saved (one per endpoint)

---

## Step 5 — Activate the Customer Portal (BLOCKING for "Abo verwalten")

The new "Abo verwalten" button in the app calls `POST /api/subscription/portal`, which opens the Stripe Customer Portal so users can cancel/manage their Pro subscription. If the portal is not activated in the Dashboard, that call returns 503 "Stripe Customer Portal ist im Dashboard noch nicht aktiviert".

This is a one-time activation per Stripe account.

1. Go to the portal settings:
   - Live: https://dashboard.stripe.com/settings/billing/portal
   - Test (for trying it first): https://dashboard.stripe.com/test/settings/billing/portal
2. Click **Activate** / **Save changes** to publish a portal configuration.
3. Set the return URL / business name to JAMIE so the portal looks right (return URL points back to `app.jamie-app.com`).
4. Make sure cancellation is allowed (so users can actually end their subscription).

Note: the portal is web + Android only. iOS Pro subscriptions are bought and managed through the App Store (Apple Guideline 3.1.1), so the button is hidden on iOS. Apple-bought subscriptions have a `apple:` customer id and the backend rejects portal requests for them with `{ managed_by: 'apple' }`.

- [ ] Customer Portal shows "Activated" in Live mode
- [ ] Cancellation is enabled in the portal config

---

## Step 6 — Apple Pay domain (recommended)

Lets Apple Pay show in the browser checkout.

1. dashboard.stripe.com -> **Settings** -> **Payments** -> **Payment methods**
2. **Apple Pay** -> Configure -> **Add new domain** -> `app.jamie-app.com`
3. Stripe gives a file `apple-developer-merchantid-domain-association` to download. Save its contents.

- [ ] Domain added; status "Pending verification" (turns green once the file is live)

DEV TODO: serve `apple-developer-merchantid-domain-association` under `/.well-known/` in `backend/src/server.js`.

Google Pay needs no domain verification — just toggle it On under the same Payment methods screen.

---

## Step 7 — Create the 6 products and prices

The backend currently creates prices at runtime via `prices.create()`. The plan is to create fixed products in Stripe and reference their `price_…` IDs. Note the exact amounts below — these come from the backend code and are authoritative.

### 7a. Boost credits (one-time payment, consumable)

dashboard.stripe.com -> **Product catalog** -> **+ Add product**. Three products, each Type Standard with a one-time price:

| Product | Product ID (IAP) | Credits | Price (EUR) |
|---|---|---|---|
| JAMIE Boost — 1 Credit | boost_starter | 1 | 1,99 € |
| JAMIE Boost — 5 Credits | boost_popular | 5 | 7,99 € |
| JAMIE Boost — 15 Credits | boost_pro | 15 | 19,99 € |

### 7b. Pro subscription (recurring)

| Product | Product ID (IAP) | Billing period | Price (EUR) | Note |
|---|---|---|---|---|
| JAMIE Pro — Wöchentlich | pro_weekly | every 1 week | 4,99 € | baseline |
| JAMIE Pro — Monatlich | pro_monthly | every 1 month | 14,99 € | default, badge "Beliebt" (~3,46 €/Woche) |
| JAMIE Pro — 6 Monate | pro_sixmonth | every 6 months | 29,99 € | badge "Bestes Angebot" (~1,15 €/Woche) |

These prices and product IDs match `subscriptionController.js` (PRO_PLANS), `boostController.js` (BOOST_PACKAGES), `frontend/src/utils/iap.js`, and the App Store products in `STOREKIT-SETUP.md`. Keep all of them in sync.

Set tax behavior to **Exclusive** on every price if you turn on Stripe Tax (Step 8), so 20% Austrian VAT is added on top.

- [ ] 3 boost products created, 3 `price_…` IDs noted
- [ ] 3 Pro products created, 3 `price_…` IDs noted

DEV TODO: replace the runtime `prices.create()` calls with these fixed `price_…` IDs.

---

## Step 8 — Stripe Tax (recommended for B2C digital goods in AT/DE)

1. dashboard.stripe.com -> **Tax** -> **Activate Stripe Tax**
2. Tax settings -> Origin address: IMPIBAG e.U. Wien address
3. Tax registrations -> **+ Add registration**: Austria -> VAT -> `ATU82812645` -> effective date today
4. If selling to Germany: add an OSS (One-Stop-Shop) registration via Austria — no separate German registration needed while under the EU-OSS threshold.
5. Tax behavior on prices: **Exclusive** (matches Step 7).

- [ ] Austria VAT registration shows a green check

Warning: do not skip this and then change it retroactively. If sales happen without VAT, IMPIBAG has to pay the VAT out of pocket — Stripe cannot collect it from customers after the fact.

---

## Step 9 — Set the Railway env vars

railway.app -> Project: jamie -> Service: jamie-backend -> **Variables**.

Set/replace these 5 values:

| Variable | Value | Source |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` | new key from Step 1 |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | Dashboard, Step 1 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | boost webhook, Step 4a |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | `whsec_…` | subscription webhook, Step 4b |
| `VITE_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | same value as `STRIPE_PUBLISHABLE_KEY` |

Important:
- `sk_live` and `pk_live` must come from the **same** Stripe mode (both live). Mixing live and test keys causes "No such customer" errors.
- The frontend-visible key is always `pk_live_…`. Never put `sk_live_…` anywhere it ends up in the browser bundle.
- Note: if `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` is missing the server still boots, but subscription webhook signature validation fails — so this is required for Pro to work.

Railway redeploys automatically on save. After deploy, check health:

```powershell
# PowerShell (Windows)
Invoke-RestMethod https://app.jamie-app.com/api/health
```

```bash
# bash
curl https://app.jamie-app.com/api/health
```

- [ ] Railway shows "Deployment successful"
- [ ] Health check returns `{"status":"ok"}`

---

## Step 10 — End-to-end test with a real card

Live mode does not accept Stripe test cards, so use a real card. Start with 1 boost = 1,99 € — smallest amount if something breaks.

1. Open the app -> log in (Tobi's account)
2. Open any group -> Boost button -> "1 Boost" package -> pay (Apple Pay / card)
3. Expected: modal shows the credit was added, credit count goes up by 1
4. Dashboard -> **Payments** -> the payment is "succeeded", 1,99 €
5. Dashboard -> Developers -> Webhooks -> boost endpoint -> Latest events -> last event is `payment_intent.succeeded`, response status 200

If Stripe took the money but the credit did not appear: webhook problem — wrong signing secret or endpoint unreachable. Check Railway logs.

Refund after the test: Dashboard -> open the payment -> Refund -> Full refund.

- [ ] One real boost purchase succeeded end-to-end
- [ ] Refund issued

### Optional: subscription + portal test

1. App -> Pro modal -> cheapest plan (Wöchentlich, 4,99 €) -> Subscribe with a real card
2. Dashboard -> Customers -> account now has an active subscription
3. In the app: Settings -> "Abo verwalten" -> the Stripe Customer Portal opens (this verifies Step 5)
4. Cancel in the portal -> Dashboard subscription status moves to "cancel_at_period_end"
5. Refund the invoice in the Dashboard

- [ ] "Abo verwalten" opens the portal (web/Android)
- [ ] Subscription canceled and refunded

---

## DEV TODO (Tobi, after the meeting)

- [ ] Serve `apple-developer-merchantid-domain-association` under `/.well-known/` in `backend/src/server.js` (Step 6)
- [ ] Replace runtime `prices.create()` with the 6 fixed `price_…` IDs (Step 7)
- [ ] Delete the leaked live keys from `to-do.md`, commit and push (Step 1)

Unrelated reminder (separate from Stripe, but pending for the same release): `@capacitor/keyboard` was just added — run `npx cap sync ios` (or `npm run cap:build:ios`) before the next iOS build.

---

## Important warnings

- Never share `sk_live` keys over WhatsApp/Slack/email. Use a shared password manager vault, or have Tina paste them straight into Railway.
- The only Stripe key that may appear in the frontend is `pk_live_…`. The secret key (`sk_live_…`) must never reach the browser bundle.
- Do not enable Stripe Tax retroactively after selling without VAT — IMPIBAG would have to pay the VAT itself.
- A blurry ID photo in Step 2 does not block test charges but freezes payouts for 7-14 days. Take a clean photo.
- iOS Pro subscriptions and iOS boosts are bought through Apple In-App Purchase, not Stripe (see `STOREKIT-SETUP.md`). Stripe handles web and Android only. Note that deals are now visible to everyone (the Pro gate was removed on 2026-06-09), so deal redemption does not depend on Stripe at all.
