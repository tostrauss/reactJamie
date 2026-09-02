# Bugfix 2026-08-09 — Map watermark + `capacitor://` share links

> **STATUS 2026-08-09: iOS 1.3 SHIPPED (live since ~2026-08-08).** Share bug →
> **RESOLVED** for anyone on 1.3 (users on 1.2 must update).
>
> **Map watermark → ✅ RESOLVED 2026-08-10.** Cause was BILLING DISABLED on the
> Google Cloud project (probed the live key: Geocoding → `REQUEST_DENIED` / "You
> must enable Billing"). Tobi enabled billing; re-probe now returns `OK` and the
> Karte tab renders normally on web + app. No rebuild was needed. The earlier
> referrer hypothesis was wrong — the direct key probe settled it.
>
> Universal Links (`/club|group|user/*`) still need the web deploy of commit
> `0cb4a57` to go live (not in the iOS build that shipped ~08-08).

Two user reports, **one shared root cause**: the iOS app live in the App Store
(**v1.2, build 7**) runs its WebView at a `capacitor://app.jamie-app.com`
origin, and it predates two fixes that only exist on `main` / web / Android.

| Report | Who | Symptom |
|---|---|---|
| Share link opens the wrong app | Maximilian (cafeconcertowien, iPhone 16 Pro) | Copied link is `capacitor://app.jamie-app.com/club/77` → tapping it opens **GetCards** |
| Map shows "For development purposes only" | Screenshot (iOS Karte tab) | Map renders but is darkened with the watermark |

---

## Root cause

**Share bug.** The live iOS binary builds share links from `window.location.href`,
which inside its WebView is `capacitor://app.jamie-app.com/...`. `capacitor://`
is Capacitor's *generic* iOS scheme — any Capacitor app can claim it, so iOS
routes the tap to whichever app registered it last (GetCards). The fix
(`share.js` → `toPublicUrl()`, commit `95f1eb1`) rewrites **any** origin to
`https://app.jamie-app.com`, but it landed **after** the 1.2 submission
(`e22e3cc`), so build 7 doesn't have it. All four share call sites
(ClubDetail, GroupDetail, GroupEdit, Profile) route through it — the current
code is airtight; the store binary is just stale.

**Map watermark.** Not a code or CSP bug (the CSP allows `*.googleapis.com` /
`*.gstatic.com`, and the map script + tiles clearly load). A rendered-but-
watermarked map = **Google rejected the key at the auth layer** — either billing
is off, or the request's **HTTP-referrer isn't in the key's allowlist**. The
screenshot is the *same* 1.2 app that emits `capacitor://` links, so its Maps
requests carry `Referer: capacitor://app.jamie-app.com`. The key baked into the
build (`AIzaSyBDl-...`, `.env.production`) is the one the **web PWA** uses
successfully from `https://app.jamie-app.com` — so a key restricted to
`https://app.jamie-app.com/*` rejects the native `capacitor://` referrer → the
watermark shows on native only, while web stays fine (matches the symptom: one
iPhone, no flood of web complaints).

---

## Fixed in code (this commit — NOT pushed)

- **`MapView.jsx`** — hooks Google's global `window.gm_authFailure` callback:
  on a key rejection it logs to Sentry (`area: maps`, with the origin) and shows
  the clean "map unavailable" fallback instead of the silent watermark. We only
  learned of this failure from a user screenshot; now it's in telemetry.
- **`apple-app-site-association`** — added `/club/*`, `/group/*`, `/user/*` to
  the Universal Links allowlist (was reset-password / verify-email only). After
  deploy, tapping a shared `https://app.jamie-app.com/club/77` opens the **JAMIE
  app** (falls back to web if not installed) — and never routes by
  `capacitor://` again. *(Requires the `applinks:app.jamie-app.com`
  associated-domains entitlement in the iOS project — see roadmap step 4.)*

Verified: frontend build ✓, lint ✓, 15/15 tests ✓.

---

## ROADMAP — what Tobi has to do

### 1. Ship iOS 1.3 — ✅ DONE (2026-08-09)
Shipped `toPublicUrl()`, so shares are `https://…` **regardless** of the WebView
origin → **Maximilian's report is closed** for anyone on 1.3 (users still on 1.2
must update from the App Store first). It *may* also fix the map (if the 1.3
WebView serves from the `https` origin the config specifies) — **verify on a 1.3
device (step 2); if the watermark persists, the console fix is still required.**

### 2. Enable billing on the Google Cloud project — ⬅️ THE MAP FIX (confirmed)
Root cause is **confirmed by probing the live key** (Geocoding →
`REQUEST_DENIED` "You must enable Billing on the Google Cloud Project"). Not a
referrer issue; it's project-wide (web map watermarked too). With ~1000 users
you crossed the post-2025 capped free tier and, with billing off, Maps fell back
to dev-mode.
- **Enable billing:** https://console.cloud.google.com/project/_/billing/enable
  (the project owning key `AIzaSyBDl-...`). Watermark clears on web **and** app
  within minutes — **no rebuild/redeploy**.
- **Cost control:** set a **budget alert** and optionally a **daily quota cap**
  on the *Maps JavaScript API* so heavy usage can't cause bill shock (monthly
  free tier, then per-1,000-loads — check current pricing).
- **Then re-verify the native map.** If it's clean → done. If the app *still*
  watermarks while web is now fine, that's a secondary HTTP-referrer restriction
  rejecting the native origin (`capacitor://app.jamie-app.com`): add it to the
  key's allowlist, or use a separate native-build key in `.env.production`.

### 3. After the web deploy — verify Universal Links
- `curl -s https://app.jamie-app.com/.well-known/apple-app-site-association`
  returns the JSON with `/club/*`, `/group/*`, `/user/*` and
  `Content-Type: application/json`.
- On an iPhone with 1.3 installed, tap a `https://app.jamie-app.com/club/…` link
  from Messages/Mail → JAMIE opens.

### 4. Confirm the iOS entitlement (on Tina's Mac — untracked project)
Universal Links need `applinks:app.jamie-app.com` in the app's
**Associated Domains** entitlement. Since `/reset-password` / `/verify-email`
already work as links, it's almost certainly present — but confirm in Xcode:
App target → Signing & Capabilities → Associated Domains →
`applinks:app.jamie-app.com`. If missing, add it before archiving 1.3.

### 5. (Optional) Reply to Maximilian
His report is valid and already fixed on web/Android; the iPhone fix ships with
the next App Store update (1.3). No action needed on his side.

---

## Sentry epilogue (triage 2026-09-02)

Two Sentry issues turned out to be the **telemetry shadow of this same incident**:

| Sentry issue | Error |
|---|---|
| JAMIE-REACT-F | `Invariant Violation: useLoadScript was marked as loaded, but window.google is not present` |
| (unnamed sibling) | `ReferenceError: Can't find variable: google` |

**Same trace ID (`6c54caa9…`), timestamps 3 ms apart, identical event counts
(14/14), one session replay** → one user, one session, on `/group/245`,
**Aug 9 22:10 UTC** — i.e. a **1.2 binary** (`capacitor://` origin) inside the
**billing-off window**, ~2 h before billing was re-enabled. The half-failed Maps
SDK let `useLoadScript` flag loaded while `google` never materialized;
`GroupMiniMap`'s `GoogleMap` mount then threw both errors.

**Impact: contained by design.** Both events are `handled: yes` — caught by
`MapErrorBoundary` (GroupDetail.jsx), which exists for exactly this family
(JAMIE-REACT-F is named in its comment). The user saw a placeholder box instead
of a decorative mini-map; the page kept working.

**No code change warranted.** A `window.google` render guard wouldn't help — the
hook's invariant throws from its own validation effect and lands in the same
boundary with the same UX. Root causes are fixed on every current surface
(billing on, batch-7 single-SDK discipline `1f0ab1c`, 1.3+ https origin).
Last event 23 days ago, 0 users/30d.

**Sentry actions for Tobi** (UI clicks, can't be done from here):
1. **Merge** the two issues (same trace → duplicates of one incident).
2. **Resolve** the merged issue.
3. **Priority High → Low** (worst case: placeholder box on a decorative map).
4. If it ever reopens: it's a 1.2 straggler (unfixable remotely — iOS bundles
   the web build) → *archive until escalating*. Real vehicles: **iOS 1.4
   build → AASA deploy**, and the 1.2.1 forced-update backlog.
