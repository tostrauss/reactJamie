# iOS-Update für Tina — Version 1.4.2 (Einstellungen + Mitglieder-Roster)

Stand: **12.09.2026** · Ziel: **Version 1.4.2** in den App Store bringen.

**Warum überhaupt?** Push funktioniert seit 1.4.1 — das ist erledigt und bleibt
so. Aber der Server verschickt seit dem 07.09. viel mehr Benachrichtigungen
(Event-Erinnerungen, Absagen, Einladungen …), und die dazu passenden
**Schalter zum Abstellen** stecken nur in der Web-Version. Auf dem iPhone sieht
man noch die alten drei Schalter, die **nichts bewirken** — wer dort „Neue
Nachrichten" ausschaltet, bekommt sie trotzdem. Das ist der Grund für dieses
Update. Obendrauf kommen die **Mitgliederliste** und die neue
**Anfragen-Übersicht**.

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
| Neue Version / Build | **1.4.2** / **11** |
| Test-Account für Apple-Review | `playreview@jamie-app.com` |

---

## 0. Bevor du anfängst

Der Code liegt **schon** auf dem Server (Stand `2495a4e` vom 07.09.) — du musst
diesmal auf nichts warten, einfach loslegen.

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
- Die letzte Zeile muss mit **`2495a4e`** anfangen (oder etwas Neuerem, falls
  Tobi inzwischen nachgelegt hat). Steht dort noch `18970ec` oder älter, hat
  der Pull nicht geklappt → **STOPP, Tobi.**

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
  **„5/5 AppDelegate … ✓ already forwards"**,
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

Dann drei Dinge durchklicken — jedes dauert unter einer Minute:

**a) Die Schalter (das Kernstück dieses Updates).**
JAMIE → **Einstellungen → Benachrichtigungen**. Dort müssen genau **zwei**
Schalter stehen:

- **„Erinnerungen"** — „Vor deinen Events und Tipps für deine eigenen Gruppen"
- **„Aktivität von Freunden"** — „Wenn Freunde Gruppen beitreten oder erstellen"

(plus darunter wie bisher **„Push-Benachrichtigungen"**.)
Stehen dort noch **„Neue Nachrichten" / „Freundschaftsanfragen" /
„Gruppenaktivität"**, ist ein alter Stand gebaut → zurück zu Schritt 1.

Jetzt **„Erinnerungen"** ausschalten, die App komplett schließen (hochwischen),
neu öffnen, wieder in die Einstellungen: Der Schalter muss **aus geblieben**
sein. Springt er zurück auf „an" → Screenshot an Tobi. Danach wieder
**einschalten**.

**b) Push kommt weiterhin an.** JAMIE schließen (oder iPhone sperren), Tobi (oder
ein zweiter Account) schickt dir eine **Direktnachricht**. Die Benachrichtigung
muss auf dem Sperrbildschirm erscheinen und beim Tippen **direkt im richtigen
Chat** aufgehen.

**c) Die neuen Seiten.** In einer Gruppe, in der du **Mitglied** bist: auf die
Avatar-Bubbles mit der Mitgliederzahl tippen → die **Mitgliederliste** muss
aufgehen (alle Mitglieder, kein Pro-Hinweis).

Der zweite Knopf braucht genau diese Lage: eine **private** Gruppe, die **dir
gehört**, mit **mindestens einer offenen Beitrittsanfrage**. Dann steht dort
**„Anfragen ansehen (1)"** → die neue Übersicht mit Sortieren/Filtern. Fehlt
der Knopf, ist die Gruppe öffentlich oder es wartet gerade keine Anfrage —
**das ist so gewollt**, kein Fehler. Zum Testen lässt du am einfachsten einen
zweiten Account eine Anfrage stellen.

Klappt a–c → weiter zu Schritt 7. Hakt etwas → Schritt 6.

## 6. Wenn etwas nicht klappt

Nicht rumprobieren. Die beiden früheren Push-Ursachen (Token-Weitergabe,
falsche Team-ID) sind behoben — wenn jetzt etwas hakt, ist es neu und Tobi
braucht es genau. Schick ihm:

1. **Was** nicht ging (a, b oder c) und die **Uhrzeit** auf die Minute.
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
   • Benachrichtigungen: neue Erinnerungen vor deinen Events – und zwei Schalter, mit denen du selbst bestimmst, was ankommt
   • Gruppen: Mitgliederliste und eine neue Übersicht für Beitrittsanfragen (sortieren, filtern, alle annehmen)
   • Kleine Verbesserungen und Fehlerbehebungen
   ```

   **Englisch**:

   ```
   • Notifications: new reminders before your events – plus two switches so you decide what reaches you
   • Groups: member list and a new overview for join requests (sort, filter, accept all)
   • Small improvements and bug fixes
   ```

   **Italienisch** (falls das Feld da ist):

   ```
   • Notifiche: nuovi promemoria prima dei tuoi eventi – e due interruttori per decidere cosa ricevere
   • Gruppi: elenco dei membri e una nuova panoramica delle richieste di partecipazione (ordina, filtra, accetta tutte)
   • Piccoli miglioramenti e correzioni
   ```

   (Frankreich/Spanien: englischen Text einsetzen oder Tobi fragen.)
3. Abschnitt **Build**: „+" → Build **11** auswählen.
4. **App-Review-Informationen**: Anmelden erforderlich = **Ja**, Demo-Account
   `playreview@jamie-app.com` + Passwort (Passwort-Manager). Notiz:
   `Login via e-mail only on iOS.`
5. Oben rechts **„Zur Prüfung hinzufügen" / „Bei App-Review einreichen"**.

Review dauert meist unter 24 h. Nach Freigabe wird automatisch veröffentlicht.
**Dann Tobi Bescheid sagen.**

Nach der Freigabe ein Test wert (Tobi oder du): einen **Gruppen-Link** aus dem
Chat auf dem iPhone antippen — er sollte jetzt direkt in der App aufgehen
statt im Safari. Die Server-Seite dafür (AASA) ist seit dem 07.09. live;
iOS holt sie sich beim Update ab.

---

## Wenn etwas schiefgeht — Kurzhilfe

| Problem | Lösung |
|---|---|
| `git pull` meckert über lokale Änderungen | `git checkout -- frontend/package-lock.json`, nochmal `git pull`. Sonst Tobi |
| `git log --oneline -1` zeigt nicht `2495a4e` oder neuer | Pull hat nicht geklappt → Tobi |
| Preflight zeigt kein „4/4 … ✓" | Screenshot an Tobi, nicht archivieren |
| Xcode: „Push Notifications" fehlt unter Capabilities | Nicht archivieren — Tobi |
| Organizer zeigt falsche Version (nicht 1.4.2 (11)) | Version/Build in General setzen, **Feld verlassen**, neu archivieren |
| Upload: „build number already used" | Build auf 12, neu archivieren |
| Build taucht in TestFlight nicht auf | 45 Min. warten, Mail prüfen |
| In den Einstellungen stehen noch die alten drei Schalter | Alter Stand gebaut → Schritt 1 und 2 nochmal |
| Apple-Review lehnt ab | Begründung als Screenshot an Tobi |

**Was du NICHT anfassen musst:** Android (läuft über den Web-Deploy und ist
automatisch aktuell — dort kommt **kein** Store-Update, das ist richtig so),
Bezahlfunktionen (bewusst aus), Server/Railway (Tobi), der Apple-Push-Key im
Developer-Portal (ist schon richtig eingetragen).
