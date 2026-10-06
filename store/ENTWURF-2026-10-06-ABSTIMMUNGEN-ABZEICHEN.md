# Entwurf 06.10.2026 — Abzeichen-Stufen (B2) und Abstimmungen im Chat (B1)

Anlass: Tester-Feedback vom 06.10.2026 („Abstimmungsfunktion für Terminfindung
oder Aktivitätsplanung“, „Haken bekommt man schon nach einem Treffen … ab 5 🏅,
ab 10 🏆, ab 100 🎆“). Hier stehen nur die tragenden Entscheidungen. Je Feature
wurden drei unabhängige Entwürfe (MVP / Risiko / Nutzer) gegen den Code erstellt,
von einer Jury bewertet und zu einer Spezifikation zusammengeführt.

## B2 — Abzeichen-Stufen

| Frage | Entscheidung | Warum |
|---|---|---|
| Was zählt als „Treffen“? | Ein Event zählt für Person X, wenn **andere** Teilnehmer X nach dem Event mit ✓ bestätigt haben und ✓ **strikt mehr** sind als ✗. Gleichstand zählt nicht. | Genau der Kern des Feedbacks: wer zusagt und nicht kommt, bekommt ✗ und damit keine Stufe. Zusagen und Mitgliedschaften werden nie gelesen. |
| Welche Events? | Nur Gruppen-Events (`type='group'`), keine Club-Events, nicht abgesagt, nicht „hat nicht stattgefunden“. Nach wöchentlichen Serien wird nie gefragt. Vor dem Ende des Event-Tags gelöscht = nie passiert, danach aufgeräumt = zählt weiter (Wiener Kalendertage). | Gemeinsame SQL-Bausteine (`countableEventSql`, `reviewableEventSql`) für Review-Prompts und Schreibsperre: Die App fragt nie nach einem Event, das nicht zählen kann. |
| Wann zählt ein Treffen? *(nach Review)* | Erst wenn die Abfrage „Wer war dabei?“ geschlossen ist: 14 Tage nach dem Event (`REVIEW_WINDOW_DAYS`, dasselbe Fenster wie die Prompts). Die eigene Karte erklärt das. | Das Modal verspricht „Deine Angaben sind anonym“. Eine Zahl, die sich mit jeder Stimme bewegt (+1, dann −1), verriete, wann jemand ✗ angekreuzt hat. Eine geschlossene Runde ändert die Zahl genau einmal, mit endgültigen Stimmen. Umkehrbar: eine Konstante. |
| Wer darf abstimmen? *(nach Review)* | Nur wer bis zum Ende des Event-Tags Mitglied war, nie über jemanden, mit dem eine Blockierung besteht (beide Richtungen), nur in offener Runde. Entschieden beim **Schreiben**, nicht beim Lesen. | Sonst könnte man einem vergangenen öffentlichen Event nachträglich beitreten und Freunde hinein- oder echte Teilnehmer hinausstimmen; ein ✗ kostet jetzt ein Treffen. Beim Lesen gefiltert, könnte ein Nicht-Erschienener ehrliche ✗ durch Blockieren löschen. |
| Owner bearbeitet ein vergangenes Event *(nach Review)* | Abgegebene Stimmen werden nach ihrem Zeitpunkt beurteilt, nicht nach dem änderbaren Datum: Verschieben, nachträglich „wöchentlich“ oder Löschen vor dem neuen Termin nimmt niemandem das Treffen. Dasselbe Datum erneut speichern ist keine Verschiebung (Server, gilt auch für alte iOS-Builds). | GroupEdit schickt immer das gespeicherte Datum mit; jede Bearbeitung eines vergangenen Events scheiterte, und der Ausweg (Datum verschieben / „wöchentlich“) löschte allen Teilnehmern das Treffen. |
| Gesperrte Konten | Stimmen gesperrter Konten zählen weiter, die gelöschter Konten nicht (CASCADE). | Sperren ist die umkehrbare Sanktion, oft wegen Belästigung, und darf echten Teilnehmern nichts wegnehmen. Gegen Farming-Ringe hilft Löschen. |
| Stufen | 🏅 ab 5, 🏆 ab 10, 🎆 ab 100 Treffen **und** mindestens 2 / 3 / 10 **verschiedene** Bestätiger. | Ohne Untergrenze könnten zwei Konten 🏆 in wenigen Tagen „farmen“. Echte Treffen mit 4–20 Leuten schaffen das nebenbei. Reine Server-Konstante, jederzeit änderbar. |
| Speichern oder berechnen? | **Beim Lesen berechnet**, eine gebündelte Abfrage pro Antwort, nur für die IDs, die die Antwort ohnehin enthält. Kein Backfill, keine neue Spalte. | Der Lesevorgang *ist* der Backfill: alle bisherigen Bestätigungen zählen ab dem ersten Request, idempotent, ohne Boot-Job. Keine neue Spalte in `SAFE_USER_COLS` (der Server nimmt Traffic vor den Migrationen an). Nachträgliches „nicht stattgefunden“ wirkt sofort. |
| Fehlerfall | Unbekannt ≠ 0: Bei Fehler fehlt das Feld, der eigene Endpunkt antwortet `200 {available:false}`. | Nie „0 Treffen“ behaupten. Nie 5xx auf GET (api.js wiederholt 5xx und zählt sie für den Circuit-Breaker). |
| Wer sieht was? | Andere sehen nur die **Stufe** (0–3), die Person selbst Anzahl + Fortschritt (`GET /api/reviews/attendance`), Admins zusätzlich die Anzahl. | Teilnahmezahlen sind Aktivitätsdaten. |
| Das Trusted-Häkchen | Bleibt unverändert sichtbar und unabhängig. **Eigener Commit:** die Neuberechnung wird monoton (`GREATEST` / `OR`). | „Bestandsnutzer verlieren nichts“: bisher konnte die nächste Bewertung ein von Admins gesetztes Häkchen entfernen, und ein gelöschtes Bestätiger-Konto senkte `trusted_count`. |
| Anzeige | Überall, wo heute das Häkchen ist: eigenes und fremdes Profil (Pill + Karte im Hall-of-Fame-Tab), Fotokacheln der Gruppe (Ecke), Mitgliederliste (Chip), Anfragen-Deck + Anfragen-Liste (Pill), Admin-Liste. Nicht im Feed (dort gibt es heute kein Häkchen, und der Feed ist der TV-Lastpfad). | — |
| Schema | Nur ein **optionaler** Covering-Index (`idx_event_reviews_votes`). Nichts in `schema.sql`, kein CRITICAL_SCHEMA_PROBE. | Fehlt der Index, liefert der vorhandene Index dasselbe Ergebnis. |

## B1 — Abstimmungen im Gruppen-/Club-Chat

| Frage | Entscheidung | Warum |
|---|---|---|
| Datenmodell | Eine Umfrage ist eine normale `messages`-Zeile (`message_type='poll'`) plus drei Seitentabellen (`message_polls`, `message_poll_options`, `message_poll_votes`), nur in `migrations.js`. | Sie erbt alles, was eine Nachricht hat: Reihenfolge, Ungelesen-Zähler, Chatliste, Antworten, Reaktionen, Melden (`'message'`), Admin-Löschen, Push. Kein DDL an `messages`. |
| Anlegen | Eigener Endpunkt `POST /api/messages/:groupId/polls`, ein atomares CTE. `POST /api/messages` lehnt `'poll'` weiter ab. | `sendMessage` bleibt unverändert (heißester Pfad). Eine Umfrage-Zeile ohne Umfragedaten kann es nicht geben. Der Zustellblock (Socket, Nudge, Push) wird als `deliverGroupMessage` herausgezogen, vorher durch einen Test festgenagelt. |
| Alte iPhones (1.4.1 bündelt den Web-Stand) | `content` ist eine vollständige, einzeilige Zeile: `📊 Frage — A · B · C` (📅 bei Terminen). Ergebnis beim Beenden als Systemzeile. | Alte Clients sehen Frage **und** alle Optionen als Text, können per Text antworten und erfahren das Ergebnis. Nichts kann abstürzen. |
| Arten | **Termin finden** (Datum + optionale Uhrzeit, immer Mehrfachauswahl, chronologisch sortiert) und **Abstimmung** (2–10 Textoptionen, Einfachwahl, optional „Mehrere Antworten erlauben“). | Terminfindung und Aktivitätsplanung aus dem Feedback. Typisierte Termine statt Freitext: sortierbar, lokalisierbar, Grundlage für ein späteres „Termin übernehmen“. |
| Stimmen | Eine Stimmzeile pro Person (PK, wie Reaktionen). **Anonym**: Zählungen + die eigene Auswahl, keine Namen. Gezählt werden nur **aktuelle** Mitglieder. | Namen würden den seit 21.09. Pro-pflichtigen Mitglieder-Überblick umgehen (Geld) und Block-Regeln berühren. Rausgeworfene Trolle entscheiden nicht über den Termin. Umkehrbar: eine spätere Namensliste gilt nur für neue Umfragen. |
| Gleichzeitigkeit | Pro Umfrage eine monotone `version`, im selben Statement wie jede Stimme erhöht. Clients übernehmen nur gleich neue oder neuere Stände. | Späte Socket-Events oder das Echo des eigenen früheren Tipps setzen die Anzeige nie zurück. Beenden vs. Abstimmen ist atomar. |
| Rechte | Anlegen = Senderechte (Mitglied; im Club mit „Nur Gründer schreibt“ nur der Gründer). Abstimmen = jedes aktuelle Mitglied (auch in Ankündigungs-Clubs). Beenden = Ersteller, Gründer, Co-Manager, App-Admin; endgültig. | Wie bei Nachrichten bzw. Reaktionen. |
| Moderation | Text bereinigen (Bidi-, Zero-Width-, Steuerzeichen) → prüfen → Mitgliedschaft → **ein** `checkTextSafety` über Frage + Optionen. Melden über das bestehende Long-Press-„Melden“. | Nicht-Mitglieder kosten keinen OpenAI-Aufruf. Admins sehen im Melde-Kontext alle Optionen (eigene Clip-Länge). |
| Limits | Anlegen: 60/min (Chat-Topf) + **10/h** eigener Topf. Abstimmen/Beenden: 60/min eigener Topf. | Jede Umfrage löst einen Push an die Gruppe aus. |
| Push / Socket | Anlegen wie eine Nachricht (Stummschaltung, Live-im-Raum, 30-s-Cooldown), lokalisierte Zeile je Art. Stimmen/Beenden: kein Push, nur `poll_update` an den Raum (ohne eigene Auswahl) und an `user_<ich>` (mit). Emit erst nach dem Schreiben, nie destrukturieren. | — |
| Boot-Fenster | Nichts, was Nachrichten liefert, hängt an den neuen Tabellen: `attachPolls` ist eine eigene, fehlerschluckende Abfrage und läuft nur, wenn die Seite Umfrage-Zeilen enthält. Schreiben ohne Tabellen → `503 POLLS_UNAVAILABLE`. | Wie bei den Reaktionen (17.09.). |
| Nicht in v1 | Wer-hat-abgestimmt-Liste, Wiedereröffnen, Bearbeiten, Fristen/Auto-Ende, „Termin übernehmen“, Umfragen in DMs. | Bewusst offen. Die Namensliste braucht eine Pro- und Datenschutz-Entscheidung. |

## Auslieferung

Web und Android (TWA) bekommen beides mit dem Deploy. **iPhones nur mit einem
neuen Build**, weil iOS das Web-Build bündelt. Bis dahin sehen sie Umfragen als
Textzeile und keine Stufen, verlieren aber nichts.
