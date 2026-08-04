# 🛠️ Backup-Einrichtung — Schritt-für-Schritt (für Tobi)

Diese Anleitung setzt das [BACKUP-KONZEPT.md](BACKUP-KONZEPT.md) **tatsächlich um**.
Danach läuft jede Nacht ein verschlüsseltes DB-Backup in einen unveränderbaren
30-Tage-Tresor — und die „Ja"-Antwort im Versicherungsfragebogen ist gedeckt.

- **Ohne Mac/Apple-Account machbar** — reine Web-/Infra-Arbeit.
- **Dauer:** ca. 45–60 Min.
- **Du brauchst:** eine **neue E-Mail-Adresse** (für das getrennte Cloudflare-Konto),
  einen Passwort-Manager, Admin-Rechte im GitHub-Repo. Für die optionalen
  CLI-Schritte: `aws` CLI + `openssl` (oder die Werte per Dashboard setzen).

> ⚠️ **Zwei Stolperfallen vorweg** (sonst scheitert Schritt 9):
> 1. **Object Lock geht nur beim Anlegen des Buckets** — nachträglich nicht
>    aktivierbar. Wenn du ihn vergisst, Bucket löschen & neu anlegen.
> 2. **GitHub Actions erreicht die DB nur über die ÖFFENTLICHE Railway-URL**,
>    nicht über die interne `*.railway.internal`-Adresse (siehe Schritt 7).

> ✅ **UPDATE 2026-08-04 — Die Backup-Automatik ist jetzt IM APP-SERVER
> implementiert** (`backend/src/jobs/backup.js` + `mediaBackupSync.js`).
> Der Railway-Service macht den nächtlichen verschlüsselten Dump (03:15 UTC)
> **selbst**, sobald die `BACKUP_R2_*`-Variablen in Railway gesetzt sind —
> plus wöchentliche Bild-Replikation (So 04:30 UTC). Bis dahin ist alles
> inert (eine Startup-Logzeile `[backup] OFF`, kein Fehler).
>
> **Was sich dadurch ändert:**
> - **Schritt 1–6 bleiben Pflicht und unverändert** (Konto, 2FA, Bucket mit
>   Object Lock, Retention/Lifecycle, Token, Schlüssel).
> - **NEU: Schritt 8-R (Railway-Variablen)** ersetzt Schritt 7–9 als
>   Standard-Aktivierung. Die GitHub Action (Schritt 7–9) bleibt als
>   **optionales zweites Standbein** (läuft Railway-unabhängig) — beide
>   schreiben in denselben Tresor unter `db/`, gleiche Verschlüsselung.
> - **Restore:** komplett neu dokumentiert im **RESTORE-Runbook** ganz unten
>   (Skript `backend/scripts/restore-backup.js`, Dry-Run als Default).

---

## Schritt 1 — Getrenntes Cloudflare-Konto + 2FA  → erfüllt V3

Das ist der Kern der Versicherungsklausel: der Tresor muss in einem **separaten**
Konto liegen, **nicht** im Produktions-Cloudflare-Konto (wo die Live-Bilder sind).

- [ ] Mit einer **anderen E-Mail** ein neues Cloudflare-Konto anlegen
      (z. B. `backups@…` — nicht der Produktions-Login).
- [ ] Einloggen → **My Profile → Authentication → Two-Factor Authentication**
      aktivieren (Authenticator-App). Recovery-Codes im Passwort-Manager sichern.

> Damit ist „Zugriff nur aus separater Domäne / mit unabhängiger 2FA" erfüllt.

---

## Schritt 2 — R2 aktivieren & Account-ID notieren

- [ ] Im neuen Konto links **R2** öffnen → einmalig aktivieren
      (verlangt eine Zahlungsmethode; das Backup-Volumen liegt im Cent-Bereich).
- [ ] **Account-ID** notieren (R2-Übersicht, rechts). Daraus wird dein Endpoint:
      `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

---

## Schritt 3 — Bucket `jamie-backups` MIT Object Lock anlegen  → erfüllt V3

- [ ] **R2 → Create bucket**
  - Name: `jamie-backups`
  - Region/Location: Standard (Automatic) ist ok
  - **Object Lock: EINSCHALTEN** ⬅️ wichtig, nur jetzt möglich!
- [ ] Erstellen.

---

## Schritt 4 — 30-Tage-Sperre + Löschung an Tag 37  → erfüllt V2

Die unveränderbare Default-Retention setzt man am zuverlässigsten per S3-API
(Dashboard versteckt das je nach Version). Beide Befehle nutzen dein
R2-Token aus Schritt 5 — du kannst Schritt 4 also auch direkt **nach** Schritt 5
ausführen. Platzhalter `<ACCOUNT_ID>` ersetzen.

**4a — Object Lock: 30 Tage Compliance (unlöschbar):**
```bash
aws s3api put-object-lock-configuration \
  --bucket jamie-backups \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  --object-lock-configuration '{"ObjectLockEnabled":"Enabled","Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Days":30}}}'
```

**4b — Lifecycle: Objekte unter `db/` nach 37 Tagen löschen (Kostenbremse):**
```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket jamie-backups \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  --lifecycle-configuration '{"Rules":[{"ID":"expire-37d","Status":"Enabled","Filter":{"Prefix":"db/"},"Expiration":{"Days":37}}]}'
```

- [ ] 4a ausgeführt (Object Lock 30 T Compliance).
- [ ] 4b ausgeführt (Lifecycle 37 T).

> 37 > 30 mit Absicht: die Sperre läuft erst ab, dann darf Lifecycle löschen.
> Hinweis: Im Compliance-Mode ist jedes hochgeladene Objekt 30 Tage **durch
> niemanden** löschbar — auch dein eigenes Test-Objekt nicht. Bei winzigen
> DB-Dumps vernachlässigbar.

---

## Schritt 5 — API-Token (auf den Bucket beschränkt)

- [ ] **R2 → Manage R2 API Tokens → Create API Token**
  - Permission: **Object Read & Write**
  - **Apply to specific buckets only → `jamie-backups`** ⬅️ Scope einschränken
  - Erstellen.
- [ ] **Access Key ID** und **Secret Access Key** sofort kopieren
      (Secret wird nur **einmal** angezeigt) → in den Passwort-Manager.

> R2 hat keine feinere „nur PutObject"-Stufe. Egal — die Unveränderbarkeit
> garantiert der Object Lock (Schritt 4a), nicht das Token.

---

## Schritt 6 — Verschlüsselungs-Schlüssel erzeugen  → erfüllt V4

- [ ] Langen Zufalls-Schlüssel erzeugen:
```bash
openssl rand -base64 48
```
- [ ] Ergebnis als `BACKUP_ENCRYPTION_KEY` in den **Passwort-Manager** legen
      **und** als versiegelten Notfall-Umschlag (Schlüsselverlust = Datenverlust!).
- [ ] **NICHT** im Backup-Cloudflare-Konto speichern (sonst Schlüssel + Daten
      am selben Ort).

---

## Schritt 7 — Öffentliche Railway-DB-URL holen  ⚠️ Stolperfalle

GitHub Actions läuft außerhalb von Railway und erreicht die interne Adresse
`postgres.railway.internal` **nicht**. Du brauchst die **öffentliche** URL.

- [ ] Railway → Postgres-Service → **Variables/Connect** → **Public Network**
      aktivieren bzw. `DATABASE_PUBLIC_URL` (TCP-Proxy-Host, Form
      `…proxy.rlwy.net:PORT`) kopieren.
- [ ] Diesen Wert in Schritt 8 als `DATABASE_URL` setzen (read-only genügt).

---

## Schritt 8 — GitHub-Secrets setzen  → aktiviert die Automatik

Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Sechs Stück:

- [ ] `DATABASE_URL` = die **öffentliche** Railway-URL aus Schritt 7
- [ ] `BACKUP_ENCRYPTION_KEY` = Schlüssel aus Schritt 6
- [ ] `BACKUP_S3_BUCKET` = `jamie-backups`
- [ ] `BACKUP_S3_ENDPOINT` = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- [ ] `BACKUP_S3_ACCESS_KEY` = Access Key ID aus Schritt 5
- [ ] `BACKUP_S3_SECRET_KEY` = Secret Access Key aus Schritt 5

> Diese Werte gehören **nur** hierher (und in den Passwort-Manager) — bitte
> nicht in Chats/Tickets pasten.

---

## Schritt 9 — Testlauf  → beweist, dass es läuft

- [ ] GitHub → **Actions → „DB Backup" → Run workflow** (Branch `main`).
- [ ] Lauf wird **grün**? Falls rot: Log lesen — meist falsche/fehlende Secrets
      oder interne statt öffentliche DB-URL (Schritt 7).
- [ ] In R2 prüfen: unter `jamie-backups/db/` liegt `jamie-db-<STAMP>.sql.gz.enc`
      mit **plausibler Größe** (nicht ~0). Alternativ:
```bash
aws s3 ls s3://jamie-backups/db/ \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```
- [ ] Ab jetzt läuft der Cron automatisch täglich 03:00 UTC.

---

## Schritt 10 — Erster Restore-Test  → erfüllt V6 (Pflicht!)

„Ein ungetestetes Backup ist kein Backup." Einmal jetzt, dann vierteljährlich.

- [ ] Leere Test-Postgres bereitstellen (lokal via Docker, oder eine zweite
      Railway-DB) → deren URL als `RESTORE_DATABASE_URL`.
- [ ] Neueste Sicherung einspielen:
```bash
aws s3 cp "s3://jamie-backups/db/jamie-db-<STAMP>.sql.gz.enc" - \
    --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  | openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$BACKUP_ENCRYPTION_KEY" \
  | gunzip \
  | psql "$RESTORE_DATABASE_URL"
```
- [ ] Prüfen: Tabellen da, Zeilenzahlen plausibel. **Dauer messen** (Ziel RTO ≤ 4 h).
- [ ] Ergebnis in [BACKUP-KONZEPT.md](BACKUP-KONZEPT.md) **§6-Tabelle** eintragen.

---

## Schritt 11 — Restliche Konzept-Punkte (kurz)

- [ ] **Railway Managed Backups** aktivieren (Postgres-Service → Backups) → Ebene A.
- [ ] **Object Versioning** auf dem **Live**-Uploads-Bucket (Produktions-Cloudflare)
      einschalten → schützt die Bilder.
- [ ] Alle Produktions-Env-Vars (Railway) in den Passwort-Manager übertragen.

---

## ✅ Fertig, wenn …

… alle Boxen oben gehakt sind. Dann gilt gegenüber der Versicherung:

| Klausel | erfüllt durch |
|---|---|
| Wöchentliche vollständige Sicherung | Schritt 8-R bzw. 8/9 (täglich) |
| Aufbewahrung ≥ 30 Tage | Schritt 4a (Object Lock 30 T) |
| Unveränderbar + separate 2FA | Schritt 1 + 3 + 4a |
| Verschlüsselt | Schritt 6 |
| Restore getestet | Schritt 10 / RESTORE-Runbook |

Danach in [BACKUP-KONZEPT.md](BACKUP-KONZEPT.md) §0 die Status-Spalten von ⬜ auf
✅ setzen — das ist dein Versicherungs-Nachweis.

---
---

# 🚂 Schritt 8-R — Railway-Variablen (Standard-Aktivierung, implementiert 2026-08-04)

Der App-Server macht das Backup jetzt selbst. Voraussetzung: Schritt 1–6 oben
sind erledigt (Backup-Konto, Bucket **mit** Object Lock, Retention, Token,
Schlüssel). Dann:

- [ ] Railway → Backend-Service → **Variables** → diese **fünf** setzen
      (Werte aus Schritt 2, 5 und 6 — **NICHT** die `STORAGE_*`-Werte des
      Produktions-Kontos!):

| Variable | Wert |
|---|---|
| `BACKUP_R2_ACCOUNT_ID` | Account-ID des **Backup**-Cloudflare-Kontos (Schritt 2) |
| `BACKUP_R2_ACCESS_KEY_ID` | Access Key ID des Backup-Tokens (Schritt 5) |
| `BACKUP_R2_SECRET_ACCESS_KEY` | Secret Access Key des Backup-Tokens (Schritt 5) |
| `BACKUP_R2_BUCKET` | `jamie-backups` |
| `BACKUP_ENCRYPTION_KEY` | Passphrase aus Schritt 6 (Passwort-Manager!) |

  Optional: `BACKUP_RETENTION_DAYS` (30), `BACKUP_PRUNE_AFTER_DAYS` (37),
  `BACKUP_MIN_BYTES` (10240), `BACKUP_MEDIA_SYNC=false` (Bild-Sync aus),
  `BACKUP_R2_ENDPOINT` (statt Account-ID).

- [ ] **Redeploy** (neues Docker-Image nötig — es enthält jetzt `pg_dump`).
- [ ] Railway-Logs prüfen: beim Start muss stehen
      `[backup] ARMED — nightly encrypted DB dump → vault bucket "jamie-backups" …`
      (steht dort `[backup] OFF — … missing: …`, fehlt genau die gelistete Variable).
- [ ] **Testlauf sofort** (nicht auf 03:15 UTC warten):
      `railway run node scripts/run-backup-now.js` — Ausgabe muss
      `status: 'success'` und den Objekt-Key zeigen. (Alternativ per
      `railway ssh` im Container: `node scripts/run-backup-now.js`.)
- [ ] Im R2-Dashboard des **Backup**-Kontos prüfen: unter `jamie-backups/db/`
      liegt `jamie-db-<STAMP>.sql.gz.enc` mit plausibler Größe (nicht ~0).
- [ ] Danach läuft es automatisch: **DB täglich 03:15 UTC**, **Bilder wöchentlich
      So 04:30 UTC** (inkrementell, nur neue Objekte, unter `media/`).

**Wie die Automatik sich absichert (Referenz):**
- Zwei Railway-Replikas laufen nie doppelt: Zufalls-Jitter (0–2 min) +
  Postgres-Advisory-Lock + „schon erfolgreich in den letzten 20 h"-Marker in
  der Tabelle `backup_runs`.
- `backup_runs` (id, kind, started_at, status, object_key, bytes, detail) ist
  zugleich das **Protokoll für die Versicherung** — `SELECT * FROM backup_runs
  ORDER BY id DESC LIMIT 40;` zeigt die letzten Läufe.
- Ein leerer/abgebrochener Dump (< `BACKUP_MIN_BYTES`) wird **nie** hochgeladen.
- Jeder Upload setzt **Object-Lock COMPLIANCE +30 T pro Objekt** mit. Lehnt der
  Bucket den Header ab (z. B. Object Lock beim Anlegen vergessen), lädt er
  ohne Header hoch und **warnt laut im Log** — dann schützt NUR die
  Bucket-Default-Retention aus Schritt 4a. Die Warnung ernst nehmen!
- Aufräumen: Dumps älter als Tag 37 löscht primär die Lifecycle-Regel
  (Schritt 4b); der Job versucht es zusätzlich selbst und ignoriert
  Ablehnungen gesperrter Objekte. **Wichtig: Die Lifecycle-Regel gilt NUR für
  den Prefix `db/` — NIEMALS eine Regel auf `media/` legen**, die Bild-Kopien
  sind ein dauerhafter Spiegel (Ransomware-Schutz), keine Rotation.
- Fehler landen als `[backup] ❌ …` in den Railway-Logs **und** in Sentry
  (Tag `job: db-backup` bzw. `media-backup-sync`).

**Monitoring-Ersatz für die „rote GitHub-Mail" (Konzept §7/V8):** Läuft das
Backup in-process, gibt es keine CI-Mail. Ersatz-Routine: Sentry-Alert auf die
beiden Job-Tags einrichten (empfohlen) **und** monatlich `backup_runs` bzw. die
Objektanzahl im Tresor prüfen (~30–37 Stück). Optional die GitHub Action
(Schritt 7–9) als unabhängiges zweites Bein aktiv lassen — sie mailt weiterhin
rot, auch wenn Railway komplett tot ist.

---

# 🔥 RESTORE-Runbook (Railway) — im Ernstfall hier anfangen

**Skript:** `backend/scripts/restore-backup.js` — **Default ist Dry-Run**, es
schreibt NIE ohne `--execute`. Es braucht dieselben `BACKUP_R2_*`-Variablen +
`BACKUP_ENCRYPTION_KEY` (lokal in `backend/.env` eintragen oder via
`railway run` injizieren) und für `--execute` ein lokales `psql`
(bzw. `railway ssh` — im Container ist es installiert).

> ⚠️ **NIE direkt in die Produktions-DB restoren, solange sie noch läuft.**
> Immer erst in eine leere DB, prüfen, dann umschalten. Das Skript verweigert
> ein Restore auf `DATABASE_URL` ohne die Extra-Flagge `--force-production`.

### A) Quartals-Drill (Pflicht, Konzept §6) — ohne Risiko

1. **Verfügbare Backups ansehen:**
   ```bash
   cd backend
   node scripts/restore-backup.js --list
   ```
2. **Integrität prüfen (Dry-Run — Download + Entschlüsseln + Entpacken, keine DB):**
   ```bash
   node scripts/restore-backup.js --latest
   ```
   Erwartet: `✅ DRY-RUN OK`, plausible SQL-Größe, erste Zeile
   `-- PostgreSQL database dump`.
3. **Leere Test-DB bereitstellen:** Railway → Projekt → **+ New → Database →
   PostgreSQL** (Wegwerf-Instanz) → deren `DATABASE_PUBLIC_URL` kopieren.
   (Oder lokal: `docker run -e POSTGRES_PASSWORD=pw -p 5433:5432 postgres:17`.)
4. **Einspielen:**
   ```bash
   node scripts/restore-backup.js --latest --target "postgresql://…TEST-DB…" --execute
   ```
   Tippe `RESTORE` zur Bestätigung. `--single-transaction` + `ON_ERROR_STOP`
   sind gesetzt — bricht es ab, ist die Ziel-DB unverändert.
5. **Prüfen:** Tabellen + Zeilenzahlen plausibel
   (`SELECT COUNT(*) FROM users;` ≈ Live-Stand), Backend testweise dagegen
   starten. **Dauer notieren** (Ziel RTO ≤ 4 h) und in
   [BACKUP-KONZEPT.md](BACKUP-KONZEPT.md) **§6-Tabelle** protokollieren.
6. Test-DB wieder **löschen** (Railway-Service entfernen).

### B) Echter Notfall (DB weg / kompromittiert)

1. **Ruhe bewahren. Nichts überschreiben.** Falls die alte DB noch existiert,
   NICHT hineinrestoren — sie ist Beweismittel und letzter Fallback.
2. Railway: **neue, leere Postgres-Instanz** anlegen (nicht die alte
   recyceln). Public-URL kopieren.
3. Neuestes (oder letztes bekannt-gutes) Backup wählen:
   `node scripts/restore-backup.js --list` → Key merken.
4. Dry-Run gegen genau diesen Key (`--key db/jamie-db-….sql.gz.enc`), dann
   `--execute` mit `--target` = **neue** Instanz (wie Drill-Schritt 4).
5. Stichproben wie im Drill (users/groups/messages-Zählungen, neueste
   `created_at` ≈ Backup-Zeitpunkt — alles danach ist verloren, RPO ≤ 24 h).
6. **Umschalten:** Railway → Backend-Service → Variables → `DATABASE_URL` auf
   die neue Instanz setzen → Redeploy. Beim Boot laufen die
   Startup-Migrationen idempotent durch; Logs auf `✅ Startup migrations done`
   prüfen. Kurzer Smoke-Test (Login, Gruppenliste, Chat).
7. Alte Instanz erst nach Abschluss der Ursachen-Analyse löschen.
8. Vorfall + Restore-Dauer für die Versicherung dokumentieren (§6-Tabelle).

### Notnagel ohne Node: reines CLI-Restore (Konzept §6, funktioniert weiterhin)

```bash
aws s3 cp "s3://jamie-backups/db/jamie-db-<STAMP>.sql.gz.enc" - \
    --endpoint-url "https://<BACKUP_ACCOUNT_ID>.r2.cloudflarestorage.com" \
  | openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$BACKUP_ENCRYPTION_KEY" \
  | gunzip \
  | psql "$RESTORE_DATABASE_URL"
```
(Unsere Dumps sind byte-kompatibel zum OpenSSL-Format `Salted__` + PBKDF2/
SHA-256/10000 Iterationen. Meckert ein exotisches openssl, explizit
`-md sha256 -iter 10000` anhängen.)
