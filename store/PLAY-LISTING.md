# Play Store Listing — JAMIE

The Google Play store listing: title, descriptions, category, assets, content rating answers, and the review test account. For the person filling in the Play Console "Main store listing" and "App content" sections. German marketing copy below is the literal text to paste — keep it German.

Default language: Deutsch (Deutschland) – de-DE. English is optional and can be added after launch (en.json exists in the app, but no English store copy is written yet).

## App details

| Field | Value |
|---|---|
| App name (max 30 chars) | `JAMIE – Aktivitäten & Gruppen` |
| Short description (max 80 chars) | `Triff Menschen, entdecke Events und tritt Gruppen in deiner Stadt bei.` |
| App category | `Social` |
| Tags | Social Networking, Events, Lifestyle |
| Default language | `Deutsch (Deutschland) – de-DE` |
| Package name | `jamie.app` |

## Vollständige Beschreibung (max 4000 chars)

Paste verbatim into Play Console → Full description.

```
JAMIE verbindet Menschen über gemeinsame Aktivitäten. Egal ob Yoga, Bouldern, Brunch, Konzerte oder ein spontaner Spieleabend – mit JAMIE findest du Leute, die genau dasselbe vorhaben wie du.

LOKALE GRUPPEN ENTDECKEN
Finde Gruppen für Sport, Ausgehen, Kultur und Hobbys direkt in deiner Nähe. Über die interaktive Karte siehst du auf einen Blick, was heute oder morgen passiert.

SELBST EINE GRUPPE GRÜNDEN
Mit wenigen Klicks erstellst du deine eigene Aktivität – Datum, Ort, Kategorie. Andere können beitreten und ihr chattet sofort. Gruppen sind einmalige Treffen und wiederholen sich nicht.

ECHTZEIT-CHAT
Sobald du einer Gruppe beigetreten bist, kannst du dich mit allen Teilnehmer:innen austauschen. Keine Verzögerungen, keine Umwege über andere Apps.

CLUBS FÜR REGELMÄSSIGE TREFFEN
Gründe oder tritt Clubs für wöchentliche Lauftreffs, Buchclubs, Pasta-Abende oder was auch immer dir Spaß macht. Eigene Mitgliederliste, eigener Chat, eigene Events – Club-Events können sich wöchentlich wiederholen.

DEALS EINLÖSEN
Sichere dir lokale Angebote direkt in der App. Deal öffnen, einlösen, den Nachweis vorzeigen – jeder Deal kann einmal pro Person eingelöst werden.

TRUSTED USER BADGE
Verlässliche Mitglieder werden mit einem grünen Häkchen ausgezeichnet – so weißt du, mit wem du es zu tun hast.

PROFIL MIT PERSÖNLICHKEIT
Zeige deinen Lieblingssong (verlinkt zu Spotify), deine Interessen, deine Stadt und Fotos – damit andere sehen, ob ihr zueinander passt.

PRIVATSPHÄRE & MODERATION
Bilder werden automatisch auf unangemessene Inhalte geprüft. Nutzer:innen können jederzeit gemeldet oder blockiert werden. Deine Daten gehören dir – Account-Löschung mit einem Klick.

KONTAKT
Fragen, Feedback oder Probleme? Schreib uns an office@jamie-app.com.

JAMIE wurde in Wien entwickelt. Gruppen und Clubs können aktuell nur an Orten in Österreich erstellt werden.
```

## Tagline-Variationen (für Promo)

- `Triff Menschen, entdecke Events.`
- `Aktivitäten finden. Leute treffen. Wien erleben.`
- `Gruppen · Clubs · Chat · Karte · Deals`

## Visual assets

All assets live in `store/assets/`. Only the files listed below actually exist there — do not invent additional sizes.

| Field | File | Format |
|---|---|---|
| App icon | `play-icon-512.png` | 512×512 PNG (no alpha) |
| Feature graphic | `play-feature-graphic-1024x500.png` | 1024×500 PNG |
| Phone screenshots (min 2, max 8) | `screenshots/android-phone-01.png` … `android-phone-05.png` (5 files) | 1080×1920 PNG |
| Tablet 7" / 10" screenshots | — | optional, none present |
| Promo video (YouTube URL) | — | optional, add later |

Screenshot upload order — the first 2-3 are the ones shown in search:

1. `android-phone-01.png`
2. `android-phone-02.png`
3. `android-phone-03.png`
4. `android-phone-04.png`
5. `android-phone-05.png`

Verify the assets exist before you start (PowerShell):

```powershell
Get-ChildItem store\assets, store\assets\screenshots
```

bash:

```bash
ls store/assets store/assets/screenshots
```

The `ios-*` files in `screenshots/` are for the App Store, not Play — ignore them here.

## Contact & links

| Field | Value |
|---|---|
| Website | `https://app.jamie-app.com` |
| Email (public) | `office@jamie-app.com` |
| Phone | (leave empty — not required) |
| Privacy Policy URL | `https://app.jamie-app.com/privacy` |

Other public legal routes (all live, no login required): `/terms`, `/guidelines`, `/impressum`.

## Test account for the Play reviewer

Play Console → App content → App access. The app requires login, so a test account is mandatory.

| Field | Value |
|---|---|
| Test email | `playreview@jamie-app.com` |
| Test password | - [ ] generieren und im Passwort-Manager speichern |
| Login instructions | "1. App öffnen → 'Anmelden' → E-Mail + Passwort eingeben. 2. Der Email-OTP-Schritt wird im Review automatisch übersprungen." |
| App access available without login? | No — Login required |

Before submitting, do this so the reviewer sees the core features immediately:

- [ ] Register the `playreview@jamie-app.com` account in the live app.
- [ ] Fill in the profile fully (name, photo, bio, city, at least one interest).
- [ ] Join at least one group and send one chat message.
- [ ] Mark the account trusted so the badge is visible:

```sql
UPDATE users SET is_trusted_user = true WHERE email = 'playreview@jamie-app.com';
```

## Content rating + audience

| Field | Value |
|---|---|
| Content rating questionnaire | see `store/DATA-SAFETY.md` (must stay in sync with `PrivacyPolicy.jsx`) |
| Target audience | 18+ |
| Designed primarily for children | No |
| Appeals to children | No |

## App content declarations

| Field | Value |
|---|---|
| Is this a Government app? | No |
| Does this app provide financial features? | No |
| Is this a News app? | No |
| Are there in-app purchases? | Yes — "Yes, my app has in-app purchases" |
| Sale of regulated goods | No |
| Health Connect data | No |
| VPN service | No |
| Real-money gambling | No |

### In-app purchases (declare these)

The app sells Boost credits (consumables) and JAMIE Pro (subscriptions). On Android these are charged via Stripe in the web layer (not Google Play Billing — `playBilling.enabled = false` in the TWA manifest). Product IDs, for reference:

| Type | Product IDs |
|---|---|
| Boost consumables | `boost_starter`, `boost_popular`, `boost_pro` |
| Pro subscriptions | `pro_weekly`, `pro_monthly`, `pro_sixmonth` |

JAMIE Pro prices (authoritative, from `subscriptionController.js`):

| Plan | Price | Notes |
|---|---|---|
| Wöchentlich | 4,99 €/Woche | baseline |
| Monatlich | 14,99 €/Monat (≈ 3,46 €/Woche) | default, badge "Beliebt", "31% sparen" |
| 6 Monate | 29,99 €/6 Monate (≈ 1,15 €/Woche) | badge "Bestes Angebot", "77% sparen" |

Subscription management on web/Android goes through the Stripe Customer Portal (`POST /api/subscription/portal`). This portal must be activated once in the Stripe Dashboard or the call returns 503 — see `store/STRIPE-MEETING-CHECKLIST.md`.

Note: `store/STRIPE-MEETING-CHECKLIST.md` lists different boost prices/credit counts. The backend, `iap.js`, and `STOREKIT-SETUP.md` are the consistent source (Boost: 1/5/15 credits at 1,99 / 7,99 / 19,99 €); the Stripe checklist is the outlier and should be reconciled before billing goes live.

## Sensitive permissions

JAMIE as a TWA needs none of the special Android permission declarations. Push runs over Web Push (VAPID) and requires no separate permission statement in the TWA.

If Google asks about "App access": login is required — provide the test account above.

## Pre-submit checklist

- [ ] App name, short + full description pasted (de-DE).
- [ ] `play-icon-512.png` and `play-feature-graphic-1024x500.png` uploaded.
- [ ] 5 phone screenshots uploaded in order.
- [ ] Privacy Policy URL set to `https://app.jamie-app.com/privacy`.
- [ ] Content rating questionnaire completed (see `DATA-SAFETY.md`).
- [ ] In-app purchases declared.
- [ ] Test account created, filled out, trusted, and entered under App access.
- [ ] assetlinks.json verified (single upload-key fingerprint already present; see `twa/RUNBOOK.md` if Play forces App Signing).
