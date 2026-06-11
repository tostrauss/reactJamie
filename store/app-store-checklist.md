# Apple App Store — Submission Checklist

What this is: the step-by-step checklist for submitting JAMIE to the Apple App Store.
Who it's for: whoever does the App Store Connect submission. Google Play has its own files (`PLAY-LISTING.md`, `DATA-SAFETY.md`).

App identity: bundle id `jamie.app`, domain `app.jamie-app.com`.

---

## Outstanding blockers (do these first)

- [ ] Replace `YOUR_10_CHAR_TEAM_ID` in `frontend/public/.well-known/apple-app-site-association` with the real Apple Team ID. It is still the literal placeholder in both `appIDs` and `webcredentials` (`YOUR_10_CHAR_TEAM_ID.jamie.app`). Until this is the real Team ID, Universal Links and Apple sign-in webcredentials will not work. See "Apple Team ID" below.
- [ ] Set a password for the Apple review test account `review@jamie-test.com` (currently unset). See "Apple review test account".
- [ ] Create all 6 IAP products in App Store Connect and get each to "Ready to Submit". See "In-app purchases (IAP)".
- [ ] Run `npx cap sync ios` before building. `@capacitor/keyboard` was just added and the native iOS project must be re-synced. See "Build (Capacitor iOS)".
- [ ] Confirm screenshots cover the 6.9" size (1320 × 2868). Current files in `store/assets/screenshots/` are named `ios-6_7-inch-*` (6.7"), not 6.9". See "Required screenshot sizes".

---

## Apple Team ID

The Team ID is the 10-character string in App Store Connect / the Apple Developer portal (Membership page, "Team ID").

File to edit: `frontend/public/.well-known/apple-app-site-association`

It must change from the placeholder:

```
YOUR_10_CHAR_TEAM_ID.jamie.app
```

to (example, replace with the real ID):

```
A1B2C3D4E5.jamie.app
```

Both the `appIDs` array and the `webcredentials` block use this value. The file handles these Universal Link paths: `/reset-password*` and `/verify-email*`.

After editing, the file is served from production at:

```
https://app.jamie-app.com/.well-known/apple-app-site-association
```

- [ ] Edit the file, replace the placeholder in both places.
- [ ] Deploy backend (it serves `.well-known/apple-app-site-association` in production).
- [ ] Confirm it loads over HTTPS with `Content-Type: application/json` and no redirect.

---

## Required screenshot sizes

Apple requires a minimum of 3 and a maximum of 10 screenshots per device class.

| Device class | Size (px) | Suggested simulator | Required? |
|---|---|---|---|
| iPhone 6.9" | 1320 × 2868 | iPhone 16 Pro Max | Yes |
| iPhone 6.5" | 1284 × 2778 | iPhone 14 Plus / 15 Plus | Yes |
| iPhone 5.5" | 1242 × 2208 | iPhone 8 Plus | Yes |
| iPad Pro 13" | 2064 × 2752 | iPad Pro 13-inch | Only if you ship an iPad build |

What is on disk now (`store/assets/screenshots/`):

- `ios-6_7-inch-01..03.png` (3) — note: 6.7", NOT the required 6.9"
- `ios-6_5-inch-01..03.png` (3)
- `ios-5_5-inch-01..03.png` (3)
- No iPad screenshots (only needed if you submit an iPad build)

- [ ] Produce 6.9" (1320 × 2868) screenshots, or confirm App Store Connect accepts the 6.7" set for the 6.9" slot.
- [ ] Verify each iPhone class has at least 3 screenshots.

### How to take screenshots (iOS Simulator)

1. Build and open the iOS project (see "Build (Capacitor iOS)" below).
2. In Xcode, launch the Simulator for each required device size.
3. Navigate to each screen you want.
4. Press `Cmd + S` in the Simulator to save the screenshot to the Desktop.
5. Rename files descriptively, e.g. `01-aktivitaeten.png`, `02-karte.png`.

Suggested screens (matches the PWA screenshot set `01-aktivitaeten` .. `05-freunde`):

- [ ] Aktivitäten / activity feed
- [ ] Karte / map view
- [ ] Gruppen-Detailseite
- [ ] Chat
- [ ] Freunde / profile

---

## App Store Connect metadata

**Name:** JAMIE – Social Activity App
**Subtitle:** Finde Leute für Aktivitäten
**Category:** Social Networking
**Secondary category:** Lifestyle
**Languages:** German (primary) and English are both shipped (`de.json` + `en.json`); the PWA `lang` is `de`.

### Description (DE — keep German)

```
JAMIE ist deine neue Social-App für Aktivitäten in deiner Stadt.

Erstelle oder tritt Gruppen für Sport, Kultur, Ausgehen und mehr bei.
Chatte in Echtzeit, finde neue Freunde und entdecke lokale Events.

✦ Gruppen erstellen oder beitreten (Orte nur in Österreich)
✦ Echtzeit-Chat mit deiner Gruppe
✦ Clubs für regelmäßige, wöchentliche Aktivitäten
✦ Interaktive Karte für Events in deiner Nähe
✦ Deals einlösen — exklusive Angebote von lokalen Partnern
✦ JAMIE Pro: mehr Reichweite per Boost
```

### Description (EN)

```
JAMIE is your social app for activities in your city.

Create or join groups for sport, culture, going out and more.
Chat in real time, meet new people and discover local events.

✦ Create or join groups (locations are Austria only)
✦ Real-time group chat
✦ Clubs for recurring, weekly activities
✦ Interactive map of events near you
✦ Redeem deals — exclusive offers from local partners
✦ JAMIE Pro: more reach with Boost
```

Notes for accuracy:
- Standalone groups do NOT repeat weekly. Weekly repetition is a clubs-events-only feature.
- Group/club locations are restricted to Austria.

### Keywords (max 100 chars)

```
sozial,gruppen,aktivitäten,sport,ausgehen,events,freunde,chat,clubs,wien
```

### URLs

| Field | URL |
|---|---|
| Support URL | https://app.jamie-app.com/privacy |
| Privacy Policy URL | https://app.jamie-app.com/privacy |
| Marketing URL | https://app.jamie-app.com |

Legal routes that exist and are public (no login): `/privacy`, `/terms`, `/guidelines`, `/impressum`.

- [ ] Fill name, subtitle, description (DE + EN), keywords, and all three URLs in App Store Connect.

---

## In-app purchases (IAP)

iOS uses native StoreKit IAP via `@capacitor-community/in-app-purchases` (iOS-only, dynamic import). Web and Android use Stripe. Full setup runbook: `STOREKIT-SETUP.md`.

Create these 6 products in App Store Connect. Product IDs must match the code (`frontend/src/utils/iap.js` + `backend/src/controllers/iapController.js`) exactly.

### Consumables — Boost credits

| Product ID | Credits | Price |
|---|---|---|
| `boost_starter` | 1 | 1,99 € |
| `boost_popular` | 5 | 7,99 € |
| `boost_pro` | 15 | 19,99 € |

### Auto-renewable subscriptions — JAMIE Pro

| Product ID | Period | Price |
|---|---|---|
| `pro_weekly` | 1 week | 4,99 € |
| `pro_monthly` | 1 month | 14,99 € (≈ 3,46 €/Woche, DEFAULT) |
| `pro_sixmonth` | 6 months | 29,99 € (≈ 1,15 €/Woche) |

Prices above are authoritative (from `subscriptionController.js` and `iap.js`). Note: `STRIPE-MEETING-CHECKLIST.md` lists different boost/Pro prices and a different 3rd boost credit count (12 vs 15) — those are stale; this table and STOREKIT-SETUP are correct.

- [ ] Create all 3 consumables in App Store Connect with exact product IDs.
- [ ] Create the JAMIE Pro subscription group with all 3 subscription products, exact IDs.
- [ ] Get every product to "Ready to Submit".
- [ ] Set `APPLE_IAP_*` Railway env vars (`APPLE_IAP_BUNDLE_ID` default `jamie.app`; key UUID, Key ID, `.p8`). See STOREKIT-SETUP.
- [ ] Test in Sandbox.
- [ ] Flip `APPLE_IAP_ENVIRONMENT` from Sandbox to Production before submitting.
- [ ] Confirm the Apple server notification webhook is reachable: `https://app.jamie-app.com/api/iap/apple/notifications`.

### Restore Purchases (required by Apple)

Apple requires a visible "Restore Purchases" action for apps with non-consumable or subscription IAP.

- [ ] Confirm Restore Purchases is present and reachable in the UI (Pro / Boost purchase screens).
- [ ] On iOS, the Stripe Customer Portal is correctly hidden (`isNativeIOS`) — Apple subscriptions are managed in the App Store per Guideline 3.1.1. Verify it does not show on the iOS build.

---

## Build (Capacitor iOS)

`@capacitor/keyboard` (^8.0.3) was added and requires a native sync before the next iOS build. Skipping the sync ships an out-of-date native project.

PowerShell (Windows) — note: the actual Xcode build still happens on a Mac:

```powershell
cd frontend
npm run cap:build:ios
```

`cap:build:ios` runs `vite build && npx cap sync ios`. If you need just the sync:

```powershell
cd frontend
npx cap sync ios
```

bash (macOS) equivalent:

```bash
cd frontend && npm run cap:build:ios
```

- [ ] Run `npx cap sync ios` (or `npm run cap:build:ios`) after pulling the latest, before opening Xcode.
- [ ] Open the project in Xcode (`frontend/ios`), set signing to the real Team, archive, and upload.

---

## TestFlight

- [ ] Upload the build via Xcode (Archive → Distribute App) or Transporter.
- [ ] Wait for processing in App Store Connect → TestFlight.
- [ ] Complete export-compliance answers (the app uses standard HTTPS/TLS only).
- [ ] Add internal testers; verify login, group create (Austria-only location), chat, push, IAP purchase + restore in Sandbox.
- [ ] Promote to external testing or submit for App Review once verified.

---

## Apple review test account

- [ ] Email: `review@jamie-test.com` (use a real inbox you control)
- [ ] Password: not set yet — create one that meets the password policy (6+ chars, upper + lower + number + special).
- [ ] Pre-fill the profile (name, bio, photo, interests).
- [ ] Join at least one group so reviewers see the core feature.
- [ ] Have a deal available so reviewers can test deal redemption (one redemption per user, ever).

Add these credentials in App Store Connect → App Review Information.

---

## App privacy (App Store Connect — "App Privacy")

Keep this in sync with `PrivacyPolicy.jsx` (`/privacy`). Summary of what JAMIE collects:

| Data type | Used | Notes |
|---|---|---|
| Contact info | Yes | Name, email |
| User content | Yes | Photos, messages |
| Location | Yes | Approximate, for map / nearby events (Austria only) |
| Purchases | Yes | IAP (Boost credits, JAMIE Pro subscriptions) |
| Identifiers | Yes | Account id, push token |
| Diagnostics | Yes | Sentry crash/error reporting |

- [ ] Data encrypted in transit: yes (HTTPS/TLS).
- [ ] Account deletion available in-app: Settings → "Konto löschen". Apple requires this for accounts.
- [ ] Complete the App Privacy questionnaire to match the table above.
