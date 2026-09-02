# Meeting 2026-09-03 — Pro freischalten + Apple Push

**Teilnehmer:** Tobi + Tina (Apple-Account + Stripe-Inhaberin nötig).
**Mitbringen:** Tina: Apple-Developer-Login, Stripe-Login, Passwort-Vault.
Tobi: Railway-Zugang, dieses Doc, echtes Test-Handy (iPhone mit TestFlight).

**Empfohlene Reihenfolge:** ① APNs (15 min Portal-Arbeit, unabhängig) →
② Pro-Go-Live (der große Block) → ③ Play-Verifikation (5 min, Deadline!).

---

## ① Apple Push (APNs) — Runbook: `store/PUSH-SETUP.md`

Code ist FERTIG (beide Enden). Im Meeting passiert nur Teil A + B:

1. **Teil A (Tina, Apple-Portal, ~10 min):** APNs Auth Key erzeugen
   (developer.apple.com → Keys → + → „JAMIE APNs" → APNs anhaken).
   **`.p8` sofort herunterladen — Apple erlaubt das genau EINMAL** → direkt in
   den Vault. Key ID notieren. Dann: Identifiers → `com.jamie-app.app` →
   Push Notifications anhaken (falls nicht schon an).
2. **Teil B (Railway, ~5 min):** Die 4 Variablen setzen — Tina fügt den
   `.p8`-Inhalt DIREKT in Railway ein (nie per WhatsApp/Mail schicken):
   `APNS_KEY_ID` · `APNS_TEAM_ID=3FMA7660T8` · `APNS_KEY` (kompletter
   PEM-Inhalt) · `APNS_BUNDLE_ID=com.jamie-app.app`.
   Nach Redeploy: Log-Zeile `[APNs] Provider initialized` beim ersten Push.
3. **Erwartung managen:** Zustellung auf echte iPhones braucht das
   **1.4-Binary** — die Entitlement-Automation (`ios/4-preflight.sh`,
   Commit `03a3d42`) ist NICHT im 1.3-Build, 1.3-Geräte registrieren also
   keine Tokens. **Im Meeting entscheiden:** 1.4-Build nach
   `store/IOS-UPDATE-TINA.md` + `PUSH-SETUP.md` Teil C anstoßen (Tinas Mac),
   Test dann via TestFlight (Teil D — NICHT via Xcode-Run, Sandbox-Token!).
   Merker aus dem Audit: **AASA-Deploy erst NACH 1.4** (appUrlOpen-Fix).

---

## ② Pro / Payments freischalten

### Stand heute (nichts davon im Meeting wiederholen)
- Stripe ist seit 27.07. **live konfiguriert**: Keys rotiert ✓, BEIDE
  Webhooks registriert ✓, Customer Portal aktiviert ✓ (Historie in
  `frontend/src/utils/platform.js` + `store/RELEASE-2026-07-27.md` §4).
- Kill-Switch ist seit `67d4ebd` **serverseitig**: Railway
  `PAYMENTS_ENABLED` wird wirklich gelesen (fail-closed, nur Literal
  `true` öffnet) + Route-Middleware auf allen 4 Geld-Routen (`a19519d`).
- `publishable_key` liefert der SERVER zur Laufzeit in der
  create-Response — das `VITE_STRIPE_PUBLISHABLE_KEY` aus der alten
  Checkliste (Step 9) ist fürs Web-Bundle NICHT nötig; serverseitig muss
  `STRIPE_PUBLISHABLE_KEY` gesetzt sein (ist es).
- **Neu vorbereitet:** Die Play-TWA ist jetzt auch SERVERSEITIG vom
  Checkout ausgeschlossen (`X-Client-Shell: twa`-Backstop) — die im Audit
  notierte Lücke vor dem Flag-Flip ist zu. Geofence unverändert.

### Vor dem Flip kurz prüfen (Stripe-Dashboard, 10 min)
- [ ] **Stripe Tax** (Checkliste Step 8): Ist die AT-USt-Registrierung
      aktiv? Wenn NEIN → im Meeting aktivieren, BEVOR verkauft wird
      (rückwirkend geht nicht — IMPIBAG zahlt sonst die USt selbst).
- [ ] Statement Descriptor = `JAMIE` (Step 3, kurzer Blick).
- [ ] Beide Webhook-Endpoints Status „Enabled" (Step 4).
- [ ] Apple-Pay-Domain (Step 6): optional — Datei
      `apple-developer-merchantid-domain-association` liegt noch NICHT in
      `.well-known/` (offenes DEV TODO). Ohne sie: kein Apple Pay im
      Browser-Checkout, Karte geht trotzdem. Nicht blocking.
- Fixe `price_…`-IDs (Step 7 DEV TODO): NICHT blocking — Runtime
  `prices.create()` funktioniert (dahlia-gepinnt).

### Der Flip (exakte Reihenfolge — wichtig!)
1. **Railway zuerst:** `PAYMENTS_ENABLED=true` setzen → Redeploy. Server
   nimmt jetzt Zahlungen an; UI zeigt noch nichts (Bundle-Flag ist aus) —
   dieser Zwischenzustand ist harmlos. *(Umgekehrt wäre er kaputt: UI da,
   Server 403.)*
2. **Frontend:** `frontend/src/utils/platform.js` Zeile
   `export const PAYMENTS_ENABLED = false;` → `true` (+ den 05.08-Kommentar
   aktualisieren). Commit, Push → Railway baut das neue Bundle.
3. **Gültig ab dann:** Käufe NUR im echten Web-Browser. iOS: neutral (kein
   Kauf-UI, `IOS_IAP_ENABLED=false`, IAP nicht gebaut — siehe
   `IAP-iOS-OPTIONEN.md`). Play-TWA + Android-Capacitor: „Bald
   verfügbar"-Teaser, serverseitig doppelt gesperrt.

### Walkthrough danach (Checkliste Step 10 — echte Karte!)
Live-Mode kennt keine Testkarten. Kleinster Betrag zuerst:
1. Browser → Login → Gruppe → Boost „1 Credit" (1,99 €) → zahlen.
2. Credit +1 im UI · Dashboard: Payment „succeeded" · Webhook-Event
   `payment_intent.succeeded` mit Response 200.
3. Optional: Pro Wöchentlich (4,99 €) abschließen → Settings → „Abo
   verwalten" öffnet das Portal → kündigen.
4. **Beides refunden** (Dashboard → Payment → Refund).
5. Health: `curl https://app.jamie-app.com/api/health` → `{"status":"ok"}`.

### Rollback (falls irgendwas brennt)
Railway `PAYMENTS_ENABLED=false` → **Server lehnt sofort alle neuen Käufe
ab (403 PAYMENTS_DISABLED)**, egal was das Bundle zeigt. Frontend-Flip
zurück im nächsten Deploy. Webhooks + Portal bleiben absichtlich offen
(Refunds/Kündigungen laufen weiter).

---

## ③ Play-Verifikation (5 min, DEADLINE 30.09!)

Google-Mail an Tina: „Register your apps and signing keys … before
Sep 30, 2026" — nicht registrierte Apps fliegen GLOBAL aus Play.
Play Console (Tinas Account) → Home → Verifizierungs-Banner prüfen.
99 % sind auto-registriert — nur bestätigen, dass `jamie.app` dabei ist.
Wenn nicht: dem Console-Flow folgen (Identität + Signing-Keys bestätigen).

---

## Nach dem Meeting (Tobi, DEV)
- [ ] iOS-1.4-Build begleiten (Pods! `@capacitor/filesystem` neu) → dann
      AASA deployen (Reihenfolge!).
- [ ] Apple-Pay-Domain-File in `.well-known/` serven (Step 6 DEV TODO).
- [ ] Fixe `price_…`-IDs verdrahten (Step 7 DEV TODO, unkritisch).
- [ ] Erste echte Payments in Sentry/Logs beobachten (24 h Fenster).
