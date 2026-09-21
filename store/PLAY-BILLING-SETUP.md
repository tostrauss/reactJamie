# Google Play Billing (Android-TWA) — Setup-Runbook

Was das ist: Schritt-für-Schritt, um JAMIE Pro **in der Play-Store-App** über Google Play Billing zu verkaufen. Für Tobi (Code, Cloud, Railway) — die Play-Console-Schritte kann auch Tina machen, Zugriff auf `office@impibag.com` (Play-Developer-Konto) vorausgesetzt.

Stand: 21.09.2026. Code ist **komplett gebaut**, Schalter `PLAY_BILLING_ENABLED = false` in `frontend/src/utils/platform.js`. Live-Schaltung erst nach dem Lizenztester-Kauf (Schritt 8).

**Nur Abos.** Boosts werden in der Play-App **nicht** einzeln verkauft („Boosts bleiben, nur keine Einzelkäufe", Tina 21.09.2026) — der Boost-„Kaufen"-Tab ist in der TWA ausgeblendet, es gibt kein Consumable und kein `consume()`.

---

## Wie es funktioniert (damit klar ist, was „gut" aussieht)

Die Play-App ist eine Trusted Web Activity = unsere Web-PWA in einer Android-Hülle. Google verbietet Stripe für digitale Güter darin. Chrome stellt in einer TWA, deren Hülle das `androidbrowserhelper:billing`-Extension mitbringt, zwei Web-APIs bereit:

| API | Wozu |
|---|---|
| `window.getDigitalGoodsService('https://play.google.com/billing')` | Produktdetails (`getDetails`), eigene Käufe (`listPurchases`) |
| `PaymentRequest` mit `supportedMethods: 'https://play.google.com/billing'` | zeigt den Play-Kaufbogen, liefert den `purchaseToken` |

Ablauf eines Kaufs:

1. ProModal → `purchasePlaySubscription(plan)` (`frontend/src/utils/playBilling.js`) öffnet den Play-Kaufbogen für die `sku` (= Produkt-ID).
2. Play liefert einen `purchaseToken`. Der Bogen wird sofort geschlossen (`complete('success')` — das Geld ist zu dem Zeitpunkt schon geflossen, egal was unser Server sagt).
3. App POSTet `{ product_id, purchase_token }` an `POST /api/iap/google/verify`.
4. Server (`backend/src/controllers/googleIapController.js`) fragt Google (`purchases.subscriptionsv2.get`), prüft Produkt + Besitzer, schreibt `iap_receipts` (platform `google`), upsertet `subscriptions` (`stripe_subscription_id = google:<purchaseToken>`, `stripe_customer_id = google:<userId>`) und **acknowledgt** den Kauf. **Ohne Acknowledge erstattet Google nach 3 Tagen automatisch.**
5. Verlängerungen, Kündigungen, Rückerstattungen kommen als **Real-time Developer Notifications** (Pub/Sub-Push) an `POST /api/iap/google/notifications`. Der Handler holt den Token neu bei Google und läuft durch **denselben** Sync — alle Wege konvergieren auf Googles Sicht.

Status-Mapping (`backend/src/utils/googlePlay.js` `PLAY_STATE_TO_STATUS`):

| Play `subscriptionState` | `subscriptions.status` | Pro? |
|---|---|---|
| ACTIVE | `active` | ja |
| CANCELED (Auto-Renew aus, Laufzeit läuft) | `canceling` | ja, bis `expiryTime` |
| IN_GRACE_PERIOD (Zahlung hängt, Google versucht weiter) | `active` | ja (Google-Vorgabe) |
| ON_HOLD (Grace vorbei) | `past_due` | nein |
| PAUSED | `paused` | nein |
| EXPIRED | `expired` | nein |
| PENDING (z. B. Barzahlung offen) | `pending` | nein — 202 an den Client |
| RTDN Typ 12 REVOKED / voidedPurchase | `revoked` | nein, sofort |

Backend-Routen (Präfix `/api/iap`):

| Methode + Pfad | Handler | Auth |
|---|---|---|
| `POST /google/verify` | `verifyGoogle` | JWT + `requirePayments` + strictLimiter |
| `POST /google/restore` | `restoreGoogle` | JWT + `requirePayments` + strictLimiter |
| `POST /google/notifications` | `googleRtdn` | Pub/Sub-OIDC **oder** URL-Secret (fail-closed), raw body |

Antwort-Codes von `verify`, die die App kennt: `PAYMENTS_DISABLED` 403 · `PLAY_NOT_CONFIGURED` 503 · `PURCHASE_INVALID` 400 · `PURCHASE_NOT_ACTIVE` 400 · `TOKEN_OWNED_BY_OTHER` 409 · `PLAY_UPSTREAM` 502 · `pending: true` 202.

---

## 0. Voraussetzungen

- Play-Developer-Konto mit **Zahlungsprofil** (Play Console → Einrichtung → Zahlungsprofil). Ohne Zahlungsprofil lassen sich keine Produkte anlegen.
- Google-Cloud-Projekt, das mit dem Play-Developer-Konto **verknüpft** ist (Play Console → Einrichtung → API-Zugriff). Das Maps-Projekt darf man nehmen; sauberer ist ein eigenes `jamie-play-billing`.
- Der TWA-Build **versionCode ≥ 11** (Schritt 6) muss mindestens in einem Test-Track liegen, sonst kennt Play die Produkte für die App nicht.

- [ ] Zahlungsprofil aktiv
- [ ] Cloud-Projekt mit Play verknüpft

## 1. Produkte in der Play Console anlegen

Play Console → JAMIE → **Monetarisieren mit Play → Produkte → Abos** → „Abo erstellen".

Produkt-IDs **zeichengenau** wie im Code (`googleIapController.GOOGLE_PRODUCTS` = `frontend/src/utils/playBilling.js` = dieselben IDs wie App Store Connect):

| Produkt-ID | Basisplan-ID | Abrechnungszeitraum | Preis (= `PRO_PLANS`, Stand 21.09.2026) |
|---|---|---|---|
| `pro_monthly` | `p1m` | 1 Monat | 6,99 € |
| `pro_sixmonth` | `p6m` | 6 Monate | 29,99 € |
| `pro_yearly` | `p1y` | 1 Jahr | 49,99 € |

Pro Abo:

1. Produkt-ID + Name („JAMIE Pro – 1 Monat" …), Beschreibung, Vorteile (bis 4 Zeilen).
2. **Basisplan** hinzufügen: ID aus der Tabelle, „Automatisch verlängernd", Zeitraum, **Kulanzzeitraum 7 Tage** (Standard), Resubscribe an. Preis für AT und DE setzen; Rest der EU „Preis automatisch umrechnen" ist ok (Verkauf ist serverseitig ohnehin nur AT+DE: `utils/paymentRegion.js` gilt für Stripe — für Play regelt das die Länderfreischaltung der App).
3. **Angebot** (optional, Tinas Zusatzfrage „14 Tage gratis bleibt?"): Angebot `trial14` → Typ „Kostenloser Testzeitraum", 14 Tage, Berechtigung „Neue Kunden". Google stellt sicher, dass ein Konto den Trial nur einmal bekommt. Wenn kein Trial gewünscht: kein Angebot anlegen — der Code braucht keins.
4. Basisplan **aktivieren**, dann das Abo aktivieren.

Preisänderung später: Basisplan-Preis in der Console ändern **und** `PRO_PLANS` (`backend/src/controllers/subscriptionController.js`) + `frontend/src/utils/proPlans.js` anpassen, damit Web und Play denselben Preis zeigen. Die App zeigt in der TWA über `getPlayProductDetails()` ohnehin den **Play-Preis**, wenn verfügbar.

- [ ] 3 Abos mit je einem Basisplan angelegt und **aktiv**
- [ ] Produkt-IDs gegen `googleIapController.js` geprüft

## 2. Play Developer API + Service-Account

Google Cloud Console (das verknüpfte Projekt):

1. **APIs & Dienste → Bibliothek → „Google Play Android Developer API"** aktivieren.
2. **IAM → Dienstkonten → Dienstkonto erstellen**: Name `jamie-play-billing`. Keine Projektrolle nötig.
3. Dienstkonto → **Schlüssel → Schlüssel hinzufügen → JSON**. Datei einmalig herunterladen, in den Passwort-Manager.
4. Play Console → **Nutzer und Berechtigungen → Neue Nutzer einladen** → E-Mail des Dienstkontos (`jamie-play-billing@<projekt>.iam.gserviceaccount.com`). App-Berechtigungen für JAMIE: **„Finanzdaten, Bestellungen und Antworten auf Umfragen zum Kündigen ansehen"** + **„Bestellungen und Abos verwalten"**. Einladen. (Es kann bis zu 24–48 h dauern, bis das Konto von der API akzeptiert wird — bis dahin kommt 401/403 = unser `PLAY_NOT_CONFIGURED` 503.)

- [ ] API aktiviert
- [ ] Service-Account-JSON gesichert
- [ ] Service-Account in der Play Console mit beiden Berechtigungen eingeladen

## 3. Railway-Env setzen

| Var | Wert |
|---|---|
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | die JSON-Datei **base64-kodiert** (`base64 -w0 key.json`) — Railways Editor zerlegt mehrzeiliges JSON; roher Einzeiler geht auch |
| `GOOGLE_PLAY_PACKAGE_NAME` | `jamie.app` (Default, kann entfallen) |
| `GOOGLE_PLAY_RTDN_SECRET` | ein langes Zufallsgeheimnis (`openssl rand -hex 32`) — für den ersten Test in Schritt 4 |
| `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL` | (Schritt 4, OIDC-Variante) |
| `GOOGLE_PLAY_RTDN_AUDIENCE` | `https://app.jamie-app.com/api/iap/google/notifications` (Default) |

Fail-closed: Ohne Service-Account antworten `verify`/`restore` mit **503 `PLAY_NOT_CONFIGURED`**; ohne RTDN-Auth wird **jede** Notification abgelehnt (503). `PAYMENTS_ENABLED=true` muss zusätzlich gesetzt sein (Kill-Switch, gilt für alle Käufe).

- [ ] Vars gesetzt, Deploy durch, Boot-Log ohne `GOOGLE_PLAY`-Fehler

## 4. Real-time Developer Notifications (RTDN)

Google Cloud → **Pub/Sub**:

1. **Thema erstellen**: `play-rtdn`.
2. Thema → Berechtigungen → Prinzipal `google-play-developer-notifications@system.gserviceaccount.com` mit Rolle **Pub/Sub-Publisher**.
3. **Abo erstellen** auf dem Thema: Typ **Push**, Endpunkt
   `https://app.jamie-app.com/api/iap/google/notifications?token=<GOOGLE_PLAY_RTDN_SECRET>`
   (für den ersten Test). Bestätigungsfrist 60 s, Retry „exponentielles Backoff".
4. **Empfohlen danach: Authentifizierung aktivieren** → Dienstkonto z. B. `play-rtdn-push@<projekt>.iam.gserviceaccount.com` (braucht Rolle *Dienstkonto-Token-Ersteller* für den Pub/Sub-Dienst-Agent), Zielgruppe = die Endpoint-URL **ohne** `?token=`. Dann in Railway `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL` setzen, `?token=` aus der Push-URL entfernen und `GOOGLE_PLAY_RTDN_SECRET` löschen. Beide Mechanismen dürfen parallel aktiv sein (entweder reicht).
5. Play Console → JAMIE → **Monetarisieren mit Play → Einrichtung der Monetarisierung** → „Echtzeit-Entwicklerbenachrichtigungen": Themenname `projects/<projekt>/topics/play-rtdn` → **Testbenachrichtigung senden**. Im Railway-Log muss `[play-rtdn] test notification received ✓` erscheinen.

Verhalten des Endpoints: `200` für alles, was wir bewusst verwerfen (Test-Ping, unbekannter Token = der Client hat den Kauf nie verifiziert → Restore holt ihn), `401` bei falscher Auth, `500` nur bei transienten Fehlern (Pub/Sub retryt dann).

- [ ] Testbenachrichtigung im Log
- [ ] (später) OIDC-Auth aktiv, Secret entfernt

## 5. Lizenztester

Play Console → **Einrichtung → Lizenztests**: die Google-Konten von Tobi/Tina/Arno eintragen, Antwort „RESPOND_NORMALLY". Käufe dieser Konten sind kostenlos, Abos verlängern sich im Schnelltakt (1 Monat ≈ 5 Min) und laufen nach wenigen Zyklen aus — perfekt für Renewal/Expire-RTDNs. Diese Käufe tragen `testPurchase` → `iap_receipts.environment = 'Test'`.

- [ ] Lizenztester eingetragen

## 6. TWA-Build 1.2 (versionCode 11)

Im Repo bereits erledigt (21.09.2026): `twa/twa-manifest.json` `playBilling.enabled = true`, Version 1.2/11; `twa/app/build.gradle` `com.google.androidbrowserhelper:billing:1.2.0` (stable, Billing Library 8.3.0 — erfüllt Googles „Billing Library 7+"-Pflicht); `AndroidManifest.xml` `PaymentActivity` + `PaymentService`; `DelegationService.java` registriert den `DigitalGoodsRequestHandler`.

```bash
cd twa
bash 3-build.sh          # bubblewrap build — bei „update project?" NEIN (targetSdk-Falle, RUNBOOK §3)
```

Das `.aab` in den **Internen Test-Track** hochladen. Play muss den Build kennen, bevor der Kaufbogen Produkte auflöst. Store-Listing ändert sich nicht (Android bleibt TWA, siehe Kommunikationsregel).

- [ ] Build 11 im internen Test-Track
- [ ] `adb logcat | grep -i billing` beim App-Start ohne Fehler

## 7. Schalter

Reihenfolge wie beim Stripe-Go-Live: **zuerst** Server (Railway `PAYMENTS_ENABLED=true` + Schritt 3), **dann** Frontend `PLAY_BILLING_ENABLED = true` in `frontend/src/utils/platform.js` deployen. Umgekehrt zeigt die App Kauf-UI, der Server 403t.

`purchasesEnabled()` wird in der TWA nur true, wenn zusätzlich `window.getDigitalGoodsService` existiert — auf **alten Play-Builds (≤ 10)** bleibt automatisch der „Bald verfügbar"-Teaser stehen. Niemand läuft in einen kaputten Kauf.

- [ ] `PAYMENTS_ENABLED=true` in Railway
- [ ] `PLAY_BILLING_ENABLED = true` deployed

## 8. Erster Testkauf

Auf einem Android-Gerät mit einem Lizenztester-Konto die App **aus dem internen Test-Track** installieren:

1. ProModal öffnen → Tarif wählen → Kaufen. Der **Play-Kaufbogen** (nicht Stripe) erscheint, Preis mit „Test"-Hinweis.
2. Kaufen → App zeigt Erfolg.
3. DB: `SELECT * FROM iap_receipts WHERE platform='google' ORDER BY id DESC LIMIT 3;` → Zeile mit `environment='Test'`; `SELECT status, current_period_end FROM subscriptions WHERE stripe_subscription_id LIKE 'google:%';` → `active`.
4. Log: kein `[play] acknowledge failed`. Play Console → Bestellverwaltung: Bestellung sichtbar, **nicht** „Bestätigung ausstehend".
5. Einstellungen → Abo-Sektion zeigt **„Abo in Google Play verwalten"** (kein Stripe-Portal, kein Kündigen-Button).
6. In Google Play → Abos kündigen → RTDN Typ 3 → Status `canceling`; nach Ablauf Typ 13 → `expired`. Im Log `[play-rtdn]`-Zeilen.
7. Restore: App neu installieren oder Konto neu anmelden → Einstellungen → „Käufe wiederherstellen" → `restored: 1`.

Wenn es hängt, in dieser Reihenfolge prüfen:
- Kaufbogen erscheint nicht / Stripe erscheint → alter Build oder `PLAY_BILLING_ENABLED` false → `window.getDigitalGoodsService` in Chrome-DevTools (chrome://inspect) prüfen.
- `503 PLAY_NOT_CONFIGURED` → Service-Account-JSON kaputt oder Play-Einladung noch nicht wirksam (bis 48 h).
- `400 PURCHASE_INVALID` → Produkt-ID stimmt nicht mit Play überein, oder Build nicht im Track.
- `409 TOKEN_OWNED_BY_OTHER` → dasselbe Play-Konto hat schon mit einem anderen JAMIE-Konto gekauft (gewollt).

- [ ] Testkauf gebucht, acknowledged, Pro aktiv
- [ ] Kündigung + Ablauf per RTDN im Status sichtbar
- [ ] Restore funktioniert

## 9. Vor dem Produktions-Release

- [ ] Google Play → App-Inhalte → **Datensicherheit**: „Kaufverlauf" als erhoben deklarieren (analog `store/DATA-SAFETY.md`).
- [ ] Lizenztester-Käufe in `iap_receipts` (`environment='Test'`) im Growth-Dashboard ausblenden.
- [ ] Widerruf: Google erstattet innerhalb 48 h selbst (Play → Bestellverlauf); danach Antrag via Play-Support oder wir per Console (Bestellverwaltung → Erstatten → RTDN `voidedPurchase` → Status `revoked`). Im Widerrufstext ergänzen (Prüfer laut Meeting offen).
- [ ] Rollback jederzeit: Railway `PAYMENTS_ENABLED=false` → der Server 403t jeden neuen Kauf, bestehende Play-Abos laufen bei Google weiter und werden per RTDN weiter gesynct.

## Was bewusst NICHT gebaut wurde

- **Consumables (Boosts)** — Entscheidung Tina 21.09.2026. Sollte das kippen: `GOOGLE_PRODUCTS` um `boost_*` mit `type:'boost'` erweitern, `purchases.products.get` + `:consume` in `utils/googlePlay.js`, und `boostPurchasesEnabled()` in `platform.js` anpassen.
- **RevenueCat für Play** — RevenueCat hat kein Web/Digital-Goods-SDK; für die TWA ist die direkte Play-Developer-API der kürzere Weg (nur `google-auth-library`, schon installiert). Wer die Käufe trotzdem in RevenueCat sehen will, kann den `purchaseToken` zusätzlich an RevenueCats REST-`/v1/receipts` posten (Platform `android`). Für iOS bleibt RevenueCat der Plan (Capacitor-SDK, IAP-Release 1.5).
- **Obfuscated Account ID** — die Digital-Goods-API in Chrome kann sie nicht mitgeben; Besitz wird stattdessen über die erste Verifikation gebunden (`TOKEN_OWNED_BY_OTHER`).
