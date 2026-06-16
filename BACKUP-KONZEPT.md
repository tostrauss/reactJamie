# 🗄️ JAMIE — Backup-Konzept

Stand: 2026-06-15 · Verantwortlich: Tobi (Technik), Tina (Inhaberin)

Dieses Dokument beschreibt, **was** gesichert wird, **wie oft**, **wie lange**,
**wo** und **wie die Wiederherstellung getestet** wird. Es erfüllt die
Anforderungen aus dem Sicherheits-/DSGVO-Backup-Standard.

---

## ✅ Anforderungen → Umsetzung (Kurzüberblick)

| Anforderung | Umsetzung bei JAMIE | Status |
|---|---|---|
| Vollständiges Backup **mind. 1× pro Woche** | Täglicher `pg_dump` der Postgres-DB (übertrifft die Wochenvorgabe) + tägliche Railway-Snapshots | ⬜ einzurichten |
| Backups **mind. 30 Tage** aufbewahren | R2-Lifecycle-Regel: 35 Tage Aufbewahrung, danach Auto-Löschung | ⬜ |
| **Offline ODER** unveränderbares Cloud-Backup mit **separater 2FA** | Cloudflare R2 Backup-Bucket mit **Object Lock (WORM, unveränderbar)**, eigenes Cloudflare-Konto mit **2FA** | ⬜ |
| Managed-Backup **+ externe verschlüsselte** Sicherung | Railway Managed Backups **+** AES-256-verschlüsselte Dumps in separatem R2-Konto | ⬜ |
| **Regelmäßig Wiederherstellung testen** | Vierteljährlicher Restore-Drill, protokolliert (Tabelle unten) | ⬜ |

> Hinweis: 2 Sicherungsorte, getrennte Konten → erfüllt die **3-2-1-Regel**
> (3 Kopien, 2 Medien/Anbieter, 1 davon ausgelagert & unveränderbar).

---

## 1. Daten-Inventar — was muss gesichert werden?

| # | Asset | Inhalt | Kritikalität | Wo live |
|---|---|---|---|---|
| 1 | **PostgreSQL-DB** | Nutzer, Gruppen, Clubs, Nachrichten, Freundschaften, Abos, Boosts … | 🔴 **Kritisch** (nicht reproduzierbar) | Railway Postgres (`DATABASE_URL`) |
| 2 | **Upload-Dateien** | Profil-/Gruppen-/Club-Bilder | 🟠 Hoch | Cloudflare R2 (`STORAGE_*` Bucket) |
| 3 | **Quellcode** | App-Code, Migrationen | 🟢 Versioniert | GitHub (+ lokale Clones) |
| 4 | **Secrets / Env-Vars** | `DATABASE_URL`, `STORAGE_*`, JWT-, Stripe-, Spotify-Keys … | 🔴 Kritisch | Railway-Variablen |

Nicht zu sichern (reproduzierbar): `node_modules`, Build-Artefakte, Caches.

---

## 2. Backup-Strategie pro Asset

### 2.1 Datenbank (🔴 Kernstück)

Zwei unabhängige Ebenen — bewusst doppelt:

**Ebene A — Managed (Railway):**
- Railway erstellt automatische Snapshots der Postgres-Instanz.
- Im Railway-Dashboard → Postgres-Service → **Backups** aktivieren und
  Aufbewahrung prüfen (Plan-abhängig). Dient als schnelle Wiederherstellung,
  liegt aber **beim selben Anbieter** → reicht allein **nicht**.

**Ebene B — Externe, verschlüsselte, unveränderbare Sicherung (Pflicht):**
- Täglicher `pg_dump` → `gzip` → **AES-256-Verschlüsselung** → Upload in einen
  **separaten** Cloudflare-R2-Bucket (anderes Konto als die Live-Uploads).
- Skript: [`backend/scripts/backup-db.sh`](backend/scripts/backup-db.sh)
- Automatisierung: GitHub Action [`.github/workflows/backup.yml`](.github/workflows/backup.yml)
  (läuft unabhängig vom App-Server, auch wenn Railway „schläft").
- Der Dump enthält das komplette Schema **und** alle Daten (`pg_dump`), ist
  also ein **vollständiges** Backup im Sinne der Anforderung.

### 2.2 Upload-Dateien (R2)

- Auf dem Live-Uploads-Bucket **Object Versioning** aktivieren → versehentlich
  überschriebene/gelöschte Bilder bleiben 35 Tage wiederherstellbar.
- Zusätzlich wöchentliche Replikation in den Backup-Bucket (`aws s3 sync`),
  damit ein kompromittiertes Live-Konto die Bilder nicht mitreißt.
- Bilder sind weniger kritisch (Nutzer können neu hochladen), aber die
  Versionierung kostet kaum etwas und schützt vor Ransomware/Fehlbedienung.

### 2.3 Quellcode

- Primär: **GitHub** (jeder Push ist ein Backup).
- Empfehlung: zweites Remote-Mirror (z. B. GitLab) oder regelmäßiger
  `git bundle` ins Backup-Konto. Mindestens 1 aktueller lokaler Clone.

### 2.4 Secrets / Env-Vars

- **Niemals** nur in Railway verlassen. Alle Produktions-Variablen in einem
  Passwort-Manager (1Password / Bitwarden) mit **2FA** ablegen.
- Vorlage der Variablen: [`backend/.env.production.example`](backend/.env.production.example).
- Ohne Secrets ist ein DB-Restore wertlos → gehört zwingend ins Backup.

---

## 3. Unveränderbarkeit & 2FA (Kernanforderung)

Statt eines physisch getrennten Offline-Backups setzen wir auf ein
**unveränderbares Cloud-Backup mit separater 2FA** — gleichwertig laut Vorgabe:

1. **Eigenes, getrenntes Cloudflare-Konto** nur für Backups (nicht das
   Live-/Produktions-Konto). Eigene Zugangsdaten.
2. **2FA verpflichtend** auf diesem Backup-Konto (TOTP/Authenticator).
3. Backup-Bucket mit **Object Lock (Compliance-Mode, WORM)**: hochgeladene
   Objekte können für die Aufbewahrungsdauer **nicht** verändert oder gelöscht
   werden — auch nicht von einem Angreifer mit den Upload-Keys.
4. Die R2-API-Keys für den Upload haben **nur Schreibrechte** (PutObject), keine
   Lösch-/Überschreibrechte → ein geleakter CI-Key kann Backups nicht zerstören.

→ Erfüllt: *„unveränderbares Cloud-Backup mit separater 2FA-Absicherung."*

---

## 4. Verschlüsselung

- DB-Dumps werden **vor** dem Upload mit `openssl enc -aes-256-cbc -pbkdf2`
  verschlüsselt — es liegt **kein Klartext** in der Cloud.
- Passphrase = `BACKUP_ENCRYPTION_KEY`, gespeichert **nur** im Passwort-Manager
  und als GitHub-Actions-Secret. **Nicht** im Backup-Konto ablegen
  (sonst hätte ein Angreifer Schlüssel + Daten am selben Ort).

---

## 5. Aufbewahrung (Retention)

- **Mindestens 30 Tage** → wir setzen **35 Tage** (Puffer).
- R2 **Lifecycle-Regel** auf dem Backup-Bucket: Objekte älter als 35 Tage
  automatisch löschen. Mit Object Lock erst nach Ablauf der Sperrfrist möglich.
- Bei täglichem Dump ⇒ ~35 wiederherstellbare Tagesstände gleichzeitig.

---

## 6. Wiederherstellung (Restore)

Vollständige Anleitung steht im Skript-Kommentar; Kurzform:

```bash
# 1) verschlüsselten Dump aus R2 holen, entschlüsseln, entpacken, einspielen
aws s3 cp "s3://$BACKUP_S3_BUCKET/db/jamie-db-<STAMP>.sql.gz.enc" - \
    --endpoint-url "$BACKUP_S3_ENDPOINT" \
  | openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$BACKUP_ENCRYPTION_KEY" \
  | gunzip \
  | psql "$RESTORE_DATABASE_URL"     # NIE direkt auf Produktion testen!
```

### Restore-Test (vierteljährlich, Pflicht)

„Ein ungetestetes Backup ist kein Backup." Jedes Quartal:
1. Neueste verschlüsselte Sicherung in eine **leere Test-Postgres** einspielen.
2. Prüfen: Tabellen vorhanden, Zeilenzahlen plausibel, Backend startet dagegen.
3. Ergebnis hier protokollieren:

| Datum | Getestete Sicherung | Größe | Restore OK? | Tester | Notizen |
|---|---|---|---|---|---|
| _TT.MM.JJJJ_ | _jamie-db-…enc_ | _… MB_ | ⬜ | _…_ | _…_ |

---

## 7. Einmalige Einrichtung (Checkliste)

- [ ] Separates **Cloudflare-Konto** für Backups anlegen, **2FA** aktivieren.
- [ ] R2-Bucket `jamie-backups` erstellen, **Object Lock** + 35-Tage-Lifecycle setzen.
- [ ] R2-API-Token (nur `PutObject`) erstellen.
- [ ] `BACKUP_ENCRYPTION_KEY` (langes Zufallspasswort) erzeugen und im Passwort-Manager speichern.
- [ ] GitHub-Secrets setzen: `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`.
- [ ] Workflow `.github/workflows/backup.yml` einmal manuell starten („Run workflow") und Upload prüfen.
- [ ] Railway-Postgres **Managed Backups** aktivieren.
- [ ] Object Versioning auf dem Live-Uploads-Bucket aktivieren.
- [ ] Alle Produktions-Env-Vars in den Passwort-Manager übertragen.
- [ ] Ersten **Restore-Test** durchführen und oben protokollieren.

---

## 8. Verantwortlichkeiten

- **Technische Umsetzung & Monitoring:** Tobi.
- **Quartals-Restore-Test & Protokoll:** Tobi, dokumentiert für Tina.
- **Eskalation bei fehlgeschlagenem Backup:** Die GitHub Action schlägt fehl
  (rote Mail an die Repo-Admins) → innerhalb von 48 h beheben.
