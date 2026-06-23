# 🍎 JAMIE im App Store — Plan für Tina

**Für wen:** Tina (du hast den Mac + den Apple-Developer-Account).
**Wann starten:** sobald der **Apple-Developer-Account freigegeben** ist.
**Ziel:** JAMIE in den Apple App Store bringen.

Dieser Plan ist die **verständliche Schritt-für-Schritt-Reihenfolge**. Die
technischen Details zu jedem Punkt stehen in
[app-store-checklist.md](app-store-checklist.md) — die brauchst du nur, wenn ein
Schritt ins Detail geht. Tobi hilft bei allem mit „💻"-Markierung.

> **Kurz vorab — wer macht was?**
> - 🍏 **Tina** = alles im Browser (App Store Connect, Apple-Portal) + der Mac steht bei dir.
> - 💻 **Tobi** = Code/Server (braucht keinen Mac) — macht er parallel von sich aus.
> - 🤝 **Gemeinsam** = einmal zusammen am Mac (am besten per Bildschirm-Teilen),
>   weil das Hochladen der App über das Programm **Xcode** läuft.

---

## ⚠️ Was VOR dem iOS-Launch geklärt sein muss

Damit es keine bösen Überraschungen gibt — bitte vorher lesen:

1. **In-App-Käufe: ERLEDIGT ✅ — kein Blocker mehr.**
   Die Bezahl-Funktionen (Boosts & JAMIE Pro) zeigen seit dem letzten Build
   überall **„Bald verfügbar"** statt einer echten Zahlung — Stripe **und** der
   iOS-Kauf sind komplett deaktiviert (`PAYMENTS_ENABLED = false`). Apple sieht
   also **keine** Kauf-Fläche und kann die App deshalb **nicht** wegen IAP
   ablehnen. Bezahlung kommt in einem Update 1–2 Monate nach Launch (💻 Tobi
   stellt dann 1 Zeile um). → Phase 4 Punkt 5 (Kauf-Produkte anlegen) **entfällt**
   für v1; die `APPLE_IAP_*`-Server-Variablen ebenfalls.
2. **Apple-Team-ID** (eine 10-stellige Kennung, die du mit dem Account bekommst)
   muss an einer Stelle im Code eingetragen werden, sonst funktionieren
   Passwort-Zurücksetzen & E-Mail-Bestätigung auf dem iPhone nicht (💻 Tobi,
   sobald du ihm die ID gibst).
3. **Screenshots** in der richtigen Größe (iPhone 6,9") müssen erstellt werden —
   das geht am Mac mit dem iPhone-Simulator (🤝 gemeinsam).

---

## Phase 1 — Account & App anlegen  🍏 Tina

Sobald Apple den Account freigeschaltet hat:

1. Auf **appstoreconnect.apple.com** einloggen.
2. **Deine Team-ID notieren** (oben rechts unter „Membership" / Mitgliedschaft —
   10 Zeichen) → **an Tobi schicken** (er braucht sie, siehe Phase 2).
3. **Neue App anlegen:** „Meine Apps" → „+" → Name **JAMIE – Social Activity App**,
   Sprache **Deutsch**, Bundle-ID **jamie.app**, Plattform **iOS**.

*Dauer: ~20 Min.*

---

## Phase 2 — Technische Vorbereitung  💻 Tobi (parallel, ohne Mac)

Sobald Tobi die Team-ID von dir hat, erledigt er ohne Mac:

- Team-ID an der nötigen Code-Stelle eintragen und neu veröffentlichen
  (für die iPhone-Deep-Links).
- Server-Variablen für **iOS-Push-Benachrichtigungen** setzen (sobald du ihm den
  Push-Schlüssel aus Phase 3 gibst).
- Entscheidung/Fix zu den **In-App-Käufen** (siehe Blocker #1 oben).

*Du musst hier nichts tun — nur die Team-ID (Phase 1) und den Push-Schlüssel
(Phase 3) an Tobi weitergeben.*

---

## Phase 3 — Schlüssel erzeugen & App hochladen  🤝 Gemeinsam am Mac

Das ist der technischste Teil. Am besten macht ihr das **zusammen** (Tobi per
Bildschirm-Teilen, du klickst am Mac).

1. **Push-Schlüssel erzeugen** (im Apple-Portal, Browser): developer.apple.com →
   „Keys" → neuen Schlüssel für **APNs** (Push) anlegen → die `.p8`-Datei
   herunterladen → **an Tobi geben** (er trägt sie am Server ein). 🍏→💻
2. **Xcode** (Apples Entwickler-Programm) aus dem Mac App Store installieren,
   falls noch nicht da.
3. 💻 Tobi baut mit dir zusammen die App fertig und lädt sie über Xcode in
   App Store Connect hoch („Archive → Distribute"). Dabei wird auch die
   Signatur mit deinem Account gesetzt. *(Details: Abschnitt „Build" +
   „TestFlight" in der Checkliste.)*

*Dauer: ~1–2 Std. beim ersten Mal.*

---

## Phase 4 — Store-Eintrag füllen  🍏 Tina

Das kannst du gut allein im Browser machen — Texte stehen fertig in der
[Checkliste](app-store-checklist.md) (Abschnitt „App Store Connect metadata"):

1. **Beschreibung, Untertitel, Schlagwörter** einfügen (Copy-&-Paste aus der Checkliste).
2. **Drei URLs** eintragen (alle vorhanden):
   - Support: `https://app.jamie-app.com/privacy`
   - Datenschutz: `https://app.jamie-app.com/privacy`
   - Marketing: `https://app.jamie-app.com`
3. **Screenshots** hochladen (aus Phase 3 / Simulator, mind. 3 pro Größe).
4. **„App-Datenschutz"-Fragebogen** ausfüllen — die Tabelle dazu steht in der
   Checkliste (Abschnitt „App privacy"). Wichtig: muss zu unserer
   Datenschutz-Seite passen.
5. Falls die Käufe doch mitkommen: die **6 Kauf-Produkte** anlegen (Boosts + Pro,
   exakte Namen/Preise in der Checkliste).

*Dauer: ~45 Min.*

---

## Phase 5 — Testkonto, Einreichen & Review  🍏 Tina

1. **Apple-Testkonto** vorbereiten: Apple-Prüfer testen die App mit einem von uns
   gestellten Login (`review@jamie-test.com`) — Passwort setzen, Profil & eine
   Gruppe vorbereiten (Details in der Checkliste).
2. **TestFlight**: erst intern testen (Login, Gruppe erstellen, Chat, Push
   ausprobieren), dann …
3. **Zur Prüfung einreichen** („Submit for Review"). Apple prüft i. d. R. 1–3 Tage.
4. Bei Nachfragen/Ablehnung: Apple schreibt genau, was fehlt → 💻 mit Tobi
   beheben und erneut einreichen.

---

## Fertig 🎉

Wenn Apple „Approved" meldet, kannst du die App auf „Veröffentlichen" stellen —
und JAMIE ist im App Store.

---

### Reihenfolge auf einen Blick

| Phase | Wer | Inhalt |
|---|---|---|
| 1 | 🍏 Tina | Account prüfen, **Team-ID an Tobi**, App anlegen |
| 2 | 💻 Tobi | Team-ID einbauen, Server-Variablen, Käufe-Entscheidung |
| 3 | 🤝 Gemeinsam | Push-Schlüssel, Xcode, App hochladen |
| 4 | 🍏 Tina | Texte, URLs, Screenshots, Datenschutz-Fragebogen |
| 5 | 🍏 Tina | Testkonto, TestFlight, Einreichen |

**Voraussetzung für Phase 1:** Apple-Developer-Account ist freigegeben.
**Größtes Risiko früher (IAP) ist erledigt** — Bezahlung ist für v1 ausgeblendet.
**Jetzt wichtigster Technik-Punkt (💻 Tobi, am Mac):** das iOS-Projekt wird
erstmalig erzeugt (`npx cap add ios`) und braucht 3 Einträge in der Info.plist
(Kamera-, Fotos-, Standort-Begründung) + die Berechtigungen Push, „Associated
Domains" und „Sign in with Apple". Siehe app-store-checklist.md → Build.
