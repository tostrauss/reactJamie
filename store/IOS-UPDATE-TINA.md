# iOS-Update für Tina — Version 1.4.2 (Chat, Reaktionen, Benachrichtigungen)

Stand: **21.09.2026** · Ziel: **Version 1.4.2** in den App Store bringen.
Code ist gepusht, Backend ist auf Railway live — du kannst sofort loslegen.

**Warum überhaupt?** Push funktioniert seit 1.4.1 — das ist erledigt und bleibt
so. Aber seit dem letzten iPhone-Build (05.09.) ist im Chat und bei den
Benachrichtigungen sehr viel dazugekommen, und das steckt bis jetzt **nur in der
Web-Version**. iPhone-Nutzer bekommen mit diesem Update:

- **Chat:** Sprachnachrichten, Fotos und Antworten — dazu **Emoji-Reaktionen**
  auf einzelne Nachrichten.
- **Lesebestätigungen:** sehen, ob eine Nachricht zugestellt und gelesen wurde —
  jederzeit abschaltbar.
- **Benachrichtigungen:** neue Erinnerungen vor Events und **zwei echte
  Schalter** zum Abstellen. Auf dem iPhone sieht man sonst noch die alten drei
  Schalter, die **nichts bewirken**.
- **Gruppen:** Mitgliederliste und eine neue **Anfragen-Übersicht**.
- **Melden & Moderation** im Chat plus viele kleine Verbesserungen.

Android muss dafür **nichts** tun (läuft über den Web-Deploy, ist längst aktuell).

Du brauchst: deinen Mac mit Xcode, dein Apple-Developer-Login, das
JAMIE-Projekt (liegt unter `~/reactJamie`), dein App-Store-Connect-Login und
dein iPhone.

Fixe Werte (nur zum Abgleichen, nichts ändern):

| Was | Wert |
|---|---|
| App | JAMIE, App-ID `6784212397` |
| Bundle ID | `com.jamie-app.app` |
| Team-ID | `RTJNBK94F8` (geklärt, nichts mehr nachschauen) |
| Neue Version / Build | **1.4.2** / **11** (falls 11 schon vergeben: 12 — siehe Kurzhilfe) |
| Test-Account für Apple-Review | `playreview@jamie-app.com` |

---

## 1. Neuesten Code holen

Terminal öffnen (Programme → Dienstprogramme → Terminal), dann Zeile für Zeile,
jede mit Enter:

```bash
cd ~/reactJamie
git status --short
git pull
git log --oneline -1
```

- Zeigt `git status --short` **Dateien an** (z. B. `package-lock.json`), dann
  vor dem `git pull` einmal: `git checkout -- frontend/package-lock.json`
  (das ist eine automatisch erzeugte Datei, die darf weg).
- Die letzte Zeile muss mit **`9d9f940`** beginnen (Commit vom 21.09.2026,
  „feat(roster): …"). Steht dort ein älterer Commit, hat der Pull nicht
  geklappt → **STOPP, Tobi.**

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
     auftauchen — entweder „`+ … added`" oder „`✓ … already set`".
     **Das ist neu und wichtig:** ohne diese Zeile funktionieren die
     Sprachnachrichten auf dem iPhone nicht.
  2. **„4/4 Push Notifications entitlement … ✓"**
  3. **„5/5 AppDelegate … ✓ already forwards"**
  4. **„Preflight done"** am Schluss.
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
2. **Version**: `1.4.2` eintragen. **Build**: `11` eintragen.
   ⚠️ **Nach dem Tippen einmal in ein anderes Feld klicken** (oder Tab drücken).
   Sonst übernimmt Xcode den Wert nicht — genau das ist schon einmal
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
   Zeile muss **`1.4.2 (11)`** heißen. Steht dort `1.4.1 (10)` oder älter →
   zurück zu Schritt 3, Version/Build nochmal setzen, neu archivieren.
4. **Distribute App → App Store Connect → Upload** → bei allen Dialogen die
   Vorauswahl lassen → **Upload**. Fragt Apple nach „Export Compliance /
   Verschlüsselung": **Nein**.
5. Warten bis „Upload Successful".

## 5. Über TestFlight testen — BEVOR du einreichst

Der Build erscheint **15–45 Minuten** nach dem Upload in App Store Connect.

1. https://appstoreconnect.apple.com → **Meine Apps → JAMIE → TestFlight**.
   Sobald Build **11** dort steht: bei „Interne Tests" dich selbst hinzufügen
   (falls nicht schon drin).
2. Am iPhone: **TestFlight-App** öffnen → JAMIE → **Installieren** (ersetzt die
   App-Store-Version, das ist okay).

Dann durchklicken — jeder Punkt dauert unter einer Minute. **d) ist der
wichtigste neue Test** (Apple prüft die Sprachnachrichten mit):

**a) Die Schalter.**
JAMIE → **Einstellungen → Benachrichtigungen**. Dort müssen genau **zwei**
Schalter stehen:

- **„Erinnerungen"** — „Vor deinen Events und Tipps für deine eigenen Gruppen"
- **„Aktivität von Freunden"** — „Wenn Freunde Gruppen beitreten oder erstellen"

(plus darunter wie bisher **„Push-Benachrichtigungen"**.)
Stehen dort noch **„Neue Nachrichten" / „Freundschaftsanfragen" /
„Gruppenaktivität"**, ist ein alter Stand gebaut → zurück zu Schritt 1.
Jetzt **„Erinnerungen"** ausschalten, App komplett schließen (hochwischen),
neu öffnen, wieder rein: Der Schalter muss **aus geblieben** sein. Springt er
zurück auf „an" → Screenshot an Tobi. Danach wieder **einschalten**.

**b) Push kommt weiterhin an.** JAMIE schließen (oder iPhone sperren), Tobi (oder
ein zweiter Account) schickt dir eine **Direktnachricht**. Die Benachrichtigung
muss auf dem Sperrbildschirm erscheinen und beim Tippen **direkt im richtigen
Chat** aufgehen.

**c) Mitgliederliste + Anfragen.** In einer Gruppe, in der du **Mitglied** bist:
auf die Avatar-Bubbles mit der Mitgliederzahl tippen → die **Mitgliederliste**
muss aufgehen (alle Mitglieder, kein Pro-Hinweis). Für die **Anfragen-Übersicht**
brauchst du eine **private** Gruppe, die **dir gehört**, mit **mindestens einer
offenen Beitrittsanfrage** → dann steht dort **„Anfragen ansehen (1)"**. Fehlt
der Knopf, ist die Gruppe öffentlich oder es wartet keine Anfrage — **das ist so
gewollt**. Zum Testen einen zweiten Account eine Anfrage stellen lassen.

**d) Sprachnachricht (NEU — bitte nicht überspringen).** In einem Chat auf das
**Mikrofon-Symbol** tippen. Beim allerersten Mal fragt iOS **„JAMIE möchte auf
das Mikrofon zugreifen"** → **Erlauben**. Eine kurze Nachricht aufnehmen,
absenden, dann **abspielen**. Kommt **keine** Mikrofon-Frage, lässt sich nichts
aufnehmen, oder die App schließt sich → **STOPP, Tobi** (dann fehlt die
Mikrofon-Berechtigung aus Schritt 2, Punkt 1).

**e) Foto + Reaktion.** Im Chat ein **Foto** anhängen und senden. Dann auf eine
Nachricht lange tippen (bzw. das Reaktions-Symbol) und ein **Emoji** wählen — es
muss an der Nachricht erscheinen. Nochmal ein anderes Emoji wählen: es
**ersetzt** das erste (eine Reaktion pro Person, das ist so gewollt).

**f) Lesebestätigungen.** Mit einem zweiten Account hin- und herschreiben: unter
der eigenen Nachricht muss **zugestellt/gelesen** erscheinen. In
**Einstellungen** den Schalter dafür **ausschalten** — dann verschwinden die
Bestätigungen für beide Seiten. Danach nach Belieben wieder einschalten.

Klappt a–f → weiter zu Schritt 7. Hakt etwas → Schritt 6.

## 6. Wenn etwas nicht klappt

Nicht rumprobieren. Schick Tobi:

1. **Was** nicht ging (a–f) und die **Uhrzeit** auf die Minute.
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

1. Links oben neben „iOS-App" das **⊕** → **1.4.2** anlegen.
2. **„Was ist neu"** einfügen — **Deutsch**:

   ```
   • Chat: Sprachnachrichten, Fotos und Antworten – plus Emoji-Reaktionen auf einzelne Nachrichten
   • Lesebestätigungen: sieh, ob deine Nachricht zugestellt und gelesen wurde – jederzeit abschaltbar
   • Benachrichtigungen: Erinnerungen vor deinen Events und zwei Schalter, mit denen du selbst bestimmst, was ankommt
   • Gruppen: Mitgliederliste und eine neue Übersicht für Beitrittsanfragen (sortieren, filtern, alle annehmen)
   • Melden & Moderation im Chat sowie viele kleine Verbesserungen
   ```

   **Englisch**:

   ```
   • Chat: voice messages, photos and replies – plus emoji reactions on individual messages
   • Read receipts: see when your message is delivered and read – switch it off anytime
   • Notifications: reminders before your events and two switches so you decide what reaches you
   • Groups: member list and a new overview for join requests (sort, filter, accept all)
   • Report & moderation in chat, plus many small improvements
   ```

   **Italienisch** (falls das Feld da ist):

   ```
   • Chat: messaggi vocali, foto e risposte – oltre alle reazioni emoji ai singoli messaggi
   • Conferme di lettura: scopri quando il messaggio è stato consegnato e letto – disattivabili quando vuoi
   • Notifiche: promemoria prima dei tuoi eventi e due interruttori per decidere cosa ricevere
   • Gruppi: elenco dei membri e una nuova panoramica delle richieste di partecipazione (ordina, filtra, accetta tutte)
   • Segnalazione e moderazione in chat, più tante piccole migliorie
   ```

   (Frankreich/Spanien: englischen Text einsetzen oder Tobi fragen.)
3. Abschnitt **Build**: „+" → Build **11** auswählen.
4. **App-Review-Informationen**: Anmelden erforderlich = **Ja**, Demo-Account
   `playreview@jamie-app.com` + Passwort (Passwort-Manager). Notiz:
   `Login via e-mail only on iOS. Voice messages need microphone permission (tap the mic icon in any chat).`
5. Oben rechts **„Zur Prüfung hinzufügen" / „Bei App-Review einreichen"**.

Review dauert meist unter 24 h. Nach Freigabe wird automatisch veröffentlicht.
**Dann Tobi Bescheid sagen.**

---

## Wenn etwas schiefgeht — Kurzhilfe

| Problem | Lösung |
|---|---|
| Tobi hat noch nicht „gepusht + Backend live" gesagt | Warten. Ohne das greifen Reaktionen/Lesebestätigungen ins Leere |
| `git pull` meckert über lokale Änderungen | `git checkout -- frontend/package-lock.json`, nochmal `git pull`. Sonst Tobi |
| `git log --oneline -1` zeigt nicht Tobis heutigen Hash | Pull hat nicht geklappt → Tobi |
| Preflight zeigt kein `NSMicrophoneUsageDescription` | Screenshot an Tobi, **nicht** archivieren (Sprachnachrichten wären kaputt) |
| Preflight zeigt kein „4/4 … ✓" | Screenshot an Tobi, nicht archivieren |
| Xcode: „Push Notifications" fehlt unter Capabilities | Nicht archivieren — Tobi |
| Organizer zeigt falsche Version (nicht 1.4.2 (11)) | Version/Build in General setzen, **Feld verlassen**, neu archivieren |
| Upload: „build number already used" | Build auf 12, neu archivieren |
| Build taucht in TestFlight nicht auf | 45 Min. warten, Mail prüfen |
| In den Einstellungen stehen noch die alten drei Schalter | Alter Stand gebaut → Schritt 1 und 2 nochmal |
| Sprachnachricht: keine Mikrofon-Frage / App schließt sich | Mikrofon-Berechtigung fehlt → Tobi (Preflight prüfen) |
| Apple-Review lehnt ab | Begründung als Screenshot an Tobi |

**Was du NICHT anfassen musst:** Android (läuft über den Web-Deploy und ist
automatisch aktuell — dort kommt **kein** Store-Update, das ist richtig so),
Bezahlfunktionen (bewusst aus), Server/Railway (Tobi), der Apple-Push-Key im
Developer-Portal (ist schon richtig eingetragen).
