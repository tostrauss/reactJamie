# Google-Play-Mail „Registriere deine Apps und Signaturschlüssel bis 30.09.2026"

Stand: **04.09.2026** · Mail vom 04.09., 06:41 an `office@impibag.com` ·
Tina hat sie weitergeleitet und gefragt, was zu tun ist.

## Kurzfassung

Google führt die **Android-Entwickler-Verifizierung** ein: Jede App muss künftig
einem verifizierten Entwicklerkonto zugeordnet sein — über den Paketnamen plus
den SHA-256-Fingerprint des Signaturschlüssels.

Für JAMIE ist das mit hoher Wahrscheinlichkeit **schon erledigt**: Wir laden ein
AAB hoch und nutzen damit **Play App Signing** — Google hält unseren
Signaturschlüssel selbst und registriert solche Apps automatisch (Google: ~99 %
der Play-Apps sind automatisch registriert). Es bleibt ein **Kontrollblick in
der Play Console**, kein Build, kein Code, kein neues Release.

**Dringlichkeit:** niedriger als die Mail klingt. Der 30.09.2026 ist der
Stichtag für **Brasilien, Indonesien, Singapur und Thailand** — dort können
teilnehmende Stores unregistrierte Apps ab dann nicht mehr normal installieren.
**Unsere Märkte (AT/DE/CH/IT/FR/ES) sind erst mit der globalen Ausweitung ab
2027 dran.** Trotzdem: der Check kostet 10 Minuten, also vor dem 30.09. machen.

## Feste Werte (nur zum Abgleichen, nichts ändern)

| Was | Wert |
|---|---|
| Android-App (Play) | JAMIE, Paketname `jamie.app` |
| Signierung | Play App Signing (AAB-Upload über Bubblewrap/TWA) |
| SHA-256 #1 | `FD:AC:47:AA:56:02:3C:AC:AA:B4:BD:0D:08:26:73:0D:04:97:9B:E2:1B:0F:6E:82:C4:01:F1:54:0C:96:0F:62` |
| SHA-256 #2 | `B3:D5:E9:53:7D:D2:67:6B:FF:65:4D:CC:51:8F:F9:87:7A:59:8A:D6:57:8D:55:EE:1A:50:CC:13:FC:89:02:CB` |
| Play-Konto | IMPIBAG e.U., Konto-Mail `office@impibag.com` |

Die beiden Fingerprints stehen in `frontend/public/.well-known/assetlinks.json`
(App-Signing-Key + Upload-Key). Nur falls die Console einen Schlüssel manuell
verlangt, werden sie gebraucht — bei Play App Signing normalerweise nicht.

## Was zu tun ist (Play Console, ~10 Minuten)

1. **Identität des Kontos prüfen.** Play Console öffnen → Startseite/Home. Wenn
   dort ein Banner zur Entwickler-Verifizierung steht, dieses zuerst abarbeiten.
   Das ist der einzige Schritt, der dauern kann (Google will ggf. Ausweis- bzw.
   Firmendokumente sehen) — deshalb zuerst.
2. **App-Status prüfen.** In der Play Console die Seite **„Android developer
   verification" / „Android-Entwickler-Verifizierung"** öffnen. Dort steht neben
   jeder App der Status. Bei `jamie.app` muss **„Registriert"** stehen.
3. **Nur falls „Nicht registriert" dort steht:** die App über den Button auf
   derselben Seite registrieren. Paketname `jamie.app`; falls ein
   Signaturschlüssel abgefragt wird, die SHA-256 aus der Tabelle oben nehmen
   (Play Console → Release → Setup → App-Integrität zeigt denselben Wert).

Danach ist nichts weiter zu tun: Jeder künftige Build, der mit demselben
Schlüssel signiert ist, gilt automatisch als registriert.

## Was NICHT nötig ist

- Kein neues App-Bundle, kein neuer Release, kein Code am Repo.
- Kein neuer Keystore. **Den vorhandenen Keystore auf keinen Fall neu erzeugen**
  — ein verlorener Signaturschlüssel bedeutet, dass das Paket nicht mehr
  registriert werden kann.
- Die iOS-App ist davon nicht betroffen (Apple-Thema, eigener Prozess).

## Quellen

- Understanding Android developer verification (Google-Support):
  <https://support.google.com/android-developer-console/answer/16561738>
- FAQ „Android developer verification" (developer.android.com):
  <https://developer.android.com/developer-verification/guides/faq>
- Android Developers Blog, 06/2026 — Launchländer + Zeitplan:
  <https://android-developers.googleblog.com/2026/06/android-developer-verification.html>
