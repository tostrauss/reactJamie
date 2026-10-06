# iOS-Update für Tina — Version 1.4.3 (Chat-Fotos, Abstimmungen, Abzeichen, Clubs)

Stand: **06.10.2026** · Ziel: **Version 1.4.3** in den App Store bringen.

**Vorher (Tobi):** Code ist gepusht und das Backend auf Railway ist live.
Erst wenn Tobi „gepusht + live" sagt, geht es hier los.

**Warum?** Die iPhone-App enthält eine Kopie der Web-App. Alles, was seit dem
letzten iPhone-Build dazukam, steckt bisher nur in der Web-Version. Im App Store
steht noch **1.4.1 vom 06.09.** — 1.4.2 ist nie erschienen. Deshalb ist 1.4.3
die **erste** iPhone-Version mit allem, was seit September im Chat dazukam.
Tester-Meldung vom 06.10. („einige konnten die Fotos nicht sehen"): Das waren
iPhones mit 1.4.1 — die zeigen ein Chat-Foto nur als Textzeile „📷 Foto".
Mit diesem Update bekommen iPhone-Nutzer:

- **Chat:** **Fotos** senden und sehen, **Sprachnachrichten**, **Antworten**
  auf Nachrichten, **Emoji-Reaktionen**, **Lese-Häkchen**.
- **Abstimmungen im Gruppen-Chat (NEU):** „Termin finden" (Datum + optional
  Uhrzeit) und „Abstimmung" mit eigenen Optionen; Ergebnis beim Beenden.
- **Abzeichen (NEU):** 🏅 ab 5, 🏆 ab 10, 🎆 ab 100 **bestätigten** Treffen —
  im Profil (Reiter Hall of Fame) und in Mitgliederlisten.
- **JAMIE Pro** (Abos über Apple).
- **Clubs:** einzelne Events können **„privat"** sein (Beitritt nur per Anfrage),
  die Club-Seite zeigt statt des Boost-Knopfs eine **Pro-Info**, Club-Fotos werden
  nicht mehr doppelt zugeschnitten. Dazu ein **Fix**: das Bearbeiten von Events
  war bei manchen Events kaputt.
- **Personensuche:** Bekannte aus gemeinsamen Gruppen stehen oben, Treffer, die
  mit dem Suchtext *beginnen*, vor denen, die ihn nur enthalten.
- **Deals:** „Neue Runde starten" — ein Deal ist für alle wieder einlösbar.
- **Melden:** Meldungen zu Gruppen zeigen den Ersteller der Gruppe.
- **Unter der Haube:** Bibliotheken auf neuen Stand (React Router 7, Sicherheits-Updates).

Android muss dafür **nichts** tun (läuft über den Web-Deploy, ist längst aktuell).

Du brauchst: deinen Mac mit Xcode, dein Apple-Developer-Login, das
JAMIE-Projekt (liegt unter `~/reactJamie`), dein App-Store-Connect-Login und
dein iPhone.

Fixe Werte (nur zum Abgleichen, nichts ändern):

| Was | Wert |
|---|---|
| App | JAMIE, App-ID `6784212397` |
| Bundle ID | `com.jamie-app.app` |
| Team-ID | `RTJNBK94F8` |
| Neue Version / Build | **1.4.3** / **12** (falls 12 schon vergeben: die nächste freie Nummer — siehe Kurzhilfe) |
| Test-Account für Apple-Review | `playreview@jamie-app.com` |

> **Vorab prüfen:** In App Store Connect → JAMIE → TestFlight / Vertrieb steht
> die letzte hochgeladene Version samt Build. Ist dort **schon 1.4.3 oder
> Build 12 oder höher**, sag Tobi kurz Bescheid, bevor du loslegst — dann
> ändern wir die Nummern.

---

## 1. Neuesten Code holen

Terminal öffnen (Programme → Dienstprogramme → Terminal), dann Zeile für Zeile,
jede mit Enter:

```bash
cd ~/reactJamie
git status --short
git pull
git log --oneline -5
```

- Zeigt `git status --short` **Dateien an** (z. B. `package-lock.json`), dann
  vor dem `git pull` einmal: `git checkout -- frontend/package-lock.json`
  (automatisch erzeugte Datei, die darf weg).
- Dann diese Zeile (kopieren, Enter):

  ```bash
  git log --oneline -60 | grep -E "Abstimmungen im Gruppen|feat.abzeichen|Folgefixes zu 93224ea|Folgefixes zu 1047f91|React Router 7"
  ```

  Sie muss **genau fünf Zeilen** ausgeben (Abstimmungen, Abzeichen, zwei
  „Folgefixes", React Router 7). Weniger als fünf → der Pull hat nicht
  geklappt oder Tobi hat noch nicht gepusht → **STOPP, Tobi.**

## 2. Bauen und ins iOS-Projekt übertragen

```bash
cd frontend
npm install
npm run build
npx cap sync ios
cd ..
bash ios/4-preflight.sh
```

- Dauert ein paar Minuten. Am Ende des letzten Befehls achte auf **vier** Dinge:
  1. Unter **„3/3 Permission usage strings"** muss **`NSMicrophoneUsageDescription`**
     auftauchen („`+ … added`" oder „`✓ … already set`"). Ohne das gehen die
     Sprachnachrichten nicht.
  2. **„4/4 Push Notifications entitlement … ✓"**
  3. **„5/5 AppDelegate … ✓ already forwards"**
  4. **„Preflight done"** am Schluss.
  Steht bei 5/5 ein rotes **❌ … STOP** → **STOPP, Tobi** (dann kann Push
  nicht funktionieren, das Archivieren wäre umsonst).
- „@capacitor/core … doesn't match @capacitor/ios" ist eine Warnung, kein
  Fehler — ignorieren.
- In der `cap sync`-Ausgabe muss **`@revenuecat/purchases-capacitor`**
  auftauchen (Pro-Abos). Fehlt es, war `npm install` nicht erfolgreich →
  Screenshot an Tobi.
- `pod: command not found` → einmalig `sudo gem install cocoapods`, dann
  `npx cap sync ios` wiederholen.

## 3. Xcode öffnen, Version setzen, Fähigkeiten prüfen

```bash
cd frontend
npx cap open ios
```

Xcode öffnet das Projekt. Dann:

1. Links im Dateibaum ganz oben das blaue **App**-Projekt anklicken →
   unter TARGETS **App** → Reiter **General** → Abschnitt **Identity**.
2. **Version**: `1.4.3` eintragen. **Build**: `12` eintragen.
   ⚠️ **Nach dem Tippen einmal in ein anderes Feld klicken** (oder Tab).
   Sonst übernimmt Xcode den Wert nicht — dadurch wurde schon einmal ein
   alter Stand archiviert.
3. Reiter **Signing & Capabilities**: In der Liste müssen **„Push Notifications"**
   **und „In-App Purchase"** stehen. Fehlt eines → **STOPP, Tobi**
   (außer „In-App Purchase": das darfst du mit **„+ Capability"** selbst
   hinzufügen).
4. Steht bei Signing etwas Rotes: Häkchen „Automatically manage signing"
   einmal aus- und wieder einschalten. Bleibt es rot → Screenshot an Tobi.

## 4. Archivieren und hochladen

1. Oben in der Gerätezeile **„Any iOS Device (arm64)"** auswählen (kein
   Simulator).
2. Menü **Product → Archive**. Dauert einige Minuten.
3. Es öffnet sich der **Organizer**. ⚠️ **Erst kontrollieren:** Die oberste
   Zeile muss **`1.4.3 (12)`** heißen. Steht dort etwas Älteres →
   zurück zu Schritt 3, Version/Build nochmal setzen, neu archivieren.
4. **Distribute App → App Store Connect → Upload** → bei allen Dialogen die
   Vorauswahl lassen → **Upload**. Fragt Apple nach „Export Compliance /
   Verschlüsselung": **Nein**.
5. Warten bis „Upload Successful".

## 5. Über TestFlight testen — BEVOR du einreichst

Der Build erscheint **15–45 Minuten** nach dem Upload in App Store Connect.

1. https://appstoreconnect.apple.com → **Meine Apps → JAMIE → TestFlight**.
   Sobald **dein eben hochgeladener Build** dort steht (höchste Nummer, heutiges
   Datum): bei „Interne Tests" dich selbst hinzufügen (falls nicht schon drin).
2. Am iPhone: **TestFlight-App** → JAMIE → **Installieren** (ersetzt die
   App-Store-Version, das ist okay).

Dann durchklicken — jeder Punkt dauert unter einer Minute. **a) ist der
wichtigste Test**, weil diesmal das Navigations-System (React Router 7)
getauscht wurde.

**a) Durch die App klicken (NEU — nicht überspringen).** Einmal alle Reiter
unten antippen (Entdecken, Karte, Chats, Profil …), eine Gruppe öffnen, mit dem
**Zurück-Pfeil** zurück, ein Chat öffnen und zurück, in den Einstellungen
etwas öffnen und zurück. Dann die App komplett schließen und neu öffnen.
Alles muss flüssig gehen, **keine weiße Seite**, kein „Seite nicht gefunden",
Zurück darf nie aus der App hinauswerfen. Hakt etwas → **STOPP, Tobi.**

**b) Event bearbeiten (Fix).** Ein **eigenes** Event (in einer Gruppe oder einem
Club) öffnen → **Bearbeiten** → etwas ändern (z. B. die Beschreibung) →
speichern. Es muss **ohne Fehlermeldung** speichern und die Änderung muss
sichtbar sein.

**c) Club + privates Event (NEU).** Einen **Club**, der dir gehört, öffnen:
- Statt eines Boost-Knopfs steht dort eine kleine **Pro-Info**.
- Beim Erstellen/Bearbeiten eines Club-Events gibt es die Option **„Privat"**.
  Mit einem zweiten Account ein privates Event ansehen: dort steht
  **„Anfrage senden"** statt direktem Beitreten.
- Club-Foto hochladen: das Bild wird **einmal** zugeschnitten, nicht doppelt
  (also nicht stark verzerrt oder winzig).
Fehlt die „Privat"-Option → Screenshot an Tobi.

**d) Personensuche (NEU).** Im Suchfeld nach Personen einen Namen-Anfang tippen
(z. B. „Ma"): Leute, die mit „Ma" **beginnen**, stehen vor denen, die „ma" nur
mittendrin haben, und Leute aus **gemeinsamen Gruppen** ganz oben.

**e) Push kommt weiterhin an.** JAMIE schließen (oder iPhone sperren), Tobi (oder
ein zweiter Account) schickt dir eine **Direktnachricht**. Die Benachrichtigung
muss auf dem Sperrbildschirm erscheinen und beim Tippen **direkt im richtigen
Chat** aufgehen.

**e2) Push bei offenem Chat (NEU).** Einen Gruppen-Chat **offen lassen** und das
iPhone sperren. Nach etwa 20 Sekunden schreibt der zweite Account in **genau
diesen** Chat → die Push muss kommen. Dann entsperren, zurück in JAMIE: eine
weitere Nachricht des zweiten Accounts muss **ohne Neuladen** im Chat
erscheinen.

**e3) Nur Tobi:** In Railway nach `[APNs-diag] user=<Tinas ID>` suchen — dort
muss `app=1.4.3 (12)` (bzw. deine Build-Nummer) mit `event=registered` stehen.

**f) Sprachnachricht.** In einem Chat auf das **Mikrofon-Symbol** tippen.
Beim ersten Mal fragt iOS **„JAMIE möchte auf das Mikrofon zugreifen"** →
**Erlauben**. Kurz aufnehmen, senden, **abspielen**. Keine Mikrofon-Frage,
nichts aufnehmbar oder die App schließt sich → **STOPP, Tobi**.

**g) Foto + Emoji-Reaktion.** Im Chat ein **Foto** senden. Dann eine Nachricht
lange antippen und ein **Emoji** wählen — es erscheint an der Nachricht.
Anderes Emoji wählen: es **ersetzt** das erste (eine Reaktion pro Person, so
gewollt).

**g2) Fotos EMPFANGEN (der Tester-Bug).** Der zweite Account schickt aus dem
**Browser oder der Android-App** ein Foto in einen gemeinsamen Gruppen-Chat.
Auf dem iPhone muss das **Bild** erscheinen — nicht die Textzeile „📷 Foto".
Dann JAMIE komplett schließen, neu öffnen, den Chat öffnen: der Chat steht
**unten**, das Foto ist sichtbar, auch ein älteres Foto weiter oben lädt.
Eine **Sprachnachricht** des zweiten Accounts muss sich abspielen lassen.

**g3) Abstimmung (NEU).** In einem Gruppen-Chat bei **leerem** Eingabefeld auf
das **Balken-Symbol** neben der Kamera tippen → „Termin finden" ist
vorausgewählt („Wann passt es euch?", morgen + übermorgen) → **Umfrage senden**.
Der zweite Account tippt einen Termin an: Häkchen und Zahl ändern sich sofort,
bei dir ebenfalls (ohne Neuladen). Dann die Umfrage **lange antippen** →
**„Umfrage beenden"** → bestätigen: im Chat erscheint eine graue Zeile
„📅 Ergebnis …".

**g4) Abzeichen + Version (NEU).** **Profil** → Reiter **Hall of Fame**: oben
steht die Karte **„Abzeichen"** mit 🏅 5 / 🏆 10 / 🎆 100 (bei wenigen Treffen
„Noch … bis 🏅"). **Einstellungen** → ganz unten **Version**: dort muss
`1.4.3 (12)` stehen (bzw. deine Build-Nummer) — nicht mehr „1.3".

**h) JAMIE Pro (Kauf läuft über Apple).** In TestFlight kostet der Kauf **nichts**.
1. **Profil** → Karte **„JAMIE Pro"** → drei Tarife mit **Euro-Preisen**
   (1 Monat / 6 Monate / 1 Jahr), darunter **„Käufe wiederherstellen"**.
2. 6 Monate wählen → Häkchen → **Jetzt starten** → Apple-Kaufbogen bestätigen.
3. Krone mit **Konfetti**; in den **Einstellungen** steht **„JAMIE Pro · Aktiv"**
   und **„Abo im App Store verwalten"** (kein JAMIE-Kündigen-Knopf, richtig so).
4. **„Käufe wiederherstellen"** → „1 Kauf wiederhergestellt".

„JAMIE Pro ist auf dem iPhone derzeit nicht verfügbar" oder gar keine
Pro-Karte → Tobi.

Klappt a–h (inkl. e2, g2–g4) → weiter zu Schritt 7. Hakt etwas → Schritt 6.

## 6. Wenn etwas nicht klappt

Nicht rumprobieren. Schick Tobi:

1. **Was** nicht ging (a–h) und die **Uhrzeit** auf die Minute.
2. **Screenshot** der Seite, auf der es hakt.
3. Nur bei Push-Problemen zusätzlich die Ausgabe von:

```bash
codesign -d --entitlements :- "$(ls -td ~/Library/Developer/Xcode/Archives/*/*.xcarchive | head -1)/Products/Applications/App.app" 2>/dev/null | grep -B1 -A1 aps-environment
```

Tobi sieht den Rest in den Server-Logs. **Du musst nichts weiter tun.** Erst
wenn er grünes Licht gibt: Schritt 7.

## 7. In App Store Connect einreichen

Erst wenn Schritt 5 durch ist (oder Tobi sagt: einreichen).

Auf https://appstoreconnect.apple.com → **Meine Apps → JAMIE → Vertrieb**:

1. Links oben neben „iOS-App" das **⊕** → **1.4.3** anlegen.
2. **„Was ist neu"** einfügen — **Deutsch**:

   ```
   • Chat: Fotos und Sprachnachrichten senden, auf Nachrichten antworten, mit Emojis reagieren, Lese-Häkchen
   • Neu: Abstimmungen im Gruppen-Chat – Termin finden oder über Ideen abstimmen
   • Neu: Abzeichen 🏅 🏆 🎆 für bestätigte Teilnahme an Treffen
   • JAMIE Pro: alle Mitglieder sehen, Boosts und mehr
   • Clubs: einzelne Events können jetzt privat sein – Beitritt per Anfrage
   • Personensuche: Bekannte aus deinen Gruppen stehen oben
   • Zuverlässigere Benachrichtigungen und viele kleine Verbesserungen
   ```

   **Englisch**:

   ```
   • Chat: send photos and voice messages, reply to messages, react with emojis, read ticks
   • New: polls in group chats – find a date or vote on ideas
   • New: badges 🏅 🏆 🎆 for confirmed attendance at meetups
   • JAMIE Pro: see all members, boosts and more
   • Clubs: individual events can now be private – join by request
   • People search: acquaintances from your groups first
   • More reliable notifications and many small improvements
   ```

   **Italienisch** (falls das Feld da ist):

   ```
   • Chat: invia foto e messaggi vocali, rispondi ai messaggi, reagisci con le emoji, spunte di lettura
   • Novità: sondaggi nelle chat di gruppo – trova una data o vota le idee
   • Novità: badge 🏅 🏆 🎆 per la partecipazione confermata agli incontri
   • JAMIE Pro: vedi tutti i membri, boost e altro
   • Club: i singoli eventi possono ora essere privati – partecipazione su richiesta
   • Ricerca persone: prima i conoscenti dei tuoi gruppi
   • Notifiche più affidabili e tante piccole migliorie
   ```

   (Frankreich/Spanien: englischen Text einsetzen oder Tobi fragen.)
3. Abschnitt **Build**: „+" → **deinen** Build auswählen (die Nummer aus dem
   Organizer, normalerweise **12**).
4. **App-Review-Informationen**: Anmelden erforderlich = **Ja**, Demo-Account
   `playreview@jamie-app.com` + Passwort (Passwort-Manager). Notiz:
   `Login via e-mail only on iOS. Voice messages need microphone permission (tap the mic icon in any chat). Polls: in a group chat, tap the bar-chart icon next to the empty text field. JAMIE Pro subscriptions: Profile tab → "JAMIE Pro" card, or Settings → "JAMIE Pro". "Restore Purchases" is in the same sheet and in Settings.`
5. Oben rechts **„Zur Prüfung hinzufügen" / „Bei App-Review einreichen"**.

Review dauert meist unter 24 h. Nach Freigabe wird automatisch veröffentlicht.
**Dann Tobi Bescheid sagen.**

---

## Wenn etwas schiefgeht — Kurzhilfe

| Problem | Lösung |
|---|---|
| Tobi hat noch nicht „gepusht + Backend live" gesagt | Warten |
| `git pull` meckert über lokale Änderungen | `git checkout -- frontend/package-lock.json`, nochmal `git pull`. Sonst Tobi |
| Die `grep`-Zeile in Schritt 1 gibt weniger als fünf Zeilen aus | Pull hat nicht geklappt oder noch nicht gepusht → Tobi |
| Preflight zeigt kein `NSMicrophoneUsageDescription` oder kein „4/4 … ✓" | Screenshot an Tobi, **nicht** archivieren |
| Xcode: „Push Notifications" fehlt | Nicht archivieren — Tobi |
| Organizer zeigt falsche Version (nicht 1.4.3 (12)) | Version/Build in General setzen, **Feld verlassen**, neu archivieren |
| Upload: „build number already used" | Build eins höher (13, 14 …), neu archivieren (und im Organizer/Schritt 7 diese Nummer nehmen) |
| Build taucht in TestFlight nicht auf | 45 Min. warten, Mail prüfen |
| Weiße Seite / „nicht gefunden" beim Navigieren | Navigations-Update → Screenshot + Uhrzeit an Tobi, nicht einreichen |
| Pro-Fenster: „derzeit nicht verfügbar" | Abos/Vertrag bei Apple (REVENUECAT-SETUP.md A1/A2) → Tobi |
| Apple-Review lehnt ab | Begründung als Screenshot an Tobi |

**Was du NICHT anfassen musst:** Android (läuft über den Web-Deploy, kein
Store-Update nötig), Server/Railway und die Kauf-Schalter (Tobi), der
Apple-Push-Key im Developer-Portal (ist schon richtig eingetragen).
