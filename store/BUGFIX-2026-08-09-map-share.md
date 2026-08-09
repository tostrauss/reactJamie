# Bugfix 2026-08-09 — Map watermark + `capacitor://` share links

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

### 1. Ship iOS 1.3 (fixes the share bug for certain) — **primary**
Follow `store/IOS-UPDATE-TINA.md` (already written, v1.3 / build 8). 1.3 ships
`toPublicUrl()`, so shares become `https://…` **regardless** of what origin
WebKit reports. This closes Maximilian's report. It also *likely* fixes the map
(if the 1.3 WebView serves from the `https` origin the config specifies) — but
the guaranteed map fix is step 2.
> Deploy web/backend **first** (so the updated `apple-app-site-association` is
> live) so the app's Universal Links resolve correctly, then ship iOS.

### 2. Fix the Maps key in Google Cloud Console — **guaranteed map fix**
Console → APIs & Services → Credentials → key `AIzaSyBDl-...`:
- **Check billing** is active on the project. *Tell:* if billing is off, the
  **web** map is watermarked too — open the Karte tab in a desktop browser at
  `https://app.jamie-app.com`. Watermarked on web → **billing** is the cause.
  Clean on web, watermarked only in the app → **referrer** (most likely).
- **Application restrictions → HTTP referrers:** the allowlist must cover the
  origin the native app actually uses. Add (in addition to the existing
  `https://app.jamie-app.com/*`):
  - `https://app.jamie-app.com` (no path)
  - Try `capacitor://app.jamie-app.com/*` — if the console rejects the scheme,
    the robust alternative is a **separate Maps JS key for the native build**
    (baked into `.env.production`, which is what the Mac build reads) with the
    native origin allowed, keeping the web key tight.
- Also confirm **Maps JavaScript API** is enabled and not over a quota cap.

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
