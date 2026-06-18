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
| Wöchentliche vollständige Sicherung | Schritt 8/9 (täglich) |
| Aufbewahrung ≥ 30 Tage | Schritt 4a (Object Lock 30 T) |
| Unveränderbar + separate 2FA | Schritt 1 + 3 + 4a |
| Verschlüsselt | Schritt 6 |
| Restore getestet | Schritt 10 |

Danach in [BACKUP-KONZEPT.md](BACKUP-KONZEPT.md) §0 die Status-Spalten von ⬜ auf
✅ setzen — das ist dein Versicherungs-Nachweis.
