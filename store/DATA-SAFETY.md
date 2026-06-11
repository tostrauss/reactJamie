# Play Console — Data Safety Form Answers

The exact answers to type into the Google Play Console Data Safety form (Play Console → App content → Data safety). For whoever submits the app to Play. Values are verified against the codebase as of 2026-06-11 (PrivacyPolicy.jsx + backend controllers + `backend/src/config/moderation.js`).

> **Must match the Privacy Policy.** If a Data Safety answer contradicts `frontend/src/pages/PrivacyPolicy.jsx`, Play rejects the submission. Re-check the mapping table at the bottom after any change.

> **VERIFY BEFORE SUBMITTING — moderation is optional and off by default.** Image moderation (Sightengine) and text moderation (OpenAI) are **fail-open** and only run when their env vars are set. If `SIGHTENGINE_API_USER` / `SIGHTENGINE_API_SECRET` are missing, image moderation is skipped entirely. If `OPENAI_API_KEY` is missing, text moderation is skipped. The boot log prints warnings, not errors, when these are absent (they are on the WARNED env-var list, not the required list). See "Moderation reality check" below and confirm the production environment before filling the content-rating and sharing sections.

---

## Pre-submit checklist

- [ ] Confirm whether Sightengine env vars (`SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET`) are set in production. If not, do **not** claim images are auto-screened for nudity/gore.
- [ ] Confirm whether `OPENAI_API_KEY` is set in production. If not, do **not** claim chat text is auto-moderated.
- [ ] Confirm Sentry is live (`SENTRY_DSN` set) — it is a required prod env var, so it should be. This justifies the Crash logs / Diagnostics rows.
- [ ] Confirm Stripe is the only payment processor in the build path you are submitting (web/Android use Stripe; iOS uses Apple IAP and is a separate App Store submission).
- [ ] Re-read `PrivacyPolicy.jsx` and confirm every row below still matches it.

---

## Section 1 — Data collection and security

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS / TLS, WebSocket over TLS) |
| Do you provide a way for users to request that their data be deleted? | **Yes** — Settings → Konto löschen → `DELETE /api/auth/account` (GDPR Art. 17). A data export also exists: `GET /api/auth/export`. |

---

## Section 2 — Data types collected

For every row below set in the Play Console:

- **Collected** = as in the table.
- **Shared with third parties** = **No**, except where Section 3 lists a recipient.
- **Optional or required** = as in the table.
- **Purpose** = as in the table.
- **Used for tracking** = **No** for every row (no cross-app/cross-site advertising tracking).
- **Processed ephemerally** = **No** unless noted.
- **Encrypted in transit** = **Yes** for every collected row.
- **User can request deletion** = **Yes** for every collected row (account delete cascades; see Section 5).

### Personal info

| Data type | Collected | Required | Purpose |
|---|---|---|---|
| Name | Yes | Required | App functionality, Account management |
| Email address | Yes | Required | App functionality, Account management, Communications |
| User IDs | Yes | Required | App functionality, Analytics |
| Address | No | – | – |
| Phone number | No | – | – |
| Race and ethnicity | No | – | – |
| Political or religious beliefs | No | – | – |
| Sexual orientation | No | – | – |
| Other info | **Yes** — date of birth, gender (`date_of_birth`, `gender` columns) | Required | App functionality (age gate, profile) |

### Financial info

| Data type | Collected | Required | Purpose |
|---|---|---|---|
| Purchase history | Yes | Optional | App functionality (Boost credits, Pro subscription) |
| Credit card or bank info | **No** — card data goes directly to Stripe, never to JAMIE servers | – | – |
| Other financial info | No | – | – |

### Health and fitness

All **No**.

### Messages

| Data type | Collected | Required | Purpose |
|---|---|---|---|
| Emails | No | – | – |
| SMS or MMS | No | – | – |
| Other in-app messages | **Yes** — DMs, group chat, club chat | Optional | App functionality |

### Photos and videos

| Data type | Collected | Required | Purpose |
|---|---|---|---|
| Photos | Yes | Optional | App functionality (profile picture, group/club image, Pinnwand) |
| Videos | No | – | – |

### Audio files

| Data type | Collected | Required | Purpose |
|---|---|---|---|
| Voice or sound recordings | No | – | – |
| Music files | No | – | – |
| Other audio | **Yes** — Spotify track selection (no audio file; only track ID + metadata) | Optional | App functionality |

### Files and docs

All **No**.

### Calendar

**No.** The calendar feature is client-side only (opens Google Calendar via URL, or downloads an `.ics` file). The app does not read or write the device calendar.

### Contacts

All **No**.

### App activity

| Data type | Collected | Required | Purpose |
|---|---|---|---|
| App interactions | Yes | Required | Analytics (`/api/analytics` screen_view / app_open events) |
| In-app search history | Yes | Optional | Analytics |
| Installed apps | No | – | – |
| Other user-generated content | Yes — group/club names + descriptions | Required | App functionality |
| Other actions | Yes — friend requests, joins, favorites, deal redemptions | Required | App functionality |

### Web browsing

All **No**.

### App info and performance

| Data type | Collected | Required | Purpose |
|---|---|---|---|
| Crash logs | Yes | Required | Analytics, App functionality (Sentry) |
| Diagnostics | Yes | Required | Analytics (performance metrics via Sentry) |
| Other app performance data | Yes | Required | Analytics |

### Device or other identifiers

| Data type | Collected | Required | Purpose |
|---|---|---|---|
| Device or other IDs | Yes — push subscription endpoint (web push) / APNs token (iOS), session ID | Required | App functionality (push notifications) |

### Location

| Data type | Collected | Required | Purpose |
|---|---|---|---|
| Approximate location | Yes — city/region, via browser geolocation + reverse-geocoding | Optional | App functionality (map, local groups). Group/club creation is Austria-only (`country: 'AT'` enforced client-side). |
| Precise location | **No** | – | – |

---

## Section 3 — Data sharing with third parties

Mark recipient + purpose for each shared row. Everything else in Section 2 is **not** shared.

| Shared data | Recipient | Purpose | Notes |
|---|---|---|---|
| Purchase history, Email, Name | **Stripe** (payment processor) | Payment processing for Boost credits + Pro subscription | Web + Android only. iOS purchases go through Apple IAP (separate App Store data declaration). |
| Crash logs, Diagnostics, App performance | **Sentry** (error monitoring) | App functionality / diagnostics | PII scrubbed before transmission. |
| Photos (uploaded only) | **Sightengine** (content moderation) | Compliance — nudity/gore screening before publish | **CONDITIONAL — only if `SIGHTENGINE_API_USER` + `SIGHTENGINE_API_SECRET` are set in production. If unset, images are NOT sent to Sightengine; remove this row.** |
| Messages (text only, pre-send) | **OpenAI Moderation API** | Compliance — text moderation (`/v1/moderations`, no training on input) | **CONDITIONAL — only if `OPENAI_API_KEY` is set in production. If unset, message text is NOT sent to OpenAI; remove this row.** |
| Approximate location (city-name lookup) | **Nominatim / OpenStreetMap** | App functionality — reverse-geocoding | Server-side geocode on group/club create; non-blocking. |

Other third parties (Cloudflare R2 storage, Railway hosting, Resend email, Google Maps, Spotify, Apple, Google sign-in) are **hosting / auth processors** (GDPR Art. 28 sub-processors), not "shared with third parties" in the Play Data Safety sense. They are listed in the Privacy Policy but are not declared as data sharing in this form.

---

## Section 4 — Security practices

| Question | Answer |
|---|---|
| Data is encrypted in transit | **Yes** — HTTPS for all endpoints + WebSocket over TLS |
| Users can request that data be deleted | **Yes** — in-app: Settings → Konto löschen. Backend: `DELETE /api/auth/account` → CASCADE cleanup of all user data. Export: `GET /api/auth/export`. |
| Has the developer committed to following the Play Families Policy? | **No** — app is 16+/18+, not directed at children. |

---

## Section 5 — Account deletion

| Question | Answer |
|---|---|
| How do users delete their account? | In-app: Profil → Einstellungen → Konto löschen → password confirmation. |
| Alternative path (for reviewers)? | Email `office@jamie-app.com`, subject "Account löschen", with the linked email address. Processed within 30 days. |
| Is data also deleted off-device? | **Yes** — `DELETE /api/auth/account` removes the user + group memberships + messages + friendships + uploads (CASCADE). |
| Is any data retained after deletion? | Only what GDPR Art. 17(3) permits: rotating backups (max 30 days), legally required invoice retention (Stripe, 7 years, held separately). |

---

## Section 6 — Content rating questionnaire

JAMIE has user-generated content (chat, profiles, group/club descriptions, uploaded photos). Answer the questionnaire on what the app *can* contain, not on what moderation *might* catch.

- Violence: None (no violent content in the app itself)
- Sex / Nudity: None as a feature. **Do NOT claim nudity is auto-blocked unless Sightengine is enabled in production** — moderation is fail-open and off without env vars (see below).
- Profanity: Mild — user-generated chat is possible; mitigated by reporting + (optional) text moderation.
- Controlled substances: None
- Gambling: None
- User-generated content + chat: **Yes** — group chat, DMs, profiles, descriptions
- User-to-user interaction (locations exposed): **Yes** — city-level only, never precise
- Shares personal info: **Yes** — profile photos + city visible to other users

**Likely result**: PEGI 16 / USK 16. The final rating comes from the questionnaire itself.

---

## Moderation reality check (read before Sections 3 and 6)

Source: `backend/src/config/moderation.js`.

| Feature | Gate function | Behaviour when env vars missing |
|---|---|---|
| Image moderation (Sightengine, `nudity-2.0,gore-2.0`) | `isModerationEnabled()` = both `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET` set | `checkImageSafety` returns `{ safe: true }` immediately — image is **not** screened |
| Text moderation (OpenAI `/v1/moderations`) | `isTextModerationEnabled()` = `OPENAI_API_KEY` set | `checkTextSafety` returns `{ safe: true }` immediately — text is **not** screened |

Both also **fail open** when the API is set but unreachable (timeout / non-200): the upload or message is allowed through. So even with keys configured, moderation is best-effort, not a guarantee. Reporting (`/api/reports`) is the always-on safety mechanism; automated moderation is the optional layer.

Practical rule for this form: claim automated content screening **only** if the keys are confirmed set in the production environment you are submitting. Reporting + manual review is always true and is the safe claim.

---

## Quick audit against the Privacy Policy

After any app change, check this mapping:

| Privacy Policy section | Data Safety entry |
|---|---|
| § 4 (which data) | Personal info + Photos + Messages + Location |
| § 7 (moderation) | Section 3 Sightengine + OpenAI rows — **only if enabled** |
| § 8 (push) | Device IDs |
| § 9 (Stripe) | Purchase history → shared with Stripe |
| § 12 (third parties) | Section 3 sharing list |
| § 14 (retention) | Sections 4 + 5 |
| § 17 (GDPR rights) | Section 5 (account deletion + export) |
