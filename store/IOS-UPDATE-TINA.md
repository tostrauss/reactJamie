# iOS-Update für Tina — Version 1.4.1 mit Push-Test (ohne Tobi machbar)

Stand: **04.09.2026** · Ziel: **Version 1.4.1** in den App Store bringen und
dabei **endlich prüfen, ob Push-Benachrichtigungen ankommen**.

Was diesmal anders ist als bei 1.3: Die App **meldet jetzt selbst an den
Server**, was mit den Benachrichtigungen passiert (Berechtigung erteilt/
verweigert, Registrierung geklappt/gescheitert). Tobi sieht das in den
Server-Logs. Du musst also nichts „debuggen" — nur die Schritte machen und ihm
am Ende zwei Screenshots schicken.

Du brauchst: deinen Mac mit Xcode, dein Apple-Developer-Login, das
JAMIE-Projekt (liegt unter `~/reactJamie`), dein App-Store-Connect-Login, dein
iPhone, und **einen zweiten Account**, der dir eine Nachricht schicken kann
(Tobi, oder ein Test-Account).

Fixe Werte (nur zum Abgleichen, nichts ändern):

| Was | Wert |
|---|---|
| App | JAMIE, App-ID `6784212397` |
| Bundle ID | `com.jamie-app.app` |
| Neue Version / Build | **1.4.1** / **10** |
| Test-Account für Apple-Review | `playreview@jamie-app.com` |

---

## 0. Bevor du anfängst — zwei Dinge

**a) Warte auf Tobis „gepusht".** Dein Build enthält nur, was auf dem Server
liegt. Tobi muss den neuen Code erst hochladen — er sagt dir Bescheid.

**b) Eine Zahl für Tobi nachschauen (20 Sekunden).** Auf
https://developer.apple.com/account → **Mitgliedschaftsdetails** → dort steht
eine **Team-ID** (10 Zeichen, z. B. `RTJNBK94F8`). **Schick Tobi genau diese
Zeichenfolge.** Hintergrund: Der Server benutzt eine Team-ID zum Signieren der
Benachrichtigungen — wenn die nicht zu deinem Account passt, lehnt Apple jede
einzelne ab. Wir haben zwei verschiedene Werte im Umlauf und müssen wissen,
welcher stimmt.

## 1. Neuesten Code holen

Terminal öffnen (Programme → Dienstprogramme → Terminal), dann Zeile für Zeile,
jede mit Enter:

```bash
cd ~/reactJamie
git status --short
git pull
```

- Zeigt `git status --short` **Dateien an** (z. B. `package-lock.json`), dann
  vor dem `git pull` einmal: `git checkout -- frontend/package-lock.json`
  (das ist eine automatisch erzeugte Datei, die darf weg).
- `git pull` muss durchlaufen und irgendwo `NativePushDeniedBanner.jsx`
  auflisten — dann ist der neue Push-Code drin. Fehler? **STOPP, Tobi.**

## 2. Bauen und ins iOS-Projekt übertragen

```bash
cd frontend
npm install
npm run build
npx cap sync ios
cd ..
bash ios/4-preflight.sh
```

- Dauert ein paar Minuten. Am Ende des letzten Befehls müssen **drei** Dinge
  stehen:
  **„4/4 Push Notifications entitlement … ✓"**,
  **„5/5 AppDelegate … ✓ already forwards"** oder **„+ added … forwarders"**,
  und **„Preflight done"**.
  Steht bei 5/5 ein rotes **❌ … STOP** → **STOPP, Tobi** (dann kann Push
  in diesem Build nicht funktionieren, das Archivieren wäre umsonst).
- Der Hinweis „@capacitor/core … doesn't match @capacitor/ios" ist eine
  Warnung, kein Fehler — ignorieren.
- `pod: command not found` → einmalig `sudo gem install cocoapods`, dann
  `npx cap sync ios` wiederholen.

## 3. Xcode öffnen, Version setzen, Push-Fähigkeit prüfen

```bash
cd frontend
npx cap open ios
```

Xcode öffnet das Projekt. Dann:

1. Links im Dateibaum ganz oben das blaue **App**-Projekt anklicken →
   unter TARGETS **App** → Reiter **General** → Abschnitt **Identity**.
2. **Version**: `1.4.1` eintragen. **Build**: `10` eintragen.
   ⚠️ **Nach dem Tippen einmal in ein anderes Feld klicken** (oder Tab drücken).
   Sonst übernimmt Xcode den Wert nicht — genau das ist beim letzten Mal
   passiert, und es wurde ein alter Stand archiviert.
3. Reiter **Signing & Capabilities**: In der Liste muss **„Push Notifications"**
   stehen. Steht es da → gut. Fehlt es → **STOPP, Tobi** (dann nicht
   archivieren, der Build wäre umsonst).
4. Steht bei Signing etwas Rotes: Häkchen „Automatically manage signing"
   einmal aus- und wieder einschalten. Bleibt es rot → Screenshot an Tobi.

## 4. Archivieren und hochladen

1. Oben in der Gerätezeile **„Any iOS Device (arm64)"** auswählen (kein
   Simulator).
2. Menü **Product → Archive**. Dauert einige Minuten.
3. Es öffnet sich der **Organizer**. ⚠️ **Erst kontrollieren:** Die oberste
   Zeile muss **`1.4.1 (10)`** heißen. Steht dort `1.4 (9)` oder `1.3 (8)` →
   zurück zu Schritt 3, Version/Build nochmal setzen, neu archivieren.
4. **Distribute App → App Store Connect → Upload** → bei allen Dialogen die
   Vorauswahl lassen → **Upload**. Fragt Apple nach „Export Compliance /
   Verschlüsselung": **Nein**.
5. Warten bis „Upload Successful".

## 5. Über TestFlight testen — BEVOR du einreichst

Der Build erscheint **15–45 Minuten** nach dem Upload in App Store Connect.

1. https://appstoreconnect.apple.com → **Meine Apps → JAMIE → TestFlight**.
   Sobald Build **10** dort steht: bei „Interne Tests" dich selbst hinzufügen
   (falls nicht schon drin). Du bekommst eine Mail / eine Meldung in der
   TestFlight-App auf dem iPhone.
2. Am iPhone: **TestFlight-App** öffnen → JAMIE → **Installieren** (ersetzt die
   App-Store-Version, das ist okay).
3. **Vorher am iPhone prüfen:** Einstellungen → **Mitteilungen** → **JAMIE** →
   „Mitteilungen erlauben" muss **an** sein. Wenn du dort **nichts** änderst,
   merk dir das für Schritt 6.
4. JAMIE öffnen, einloggen (falls nötig). Kommt eine Frage „JAMIE möchte dir
   Mitteilungen senden" → **Erlauben**. Kommt stattdessen unten ein Banner
   „Benachrichtigungen sind in iOS deaktiviert" → **„Einstellungen öffnen"**
   tippen, dort einschalten, **zurück in die App wischen** — mehr nicht, die
   App merkt das selbst.
5. **10 Sekunden warten.** Dann JAMIE **schließen** (Home-Bildschirm, oder
   iPhone sperren).
6. Der **zweite Account** schickt dir jetzt eine **Direktnachricht** (DM). Ihr
   müsst dafür befreundet sein — oder Tobi schickt sie, er darf jedem
   schreiben.
7. **Kommt die Benachrichtigung auf dem Sperrbildschirm / oben als Banner?**
   - **Ja** → 🎉 Tippen: die App muss direkt im richtigen Chat aufgehen. Dann
     weiter zu Schritt 7.
   - **Nein** → weiter zu Schritt 6.

## 6. Wenn keine Benachrichtigung kommt

Nicht rumprobieren. Schick Tobi **drei Dinge**:

1. **Uhrzeit**, zu der die DM geschickt wurde (auf die Minute).
2. **Screenshot** von iPhone-Einstellungen → Mitteilungen → JAMIE.
3. Die Ausgabe dieser drei Befehle im Terminal (Copy & Paste, dann Screenshot
   oder Text an Tobi):

```bash
codesign -d --entitlements :- ~/Library/Developer/Xcode/Archives/$(date +%Y-%m-%d)/*.xcarchive/Products/Applications/App.app 2>/dev/null | grep -B1 -A1 aps-environment
```
```bash
grep -n "didRegisterForRemoteNotificationsWithDeviceToken\|capacitorDidRegisterForRemoteNotifications" ~/reactJamie/frontend/ios/App/App/AppDelegate.swift
```
```bash
grep -n "aps-environment" -A1 ~/reactJamie/frontend/ios/App/App/App.entitlements
```

Tobi sieht in den Server-Logs, an welcher Stelle es hängt — dafür ist der
neue Code da. **Du musst nichts weiter tun.** Erst wenn er grünes Licht gibt:
Schritt 7.

Falls du danach noch Lust hast (5 Minuten, sehr hilfreich): iPhone per Kabel
an den Mac, in Xcode oben statt „Any iOS Device" **dein iPhone** auswählen →
**▶ (Run)**. Unten in Xcode erscheint eine Konsole. Dort ins Filterfeld
`APNs` tippen und einen Screenshot von allem machen, was erscheint. (Das
Testgerät bekommt dabei einen Test-Token, den der Server absichtlich ablehnt —
das ist normal; uns interessiert nur, **ob** überhaupt eine Zeile kommt.)

## 7. In App Store Connect einreichen

Erst wenn die Benachrichtigung in Schritt 5 angekommen ist (oder Tobi sagt:
einreichen).

Auf https://appstoreconnect.apple.com → **Meine Apps → JAMIE → Vertrieb**:

1. Links oben neben „iOS-App" das **⊕** → **1.4.1** anlegen.
2. **„Was ist neu"** einfügen — **Deutsch**:
   ```
   • Push-Benachrichtigungen: zuverlässiger, und die App sagt dir jetzt, wenn Mitteilungen in den iOS-Einstellungen ausgeschaltet sind
   • Kleine Verbesserungen und Fehlerbehebungen
   ```
   **Englisch**:
   ```
   • Push notifications: more reliable, and the app now tells you when notifications are turned off in iOS Settings
   • Small improvements and bug fixes
   ```
   **Italienisch** (falls das Feld da ist):
   ```
   • Notifiche push: più affidabili, e l'app ora ti avvisa se le notifiche sono disattivate nelle Impostazioni iOS
   • Piccoli miglioramenti e correzioni
   ```
   (Frankreich/Spanien: englischen Text einsetzen oder Tobi fragen.)
3. Abschnitt **Build**: „+" → Build **10** auswählen.
4. **App-Review-Informationen**: Anmelden erforderlich = **Ja**, Demo-Account
   `playreview@jamie-app.com` + Passwort (Passwort-Manager). Notiz:
   `Login via e-mail only on iOS.`
5. Falls App Store Connect noch die **Altersfreigabe-Fragen** verlangt (blauer
   Banner „Neue Antworten … erforderlich", Frist 7.9.): unter
   **App-Informationen** beantworten — nutzergenerierte Inhalte **Ja**,
   Chat **Ja**, Nutzerprofile **Ja**, Standort **Ja**. Ohne diese Antworten
   lässt Apple keine Einreichung zu.
6. Oben rechts **„Zur Prüfung hinzufügen" / „Bei App-Review einreichen"**.

Review dauert meist unter 24 h. Nach Freigabe wird automatisch
veröffentlicht. **Dann Tobi Bescheid sagen** — er hat danach noch einen
Server-Schritt (AASA-Deploy), der erst nach diesem Release passieren darf.

---

## Wenn etwas schiefgeht — Kurzhilfe

| Problem | Lösung |
|---|---|
| `git pull` meckert über lokale Änderungen | `git checkout -- frontend/package-lock.json`, nochmal `git pull`. Sonst Tobi |
| Preflight zeigt kein „4/4 … ✓" | Screenshot an Tobi, nicht archivieren |
| Xcode: „Push Notifications" fehlt unter Capabilities | Nicht archivieren — Tobi |
| Organizer zeigt falsche Version (nicht 1.4.1 (10)) | Version/Build in General setzen, **Feld verlassen**, neu archivieren |
| Upload: „build number already used" | Build auf 11, neu archivieren |
| Build taucht in TestFlight nicht auf | 45 Min. warten, Mail prüfen |
| Kein Push | Schritt 6 — nichts selbst umstellen |
| Apple-Review lehnt ab | Begründung als Screenshot an Tobi |

**Was du NICHT anfassen musst:** Android (läuft über den Web-Deploy),
Bezahlfunktionen (bewusst aus), Server/Railway (Tobi), der Apple-Push-Key im
Developer-Portal (ist schon richtig eingetragen).
