# Rollback-Runbook — Railway (Web + API)

**Zweck:** Ein schlechter Deploy während Last (2M2M!) braucht einen GEPROBTEN
Weg zurück, nicht Improvisation. Dieses Runbook ist der Weg. Einmal im Ruhigen
durchspielen (Schritt 6), damit es im Ernstfall Muskelgedächtnis ist.

**Gilt für:** den einen Railway-Service (API + PWA aus einem Docker-Image).
**Nicht abgedeckt:** iOS-Binary (App-Store-Review, Tage — deshalb Web-Fixes
immer zuerst; Android/TWA + PWA folgen dem Web-Deploy sofort).

---

## 1. Entscheiden (≤ 2 Minuten)

Rollback JA, wenn nach einem Deploy:
- `/api/health` 503/`degraded` liefert (neu: auch bei fehlgeschlagener
  Schema-Assertion oder fehlendem Redis bei `REQUIRE_REDIS=true`), ODER
- Sentry eine neue Fehlerwelle zeigt, die es vor dem Deploy nicht gab, ODER
- ein Kernpfad (Login, Feed, Chat senden, Join) reproduzierbar bricht.

Kein Rollback für Kleinkram, der mit einem Forward-Fix in <30 min lösbar ist —
Rollback ist für "es brennt und die Ursache ist der letzte Deploy".

## 2. Rollback ausführen (Railway UI, ~1 Klick)

1. Railway → Projekt → Service → **Deployments**.
2. Den letzten GRÜNEN Deploy vor dem kaputten suchen (Zeitstempel + Commit-SHA
   prüfen — steht auch im Boot-Log: `Server running on port … — version <sha>`).
3. Drei-Punkte-Menü → **Redeploy** (bzw. „Rollback to this deployment").
4. Warten bis der Healthcheck grün ist (railway.toml: `/api/health`, 30s).

CLI-Alternative: `railway redeploy --service <service-id>` (re-deployt die
AKTUELLE Version — für echtes Zurück die Deployment-ID aus `railway status`
verwenden).

## 3. Verifizieren (≤ 5 Minuten)

- [ ] `curl -s https://app.jamie-app.com/api/health` → `{"status":"ok"}`
- [ ] Boot-Log zeigt die ERWARTETE (alte) `version <sha>`.
- [ ] Ein Login + ein Feed-Load + eine Chat-Nachricht in einer echten Session.
- [ ] Sentry: neue Fehlerwelle abgeebbt (5-min-Fenster beobachten).

## 4. Datenbank-Kaveat (wichtig, aber entspannt)

Migrationen sind **forward-only und idempotent** (CREATE/ALTER IF NOT EXISTS,
log-and-continue) und laufen bei jedem Boot. Ein CODE-Rollback ist deshalb
sicher: alte Code-Version + neuere Spalten koexistieren (Spalten werden nie
umbenannt/gelöscht, nur ergänzt). NIEMALS versuchen, das Schema „mitzurollen".
Ausnahme-Radar: eine Migration, die Daten UMSCHREIBT (one_shot_migrations) —
vor deren Deploy dieses Runbook um den Spezialfall ergänzen.

**Spezialfall Gratis-Grenze für Clubs (Tina-Update 17.11.2026).** Der erste Boot
des Updates setzt in `one_shot_migrations` den Stichtag
`2026-11-17_club_free_tier_start`; ab `applied_at` zählen neu angelegte
Club-Events gegen die Gratis-Grenze, und kein späterer Boot bewegt ihn. Wird
dieser Deploy zurückgerollt, läuft der alte Code ohne Grenze weiter, der
Stichtag bleibt aber stehen: Events, die Clubs bis zum nächsten Deploy anlegen,
zählen dann mit, ein Club könnte sofort gesperrt sein. Deshalb **nach einem
Rollback dieses Updates, vor dem nächsten Deploy**, in der Railway-DB:

```sql
DELETE FROM one_shot_migrations WHERE name = '2026-11-17_club_free_tier_start';
```

Der nächste Boot setzt den Stichtag neu. Schneller als ein Rollback ist bei
Ärger mit der Grenze der Not-Aus `CLUB_FREE_TIER=false` (Railway-Env, ohne
Deploy). Die übrigen Not-Aus-Schalter des Updates, alle standardmäßig an:
`CLUB_AUTO_MESSAGES`, `PARTNER_LEADS_NOTIFY`, `POST_EVENT_CONNECT`,
`EVENT_RATINGS`, `COMMUNITY_NUDGES`.

## 5. Wenn Rollback nicht reicht

- DB selbst kaputt/inkonsistent → **Restore-Runbook** in
  `BACKUP-SETUP-ANLEITUNG.md` (verschlüsselte Off-Site-Dumps, täglich 03:00).
- Env-Var-Änderung war die Ursache → Railway → Variables → History prüfen;
  Variable zurücksetzen schlägt Redeploy.

## 6. Probe (einmalig, vor 2M2M)

Im Ruhigen: aktuellen Deploy notieren → beliebigen älteren grünen Deploy
redeployen → Schritt 3 verifizieren → wieder vor. Dauer notieren (Ziel < 5
min end-to-end). Datum der letzten Probe hier eintragen:

- Letzte Probe: ____________  Dauer: ______  von: ______
