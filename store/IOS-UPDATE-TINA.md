# iOS-Update Roadmap für Tina — Schritt für Schritt (ohne Tobi machbar)

Stand: 30.07.2026. Ziel: **(A)** neues JAMIE-Update in den App Store bringen und
**(B)** einmalig den Push-Schlüssel (APNs) erzeugen, damit iOS-Benachrichtigungen
endlich funktionieren. Teil B ist unabhängig von Teil A und **wichtiger** — wenn
die Zeit knapp ist, zuerst Teil B machen (10 Minuten).

Du brauchst: deinen Mac mit Xcode, dein Apple-Developer-Login, das
JAMIE-Projekt (liegt schon auf deinem Mac — dort, wo du es beim letzten Mal
gebaut hast) und dein App-Store-Connect-Login.

Fixe Werte (zum Abgleichen, nichts ändern):

| Was | Wert |
|---|---|
| App | JAMIE, App-ID `6784212397` |
| Bundle ID | `com.jamie-app.app` |
| Team ID | `3FMA7660T8` |
| Test-Account für Apple-Review | `playreview@jamie-app.com` |

---

## Teil A — App-Update bauen und hochladen

### A1. Neuesten Code holen

Terminal öffnen (Programme → Dienstprogramme → Terminal), dann Zeile für Zeile
(jede mit Enter bestätigen — `<PFAD ZUM PROJEKT>` ersetzen, z. B. `~/jamie`):

```bash
cd <PFAD ZUM PROJEKT>
git pull
```

Wenn `git pull` einen Fehler zeigt („local changes would be overwritten"):
STOPP — Tobi anrufen. Wenn es einfach Dateien auflistet und mit etwas wie
„Fast-forward" endet: weiter.

### A2. Frontend bauen und in das iOS-Projekt übertragen

```bash
cd frontend
npm install
npm run build
npx cap sync ios
```

- Das dauert ein paar Minuten. `npx cap sync ios` führt am Ende automatisch
  „pod install" aus.
- Fehler „pod: command not found" → einmalig `sudo gem install cocoapods`,
  dann `npx cap sync ios` wiederholen.
- Andere rote Fehler → Screenshot an Tobi.

### A3. Xcode öffnen und Versionsnummern setzen

```bash
npx cap open ios
```

Xcode öffnet das Projekt. Dann:

1. Links im Dateibaum ganz oben das blaue **App**-Projekt anklicken →
   Reiter **General** → Abschnitt **Identity**.
2. **Version**: In App Store Connect nachsehen, welche Version aktuell „Live"
   ist (appstoreconnect.apple.com → Meine Apps → JAMIE, steht oben links).
   - Ist dort **1.0** live → Version auf `1.1` setzen.
   - Ist dort schon **1.1** live → Version auf `1.2` setzen.
3. **Build**: die angezeigte Zahl um **1 erhöhen** (z. B. 2 → 3). Die Zahl muss
   höher sein als bei jedem früheren Upload — bei einer Fehlermeldung beim
   Upload („build number already used") einfach nochmal +1 und neu archivieren.
4. Kontrolle im selben Fenster: **Team = IMPIBAG e.U. (3FMA7660T8)**,
   Bundle Identifier = `com.jamie-app.app`. Wenn da etwas Rotes steht
   („Signing"): einmal auf „Try Again" — bleibt es rot → Screenshot an Tobi.

### A4. Archivieren und hochladen

1. Oben in der Gerätezeile (neben dem App-Namen) **„Any iOS Device (arm64)"**
   auswählen (NICHT ein Simulator).
2. Menü **Product → Archive**. Dauert einige Minuten.
3. Es öffnet sich der **Organizer** mit dem neuen Archiv →
   **Distribute App** → **App Store Connect** → **Upload** → bei allen
   folgenden Dialogen die Vorauswahl lassen und **Next/Upload** klicken.
4. Warten bis „Upload Successful". Fertig in Xcode.

### A5. In App Store Connect einreichen

Auf https://appstoreconnect.apple.com → **Meine Apps → JAMIE**:

1. Links oben **„+"** bzw. **„Neue Version"** → Versionsnummer eintragen
   (dieselbe wie in A3, z. B. `1.1`).
2. **„Was ist neu"** (Neuerungen) einfügen — Deutsch:
   ```
   • Chat aktualisiert sich jetzt zuverlässig, auch nach Standby
   • Mitglieder-Verwaltung für Gruppen-Ersteller
   • Route zu Events: Karte antippen und direkt navigieren
   • JAMIE Momente: Fotos auch aus der Galerie hochladen
   • Technische Verbesserungen und Fehlerbehebungen
   ```
   Italienisch (Feld „Italienisch", falls vorhanden):
   ```
   • La chat ora si aggiorna in modo affidabile, anche dopo lo standby
   • Gestione dei membri per i creatori di gruppi
   • Percorso verso gli eventi: tocca la mappa e naviga direttamente
   • JAMIE Momenti: carica le foto anche dalla galleria
   • Miglioramenti tecnici e correzioni di bug
   ```
   Englisch:
   ```
   • Chat now updates reliably, even after standby
   • Member management for group creators
   • Directions to events: tap the map and navigate right away
   • JAMIE Moments: upload photos from your gallery too
   • Technical improvements and bug fixes
   ```
3. Abschnitt **Build**: „+" klicken und den eben hochgeladenen Build auswählen.
   (Er erscheint erst **15–45 Min. nach dem Upload** — solange steht dort
   nichts. Kaffee holen, Seite neu laden.)
4. **App-Review-Informationen** (weiter unten): Anmelden erforderlich = Ja,
   Demo-Account `playreview@jamie-app.com` + Passwort (steht im
   Passwort-Manager). Notiz-Feld: „Login via e-mail only on iOS."
5. Kontrolle **Preise und Verfügbarkeit**: nur Österreich, Deutschland,
   Schweiz, Italien ausgewählt (sollte schon so sein — nur prüfen).
6. Oben rechts **„Zur Prüfung hinzufügen" / „Bei App-Review einreichen"**.

Review dauert meist unter 24 h, manchmal bis 48 h. Status kommt per Mail.
Nach Freigabe: Version wird automatisch veröffentlicht (bzw. auf
„Veröffentlichen" klicken, falls manuelle Freigabe eingestellt ist).

---

## Teil B — APNs-Push-Schlüssel erzeugen (einmalig, ~10 Min., SEHR WICHTIG)

Ohne diesen Schlüssel bekommen iPhone-Nutzer KEINE Benachrichtigungen —
egal wie neu die App ist. Das ist der Grund, warum iOS-Push bis heute nicht geht.

1. Auf https://developer.apple.com → **Account** → einloggen →
   **Certificates, Identifiers & Profiles** → links **Keys**.
2. Blaues **„+"** (Create a key).
3. Name: `JAMIE Push` → Haken bei **„Apple Push Notifications service (APNs)"**
   → Continue → Register.
4. **„Download"** klicken → eine Datei `AuthKey_XXXXXXXXXX.p8` wird geladen.
   ⚠️ **Das geht nur EIN einziges Mal!** Datei sofort sicher ablegen
   (Passwort-Manager / verschlüsselter Ordner). Nie per unverschlüsselter
   E-Mail verschicken.
5. Auf der Seite steht die **Key ID** (10 Zeichen, gleich wie die XXXXXXXXXX im
   Dateinamen) — notieren.
6. An Tobi übermitteln (Passwort-Manager-Freigabe oder Signal o. ä. — nicht
   normale E-Mail): die **.p8-Datei**, die **Key ID**, und zur Sicherheit die
   Team ID `3FMA7660T8`. Tobi trägt daraus drei Werte auf dem Server ein
   (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`) — ab dann funktionieren
   iOS-Benachrichtigungen für alle, ohne dass Nutzer etwas tun müssen.

---

## Wenn etwas schiefgeht — Kurzhilfe

| Problem | Lösung |
|---|---|
| `git pull` meckert über lokale Änderungen | Nichts erzwingen — Tobi anrufen |
| `npm: command not found` | Node.js fehlt/Terminal neu öffnen; sonst Tobi |
| `pod: command not found` | `sudo gem install cocoapods`, dann A2 wiederholen |
| Xcode: rotes Signing-Problem | Xcode → Settings → Accounts: mit Apple-ID eingeloggt? „Try Again". Sonst Screenshot an Tobi |
| Upload: „build number already used" | Build-Nummer in A3 nochmal +1, dann A4 wiederholen |
| Build taucht in App Store Connect nicht auf | 45 Min. warten + Mail-Postfach prüfen (Apple meldet Verarbeitungsfehler per Mail) |
| Apple-Review lehnt ab | Begründung als Screenshot an Tobi — nichts selbst umstellen |

**Was du NICHT anfassen musst:** Android (ist schon erledigt), Bezahlfunktionen
(bewusst deaktiviert), Server/Railway (macht Tobi).
