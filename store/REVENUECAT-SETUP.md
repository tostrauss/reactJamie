# RevenueCat + App Store Connect: JAMIE Pro auf dem iPhone

Stand: **23.09.2026**. Für **Tina** (App Store Connect + RevenueCat) und
**Tobi** (Railway). Der Code ist fertig. Hier stehen nur die Einstellungen, die
**exakt** zum Code passen müssen.

**Nur Abos.** Keine Einzelkäufe, keine Boost-Pakete. Boosten ist Teil von Pro
(Meeting 21.09.).

## Die Werte, die exakt stimmen müssen

| Was | Wert |
|---|---|
| Bundle ID | `com.jamie-app.app` |
| Abo-Gruppe (App Store Connect) | `JAMIE Pro` |
| Produkt-ID 1 Monat | `pro_monthly`: 6,99 €, Stufe (Level) 3 |
| Produkt-ID 6 Monate | `pro_sixmonth`: 29,99 €, Stufe 2 |
| Produkt-ID 1 Jahr | `pro_yearly`: 49,99 €, Stufe 1 |
| Entitlement in RevenueCat | `pro` (klein geschrieben) |
| Webhook-URL | `https://app.jamie-app.com/api/iap/revenuecat/webhook` |

Bei Apple ist **Stufe 1 die höchste**. Das Jahresabo ist also Stufe 1.
Ein Wechsel auf eine höhere Stufe gilt als Upgrade und greift sofort.

Eine andere Schreibweise (z. B. `Pro`, `pro_month`) bedeutet: Kauf klappt bei
Apple, aber niemand bekommt Pro. Bitte Zeichen für Zeichen abgleichen.

---

## Teil A: App Store Connect (Tina)

### A1. Verträge prüfen, sonst lädt die App keine Preise

App Store Connect → **Business** (früher „Verträge, Steuern und Bankdaten").
Der Vertrag **„Paid Apps"** muss **Aktiv** sein, mit Bankkonto und
Steuerformularen. Solange er fehlt, liefert Apple **keine** Abos an die App.
Die App zeigt dann „JAMIE Pro ist auf dem iPhone derzeit nicht verfügbar."

- [ ] Paid-Apps-Vertrag aktiv

### A2. Abo-Gruppe und die drei Abos

**Meine Apps → JAMIE → Monetarisierung → Abonnements**

1. Abo-Gruppe **`JAMIE Pro`** anlegen, Lokalisierung Deutsch + Englisch
   (Anzeigename z. B. „JAMIE Pro").
2. Darin die drei Abos aus der Tabelle oben anlegen (Produkt-ID, Laufzeit,
   Preis, Stufe). Preise: Basisland **Österreich**, dann Apple die anderen
   Länder automatisch umrechnen lassen.
3. Pro Abo: Lokalisierung (Name + Beschreibung, DE + EN), Screenshot fürs
   Review (ein Screenshot vom Pro-Fenster reicht), Review-Notiz:
   `Auto-renewable subscription. Unlocks JAMIE Pro: boosting groups and clubs, full member lists, top placement, deals.`
4. **Verfügbarkeit:** alle Länder, in denen die App ist (Entscheidung Tobi
   23.09.: auf dem iPhone überall verkaufen, Apple führt die Steuern ab).

**Gratis-Testphase (optional):** Wenn ihr eine wollt, pro Abo unter
„Einführungsangebote" ein **kostenloses** Angebot anlegen (z. B. 14 Tage).
Die App erkennt das von selbst: Sie zeigt dann „14 Tage kostenlos starten"
und den Hinweis, was danach abgebucht wird. Nur Nutzer, denen Apple das
Angebot wirklich gibt, sehen den Text. Ohne Einführungsangebot steht dort
einfach „Jetzt starten".

- [ ] 3 Abos angelegt, Status „Bereit zur Einreichung"

### A3. In-App-Purchase-Schlüssel für RevenueCat

**Benutzer und Zugriff → Integrationen → In-App-Kauf** → **Schlüssel generieren**
(Name z. B. `RevenueCat`). Die `.p8`-Datei **sofort** herunterladen (geht nur
einmal) und im Passwort-Manager ablegen. **Key ID** und **Issuer ID** notieren.

- [ ] `.p8` + Key ID + Issuer ID vorhanden

### A4. App-Datenschutz

**App-Datenschutz** → Datentyp **„Kaufverlauf"** hinzufügen: mit der
Identität verknüpft, Zweck **App-Funktionalität**, kein Tracking. Ohne diesen
Eintrag lehnt Apple Apps mit Abos gerne ab.

- [ ] Kaufverlauf eingetragen

---

## Teil B: RevenueCat (Tina oder Tobi)

Konto: `office@jamie-app.com`. Stand 24.09. morgens ist das Konto frisch, es
gibt **noch kein Projekt**. Der Hinweis „Add your credit card … $2,500 MTR" ist
**keine** Hürde: Eine Karte braucht RevenueCat erst ab 2.500 $ Monatsumsatz,
für den Start reicht das kostenlose Konto. Der Bank-Termin für die Karte kann
also warten.

Zugang für Tobi: **Project settings → Collaborators → Invite** (seine
E-Mail-Adresse), nicht das Passwort weitergeben. Wurde das Passwort schon
einmal im Chat geteilt: danach ändern.

### B0. Projekt anlegen

Overview → **Create a project** → Name **`JAMIE`**. Alles Weitere passiert in
diesem Projekt.

### B1. App anlegen

Projekt **JAMIE** → **Apps & providers** → **+ App Store**:

- Bundle ID `com.jamie-app.app`
- **In-App Purchase Key**: die `.p8` aus A3 hochladen, Key ID + Issuer ID
  eintragen.

### B2. Produkte und Entitlement

1. **Product catalog → Products** → die drei Produkte aus App Store Connect
   importieren (`pro_monthly`, `pro_sixmonth`, `pro_yearly`).
2. **Entitlements → + New** → Identifier **`pro`**. Alle **drei** Produkte
   anhängen. Das Entitlement entscheidet, wer Pro ist. Ein Produkt ohne
   Entitlement verkauft, schaltet aber nichts frei.
3. **Offerings:** Das Standard-Offering `default` mit den drei Paketen darf
   angelegt werden, die App braucht es aber nicht (sie lädt die Produkte
   direkt über ihre IDs).

### B3. Apples Server-Benachrichtigungen an RevenueCat

In RevenueCat bei der App Store-App die **„Apple Server to Server
notification URL"** kopieren. In App Store Connect → **JAMIE → App-Informationen
→ App Store-Servermitteilungen** diese URL bei **Produktion und Sandbox**
eintragen (Version 2). So erfährt RevenueCat sofort von Verlängerungen,
Kündigungen und Erstattungen.

### B4. Webhook an JAMIE

**Integrations → Webhooks → + New**:

- URL: `https://app.jamie-app.com/api/iap/revenuecat/webhook`
- **Authorization header value:** eine lange Zufallszeichenkette (z. B. aus dem
  Passwort-Manager, 40+ Zeichen). **Diese geht an Tobi.**
- Environment: **Production and Sandbox**
- Events: alle

### B5. Die drei Schlüssel für Tobi

**Project settings → API keys**:

1. Den **öffentlichen App-Store-Schlüssel** der App (beginnt mit `appl_`)
2. **+ New secret API key**, API-Version **V1** (beginnt mit `sk_`). Nicht V2,
   der Server nutzt die V1-Schnittstelle.
3. Den Authorization-Wert aus B4

Diese drei **per Passwort-Manager** an Tobi, nicht per Chat oder Mail.

- [ ] Tobi hat `appl_…`, `sk_…` und den Webhook-Wert

---

## Teil C: Railway (Tobi)

| Variable | Wert |
|---|---|
| `REVENUECAT_IOS_API_KEY` | `appl_…` |
| `REVENUECAT_SECRET_API_KEY` | `sk_…` (V1) |
| `REVENUECAT_WEBHOOK_AUTH` | der Webhook-Wert aus B4 |
| `IOS_IAP_ENABLED` | `true` |
| `PAYMENTS_ENABLED` | `true` (Master, schaltet **auch** Stripe im Web frei) |

Danach prüfen:

1. `https://app.jamie-app.com/api/iap/config` im Browser: `ios_iap_enabled`
   muss `true` sein. Bleibt es `false`, fehlt einer der beiden Schlüssel oder
   ein Schalter.
2. RevenueCat → Webhook → **Send test event** → Railway-Log zeigt
   `[revenuecat-webhook] test event received ✓`. Ein `401` bedeutet: Der
   Authorization-Wert stimmt nicht mit `REVENUECAT_WEBHOOK_AUTH` überein.

**Die Schalter müssen an sein, BEVOR 1.4.2 zur Prüfung geht.** Apples Prüfer
kaufen in der Sandbox. Sehen sie keinen Kauf-Knopf, lehnen sie die Abos ab.

**Rollback:** `IOS_IAP_ENABLED=false` → iPhone-Kauf-Knöpfe verschwinden beim
nächsten App-Start, der Server nimmt keine neuen Käufe mehr an. Laufende Abos
bleiben gültig, Verlängerungen laufen weiter über den Webhook.

---

## So funktioniert es (für die Fehlersuche)

1. App-Start: Die App holt `GET /api/iap/config`. Darin steht, ob iOS-Käufe an
   sind, plus der öffentliche RevenueCat-Schlüssel.
2. Login: RevenueCat läuft mit der **JAMIE-User-ID** als App User ID.
3. Kauf: Apple-Kaufbogen → danach `POST /api/iap/revenuecat/sync`. Der Server
   fragt RevenueCat selbst, ob das Entitlement `pro` aktiv ist, und schreibt
   `subscriptions` (Zeile `revenuecat:<userId>`).
4. Verlängerung, Kündigung, Erstattung, Übertragung auf ein anderes Konto:
   RevenueCat-Webhook → der Server fragt erneut nach, gleicher Ablauf.

In der Datenbank:

```sql
SELECT status, current_period_end, stripe_customer_id
  FROM subscriptions WHERE stripe_subscription_id = 'revenuecat:<USER_ID>';
```

| Status | Bedeutung |
|---|---|
| `active` / `trialing` | Pro aktiv (bezahlt / in der Testphase) |
| `canceling` | gekündigt, Pro läuft bis `current_period_end` |
| `expired` / `revoked` | abgelaufen / erstattet |
| `duplicate` | Nutzer hat **zusätzlich** ein aktives Web-Abo. Er zahlt doppelt. Support sollte eines erstatten (Sentry-Warnung `revenuecat duplicate subscription`). |

| Symptom | Ursache |
|---|---|
| iPhone zeigt keinen Pro-Knopf | `ios_iap_enabled` false (Teil C) oder App vor 1.4.2 |
| „JAMIE Pro ist auf dem iPhone derzeit nicht verfügbar" | Apple liefert keine Produkte: Paid-Apps-Vertrag (A1), Produkt-IDs, oder Abos noch nicht „Bereit zur Einreichung" |
| Kauf klappt, aber kein Pro | Entitlement `pro` fehlt oder Produkt nicht angehängt (B2) |
| Pro kommt erst nach Minuten | Sync-Aufruf fehlgeschlagen, der Webhook hat es nachgeholt. Railway-Log `[revenuecat]` prüfen |
