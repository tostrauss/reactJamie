# Google-Play-Mail „Registriere deine Apps und Signaturschlüssel bis 30.09.2026"

Stand: **04.09.2026** · Mail vom 04.09., 06:41 an `office@impibag.com` ·
Tina hat sie weitergeleitet und gefragt, was zu tun ist.

## Ergebnis: erledigt, nichts zu tun

Geprüft am 04.09.2026 in der Play Console unter **Android developer
verification**:

| Paketname | Status | Keys | Zuletzt aktualisiert |
|---|---|---|---|
| `jamie.app` (JAMIE – Aktivitäten & Gruppen) | ✅ **Registered** | 1 | 01.07.2026 |

Das war Automatik: Wir laden ein AAB hoch und nutzen damit **Play App Signing** —
Google hält unseren Signaturschlüssel selbst und registriert solche Apps von sich
aus. Die Mail ist ein Serienrundschreiben an alle Entwickler, kein Hinweis auf
ein offenes Problem bei uns.

## Worum es geht (und was der Stichtag wirklich bedeutet)

Google führt die **Android-Entwickler-Verifizierung** ein: Jede App muss einem
verifizierten Entwicklerkonto zugeordnet sein — über den Paketnamen plus den
Fingerprint des Signaturschlüssels. Zwei verschiedene Konsequenzen ab
**30.09.2026**, die gern verwechselt werden:

- **Google Play, weltweit:** Play-Apps, die bis dahin nicht registriert sind,
  werden **global aus dem Store entfernt** (angekündigt am 15.07. als aktualisierte
  Play-Console-Anforderung). Das gilt für alle Märkte, auch AT/DE/CH/IT/FR/ES.
- **Andere Stores / Sideload, ausgewählte Länder:** Nicht registrierte Apps aus
  teilnehmenden Fremdstores lassen sich auf zertifizierten Android-Geräten in
  Brasilien, Indonesien, Singapur und Thailand nicht mehr normal installieren.
  Diese Länderliste betrifft **nicht** die Play-Auslieferung.

Für JAMIE ist beides gegenstandslos, solange der Status oben „Registered" bleibt.

## Feste Werte (nur zum Abgleichen, nichts ändern)

| Was | Wert |
|---|---|
| Android-App (Play) | JAMIE, Paketname `jamie.app` |
| Signierung | Play App Signing (AAB-Upload über Bubblewrap/TWA) |
| SHA-256 #1 (App-Signing-Key, registriert) | `FD:AC:47:AA:56:02:3C:AC:AA:B4:BD:0D:08:26:73:0D:04:97:9B:E2:1B:0F:6E:82:C4:01:F1:54:0C:96:0F:62` |
| SHA-256 #2 (Upload-Key) | `B3:D5:E9:53:7D:D2:67:6B:FF:65:4D:CC:51:8F:F9:87:7A:59:8A:D6:57:8D:55:EE:1A:50:CC:13:FC:89:02:CB` |
| Play-Konto | IMPIBAG e.U. / JAMIE.groups, Konto-Mail `office@impibag.com` |

Beide Fingerprints stehen öffentlich in `assetlinks.json` auf jamie-app.com.
Registriert ist **einer** (der App-Signing-Key) — das ist korrekt so: der
Upload-Key signiert nichts, was außerhalb von Play ausgeliefert wird. Ein
zweiter Schlüssel wäre erst zu registrieren, wenn wir die App je direkt als APK
verteilen (eigener Download, Fremdstore).

## Nachprüfen (falls je eine zweite App dazukommt)

1. Play Console → linke Leiste ganz unten **„Android developer verification"**.
2. In der Tabelle muss neben jedem Paketnamen **„Registered"** stehen.
3. Falls nicht: Button **„Register package name"** rechts oben; Paketname
   eintragen und, wenn ein Schlüssel abgefragt wird, den SHA-256 des
   App-Signing-Keys nehmen (Play Console → Release → Setup → App-Integrität).

## Was NICHT nötig ist

- Kein neues App-Bundle, kein neuer Release, keine Code-Änderung.
- **Keinen neuen Keystore erzeugen** — ein verlorener Signaturschlüssel bedeutet,
  dass das Paket nicht mehr registriert werden kann.
- Die iOS-App ist nicht betroffen (Apple-Thema, eigener Prozess).

## Nicht verwechseln: die rote „Action by 31 Aug"-Karte

Auf der Play-Console-Startseite steht weiterhin eine rote Karte „Update your
target API level by 31 August 2026". Die ist **vom 21.07. und erledigt**:
Commit `a27dc3b` (30.07.) hebt `targetSdkVersion` auf 36 und `versionCode` auf
10, dieser Build ging am 30.07. in die Produktion (Dashboard: „Released on
30 Jul 2026", 100 %). Play-Benachrichtigungen verschwinden nicht von selbst —
die Karte kann über das Mülleimer-Symbol weg. Gegenprobe: Test and release →
Production → aktuelle Version = `versionCode 10`.

## Quellen

- Play Console → Android developer verification (maßgeblich, dort steht der
  Status)
- FAQ „Android developer verification":
  <https://developer.android.com/developer-verification/guides/faq>
- Android Developers Blog, 06/2026 — Ökosystem-Zeitplan und Launchländer:
  <https://android-developers.googleblog.com/2026/06/android-developer-verification.html>
