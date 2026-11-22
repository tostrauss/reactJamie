# iOS-Build über GitHub, ohne eigenen Mac

Stand **22.11.2026**. Ein Mac bei GitHub baut JAMIE und lädt den Build zu App Store
Connect hoch. Gestartet wird im Browser, das geht auch vom Lenovo aus. Für öffentliche
Repos kostet das nichts. Der Ablauf steht in `.github/workflows/ios-build.yml`.

Einmal einrichten (A–D), danach pro Build nur noch Schritt E.

---

## A. Xcode-Projekt ins Repo (einmalig, von Tina)

Das Xcode-Projekt (`frontend/ios`) gibt es bisher nur auf Tinas Mac. Sie öffnet das
Terminal und fügt diese Zeile ein:

```bash
cd ~/reactJamie/frontend && zip -r ~/Desktop/jamie-ios.zip ios -x "ios/App/Pods/*" "ios/App/App/public/*" "*xcuserdata*" "ios/App/build/*" "ios/DerivedData/*"
```

Die Datei `jamie-ios.zip` vom Schreibtisch schickt sie an Tobi. Claude entpackt sie nach
`frontend/ios`, prüft sie auf Geheimnisse und checkt sie ein; Tobi pusht.

**Danach bei Tina einmal, vor ihrem nächsten `git pull`:**

```bash
mv ~/reactJamie/frontend/ios ~/Desktop/ios-alt
```

Sonst bricht `git pull` ab, weil dieselben Dateien jetzt im Repo liegen. Baut sie
danach selbst, nimmt sie das Projekt aus dem Repo, sonst ändert sich für sie nichts.

## B. API-Schlüssel (einmalig, von Tina)

Nur die Kontoinhaberin oder ein Admin kann ihn erzeugen.

App Store Connect → **Benutzer und Zugriffsrechte** → **Integrationen** → **App Store
Connect API** → **Team-Schlüssel** → **+**. Fragt Apple zuerst nach einer Anfrage für
den API-Zugang: bestätigen. Dann:

- Name: `GitHub Build`
- Zugriff: **App-Manager**

**Generieren** → **API-Schlüssel laden**. Das geht nur **ein einziges Mal**. Tobi bekommt
(persönlich, nicht in die Gruppe):

1. die Datei `AuthKey_XXXXXXXXXX.p8`
2. die **Schlüssel-ID** (Key ID, Spalte in der Liste)
3. die **Aussteller-ID** (Issuer ID, steht über der Liste)

## C. Zertifikat und Profil (einmalig, Tobi am Lenovo, ca. 15 Minuten)

Voraussetzung: Unter https://developer.apple.com/account (oben rechts das Team
**Tina Glavanovitz** gewählt) gibt es **Zertifikate, IDs & Profile**. Fehlt der Punkt,
muss Tina bei Tobis Benutzer den Zugriff auf Zertifikate, IDs und Profile anhaken.

Git Bash im Projektordner (`C:\Users\tobia\Desktop\trys`) öffnen:

1. `bash ios/github-zertifikat.sh anfrage`
2. https://developer.apple.com/account/resources/certificates/add → **Apple
   Distribution** → Weiter → die Datei `~/jamie-ios-signing/distribution.certSigningRequest`
   hochladen → **Herunterladen** (`distribution.cer`).
   Meldet Apple, dass es schon zu viele Zertifikate gibt: mit Tina klären, welches
   weg kann. **Tinas eigenes Zertifikat nicht widerrufen**, sonst kann sie nicht mehr bauen.
3. `bash ios/github-zertifikat.sh p12 ~/Downloads/distribution.cer`
4. https://developer.apple.com/account/resources/profiles/add → unter Distribution
   **App Store Connect** → App-ID **com.jamie-app.app** → das neue Zertifikat aus 2.
   (Ablaufdatum in einem Jahr) → Name `JAMIE App Store GitHub` → **Generieren** →
   **Herunterladen**.
5. `bash ios/github-zertifikat.sh profil ~/Downloads/JAMIE_App_Store_GitHub.mobileprovision`

Alles liegt jetzt in `C:\Users\tobia\jamie-ios-signing`. Den Ordner aufheben (z. B. im
Passwortmanager sichern) und **nie ins Repo** legen. Ohne `distribution.key` ist das
Zertifikat nutzlos, dann C komplett neu.

## D. Secrets bei GitHub (einmalig, Tobi)

https://github.com/tostrauss/reactJamie/settings/secrets/actions → **New repository
secret**, sechsmal:

| Name | Wert |
|---|---|
| `IOS_DIST_P12_BASE64` | Inhalt von `jamie-ios-signing\IOS_DIST_P12_BASE64.txt` |
| `IOS_DIST_P12_PASSWORD` | Inhalt von `jamie-ios-signing\IOS_DIST_P12_PASSWORD.txt` |
| `IOS_APPSTORE_PROFILE_BASE64` | Inhalt von `jamie-ios-signing\IOS_APPSTORE_PROFILE_BASE64.txt` |
| `ASC_KEY_ID` | Schlüssel-ID aus B |
| `ASC_ISSUER_ID` | Aussteller-ID aus B |
| `ASC_KEY_P8` | ganzer Inhalt der `.p8`-Datei aus B, mit den Zeilen `-----BEGIN…` und `-----END…` |

Danach die `.p8` aus dem Chat bzw. den Downloads löschen (die Kopie in GitHub reicht;
im Notfall erzeugt Tina einen neuen Schlüssel).

## E. Jeder Build

1. Alles, was in den Build soll, ist auf `main` gepusht.
2. https://github.com/tostrauss/reactJamie/actions/workflows/ios-build.yml →
   **Run workflow** → eintragen:
   - **Version**: höher als die im App Store, z. B. `1.4.6`
   - **Build**: höchste Build-Nummer in TestFlight + 1, z. B. `19`
3. Dauert etwa 20–30 Minuten. Grüner Haken = hochgeladen. Rotes X = den roten Schritt
   aufklappen, Screenshot an Claude.
4. 15–45 Minuten später steht der Build in App Store Connect → **JAMIE → TestFlight**.
   Die Frage zur Verschlüsselung kommt nicht mehr (steht jetzt in der App: nur HTTPS).
   Testen wie in `store/IOS-UPDATE-TINA.md`, Schritt 5.
5. Einreichen wie dort in Schritt 7: Version anlegen, „Was ist neu“, Build wählen,
   Sichern, einreichen. Vorher müssen die Fragen zur Altersfreigabe (App-Informationen)
   beantwortet sein.

## F. Wenn es hakt

| Meldung im Lauf | Was tun |
|---|---|
| `Secret … fehlt` | Schritt D |
| `frontend/ios fehlt im Repo` | Schritt A |
| `Kein Xcode 26 auf diesem Runner` | GitHub hat das Image umgestellt → Claude fragen |
| `Profil ohne Push` | Profil neu erzeugen (C.4), Secret ersetzen |
| Archivieren: `No signing certificate` / `doesn't include signing certificate` | Das Profil gehört zu einem anderen Zertifikat → C.4 mit dem Zertifikat aus C.2 |
| Hochladen: Build-Nummer `already been used` / `must be higher` | Build + 1, neu starten |
| Hochladen: `401` / `403` / `authentication` | Secrets aus B/D prüfen, Zugriff des Schlüssels = App-Manager |
| `expired` (nach einem Jahr) | Zertifikat und Profil laufen ab → C neu, die drei Secrets ersetzen |

## Warum so

- **Kein Xcode Cloud:** Die erste Einrichtung geht nur in Xcode, also an einem Mac.
- **Eigenes Zertifikat statt Signieren durch Apple:** Das Signieren in Apples Cloud
  klappt per API-Schlüssel laut Entwicklerforum nur mit einem Admin-Schlüssel, und auch
  dann nicht immer. Mit eigenem Zertifikat und Profil braucht der Schlüssel nur
  App-Manager, zum Hochladen.
- **Xcode 26, nicht 27:** Ohne Umbau auf das neue Start-Verfahren (UIScene) startet ein
  Xcode-27-Build auf iOS 27 nicht (`store/IOS-UPDATE-TINA.md`, Schritt 0).
- **Öffentliches Repo:** Die Läufe und Logs sieht jeder, die Secrets nicht. Darum
  startet der Build nur von Hand und legt keine Dateien zum Herunterladen ab.
