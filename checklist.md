# JAMIE Config Quick Reference

Quick sanity-check sheet for Tobi/Tina: what users enter at sign-up, the category list, the event-date rule, and the env vars that must be set in production. Verified against the codebase 2026-06-11.

## Registration fields

Sign-up is a 6-step flow (`frontend/src/pages/Register.jsx`). It collects, in order:

1. Name
2. Email — verified by a 6-digit OTP code emailed via Resend (auto-skipped in dev)
3. Location (city, autocompleted via Nominatim)
4. Date of birth — **minimum age 18** (DOB must be at least 18 years ago)
5. Password + confirm
6. Referral code (optional)

Password policy: at least 6 characters, with one uppercase, one lowercase, one digit, and one special character.

Note: there is **no profile-picture step at sign-up**. Profile pictures are uploaded later from the profile screen.

## Category taxonomy

Source: `frontend/src/utils/categories.js`. Six main categories, each with sub-categories (every category also has a "Sonstiges" catch-all).

| Main category | id | Example sub-categories |
|---|---|---|
| Sport | `sport` | Fußball, Tennis, Running, Fitness, Yoga, Kampfsport |
| Night Out | `night-out` | Bar-Hopping, Clubbing, Tanzen, Karaoke, Konzert, Pub Quiz |
| Outdoor | `outdoor` | Wandern, Radfahren, Klettern, Skifahren, Camping, Segeln |
| Kultur | `kultur` | Musik, Theater, Kunst, Museen, Film, Brettspiele, Escape Room |
| Food | `food` | Essen gehen, Brunch, Kochen, Grillabend, Heuriger, Weinverkostung |
| Sonstiges | `sonstiges` | Reisen, Shopping, Gaming, Tiere, Meditation |

To change categories, edit `CATEGORY_HIERARCHY` in `categories.js` — the create-group screen reads it directly.

## Event-date rule

- A group's event date must be **today or later** — `formData.date >= todayStr` in `CreateGroup.jsx`. Past dates are blocked.
- There is **no maximum future window** (the old "max 6 months" note was wrong — no such cap exists in the code).
- **Groups do not repeat weekly.** Create-group always sends `is_recurring_weekly: false`. Weekly repetition is a clubs-events-only feature now (Tina, 2026-06-11).
- **Austria-only location.** Group/club creation only accepts Austrian addresses: Google Places is restricted to `country: ['at']`, and step 2 is blocked unless the resolved country is `AT`.

## Required production env vars

Set `NODE_ENV=production`. Missing any of these → the backend logs the failure and **exits immediately** (`process.exit(1)`). `JWT_SECRET` must also be at least 32 chars and must not contain `CHANGE_ME` / `change_me` / `your_secret`. `DISABLE_RATE_LIMIT=true` is **forbidden** in production (also fatal).

| Env var | What breaks without it |
|---|---|
| `JWT_SECRET` | No auth — login/tokens fail. Must be ≥32 chars, no placeholder words. |
| `DATABASE_URL` | No database — nothing works. |
| `EMAIL_FROM` | OTP / password-reset emails have no sender. |
| `RESEND_API_KEY` | Verification & reset emails never reach users. |
| `FRONTEND_URL` | Wrong links in emails; CORS / self-ping break. |
| `STORAGE_ENDPOINT` | Image uploads (profile / group pics) fail. |
| `STORAGE_ACCESS_KEY` | Storage auth fails — uploads fail. |
| `STORAGE_SECRET_KEY` | Storage auth fails — uploads fail. |
| `STORAGE_BUCKET` | No target bucket — uploads fail. |
| `STORAGE_PUBLIC_URL` | Uploaded images have no public URL to serve from. |
| `VAPID_PUBLIC_KEY` | Web push notifications disabled. |
| `VAPID_PRIVATE_KEY` | Web push notifications disabled. |
| `SENTRY_DSN` | No error reporting. |

## Optional env vars (boot continues, feature degraded)

| Env var(s) | Effect if missing |
|---|---|
| `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET` | Image moderation disabled. |
| `OPENAI_API_KEY` | Text moderation disabled. |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Subscription webhook signature validation fails. |
| `GOOGLE_CLIENT_ID` | Google OAuth falls back to the unverified userinfo endpoint. |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID` | iOS push disabled. |

Frontend build args (passed at Docker build, not backend boot): `VITE_SENTRY_DSN`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_MAPS_API_KEY` (location input), `VITE_VAPID_PUBLIC_KEY`.

## Payments

- **Pro subscription** (web + Android via Stripe; iOS via Apple IAP). Tiers and prices: weekly **14,99 €**, monthly **22,75 €** (default, "Beliebt"), 6 months **58,50 €** ("Bestes Angebot"). Source of truth: `subscriptionController.js` / `proPlans.js`.
- **Boost credit packs** (Stripe / Apple IAP): `boost_starter` 1 credit / **1,99 €**, `boost_popular` 5 credits / **7,99 €**, `boost_pro` 15 credits / **19,99 €**. Source of truth: `boostController.js` + `iap.js`.
  - [ ] Note: `store/STRIPE-MEETING-CHECKLIST.md` lists different boost/pro prices and credit counts — that doc is the outlier; backend + iap.js + STOREKIT-SETUP.md agree. Fix the Stripe checklist before the meeting.
- **IAP product IDs** (must match App Store Connect exactly): `boost_starter`, `boost_popular`, `boost_pro`, `pro_weekly`, `pro_monthly`, `pro_sixmonth`.
- **Stripe Customer Portal**: `POST /api/subscription/portal` returns `{ url }` (web + Android only; hidden on iOS — Apple subs are managed in the App Store).
  - [ ] One-time setup: activate the portal once in the Stripe Dashboard, otherwise the endpoint returns 503. Live: https://dashboard.stripe.com/settings/billing/portal · Test: https://dashboard.stripe.com/test/settings/billing/portal

## Deal redemption

- Routes: `GET /api/deals`, `GET /api/deals/:id`, `GET /api/deals/:id/redemption`, `POST /api/deals/:id/redeem`. Proof screen: `/deal/:id/redeem`.
- **One redemption per user, ever** (`MAX_REDEMPTIONS_PER_USER = 1`, enforced by a DB unique constraint; a second attempt returns 409).
- Deals are visible to **everyone** — the Pro gate was removed (2026-06-09). Visibility is controlled by each deal's `visible_until`.

## iOS build note

`@capacitor/keyboard` was added. After pulling, you must sync the native iOS project or the build will be stale:

```powershell
npx cap sync ios
```

```bash
# bash equivalent (same command)
npx cap sync ios
```

The npm script `cap:build:ios` does this for you (`vite build && npx cap sync ios`).
