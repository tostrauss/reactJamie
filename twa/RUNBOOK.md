# TWA → Play Store — Build & Submit Runbook

Was das ist: Schritt-für-Schritt-Anleitung, um JAMIE als Android TWA zu bauen und in den Play Store zu bringen. Für Tobi. Bubblewrap CLI macht den Großteil; Android Studio brauchst du nur, wenn du das Bundle lokal signieren oder debuggen willst.

Stand: 2026-06-11. Host: `app.jamie-app.com`. Package: `jamie.app`. versionName `1`, versionCode `4`.

Die Shell-Skripte (`1-generate-keystore.sh` … `6-fill-apple-aasa.sh`) sind Bash-Skripte. Auf Windows mit Git Bash oder über die `Bash`-Umgebung ausführen — nicht direkt in PowerShell. Umgebungs-Setup unten ist PowerShell.

---

## 0. Voraussetzungen (einmalig)

```powershell
# Bubblewrap CLI installieren
npm install -g @bubblewrap/cli

# JDK 17 (Bubblewrap benötigt 11+, 17 ist empfohlen)
# → Adoptium / Temurin JDK 17 von https://adoptium.net installieren
java -version    # muss "17" (oder "11") zeigen

# Android SDK ist über Android Studio bereits installiert.
# ENV-Variablen setzen, falls noch nicht gesetzt:
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("JAVA_HOME",    "C:\Program Files\Eclipse Adoptium\jdk-17.0.10.7-hotspot", "User")
# (Pfad-Versionsnummer ggf. anpassen — schau in C:\Program Files\Eclipse Adoptium\)
```

PowerShell **neu starten** nach dem Setzen von ENV-Variablen, sonst sieht Bubblewrap sie nicht.

- [ ] `npm install -g @bubblewrap/cli` ausgeführt
- [ ] `java -version` zeigt 17 oder 11
- [ ] `ANDROID_HOME` und `JAVA_HOME` gesetzt, PowerShell neu gestartet

---

## 1. Keystore generieren (einmalig — und dann FOREVER sichern)

```bash
cd twa
bash 1-generate-keystore.sh
```

Du wirst nach einem **Keystore-Passwort** und einem **Key-Passwort** gefragt. Verwende **dasselbe Passwort** für beide — speichere es im Passwort-Manager unter `JAMIE Android Release Keystore`.

Erzeugt `twa/keystore/jamie-release.jks` mit Alias `jamie-key` (so verweist `twa-manifest.json` und `twa/app/build.gradle` darauf).

```bash
bash 2-get-sha256.sh
```

Notiere den SHA-256 Fingerprint. Aktuell in `assetlinks.json` hinterlegt (Dev/Upload-Key):

```
FD:AC:47:AA:56:02:3C:AC:AA:B4:BD:0D:08:26:73:0D:04:97:9B:E2:1B:0F:6E:82:C4:01:F1:54:0C:96:0F:62
```

Wenn `2-get-sha256.sh` einen anderen Fingerprint zeigt, hast du einen neuen/anderen Keystore — dann muss `assetlinks.json` (Schritt 2) entsprechend aktualisiert werden.

**Backup-Pflicht:**
- [ ] `twa/keystore/jamie-release.jks` in verschlüsselten Cloud-Ordner kopieren (1Password / Bitwarden / verschlüsselter USB-Stick)
- [ ] Passwort am selben Ort notieren

Wenn der Keystore verloren geht, ist die App auf Play Store **nicht mehr updatebar** — du müsstest unter neuem Package-Namen neu starten. (Gilt, solange wir Play App Signing nicht nutzen — siehe Schritt 6.)

---

## 2. assetlinks.json mit dem DEV-Fingerprint vorab füllen

Damit der erste Build im Vollbild läuft (kein Browser-Header), muss der lokale Fingerprint in `frontend/public/.well-known/assetlinks.json` stehen. Aktuell ist dort genau **ein** Fingerprint (der Dev/Upload-Key, siehe Schritt 1) für `package_name: jamie.app` eingetragen — das ist der Soll-Zustand für unsere Signing-Strategie.

Falls die Datei leer/falsch ist, neu setzen:

```bash
cd twa
bash 5-fill-assetlinks.sh "DEIN:SHA256:VOM:SCHRITT:1"
```

**Commit + deploy** (Railway baut automatisch):

```bash
git add frontend/public/.well-known/assetlinks.json
git commit -m "Add Android dev fingerprint to assetlinks"
git push
```

Warte ~1–2 Minuten bis Railway redeployed hat, dann verifizieren:

```bash
curl -i https://app.jamie-app.com/.well-known/assetlinks.json
# muss 200 + den Dev-Fingerprint zurückgeben
```

Bash-Alternative für die Verifikation:

```bash
cd twa
bash 4-verify-assetlinks.sh
```

- [ ] `assetlinks.json` enthält den Dev/Upload-Fingerprint, Status 200 über `https://app.jamie-app.com/.well-known/assetlinks.json`

---

## 3. TWA bauen

```bash
cd twa
bash 3-build.sh
```

Bubblewrap fragt mehrere Dinge ab. Diese Antworten verwenden (decken sich mit `twa-manifest.json` und `twa/app/build.gradle`):

| Frage | Antwort |
|---|---|
| Domain to be opened in the Trusted Web Activity | `app.jamie-app.com` |
| Name of the application | `JAMIE - Social Activity App` |
| Launcher name | `JAMIE` |
| Application color (theme) | `#231B43` |
| Background color | `#231B43` |
| Start URL | `/` |
| Icon URL | `https://app.jamie-app.com/pwa-512x512.png` |
| Maskable icon URL | `https://app.jamie-app.com/maskable-icon-512x512.png` |
| Orientation | `portrait` |
| versionName | `1` |
| versionCode | `4` |
| Use existing keystore? | **Yes** → Pfad: `keystore/jamie-release.jks`, Alias: `jamie-key` |
| Keystore-Passwort | (aus Passwort-Manager) |
| Key-Passwort | (gleich wie Keystore) |

Hinweise zu den Manifest-Settings (schon gesetzt, nicht ändern):
- `playBilling.enabled = false` — wir liefern kein Play-Billing über die TWA aus (Bezahlung läuft web/Stripe; siehe Schritt 7 zur Data-Safety-Deklaration).
- `locationDelegation.enabled = false`.
- 1 Shortcut: „Gruppe erstellen" → `/create-group`.
- minSdk 21, targetSdk 35, compileSdk 36.

Output:
- `app-release-bundle.aab` ← das hier zu Play Store hochladen
- `app-release-signed.apk` ← optional zum lokalen Testen mit `adb install`

---

## 4. (Optional) Lokal testen vor Upload

USB-Debugging am Android-Gerät aktivieren, dann:

```bash
adb install app-release-signed.apk
```

Auf dem Telefon JAMIE öffnen. **Es darf KEIN Browser-Header oben sein** — wenn doch, ist `assetlinks.json` falsch (zurück zu Schritt 2).

Beim Test mitprüfen (das sind die neuen/sensiblen Flows):
- [ ] Vollbild (kein Adressleisten-Header)
- [ ] Push-Benachrichtigung kommt an
- [ ] Gruppe/Club anlegen: Adress-Autocomplete erlaubt **nur Österreich** (AT) — eine deutsche/andere Adresse muss abgelehnt werden
- [ ] Pro-Kauf: Web/Android laufen über Stripe; Preise siehe Schritt 9
- [ ] Deal einlösen: „Einlösen"-Screen unter `/deal/:id/redeem`, Bottom-Nav ausgeblendet, zweite Einlösung wird mit „bereits eingelöst" geblockt

---

## 5. Play Console Upload — Internal Testing Track

1. Gehe zu https://play.google.com/console
2. **Create app** → JAMIE → Default language: German (Deutschland) → App or Game: App → Free or Paid: Free
3. Akzeptiere die Erklärungen (Content guidelines, US export laws)
4. Linkes Menü → **Testing → Internal testing**
5. **Create new release**
6. Lade `app-release-bundle.aab` hoch
7. Release name: `1 (4)` (entspricht versionName `1` / versionCode `4`)
8. Release notes:
   ```
   Erste Veröffentlichung von JAMIE — Social Activity App.
   Finde Leute für Aktivitäten in Wien.
   ```
9. **Save** (noch nicht „Review release")

- [ ] AAB hochgeladen, Release gespeichert

---

## 6. Play App Signing: Entscheidung + Fallback

> **Entscheidung 2026-06-10:** Wir verwenden Play App Signing **nicht**. Play nutzt unseren Upload-Key direkt. Der einzelne Dev/Upload-Fingerprint in `assetlinks.json` reicht damit aus — der Schritt „Play-Signing-Fingerprint nachtragen" ist **N/A**.
>
> Wichtig: Solange wir den Upload-Key direkt nutzen, ist der Verlust des Keystores fatal (siehe Schritt 1) — es gibt keinen von Google verwahrten Zweitschlüssel.

**Fallback, falls Play beim ersten AAB-Upload Play App Signing erzwingt.** Für neue Apps ist Play App Signing seit August 2021 grundsätzlich Pflicht; es kann sein, dass die Console es nicht überspringen lässt. Dann signiert Play das AAB mit einem **eigenen** Key zusätzlich zu deinem Upload-Key — und **beide** Fingerprints müssen in `assetlinks.json`:

1. Play Console → JAMIE → linkes Menü → **Setup → App integrity** → **App signing**
2. Kopiere den **App signing key certificate → SHA-256 certificate fingerprint**
3. Lokal den Play-Fingerprint **hinzufügen** (Dev-Fingerprint bleibt erhalten):
   ```bash
   cd twa
   bash 5-fill-assetlinks.sh "PLAY:SIGNING:KEY:SHA256:HIER"
   ```
4. Commit + push:
   ```bash
   git add frontend/public/.well-known/assetlinks.json
   git commit -m "Add Play Store signing fingerprint to assetlinks"
   git push
   ```
5. Nach ~2 Min Railway-Redeploy verifizieren — **beide** Fingerprints müssen erscheinen, Status 200:
   ```bash
   cd twa
   bash 4-verify-assetlinks.sh
   ```

- [ ] Standardfall: nichts zu tun (Play App Signing nicht aktiviert)
- [ ] Fallback (nur falls erzwungen): Play-Fingerprint nachgetragen, beide verifiziert

---

## 7. Store-Listing & App content ausfüllen

Im linken Menü der Play Console:

- **Main store listing** — Texte/Bilder (siehe `store/PLAY-LISTING.md`)
  - App icon: `store/assets/play-icon-512.png`
  - Feature graphic: `store/assets/play-feature-graphic-1024x500.png`
  - Phone screenshots (mind. 2): `store/assets/screenshots/android-phone-01.png` … `-05.png`
- **App content** — alle Pflicht-Sektionen:
  - Privacy Policy URL: `https://app.jamie-app.com/privacy`
  - Weitere Rechtstexte existieren als öffentliche Routen: `/terms`, `/guidelines`, `/impressum`
  - App access: Login-Pflicht ist OK — gib einen Test-Account an (siehe `store/PLAY-LISTING.md`, `playreview@jamie-app.com`, Passwort noch zu generieren)
  - Ads: „No, my app does not contain ads"
  - Content rating: Fragebogen ausfüllen (Antworten in `store/DATA-SAFETY.md`)
  - Target audience: 18+
  - Data safety: siehe `store/DATA-SAFETY.md` — muss mit `frontend/src/pages/PrivacyPolicy.jsx` übereinstimmen
  - Government apps: No
  - News app: No

**Hinweis zu In-App-Käufen (Boost & Pro).** Auf Android laufen Käufe über Stripe (web), nicht über Play Billing — `playBilling` ist in der TWA deaktiviert. Da die Boost-Credits und Pro digitale In-App-Funktionen freischalten, kann Google bei strenger Auslegung Play Billing verlangen. **Pragmatisch heute:** in der Data-Safety-Form „Purchase history → ja, gesammelt" angeben. TWAs werden hier deutlich weniger strikt geprüft als native Apps. Wenn Play später Play Billing verlangt, müssen wir umstellen.

- [ ] Store-Listing-Texte und Assets eingetragen
- [ ] Alle „App content"-Sektionen grün
- [ ] Test-Account `playreview@jamie-app.com` angelegt + Passwort generiert

---

## 8. Internal Testing → Closed → Production

1. **Save** + **Review release** + **Start rollout to Internal testing**
2. Füge dich selbst als Tester hinzu (E-Mail oder Google Group)
3. Installiere via Tester-Link auf deinem Telefon, prüfe Vollbild + Push + die Flows aus Schritt 4
4. Wenn alles passt: **Promote release → Closed testing → Production**

Erster Production-Review dauert **bis zu 7 Tage**. Updates danach meist <24 h.

---

## 9. Preise & Produkt-IDs (Referenz)

Diese Werte sind im Backend/Frontend autoritativ (Stripe auf Web/Android, Apple IAP nur iOS). Nur zur Kontrolle beim Ausfüllen der Store-Angaben — am Wert selbst nichts ändern.

**Pro-Abos** (`subscriptionController.js` PRO_PLANS, Anzeige `proPlans.js`):

| Plan | Produkt-ID | Preis | pro Woche | Intervall | Badge |
|---|---|---|---|---|---|
| Wöchentlich | `pro_weekly` | 14,99 €/Woche | 14,99 € | week/1 | — (Baseline) |
| Monatlich | `pro_monthly` | 22,75 €/Monat | 5,25 € | month/1 | „Beliebt" (Default) |
| 6 Monate | `pro_sixmonth` | 58,50 €/6 Monate | 2,25 € | month/6 | „Bestes Angebot" |

**Boost-Credits** (Consumables, `iap.js` / Backend `boostController` BOOST_PACKAGES):

| Paket | Produkt-ID | Credits | Preis |
|---|---|---|---|
| Starter | `boost_starter` | 1 | 1,99 € |
| Popular | `boost_popular` | 5 | 7,99 € |
| Pro | `boost_pro` | 15 | 19,99 € |

> Warnung: `store/STRIPE-MEETING-CHECKLIST.md` listet abweichende Preise/Credits (z. B. 1,99/4,99/9,99 € und 12 statt 15 Credits). Maßgeblich sind die obigen Werte (Backend + `iap.js` + `STOREKIT-SETUP.md` stimmen überein). STRIPE-MEETING-CHECKLIST ist hier der Ausreißer und ggf. veraltet.

---

## Aktueller Stand & offene Punkte (außerhalb dieses Runbooks)

Nur damit klar ist, was an JAMIE selbst noch hängt — blockiert den Android-TWA-Release nicht, betrifft aber iOS / Zahlung:

- **iOS:** `frontend/public/.well-known/apple-app-site-association` enthält noch den Platzhalter `YOUR_10_CHAR_TEAM_ID.jamie.app`. Universal Links + Apple-Sign-in funktionieren erst nach Eintrag der echten Apple Team ID (`bash 6-fill-apple-aasa.sh` / `STOREKIT-SETUP.md`).
- **iOS Build:** `@capacitor/keyboard` wurde neu hinzugefügt → vor dem nächsten iOS-Build `npx cap sync ios` laufen lassen (bzw. `npm run cap:build:ios`).
- **Stripe live:** Account-Aktivierung (Tina / IMPIBAG e.U.), Apple-Pay-Domain-Datei, feste Price-IDs, 2 Webhooks und 5 Railway-ENV-Vars sind laut `store/STRIPE-MEETING-CHECKLIST.md` noch offen.
- **Stripe Customer Portal:** muss einmalig im Stripe-Dashboard aktiviert werden (`/settings/billing/portal`), sonst liefert `POST /subscription/portal` einen 503. Portal nur web/Android; iOS-Abos werden im App Store verwaltet.
- **Inhaltliche Fakten:** Locations sind Österreich-only (Create-Group erzwingt `country === 'AT'`); eigenständige Gruppen wiederholen sich **nicht** wöchentlich (nur Club-Events können wiederkehrend sein); Deal-Einlösung ist 1× pro Nutzer pro Deal, Proof-Screen `/deal/:id/redeem`.

---

## Troubleshooting

- **Bubblewrap „Could not find an installed Android SDK"** → `ANDROID_HOME` falsch gesetzt. Prüfe, dass `dir $env:ANDROID_HOME` `platforms`, `build-tools`, `cmdline-tools` zeigt.
- **Java-Version-Fehler** → `JAVA_HOME` zeigt auf JDK 17, `java -version` bestätigt es. PowerShell neu starten.
- **TWA zeigt Browser-Adressleiste** → `assetlinks.json` nicht erreichbar ODER falscher Fingerprint. `bash 4-verify-assetlinks.sh` checkt das. Bei aktiviertem Play App Signing müssen **beide** Fingerprints drin sein (Schritt 6 Fallback).
- **„App not installed" auf Telefon** → Release-APK ist signiert, Debug-APK nicht — du installierst die falsche. Verwende `app-release-signed.apk`.
- **Skript läuft in PowerShell nicht** → die `*-.sh`-Skripte sind Bash. Über Git Bash oder die Bash-Umgebung starten, nicht direkt in PowerShell.
