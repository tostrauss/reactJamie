# iOS-Update für Tina — Version 1.4.4 (JAMIE Pro, Profilbilder im Gruppenchat, Event-Chats)

Stand: **08.10.2026** · Ziel: **Version 1.4.4** mit den drei Pro-Abos in den App Store bringen.

**Außerdem neu in 1.4.4** (dein Feedback vom 08.10.): Im Gruppenchat steht neben der ersten
Nachricht jeder Person ihr **Profilbild** (antippen → Profil), wie bei WhatsApp. Und
**Chats von Club-Events** (z. B. „JAMIE x Mon Ami Halloween") stehen jetzt in der
Chatliste und im roten Zähler — bisher wurden sie dort komplett ausgeblendet.

**Was passiert ist:** In 1.4.3 (Build 12) steckt ein Fehler in **unserer** Kauf-Anbindung,
nicht in deinen Einstellungen: Das Pro-Fenster lädt endlos, darum hast du in TestFlight
keine Abos gesehen. 1.4.3 geht deshalb **ohne Pro** durch die Prüfung und in den Store —
der Server bietet Build 12 nie einen Kauf an. **1.4.4 bringt den Fix**, und die Abos gehen
**mit dieser Version** zur Prüfung: Die **ersten** Abos einer App prüft Apple nur zusammen
mit einer App-Version, getrennt einreichen geht beim ersten Mal nicht.

**Vorher (Tobi), genau in dieser Reihenfolge:**
1. Pushen und warten, bis auf Railway (Projekt `incredible-radiance`) der Deploy mit
   **genau diesem Commit** aktiv ist. Bei ausgeschaltetem Schalter sieht der alte
   Server-Code von außen gleich aus — nur der Commit beweist, dass die Sperre live ist.
2. **Erst dann** `IOS_IAP_ENABLED=true` (+ `PAYMENTS_ENABLED=true`) setzen und deployen.
3. Beide Adressen im Browser prüfen:
   - https://app.jamie-app.com/api/iap/config muss `"ios_iap_enabled":false` zeigen
     (so bleibt 1.4.3 / Build 12 ohne Kauf). Steht dort `true`, läuft noch der alte
     Server-Code → sofort `IOS_IAP_ENABLED=false`, deployen, zurück zu 1.
   - https://app.jamie-app.com/api/iap/config?iap_client=2 muss `true` zeigen.
Erst wenn Tobi „gepusht + live + Schalter an" sagt, geht es hier los.

Android muss **nichts** tun (läuft über den Web-Deploy).

Du brauchst: deinen Mac mit Xcode, das JAMIE-Projekt (liegt unter `~/reactJamie`),
dein App-Store-Connect-Login und dein iPhone.

Fixe Werte (nur zum Abgleichen, nichts ändern):

| Was | Wert |
|---|---|
| App | JAMIE, App-ID `6784212397` |
| Bundle ID | `com.jamie-app.app` |
| Team-ID | `RTJNBK94F8` |
| Neue Version / Build | **1.4.4** / **13** (falls 13 schon vergeben: die nächste freie Nummer — siehe Kurzhilfe) |
| Abos (Gruppe „JAMIE Pro") | `pro_monthly` 6,99 € · `pro_sixmonth` 29,99 € · `pro_yearly` 49,99 € |
| Test-Account für Apple-Review | `playreview@jamie-app.com` |

> **Vorab in App Store Connect (geht schon jetzt, auch während 1.4.3 in Prüfung ist):**
> 1. **Business:** Der Vertrag **„Paid Apps"** muss **Aktiv** sein. Sonst liefert Apple
>    der App gar keine Abos.
> 2. **Monetarisierung → Abonnements → Gruppe „JAMIE Pro":** Die Gruppe selbst braucht
>    eine **Lokalisierung** (Deutsch + Englisch, Anzeigename „JAMIE Pro").
> 3. Bei **jedem** der drei Abos alles ausfüllen, was Apple als Pflicht führt:
>    Anzeigename + Beschreibung (Deutsch + Englisch), Preis, **Verfügbarkeit: alle
>    Länder**, und unter „Informationen zur Prüfung" den **Review-Screenshot**. Tobi
>    schickt dir drei Bilder vom Pro-Fenster: `paywall-pro_monthly.png` beim Monats-Abo,
>    `paywall-pro_sixmonth.png` beim 6-Monats-Abo, `paywall-pro_yearly.png` beim
>    Jahres-Abo. Den Status-Text nicht zu genau nehmen: Apple hat die Namen 2026
>    geändert („Fehlende Metadaten" / „Bereit zur Einreichung" gibt es nicht mehr
>    überall; neu steht oft „Vorbereitung für die Einreichung" auch dann, wenn noch etwas
>    fehlt). Maßgeblich ist: Kein Pflichtfeld ist mehr leer oder rot markiert.
>    Für TestFlight reichen Name, Preis, die Lokalisierung der Gruppe (2.) und der
>    aktive Vertrag (1.); Änderungen brauchen **bis zu 1 Stunde**, bis sie in TestFlight
>    ankommen. Der Review-Screenshot ist für die Einreichung Pflicht und lässt sich
>    nach dem Einreichen nicht mehr tauschen.
> 4. **Vertrieb:** Status von **1.4.3** ansehen. Die neue Version 1.4.4 legst du erst in
>    Schritt 7 an, wenn 1.4.3 **im App Store** ist. Bauen und TestFlight (Schritte 1–5)
>    gehen schon vorher.
> 5. **1.4.3 zeigt kein Pro — also darf es dort auch nicht drinstehen.** Unter
>    **Vertrieb → 1.4.3**: Steht in **„Was ist neu"** (in jeder Sprache) die Zeile
>    „JAMIE Pro: alle Mitglieder sehen, Boosts und mehr" (EN „JAMIE Pro: see all
>    members …", IT „JAMIE Pro: vedi tutti i membri …"), oder in
>    **App-Review-Informationen → Notizen** der Satz von „JAMIE Pro subscriptions: …"
>    bis „… in Settings." → löschen, **Sichern**. Die Notiz lässt sich laut Apple
>    jederzeit ändern. Ist „Was ist neu" gesperrt (grau): so lassen. Fragt Apple nach
>    Pro oder den Abos, im Resolution Center antworten:
>    `JAMIE Pro and its subscriptions are not part of this version. They will be submitted together with the next version (1.4.4).`
>    Lehnt Apple deshalb ab: die Zeile löschen und ohne neuen Build erneut einreichen.

---

## 1. Neuesten Code holen

Terminal öffnen (Programme → Dienstprogramme → Terminal), dann Zeile für Zeile,
jede mit Enter:

```bash
cd ~/reactJamie
git status --short
git pull
git log --oneline -3
```

- Zeigt `git status --short` **Dateien an** (z. B. `package-lock.json`), dann
  vor dem `git pull` einmal: `git checkout -- frontend/package-lock.json`
  (automatisch erzeugte Datei, die darf weg). Eine Zeile `?? frontend/ios/` ist
  normal (das Xcode-Projekt) — die bleibt einfach stehen.
- Dann diese Zeile (kopieren, Enter) — sie prüft, ob der Fix für das Pro-Fenster da ist:

  ```bash
  grep -c "Purchases: m.Purchases" frontend/src/utils/iap.js
  ```

  Sie muss **1** ausgeben. Steht dort **0** → der Pull hat nicht geklappt oder Tobi hat
  noch nicht gepusht → **STOPP, Tobi.**
- Und diese (die Preisanzeige für Apple, wie bei 1.4.3):

  ```bash
  grep -c "perMonthApprox" frontend/src/components/ProModal.jsx
  ```

  Sie muss eine Zahl **größer als 0** ausgeben. **0** → **STOPP, Tobi.**

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
  1. Unter **„3/3 Permission usage strings"** steht **`NSMicrophoneUsageDescription`**
     („`+ … added`" oder „`✓ … already set`").
  2. **„4/4 Push Notifications entitlement … ✓"**
  3. **„5/5 AppDelegate … ✓ already forwards"**
  4. **„Preflight done"** am Schluss.
  Steht bei 5/5 ein rotes **❌ … STOP** → **STOPP, Tobi**.
- In der `cap sync`-Ausgabe muss **`@revenuecat/purchases-capacitor`** auftauchen
  (die Kauf-Anbindung). Fehlt es → Screenshot an Tobi.
- „@capacitor/core … doesn't match @capacitor/ios" ist eine Warnung, kein
  Fehler — ignorieren.
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
2. **Version**: `1.4.4` eintragen. **Build**: `13` eintragen (dort steht noch
   `1.4.3` / `12` — einfach überschreiben).
   ⚠️ **Nach dem Tippen einmal in ein anderes Feld klicken** (oder Tab).
   Sonst übernimmt Xcode den Wert nicht.
3. Reiter **Signing & Capabilities**: In der Liste muss **„Push Notifications"**
   stehen. Fehlt es → **STOPP, Tobi**. **Sonst nichts hinzufügen** — „In-App
   Purchase" brauchst du nicht (Apple: unnötig, Käufe sind für unsere App-ID
   automatisch aktiv), und **auf keinen Fall „StoreKit External Purchases or
   Offers"** (Bezahlen außerhalb von Apple, braucht eine Sondergenehmigung).
4. Steht bei Signing etwas Rotes: Häkchen „Automatically manage signing"
   einmal aus- und wieder einschalten. Bleibt es rot → Screenshot an Tobi.

## 4. Archivieren und hochladen

1. Oben in der Gerätezeile **„Any iOS Device (arm64)"** auswählen (kein
   Simulator).
2. Menü **Product → Archive**. Dauert einige Minuten.
3. Es öffnet sich der **Organizer**. ⚠️ **Erst kontrollieren:** Die oberste
   Zeile muss **1.4.4** mit der Build-Nummer aus Schritt 3 heißen (normal
   **`1.4.4 (13)`**). Steht dort etwas Älteres → zurück zu Schritt 3,
   Version/Build nochmal setzen, neu archivieren.
4. **Distribute App → App Store Connect → Upload** → bei allen Dialogen die
   Vorauswahl lassen → **Upload**. Fragt Apple nach „Export Compliance /
   Verschlüsselung": **Nein**. Steht der Build später in TestFlight auf
   **„Fehlende Konformität"**: dort **„Verwalten"** → **„Keiner der oben genannten
   Algorithmen"** wählen (bzw. „Nein").
5. Warten bis „Upload Successful".

## 5. Über TestFlight testen — BEVOR du einreichst

Der Build erscheint **15–45 Minuten** nach dem Upload. App Store Connect →
**JAMIE → TestFlight** → bei „Interne Tests" dich selbst hinzufügen (falls nicht
schon drin) → am iPhone **TestFlight-App** → JAMIE → **Installieren**.

**h) JAMIE Pro — der Haupttest.** In TestFlight kostet der Kauf **nichts**.
1. **Profil** → Karte **„JAMIE Pro"**. Nach ein, zwei Sekunden stehen dort drei
   Tarife mit **Euro-Preisen**: groß der Betrag, der abgebucht wird (6,99 € /
   29,99 € / 49,99 €), klein darunter „≈ … pro Monat".
   - **Dreht sich der Ladekreis länger als 10 Sekunden** → **STOPP, Tobi**
     (Uhrzeit dazu).
   - **„JAMIE Pro ist auf dem iPhone derzeit nicht verfügbar"** → Apple liefert die
     Abos noch nicht aus: Vertrag (Vorab 1), Lokalisierung der Gruppe (Vorab 2), ein
     Abo ohne Preis/Namen oder nicht in Österreich verfügbar (Vorab 3), oder eine
     Änderung ist noch keine Stunde alt. Erst das prüfen, dann JAMIE komplett
     schließen und neu öffnen. Bleibt es → Screenshot an Tobi (er sieht in Sentry,
     welches Abo fehlt).
   - **Gar keine Pro-Karte** → der Fix fehlt im Build (Schritt 1) oder Tobis Schalter
     ist aus → Tobi.
2. Ganz unten im Pro-Fenster **„AGB"** und **„Datenschutz"** antippen — beide müssen
   die Seite in Safari öffnen.
3. **Screenshots für Apple (optional):** ganz nach oben scrollen, sodass Krone,
   „JAMIE Pro" und alle drei Tarife mit Preisen zu sehen sind (wie auf Tobis Bildern).
   Knopf und Abo-Text passen nicht mit aufs Bild — das ist normal und für Apple nicht
   nötig. Je einen Screenshot mit „1 Monat", „6 Monate" und „1 Jahr" angetippt.
   Willst du Tobis Bilder damit ersetzen: **gleich jetzt** unter **Monetarisierung →
   Abonnements** beim passenden Abo den Review-Screenshot tauschen und **Sichern**
   (nach dem Einreichen geht das nicht mehr, und in Schritt 7 kostet jeder
   Seitenwechsel ungesicherte Eingaben).
4. 6 Monate gewählt → Häkchen → **Jetzt starten** → Apple-Kaufbogen bestätigen.
5. Krone mit **Konfetti**; in den **Einstellungen** steht **„JAMIE Pro · Aktiv"**
   und **„Abo im App Store verwalten"** (kein JAMIE-Kündigen-Knopf, richtig so).
6. **„Käufe wiederherstellen"** → „1 Kauf wiederhergestellt".

**Kurzer Rundgang (3 Minuten):** JAMIE komplett schließen und neu öffnen, alle Reiter
unten antippen, einen Gruppen-Chat mit Foto öffnen (das **Bild** erscheint), Tobi oder
ein zweiter Account schickt dir eine Direktnachricht, während JAMIE geschlossen ist →
die Benachrichtigung kommt. Keine weiße Seite, nichts hängt.
- **Profilbilder (neu):** In einem Gruppen-Chat steht links neben der ersten Nachricht
  jeder Person ihr Profilbild, der Name nur einmal pro Block. Antippen öffnet das Profil.
  Deine eigenen Nachrichten rechts bleiben wie bisher.
- **Event-Chats (neu):** **Chats** → „Alle" und „Gruppen": Der Chat von „JAMIE x Mon Ami
  Halloween" (oder einem anderen Club-Event, in dem du bist) steht in der Liste, mit der
  letzten Nachricht. Schreibt jemand dort, erscheint der rote Zähler unten.

Klappt h und der Rundgang → Schritt 7. Hakt etwas → Schritt 6.

## 6. Wenn etwas nicht klappt

Nicht rumprobieren. Schick Tobi:

1. **Was** nicht ging und die **Uhrzeit** auf die Minute.
2. **Screenshot** der Seite, auf der es hakt.

Tobi sieht den Rest in Sentry und den Server-Logs. Erst wenn er grünes Licht gibt:
Schritt 7.

**Neu bauen nach einem Fix von Tobi:** Schritte 1–5 wiederholen; in Schritt 3 als Build
die **höchste 1.4.4-Nummer aus TestFlight + 1** eintragen (z. B. 14).

## 7. In App Store Connect einreichen

Erst wenn **1.4.3 im App Store ist** (unter Vertrieb „Bereit für den Vertrieb") und
Schritt 5 durch ist (oder Tobi sagt: einreichen).

Auf https://appstoreconnect.apple.com → **Meine Apps → JAMIE → Vertrieb**:

1. Links oben neben „iOS-App" das **⊕** → **1.4.4** anlegen.
2. **„Was ist neu"** einfügen — **Deutsch**:

   ```
   • JAMIE Pro jetzt auch auf dem iPhone: alle Mitglieder sehen, Gruppen und Clubs boosten und mehr – als Abo über Apple, jederzeit kündbar
   • Gruppen-Chat: Profilbilder neben den Nachrichten – antippen öffnet das Profil
   • Chats von Club-Events stehen jetzt in deiner Chatliste
   • Kleine Verbesserungen und Fehlerbehebungen
   ```

   **Englisch**:

   ```
   • JAMIE Pro now on iPhone: see all members, boost groups and clubs and more – as a subscription through Apple, cancel anytime
   • Group chats: profile pictures next to messages – tap to open the profile
   • Club event chats now show up in your chat list
   • Small improvements and bug fixes
   ```

   **Italienisch** (falls das Feld da ist):

   ```
   • JAMIE Pro ora anche su iPhone: vedi tutti i membri, dai visibilità a gruppi e club e altro – abbonamento tramite Apple, disdici quando vuoi
   • Chat di gruppo: foto profilo accanto ai messaggi – toccala per aprire il profilo
   • Le chat degli eventi dei club ora compaiono nell’elenco delle chat
   • Piccoli miglioramenti e correzioni
   ```

   (Frankreich/Spanien: englischen Text einsetzen.)
3. Abschnitt **Build**: „+" → den **1.4.4-Build mit der höchsten Nummer** — den, den du
   in Schritt 5 getestet hast (normal 13, nach einem Neubau höher). Das Datum ist egal:
   Gebaut hast du ihn vielleicht schon vor Tagen.
4. Gleich darunter Abschnitt **„In-App-Käufe und Abonnements"**: die drei Abos
   `pro_monthly`, `pro_sixmonth`, `pro_yearly` auswählen — **Pflicht**. Ohne diesen
   Schritt prüft Apple die Abos nicht, und im App Store steht später „JAMIE Pro ist auf
   dem iPhone derzeit nicht verfügbar". Die Abo-**Gruppe** „JAMIE Pro" kommt dabei mit.
   Fehlt der Abschnitt oder ist ein Abo nicht auswählbar (meist fehlt noch ein
   Pflichtfeld, Vorab 3) → Screenshot an Tobi.
5. (Die Review-Screenshots der Abos sind schon erledigt: Tobis Bilder aus Vorab 3, oder
   deine aus h.3. Hier nicht mehr wechseln.)
6. Oben rechts **„Sichern"** — und zwar vor **jedem** Seitenwechsel (App-Datenschutz,
   Monetarisierung …), sonst sind Text, Build und Abo-Auswahl weg.
7. **App-Datenschutz** (links im Menü): **„Kaufverlauf"** muss eingetragen und
   **veröffentlicht** sein (mit der Identität verknüpft, Zweck „App-Funktionalität",
   kein Tracking). War das schon bei 1.4.3 so → nichts tun.
8. **Beschreibung** der Version — in **jeder** Sprache: am Ende ein Link zu den
   Nutzungsbedingungen (https://app.jamie-app.com/terms); die Datenschutz-URL ist
   https://app.jamie-app.com/privacy. Bei Abos verlangt Apple beides. Schon drin → nichts tun.
9. **App-Review-Informationen**: Anmelden erforderlich = **Ja**, Demo-Account
   `playreview@jamie-app.com` + Passwort. Vorher einmal in der TestFlight-App mit dem
   Demo-Account anmelden: Unter **Profil** muss die Karte **„JAMIE Pro"** stehen (fehlt
   sie, hat der Demo-Account schon Pro → **STOPP, Tobi**). Dabei **nicht** „Käufe
   wiederherstellen" tippen (das würde dein Test-Abo aus h auf den Demo-Account
   übertragen). Danach abmelden und wieder mit deinem Account anmelden.
   Notiz:
   `Login via e-mail only on iOS. This version adds JAMIE Pro, three auto-renewable subscriptions submitted with this version: Profile tab → "JAMIE Pro" card, or Settings → "JAMIE Pro". "Restore Purchases" is in the same sheet and in Settings. The demo account has no subscription.`
10. **Veröffentlichung der Version**: automatisch, **phasenweise Veröffentlichung AUS**.
11. Oben rechts noch einmal **„Sichern"**. **Letzter Blick vor dem Einreichen:** Steht
    unter **Build** dein 1.4.4-Build, und stehen unter **„In-App-Käufe und
    Abonnements"** (bzw. in der Einreichung) alle drei: `pro_monthly`, `pro_sixmonth`,
    `pro_yearly`? Apple meckert nicht, wenn sie fehlen — dann gingen die Abos wieder
    nicht mit. Fehlt etwas → **STOPP, Tobi**. Sonst **„Zur Prüfung hinzufügen" / „Bei
    App-Review einreichen"**.

Review dauert meist unter 24 h, bei den ersten Abos manchmal etwas länger. Nach Freigabe
wird automatisch veröffentlicht. **Dann Tobi Bescheid sagen.**

---

## Wenn etwas schiefgeht — Kurzhilfe

| Problem | Lösung |
|---|---|
| Tobi hat noch nicht „gepusht + live + Schalter an" gesagt | Warten |
| `grep -c "Purchases: m.Purchases"` gibt 0 aus | Fix fehlt → Tobi, **nicht** bauen |
| `git pull` meckert über lokale Änderungen | `git checkout -- frontend/package-lock.json`, nochmal `git pull`. Sonst Tobi |
| Preflight zeigt kein `NSMicrophoneUsageDescription` oder kein „4/4 … ✓" | Screenshot an Tobi, **nicht** archivieren |
| Xcode: „Push Notifications" fehlt | Nicht archivieren — Tobi |
| Xcode: kein „In-App Purchase" unter „+ Capability", nur „StoreKit External Purchases or Offers" | Richtig so — nichts hinzufügen, weiter |
| Signing rot, im Text steht `com.apple.developer.storekit` | Capability „In-App Purchase" entfernen (Maus drauf → ✕ links neben dem Namen) — sie ist unnötig |
| Organizer zeigt nicht 1.4.4 mit deiner Build-Nummer aus Schritt 3 | Version/Build in General setzen, **Feld verlassen**, neu archivieren |
| Upload: „build number already used" | Build eins höher (14, 15 …), neu archivieren, in Schritt 7 diese Nummer nehmen |
| Neu bauen nach einem Fix von Tobi | Build = höchste 1.4.4-Nummer in TestFlight + 1, dann Schritte 1–5 |
| Build taucht in TestFlight nicht auf | 45 Min. warten, Mail prüfen |
| Pro-Fenster: Ladekreis hört nicht auf | **STOPP, Tobi** (Uhrzeit dazu) |
| Pro-Fenster: „derzeit nicht verfügbar" | Vertrag, Gruppen-Lokalisierung, Abo-Pflichtfelder (Vorab 1–3), bis zu 1 Stunde warten, App neu öffnen. Sonst Tobi |
| Gar keine Pro-Karte im Profil | Fix fehlt im Build (Schritt 1), oder Kauf-Schalter in Railway aus → Tobi |
| Kein ⊕ für 1.4.4 in Schritt 7 | 1.4.3 ist noch nicht im App Store → warten. Abgelehnt → Begründung an Tobi |
| 1.4.3: Apple fragt nach JAMIE Pro oder lehnt deswegen ab | Vorab 5: Pro-Zeile und Notiz-Satz löschen, Antworttext von dort, ohne neuen Build erneut einreichen → Tobi Bescheid |
| Apple-Review lehnt ab | Begründung als Screenshot an Tobi |

**Was du NICHT anfassen musst:** Android (läuft über den Web-Deploy), Server/Railway
und die Kauf-Schalter (Tobi), der Apple-Push-Key im Developer-Portal.
