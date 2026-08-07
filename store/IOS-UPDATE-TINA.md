# iOS-Update für Tina — Schritt für Schritt (ohne Tobi machbar)

Stand: **07.08.2026** · Ziel: das neue JAMIE-Update (**Version 1.3**) in den App
Store bringen. Alle Änderungen der letzten Tage sind schon auf Web & Android
live — die **iPhone-App** bekommt sie erst mit diesem neuen Build, weil iOS die
App-Oberfläche fest mitbaut (anders als Android).

> **Push-Benachrichtigungen (APNs) machst du diesmal NICHT** — das nehmen wir
> uns beim nächsten Mal gemeinsam vor, weil es noch nicht funktioniert. Hier
> also nur das App-Update.

Du brauchst: deinen Mac mit Xcode, dein Apple-Developer-Login, das
JAMIE-Projekt (liegt schon auf deinem Mac, dort wo du es letztes Mal gebaut
hast) und dein App-Store-Connect-Login.

Fixe Werte (nur zum Abgleichen, nichts ändern):

| Was | Wert |
|---|---|
| App | JAMIE, App-ID `6784212397` |
| Bundle ID | `com.jamie-app.app` |
| Team | IMPIBAG e.U. — Team ID `3FMA7660T8` |
| Test-Account für Apple-Review | `playreview@jamie-app.com` |

---

## 1. Neuesten Code holen

Terminal öffnen (Programme → Dienstprogramme → Terminal), dann Zeile für Zeile
(jede mit Enter — `<PFAD ZUM PROJEKT>` durch deinen Projektordner ersetzen, z. B.
`~/reactJamie`):

```bash
cd <PFAD ZUM PROJEKT>
git pull
```

Wenn `git pull` einen Fehler zeigt („local changes would be overwritten"):
STOPP — Tobi anrufen. Wenn es Dateien auflistet und mit „Fast-forward" o. Ä.
endet: weiter.

## 2. Frontend bauen und ins iOS-Projekt übertragen

```bash
cd frontend
npm install
npm run build
npx cap sync ios
```

- Dauert ein paar Minuten. `npx cap sync ios` macht am Ende automatisch
  „pod install".
- Fehler „pod: command not found" → einmalig `sudo gem install cocoapods`,
  dann `npx cap sync ios` wiederholen.
- Andere rote Fehler → Screenshot an Tobi.

## 3. Xcode öffnen und Versionsnummern setzen

```bash
npx cap open ios
```

Xcode öffnet das Projekt. Dann:

1. Links im Dateibaum ganz oben das blaue **App**-Projekt anklicken →
   Reiter **General** → Abschnitt **Identity**.
2. **Version**: auf `1.3` setzen.
   (Zur Kontrolle in App Store Connect nachsehen: appstoreconnect.apple.com →
   Meine Apps → JAMIE. Dort war zuletzt **1.2** live/eingereicht → neue Version
   ist also `1.3`. Falls dort schon `1.3` angelegt ist, Version so lassen und nur
   die Build-Nummer erhöhen.)
3. **Build**: die angezeigte Zahl um **1 erhöhen** (der letzte Upload war
   Build 7 → also `8` eintragen). Die Zahl muss höher sein als bei jedem
   früheren Upload — falls beim Upload „build number already used" kommt:
   einfach nochmal +1 und neu archivieren.
4. Kontrolle im selben Fenster: **Team = IMPIBAG e.U. (3FMA7660T8)**,
   Bundle Identifier = `com.jamie-app.app`. Steht bei „Signing" etwas Rotes:
   einmal „Try Again" — bleibt es rot → Screenshot an Tobi.

## 4. Archivieren und hochladen

1. Oben in der Gerätezeile (neben dem App-Namen) **„Any iOS Device (arm64)"**
   auswählen (NICHT ein Simulator).
2. Menü **Product → Archive**. Dauert einige Minuten.
3. Es öffnet sich der **Organizer** mit dem neuen Archiv →
   **Distribute App** → **App Store Connect** → **Upload** → bei allen
   folgenden Dialogen die Vorauswahl lassen und **Next/Upload** klicken.
4. Warten bis „Upload Successful". Fertig in Xcode.

## 5. In App Store Connect einreichen

Auf https://appstoreconnect.apple.com → **Meine Apps → JAMIE**:

1. Links oben **„+ Version oder Plattform"** → `1.3` eintragen (falls die
   Version noch nicht existiert).
2. **„Was ist neu"** (Neuerungen) einfügen — **Deutsch**:
   ```
   • Neue Chat-Übersicht: alle Chats an einem Ort, mit Filtern und Anfragen
   • Profil bearbeiten & speichern funktioniert wieder zuverlässig
   • Event-Feedback: neue Option „Hat nicht stattgefunden"
   • Viele Detail-Verbesserungen und Fehlerbehebungen
   ```
   **Englisch**:
   ```
   • New chat overview: all your chats in one place, with filters and requests
   • Editing and saving your profile works reliably again
   • Event feedback: new "Didn't take place" option
   • Lots of polish and bug fixes
   ```
   **Italienisch** (falls das Feld vorhanden ist):
   ```
   • Nuova panoramica chat: tutte le chat in un unico posto, con filtri e richieste
   • Modifica e salvataggio del profilo di nuovo affidabili
   • Feedback evento: nuova opzione "Non si è svolto"
   • Tante piccole migliorie e correzioni di bug
   ```
   (Für Frankreich/Spanien: wenn dort ein „Was ist neu"-Feld existiert, den
   englischen Text einsetzen — oder kurz Tobi fragen, er schickt dir FR/ES.)
3. Abschnitt **Build**: „+" klicken und den eben hochgeladenen Build (Nr. 8)
   auswählen. Er erscheint erst **15–45 Min. nach dem Upload** — solange steht
   dort nichts. Kaffee holen, Seite neu laden.
4. **App-Review-Informationen** (weiter unten): Anmelden erforderlich = **Ja**,
   Demo-Account `playreview@jamie-app.com` + Passwort (aus dem Passwort-Manager).
   Notiz-Feld: `Login via e-mail only on iOS.`
5. Kontrolle **Preise und Verfügbarkeit**: Österreich, Deutschland, Schweiz,
   Italien, Frankreich, Spanien ausgewählt (sollte schon so sein — nur prüfen).
6. Oben rechts **„Zur Prüfung hinzufügen" / „Bei App-Review einreichen"**.

Review dauert meist unter 24 h, manchmal bis 48 h — Status kommt per Mail. Nach
Freigabe wird die Version automatisch veröffentlicht (bzw. „Veröffentlichen"
klicken, falls manuelle Freigabe eingestellt ist).

---

## Wenn etwas schiefgeht — Kurzhilfe

| Problem | Lösung |
|---|---|
| `git pull` meckert über lokale Änderungen | Nichts erzwingen — Tobi anrufen |
| `npm: command not found` | Terminal neu öffnen; sonst Tobi |
| `pod: command not found` | `sudo gem install cocoapods`, dann Schritt 2 wiederholen |
| Xcode: rotes Signing-Problem | Xcode → Settings → Accounts: mit Apple-ID eingeloggt? „Try Again". Sonst Screenshot an Tobi |
| Upload: „build number already used" | Build-Nummer in Schritt 3 nochmal +1, dann Schritt 4 wiederholen |
| Build taucht in App Store Connect nicht auf | 45 Min. warten + Mail prüfen (Apple meldet Verarbeitungsfehler per Mail) |
| Apple-Review lehnt ab | Begründung als Screenshot an Tobi — nichts selbst umstellen |

**Was du NICHT anfassen musst:** Android (läuft schon über den Web-Deploy),
Bezahlfunktionen (bewusst deaktiviert), Server/Railway (macht Tobi),
Push-Benachrichtigungen (machen wir zusammen beim nächsten Mal).
