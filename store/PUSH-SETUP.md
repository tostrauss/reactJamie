# iOS Push (APNs) — Setup & Go-Live Runbook

**Status of the code: DONE on both ends.** Nothing here requires new code — only
Apple-side config, Railway env vars, and one automated build step.

- Backend send path: `backend/src/controllers/pushController.js` (uses
  `@parse/node-apn`, JWT `.p8` auth). Route `POST /push/apns-token` stores the
  device token.
- Native registration: `useNativePush` in `frontend/src/App.jsx` (asks
  permission → `register()` → sends the token to the backend).
- The Push **entitlement** is installed automatically by `ios/4-preflight.sh`
  (see Part C) — you no longer click "+ Capability" by hand.

What is still missing to actually deliver a notification: **Parts A + B + C below.**

Known values (fill the blanks):
- **Team ID:** `RTJNBK94F8`
- **Bundle ID / APNs topic:** `com.jamie-app.app`
- **iOS App ID (App Store Connect):** `6784212397`

---

## Part A — Apple Developer portal (one-time)

1. **Create an APNs Auth Key**
   developer.apple.com → *Certificates, Identifiers & Profiles* → **Keys** → **+**
   - Name: `JAMIE APNs`
   - Tick **Apple Push Notifications service (APNs)** → Continue → Register
   - **Download the `AuthKey_XXXXXXXXXX.p8` file NOW** — Apple lets you download it
     exactly once. Store it in the password vault, never in git.
   - Note the **Key ID** (the 10 chars in the filename / on the key page).
   - One key works for the whole team (dev + prod, all apps).

2. **Enable Push on the App ID**
   *Identifiers* → `com.jamie-app.app` → tick **Push Notifications** → Save.
   (If it was already on, nothing to do.)

After this you have: the `.p8` file, its **Key ID**, and the **Team ID**
(`RTJNBK94F8`).

---

## Part B — Railway env vars (backend)

Set all four on the API service. Missing any one → the APNs provider stays
uninitialised and iOS sends silently no-op (web/Android push keep working).

| Variable          | Value                                                        |
|-------------------|-------------------------------------------------------------|
| `APNS_KEY_ID`     | the 10-char Key ID from Part A                               |
| `APNS_TEAM_ID`    | `RTJNBK94F8`                                                 |
| `APNS_KEY`        | the **full contents** of `AuthKey_XXXXXXXXXX.p8`            |
| `APNS_BUNDLE_ID`  | `com.jamie-app.app`                                          |

`APNS_KEY` note: paste the whole PEM including the
`-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines. Railway keeps
real newlines fine; if your paste flattens them, the code also accepts literal
`\n` escapes (it converts them back). Redeploy after setting them — look for
`[APNs] Provider initialized` in the logs on the next push.

The backend picks the APNs gateway from `NODE_ENV`: on Railway that's
`production` → the **production** gateway (`api.push.apple.com`). This matches
tokens from TestFlight / App Store builds. (See the sandbox caveat in Part D.)

---

## Part C — iOS build (entitlement)

The native project is regenerated each build, so the entitlement is scripted:

```bash
cd frontend && npx cap sync ios && cd ..
bash ios/4-preflight.sh      # step 4/4 installs the Push entitlement
```

`4-preflight.sh` copies `ios/App.entitlements` into the project and wires
`CODE_SIGN_ENTITLEMENTS` into `project.pbxproj` (Debug + Release). Then in Xcode:

1. Open: `bash ios/2-open-xcode.sh`
2. *Signing & Capabilities* → Team = **RTJNBK94F8**, automatic signing ON.
   Xcode sees the `aps-environment` entitlement and regenerates a provisioning
   profile that includes Push (needs Part A step 2 done first).
3. Bump the **Build** number, then **Product → Archive → Distribute App**.

The entitlement file says `aps-environment = development`; Xcode automatically
embeds `production` in an App Store / TestFlight archive. Don't change it to
`production` by hand — that breaks running the app on a device from Xcode.

---

## Part D — Testing

**Test via TestFlight, not a raw Xcode device run.** Because the backend uses the
production APNs gateway (`NODE_ENV=production`):

- **TestFlight / App Store build** → `aps-environment=production` → **production
  token** → matches the backend. ✅ This is the real test.
- **Xcode "Run" on a device** → `aps-environment=development` → **sandbox token**
  → the production gateway rejects it with `BadDeviceToken`. Expected; not a bug.

Steps:
1. Install the TestFlight build on a real iPhone (push does not work in the
   Simulator).
2. Log in → allow notifications when prompted. Backend log shows
   `[APNs] token registered (len …)`.
3. Trigger a notification (e.g. have a second account send you a friend request
   or a DM).
4. It should arrive; tapping it opens the right screen (the `url` in the payload).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `[APNs] registrationError` on the device; no token reaches the backend | Push capability / `aps-environment` entitlement missing in the build | Re-run `ios/4-preflight.sh`; confirm *Signing & Capabilities* shows Push Notifications; let automatic signing regenerate the profile |
| No `[APNs] Provider initialized` in logs | One of the 4 env vars missing/empty | Recheck Part B; all four must be set |
| `[APNs] send failure: InvalidProviderToken status 403` | Apple rejects the JWT itself: `APNS_TEAM_ID` does not own key `APNS_KEY_ID`, or `APNS_KEY` is not the `.p8` for that Key ID. **This is what blocked iOS push 04.–06.09.2026** — the Team ID had been copied from an unverified note; the real one is on the portal's *Membership details* page. "Variable is set" ≠ "variable is right": only a real send (or the JWT one-liner in `project_ios_push_incident` → `BadDeviceToken` = consistent) proves the four values fit together | Read the Team ID from *Membership details* of the team that owns the App ID; set `APNS_TEAM_ID`, redeploy, trigger one DM, look for `[APNs] sent` |
| `[APNs] send failure: BadDeviceToken` | Sandbox token hitting the production gateway (Xcode dev build) — Team/Key/Topic are already consistent when you see this | Test via TestFlight (Part D) |
| `[APNs] send failure: TopicDisallowed` / `DeviceTokenNotForTopic` | `APNS_BUNDLE_ID` ≠ the app's bundle id | Set `APNS_BUNDLE_ID=com.jamie-app.app` |
| Token saved but nothing arrives, no failure logged | No subscription row, or notification suppressed by iOS Focus/DND | Confirm the row in `push_subscriptions` (platform `apns`); check the device's notification settings |

---

## One-glance checklist

- [ ] APNs Auth Key `.p8` created, Key ID noted, `.p8` in the vault
- [ ] Push enabled on App ID `com.jamie-app.app`
- [ ] Railway: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID` set + redeployed
- [ ] `[APNs] Provider initialized` seen in logs
- [ ] `ios/4-preflight.sh` run; Xcode shows Push Notifications capability
- [ ] New build to TestFlight; push received on a real device
