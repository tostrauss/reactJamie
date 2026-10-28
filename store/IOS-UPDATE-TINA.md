# iOS-Update für Tina — Version 1.4.4 (iOS-27-Fix, JAMIE Pro, großes Community-Update)

Stand: **28.10.2026** (aktualisiert — dein neues Abo-Design und das komplette Update aus
deinem Feedback-Dokument sind jetzt drin) · Ziel: **Version 1.4.4** mit den drei
Pro-Abos in den App Store bringen.

> ### ⚠️ Neu am 11.10.: 1.4.4 mit **Xcode 26** bauen — nicht mit Xcode 27
> **1.4.3 (Build 12) öffnet sich auf iPhones mit iOS 27 überhaupt nicht** (Meldungen vom
> 08.–10.10.: „stürzt direkt nach dem Öffnen ab“, Neu-Installieren hilft nicht). Grund:
> Seit iOS 27 startet Apple Apps, die **mit Xcode 27 gebaut** sind, nur noch, wenn sie ein
> neues Start-Verfahren („UIScene“) können — unsere App kann das noch nicht. Mit
> **Xcode 26** gebaut startet sie auch auf iOS 27 ganz normal. **Schritt 0** unten richtet
> Xcode 26 ein; das Prüf-Skript in Schritt 2 bricht ab, solange noch Xcode 27 aktiv ist.
> 1.4.4 ist damit **dringend**: Es repariert JAMIE für alle iPhones mit iOS 27.

**Außerdem neu in 1.4.4** (alles seit 1.4.3 — im Browser/Android ist das meiste schon
live, aufs iPhone kommt es mit diesem Build):
- **Dein Abo-Fenster vom 27.10.:** „MORE PEOPLE. / MORE PLACES." mit dem Herz-Foto,
  drei Vorteile, „Alle Vorteile ansehen", Tarife, **„Weiter"**-Knopf. Die alte
  Checkbox gibt es **nicht mehr**.
- **Dein Feedback-Dokument komplett:** Plus-Menü mit den drei Optionen (nur Clubs
  brauchen Freigabe), Entdecken heißt **„Community"** mit Communities & Clubs getrennt
  (inkl. deiner Sortierung aus dem Admin), die Compass-Seite ist jetzt
  **Memories | Friends** mit „Warst du dabei?"-Seite und Freunde-Suche, das Profil hat
  Meet-ups / Friends / Memories, Memories-Bearbeiten und „Meine Gruppen & Clubs".
- **Mitgliederlisten:** Wer in einer Gruppe oder einem Club drin ist, sieht wieder
  **alle** Mitglieder.
- **Gruppenchat-Profilbilder**, **Club-Event-Chats in der Chatliste**, **Fotos
  umreihen**, die **kürzere Anmeldung** mit „Clubs für dich" — und der
  **iOS-27-Start-Fix** (der Hauptgrund für dieses Update).

**Was passiert ist:** In 1.4.3 (Build 12) steckt ein Fehler in **unserer** Kauf-Anbindung,
nicht in deinen Einstellungen: Das Pro-Fenster lädt endlos, darum hast du in TestFlight
keine Abos gesehen. 1.4.3 geht deshalb **ohne Pro** durch die Prüfung und in den Store —
der Server bietet Build 12 nie einen Kauf an. **1.4.4 bringt den Fix**, und die Abos gehen
**mit dieser Version** zur Prüfung: Die **ersten** Abos einer App prüft Apple nur zusammen
mit einer App-Version, getrennt einreichen geht beim ersten Mal nicht.

**Vorher (Tobi): ✅ ERLEDIGT am 28.10.** — alles ist gepusht und live (Commit
`7d9b135`), die Schalter stehen richtig; beide Adressen wurden am 28.10. geprüft:
- https://app.jamie-app.com/api/iap/config zeigt `"ios_iap_enabled":false`
  (alte Builds bleiben ohne Kauf) ✓
- https://app.jamie-app.com/api/iap/config?iap_client=2 zeigt `true` ✓

Du kannst also **direkt loslegen**. (Wenn du magst, öffne die zwei Adressen kurz
selbst im Browser — sie müssen genau das zeigen; sonst Tobi.)

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

---

## 0. Xcode 26 bereitstellen (einmalig, ~20 Minuten)

1. Xcode öffnen → Menü **Xcode → Über Xcode**. Steht dort **26.x** → nichts zu tun,
   weiter mit Schritt 1. Steht dort **27.x** → weiter mit 2. **Bitte Tobi kurz schreiben,
   welche Version dort steht** (hast du Xcode seit dem 06.10. nicht aktualisiert, ist das
   die Version, mit der 1.4.3 gebaut wurde).
2. https://developer.apple.com/download/all öffnen, mit deiner Apple-ID anmelden, nach
   **„Xcode 26“** suchen und die **neueste 26er-Version** laden (Datei `Xcode_26….xip`,
   mehrere GB).
3. Doppelklick auf die `.xip` → es entsteht `Xcode.app` im Downloads-Ordner →
   **umbenennen in `Xcode-26.app`** → in den Ordner **Programme** ziehen. Dein
   bisheriges Xcode bleibt einfach daneben stehen.
4. **Xcode-26** einmal per Doppelklick öffnen, Zusatzkomponenten installieren lassen,
   wieder schließen.
5. Im Terminal (Mac-Passwort eingeben, es erscheinen beim Tippen keine Zeichen):

   ```bash
   sudo xcode-select -s /Applications/Xcode-26.app
   xcodebuild -version
   ```

   Die zweite Zeile muss **Xcode 26.…** ausgeben.
- **Xcode 26 lässt sich auf deinem Mac nicht öffnen** (z. B. „nicht kompatibel mit
  dieser macOS-Version“) → **STOPP, Tobi**. Dann stellen wir die App auf das neue
  Start-Verfahren um, das dauert länger.
- Für JAMIE-Builds bis auf Weiteres **immer Xcode 26** nehmen, bis Tobi Entwarnung gibt.

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
- Und diese (dein neues Abo-Design vom 27.10. ist da):

  ```bash
  grep -c "heroTitle1" frontend/src/i18n/locales/de.json
  ```

  Sie muss eine Zahl **größer als 0** ausgeben. **0** → **STOPP, Tobi.**
- Und diese (die neue Anmeldung und der iOS-27-Schutz sind da):

  ```bash
  grep -c "OnboardingClubs" frontend/src/App.jsx; grep -c "UIApplicationSceneManifest" ios/4-preflight.sh
  ```

  Beide Zahlen müssen **größer als 0** sein. Eine **0** → **STOPP, Tobi.**

## 2. Bauen und ins iOS-Projekt übertragen

```bash
cd frontend
npm install
npm run build
npx cap sync ios
cd ..
bash ios/4-preflight.sh
```

- Dauert ein paar Minuten. Ganz oben in der Ausgabe des letzten Befehls muss
  **„0 Xcode version … ✓ Xcode 26.…“** stehen. Steht dort **❌ … Xcode 27** → Schritt 0.
- Am Ende des letzten Befehls achte auf **vier** Dinge:
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
bash ios/open-xcode.sh
```

(Nicht mehr `npx cap open ios` — das öffnet womöglich Xcode 27.) Xcode öffnet das
Projekt. **Erst prüfen:** Menü **Xcode → Über Xcode** muss **26.x** zeigen. Sonst
Xcode schließen → Schritt 0. Dann:

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
1. **Einstellungen → „JAMIE Pro"** (die Pro-Karte im Profil gibt es seit dem Update
   **nicht mehr** — das ist richtig so). Es öffnet sich **dein** Abo-Fenster: oben
   „MORE PEOPLE. / MORE PLACES." mit dem Herz-Foto, die drei Vorteile,
   „Alle Vorteile ansehen", darunter nach ein, zwei Sekunden die drei Tarife mit
   **Euro-Preisen**: groß der Betrag, der abgebucht wird (6,99 € / 29,99 € /
   49,99 €), klein darunter „≈ … pro Monat".
   - **Dreht sich der Ladekreis länger als 10 Sekunden** → **STOPP, Tobi**
     (Uhrzeit dazu).
   - **„JAMIE Pro ist auf dem iPhone derzeit nicht verfügbar"** → Apple liefert die
     Abos noch nicht aus: Vertrag (Vorab 1), Lokalisierung der Gruppe (Vorab 2), ein
     Abo ohne Preis/Namen oder nicht in Österreich verfügbar (Vorab 3), oder eine
     Änderung ist noch keine Stunde alt. Erst das prüfen, dann JAMIE komplett
     schließen und neu öffnen. Bleibt es → Screenshot an Tobi (er sieht in Sentry,
     welches Abo fehlt).
   - **Kein „JAMIE Pro"-Eintrag in den Einstellungen** → der Fix fehlt im Build
     (Schritt 1) oder Tobis Schalter ist aus → Tobi.
2. Ganz unten im Pro-Fenster **„AGB"** und **„Datenschutz"** antippen — beide müssen
   die Seite in Safari öffnen.
3. **Screenshots für Apple (optional):** ganz nach oben scrollen, sodass
   „MORE PEOPLE. / MORE PLACES.", die drei Vorteile und alle drei Tarife mit Preisen
   zu sehen sind. Knopf und Abo-Text passen nicht mit aufs Bild — das ist normal und
   für Apple nicht nötig. Je einen Screenshot mit „1 Monat", „6 Monate" und „1 Jahr" angetippt.
   Willst du Tobis Bilder damit ersetzen: **gleich jetzt** unter **Monetarisierung →
   Abonnements** beim passenden Abo den Review-Screenshot tauschen und **Sichern**
   (nach dem Einreichen geht das nicht mehr, und in Schritt 7 kostet jeder
   Seitenwechsel ungesicherte Eingaben).
4. „6 Monate" angetippt → **„Weiter"** (eine Checkbox gibt es **nicht mehr** — der
   Knopf ist sofort aktiv) → Apple-Kaufbogen bestätigen.
5. Krone mit **Konfetti**; in den **Einstellungen** steht **„JAMIE Pro · Aktiv"**
   und **„Abo im App Store verwalten"** (kein JAMIE-Kündigen-Knopf, richtig so).
6. **„Käufe wiederherstellen"** → „1 Kauf wiederhergestellt".

**iOS 27 — der wichtigste Test dieses Updates:** Wer im Team hat ein iPhone mit
**iOS 27** (Einstellungen → Allgemein → Info → iOS-Version)? Diese Person installiert
den Build über TestFlight und öffnet JAMIE: Die App **muss normal starten**. (Zum
Vergleich: 1.4.3 aus dem App Store geht dort sofort wieder zu.) Startet auch 1.4.4 nicht
→ **STOPP, Tobi**. Hat niemand iOS 27: Tobi Bescheid sagen, dann bitten wir eine
betroffene Nutzerin um den TestFlight-Test.

**Neue Anmeldung (deine Checkliste vom 10.10.):** Mit einer **neuen** E-Mail-Adresse
ein Test-Konto anlegen (z. B. `tina+test1@…`; danach unter Einstellungen wieder löschen).
1. Registrierung hat **4 Seiten**: „Wer bist du?“ (Name + E-Mail) → Code → „Ein bisschen
   über dich“ (Geburtsdatum + Geschlecht als Bubbles) → Passwort. Erledigte Striche oben
   werden **grün**. Beim Code steht die E-Mail mit Leerzeichen („an … gesendet.“).
2. Nach „Konto erstellen“ kommt das **Intro (3 Folien)**, danach **„Was trifft zu?“ 1 / 4**.
   Zwischendurch darf **kein** Fenster „Magst du ein Profilbild ergänzen?“ aufgehen (auch
   nicht nach ein paar Sekunden Warten auf Schritt 1).
3. „Was trifft zu?“ → mind. eine Antwort; „Worauf hast du Lust?“ → mind. 3; „Erzähl uns
   etwas über dich“ → Wohnort (Vorschläge erscheinen erst, wenn Tobi Google Maps wieder
   freigeschaltet hat — sonst einfach eintippen); **Fotos** ist der letzte Schritt (4 / 4).
4. **Ohne** Profilbild „Los geht's!“ tippen → Fenster **„Achtung: Dein Profil ist nicht
   vollständig“**. „Profilbild hinzufügen“ muss **sofort** die Foto-Auswahl öffnen; ein
   Foto wählen → das Bild erscheint im runden Feld, darunter „Profil vollständig“, danach
   geht es automatisch weiter.
5. Es folgt **„Clubs für dich“** (JAMIE Groups Official zuerst — sobald die Liste im
   Admin-Dashboard gepflegt ist; ist sie leer, geht es direkt auf Home). „Beitreten“ bei
   einem Club → „Dabei“. „Weiter“ → Home, ohne Profil-Hinweis.
6. Zweites Test-Konto, diesmal bei Schritt 4 **„Überspringen“** → Clubs-Seite mit
   Achtung-Kasten, Home zeigt oben „Achtung: Dein Profil ist nicht vollständig“.
Hakt etwas → Uhrzeit + Screenshot an Tobi.

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
- **Fotos umreihen (neu):** Profil → Bearbeiten → ein Profilfoto antippen (orangener
  Rahmen) → unten erscheinen ‹ · „Als Profilbild" · › · „Fertig". Ein Foto nach vorne
  schieben, **Speichern** → auf deinem Profil steht es an der neuen Stelle. Danach
  wieder zurück, wie es war. Bei der Pinnwand heißt der Knopf „Ganz nach vorne".
- **Event-Größe (neu):** In einem Club-Event, das du verwaltest → Bearbeiten →
  **„Max. Teilnehmer"**: „+" geht über 20 (ab 20 in Fünferschritten), **Speichern** →
  die neue Zahl steht beim Event. „−" geht nie unter die Zahl, die schon dabei ist.
- **Interessen (neu):** Profil → Bearbeiten → Interessen: „Mode" **und** „Brettspiele"
  sind beide da.

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
   • Großes Update: Entdecken heißt jetzt „Community“ mit Communities & Clubs, und die Compass-Seite wird zu Memories | Friends – teile Fotos vergangener Treffen und finde Freunde
   • Neues Profil: Meet-ups, Friends & Memories auf einen Blick, Memories bearbeiten und „Meine Gruppen & Clubs“ verwalten
   • Als Mitglied siehst du jetzt wieder alle Mitglieder deiner Gruppen & Clubs
   • JAMIE Pro jetzt auch auf dem iPhone – als Abo über Apple, jederzeit kündbar
   • Gruppen-Chat mit Profilbildern, Club-Event-Chats in der Chatliste, kürzere Anmeldung
   • Behebt einen Fehler, durch den sich JAMIE auf iOS 27 nicht öffnen ließ
   ```

   **Englisch**:

   ```
   • Big update: Discover is now “Community” with communities & clubs, and the compass page becomes Memories | Friends – share photos of past meet-ups and find friends
   • New profile: meet-ups, friends & memories at a glance, edit your memories and manage “My groups & clubs”
   • As a member you can now see all members of your groups & clubs again
   • JAMIE Pro now on iPhone – as a subscription through Apple, cancel anytime
   • Group chats with profile pictures, club event chats in your chat list, shorter sign-up
   • Fixes an issue that kept JAMIE from opening on iOS 27
   ```

   **Italienisch** (falls das Feld da ist):

   ```
   • Grande aggiornamento: Scopri ora si chiama “Community” con communities & club, e la pagina bussola diventa Memories | Friends – condividi le foto dei meet-up passati e trova amici
   • Nuovo profilo: meet-up, amici e memories a colpo d’occhio, modifica le tue memories e gestisci “I miei gruppi & club”
   • Come membro ora vedi di nuovo tutti i membri dei tuoi gruppi & club
   • JAMIE Pro ora anche su iPhone – abbonamento tramite Apple, disdici quando vuoi
   • Chat di gruppo con foto profilo, chat degli eventi dei club nell’elenco, registrazione più breve
   • Risolto un problema per cui JAMIE non si apriva su iOS 27
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
   Demo-Account anmelden: **Einstellungen → „JAMIE Pro"** muss das Abo-Fenster mit den
   drei Tarifen öffnen (steht dort stattdessen „JAMIE Pro · Aktiv", hat der
   Demo-Account schon Pro → **STOPP, Tobi**). Dabei **nicht** „Käufe
   wiederherstellen" tippen (das würde dein Test-Abo aus h auf den Demo-Account
   übertragen). Danach abmelden und wieder mit deinem Account anmelden.
   Notiz:
   `Login via e-mail only on iOS. This version adds JAMIE Pro, three auto-renewable subscriptions submitted with this version: Settings → "JAMIE Pro". "Restore Purchases" is in the same sheet and in Settings. The demo account has no subscription.`
10. **Veröffentlichung der Version**: automatisch, **phasenweise Veröffentlichung AUS**.
11. Oben rechts noch einmal **„Sichern"**. **Letzter Blick vor dem Einreichen:** Steht
    unter **Build** dein 1.4.4-Build, und stehen unter **„In-App-Käufe und
    Abonnements"** (bzw. in der Einreichung) alle drei: `pro_monthly`, `pro_sixmonth`,
    `pro_yearly`? Apple meckert nicht, wenn sie fehlen — dann gingen die Abos wieder
    nicht mit. Fehlt etwas → **STOPP, Tobi**. Sonst **„Zur Prüfung hinzufügen" / „Bei
    App-Review einreichen"**.

12. **Beschleunigte Prüfung beantragen** (gleich nach dem Einreichen):
    https://developer.apple.com/contact/app-store/?topic=expedite → „Request an expedited
    app review“ → App **JAMIE**, Plattform iOS, Version **1.4.4**, Grund **„Critical bug
    fix“**, Text:
    `Version 1.4.3 does not launch on devices running iOS 27 - the app terminates immediately at launch, so affected users cannot use JAMIE at all. Version 1.4.4 fixes this.`

Review dauert meist unter 24 h, bei den ersten Abos manchmal etwas länger. Nach Freigabe
wird automatisch veröffentlicht. **Dann Tobi Bescheid sagen.**

---

## Wenn etwas schiefgeht — Kurzhilfe

| Problem | Lösung |
|---|---|
| Tobi hat noch nicht „gepusht + live + Schalter an" gesagt | Warten |
| Preflight: „❌ Xcode 27 … is active" | Schritt 0 (Xcode 26), dann Preflight nochmal |
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
| Kein „JAMIE Pro"-Eintrag in den Einstellungen | Fix fehlt im Build (Schritt 1), oder Kauf-Schalter in Railway aus → Tobi |
| Pro-Fenster sieht noch alt aus (Krone statt „MORE PEOPLE.") | `git pull` hat nicht geklappt (Schritt 1, heroTitle1-Check) → nicht einreichen |
| Kein ⊕ für 1.4.4 in Schritt 7 | 1.4.3 ist noch nicht im App Store → warten. Abgelehnt → Begründung an Tobi |
| Apple-Review lehnt ab | Begründung als Screenshot an Tobi |

**Was du NICHT anfassen musst:** Android (läuft über den Web-Deploy), Server/Railway
und die Kauf-Schalter (Tobi), der Apple-Push-Key im Developer-Portal.
