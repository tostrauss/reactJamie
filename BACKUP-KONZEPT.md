# 🗄️ JAMIE — Backup- & Wiederherstellungskonzept

Stand: 2026-06-18 · Verantwortlich: Tobi (Technik), Tina (Inhaberin)

Dieses Dokument beschreibt, **was** gesichert wird, **wie oft**, **wie lange**,
**wo**, **wie unveränderbar** und **wie die Wiederherstellung getestet** wird.
Es ist so aufgebaut, dass es als **Nachweis gegenüber der (Cyber-)Versicherung**
dient: Abschnitt 0 bildet jede Versicherungs-Anforderung direkt auf ihre
technische Umsetzung ab.

---

## 0. Versicherungs-Anforderungen → Nachweis

> Maßgeblich ist der Wortlaut der Police. Die folgende Tabelle bildet die
> üblichen Backup-Klauseln einer Cyber-/Inhaltsversicherung ab. Sollte die
> Police abweichende Zahlen nennen, **gewinnt die Police** — die Werte hier
> (30-Tage-Tresor) sind so gewählt, dass sie die Standardvorgabe erfüllen
> oder übertreffen.

| # | Anforderung der Versicherung | Umsetzung bei JAMIE | Beleg / Ort | Status |
|---|---|---|---|---|
| V1 | Vollständiges Backup **mind. 1× pro Woche** | **Täglicher** `pg_dump` (Schema **+** Daten) + Railway-Snapshots | `backup-db.sh`, `backup.yml` | ⬜ einzurichten |
| V2 | Backups **mind. 30 Tage** aufbewahren | **30-Tage-Backup-Tresor** (Object-Lock 30 T) + Lifecycle-Löschung Tag 37 | Abschnitt 3 + 5 | ⬜ |
| V3 | **Unveränderbares** Backup (offline ODER WORM) **mit separater 2FA** | R2-Bucket mit **Object Lock (Compliance/WORM)** in **eigenem** Cloudflare-Konto **mit 2FA** | Abschnitt 3 | ⬜ |
| V4 | Backup **verschlüsselt** abgelegt | **AES-256** vor Upload, kein Klartext in der Cloud | Abschnitt 4 | ⬜ |
| V5 | Managed-Backup **+ externe** Sicherung (getrennte Anbieter) | Railway Managed Backups **+** R2 (anderes Konto) → **3-2-1-Regel** | Abschnitt 2 | ⬜ |
| V6 | **Wiederherstellung regelmäßig testen** & protokollieren | **Vierteljährlicher** Restore-Drill, Protokoll-Tabelle | Abschnitt 6 | ⬜ |
| V7 | Definierte **Wiederanlaufzeit / max. Datenverlust** | **RTO ≤ 4 h**, **RPO ≤ 24 h** (extern, unveränderbar) | Abschnitt 1.1 | ✅ definiert |
| V8 | **Alarmierung** bei fehlgeschlagenem Backup | GitHub-Action schlägt fehl → Mail an Repo-Admins; 48-h-SLA | Abschnitt 7 | ⬜ |

> **3-2-1-Regel erfüllt:** 3 Kopien (Live-DB, Railway-Snapshot, R2-Dump),
> 2 getrennte Anbieter, 1 davon ausgelagert **und unveränderbar**.

---

## 1. Daten-Inventar — was muss gesichert werden?

| # | Asset | Inhalt | Kritikalität | Wo live |
|---|---|---|---|---|
| 1 | **PostgreSQL-DB** | Nutzer, Gruppen, Clubs, Nachrichten, Freundschaften, Abos, Boosts … | 🔴 **Kritisch** (nicht reproduzierbar) | Railway Postgres (`DATABASE_URL`) |
| 2 | **Upload-Dateien** | Profil-/Gruppen-/Club-Bilder | 🟠 Hoch | Cloudflare R2 (`STORAGE_*` Bucket) |
| 3 | **Quellcode** | App-Code, Migrationen | 🟢 Versioniert | GitHub (+ lokale Clones) |
| 4 | **Secrets / Env-Vars** | `DATABASE_URL`, `STORAGE_*`, JWT-, Stripe-, Spotify-Keys … | 🔴 Kritisch | Railway-Variablen + Passwort-Manager |

Nicht zu sichern (reproduzierbar): `node_modules`, Build-Artefakte, Caches.

### 1.1 Schutzziele — RPO & RTO

- **RPO (max. tolerierter Datenverlust): ≤ 24 h.** Der externe, unveränderbare
  Dump läuft täglich. Im schlimmsten Fall (Totalausfall + kompromittiertes
  Railway-Konto) verlieren wir die Daten seit dem letzten Nacht-Dump.
  Railway-Snapshots verkürzen den realen RPO meist deutlich.
- **RTO (max. Wiederanlaufzeit): ≤ 4 h.** Die DB ist klein; Download + Entschlüsseln
  + `psql`-Restore dauert in der Praxis < 1 h. Die 4 h sind Puffer für
  Neu-Provisionierung der Railway-Instanz und Env-Var-Wiederherstellung.

---

## 2. Backup-Strategie pro Asset

### 2.1 Datenbank (🔴 Kernstück)

Zwei unabhängige Ebenen — bewusst doppelt:

**Ebene A — Managed (Railway):**
- Railway erstellt automatische Snapshots der Postgres-Instanz.
- Im Railway-Dashboard → Postgres-Service → **Backups** aktivieren und
  Aufbewahrung prüfen (Plan-abhängig). Schnelle Wiederherstellung, liegt aber
  **beim selben Anbieter** → erfüllt allein **nicht** die Versicherungsvorgabe.

**Ebene B — Externer, verschlüsselter, unveränderbarer Tresor (Pflicht):**
- Täglicher `pg_dump` → `gzip` → **AES-256-Verschlüsselung** → Upload in einen
  **separaten** Cloudflare-R2-Bucket (anderes Konto als die Live-Uploads).
- Skript: [`backend/scripts/backup-db.sh`](backend/scripts/backup-db.sh)
  (prüft per Mindestgröße, dass der Dump nicht leer/abgebrochen ist).
- Automatisierung: GitHub Action [`.github/workflows/backup.yml`](.github/workflows/backup.yml)
  (läuft unabhängig vom App-Server, auch wenn Railway „schläft").
- Der Dump enthält Schema **und** alle Daten → **vollständiges** Backup i. S. d.
  Versicherungsvorgabe (V1).

### 2.2 Upload-Dateien (R2)

- Auf dem Live-Uploads-Bucket **Object Versioning** aktivieren → versehentlich
  überschriebene/gelöschte Bilder bleiben wiederherstellbar.
- Zusätzlich wöchentliche Replikation in den Backup-Bucket (`aws s3 sync`),
  damit ein kompromittiertes Live-Konto die Bilder nicht mitreißt.
- Bilder sind weniger kritisch (Nutzer können neu hochladen), daher wöchentlich
  statt täglich.

### 2.3 Quellcode

- Primär: **GitHub** (jeder Push ist ein Backup).
- Empfehlung: zweites Remote-Mirror (z. B. GitLab) oder regelmäßiger
  `git bundle` ins Backup-Konto. Mindestens 1 aktueller lokaler Clone.

### 2.4 Secrets / Env-Vars

- **Niemals** nur in Railway verlassen. Alle Produktions-Variablen in einem
  Passwort-Manager (1Password / Bitwarden) mit **2FA** ablegen.
- Vorlage der Variablen: [`backend/.env.production.example`](backend/.env.production.example)
  (enthält jetzt auch den `BACKUP_*`-Block).
- Ohne Secrets ist ein DB-Restore wertlos → gehört zwingend ins Backup.

---

## 3. Der 30-Tage-Backup-Tresor (Kernanforderung V2 + V3)

Statt eines physisch getrennten Offline-Backups setzen wir auf einen
**unveränderbaren Cloud-Tresor mit separater 2FA** — laut Vorgabe gleichwertig:

1. **Eigenes, getrenntes Cloudflare-Konto** nur für Backups (nicht das
   Live-/Produktions-Konto). Eigene Zugangsdaten.
2. **2FA verpflichtend** auf diesem Backup-Konto (TOTP/Authenticator).
3. Backup-Bucket mit **Object Lock im Compliance-Mode (WORM)** und einer
   **Default-Retention von 30 Tagen**: jedes hochgeladene Objekt ist für
   30 Tage **unveränderlich und unlöschbar** — auch nicht durch einen Angreifer
   mit den Upload-Keys, und auch nicht durch uns selbst. **Das ist der
   „30-Tage-Safe" der Versicherung.**
4. Die R2-API-Keys für den Upload haben **nur Schreibrechte** (`PutObject`),
   keine Lösch-/Überschreibrechte → ein geleakter CI-Key kann Backups weder
   zerstören noch verändern.

> **Betriebshinweis zum Compliance-Mode:** Objekte lassen sich vor Ablauf der
> 30 Tage durch **niemanden** löschen (das ist der Zweck). Ein versehentlich
> hochgeladenes Objekt verursacht also bis Tag 30 reine Speicherkosten — bei
> kleinen täglichen DB-Dumps vernachlässigbar. Wer diese Sperre umgehbar halten
> will, kann stattdessen **Governance-Mode** wählen; dann ist die
> Unveränderbarkeit gegenüber einem Angreifer mit Admin-Rechten aber schwächer.

→ Erfüllt V2 (30 Tage) **und** V3 (unveränderbar + separate 2FA).

---

## 4. Verschlüsselung (V4)

- DB-Dumps werden **vor** dem Upload mit `openssl enc -aes-256-cbc -pbkdf2`
  verschlüsselt — es liegt **kein Klartext** in der Cloud.
- Passphrase = `BACKUP_ENCRYPTION_KEY`, gespeichert **nur** im Passwort-Manager
  und als GitHub-Actions-Secret. **Nicht** im Backup-Konto ablegen
  (sonst hätte ein Angreifer Schlüssel + Daten am selben Ort).
- ⚠️ **Schlüsselverlust = Datenverlust.** Geht `BACKUP_ENCRYPTION_KEY` verloren,
  sind alle Tresor-Backups unbrauchbar. Der Schlüssel muss daher selbst
  redundant (Passwort-Manager + versiegelter Notfall-Umschlag) abgelegt sein.

---

## 5. Aufbewahrung (Retention) — V2

- **Object-Lock-Retention: 30 Tage** (die unveränderbare Sperrfrist = der
  eigentliche „Tresor", erfüllt die 30-Tage-Mindestvorgabe).
- **Lifecycle-Regel: Löschung an Tag 37.** Bewusst **nach** Ablauf der 30-tägigen
  Sperre (7 Tage Puffer), damit Lifecycle und Object Lock nicht kollidieren und
  die Speicherkosten begrenzt bleiben.
- Bei täglichem Dump ⇒ jederzeit **~30–37 unveränderbare Tagesstände** parallel
  wiederherstellbar.

---

## 6. Wiederherstellung (Restore) — V6

Kurzform (vollständige Anleitung im Skript-Kommentar):

```bash
# Verschlüsselten Dump aus R2 holen → entschlüsseln → entpacken → einspielen
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
3. Restore-Dauer messen (Abgleich mit **RTO ≤ 4 h**).
4. Ergebnis hier protokollieren:

| Datum | Getestete Sicherung | Größe | Restore-Dauer | Restore OK? | Tester | Notizen |
|---|---|---|---|---|---|---|
| _TT.MM.JJJJ_ | _jamie-db-…enc_ | _… MB_ | _… min_ | ⬜ | _…_ | _…_ |

---

## 7. Monitoring & Alarmierung (V8)

- Die GitHub Action läuft täglich 03:00 UTC. **Schlägt sie fehl** (Dump leer,
  Upload-Fehler, fehlende Secrets), wird der Lauf **rot** → GitHub mailt die
  Repo-Admins automatisch.
- Das Skript bricht **vor** dem Upload ab, wenn der verschlüsselte Dump die
  Mindestgröße unterschreitet (Schutz vor stillen Leer-/Abbruch-Backups).
- **SLA:** Ein fehlgeschlagenes Backup wird innerhalb von **48 h** behoben.
- Optional/empfohlen: monatlicher Blick in den R2-Tresor, ob die Anzahl der
  Objekte zur erwarteten ~30–37 passt (Indikator, dass der Cron wirklich läuft).

---

## 8. Einmalige Einrichtung (Checkliste)

- [ ] Separates **Cloudflare-Konto** für Backups anlegen, **2FA** aktivieren.
- [ ] R2-Bucket `jamie-backups` erstellen, **Object Lock (Compliance, 30 T Default-Retention)** + **Lifecycle-Löschung Tag 37** setzen.
- [ ] R2-API-Token (nur `PutObject`) erstellen.
- [ ] `BACKUP_ENCRYPTION_KEY` (langes Zufallspasswort) erzeugen, im Passwort-Manager **und** versiegelt als Notfall-Umschlag ablegen.
- [ ] GitHub-Secrets setzen: `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`.
- [ ] Workflow `.github/workflows/backup.yml` einmal manuell starten („Run workflow") und Upload + Größe prüfen.
- [ ] Railway-Postgres **Managed Backups** aktivieren.
- [ ] Object Versioning auf dem Live-Uploads-Bucket aktivieren.
- [ ] Alle Produktions-Env-Vars in den Passwort-Manager übertragen.
- [ ] Ersten **Restore-Test** durchführen und in Abschnitt 6 protokollieren.
- [ ] Diese Checkliste + Abschnitt 0 der Versicherung als Nachweis vorlegen.

---

## 9. Verantwortlichkeiten

- **Technische Umsetzung & Monitoring:** Tobi.
- **Quartals-Restore-Test & Protokoll:** Tobi, dokumentiert für Tina.
- **Eskalation bei fehlgeschlagenem Backup:** GitHub-Action schlägt fehl
  (rote Mail an die Repo-Admins) → innerhalb von 48 h beheben.
- **Versicherungs-Nachweis / Police-Abgleich:** Tina, mit Zuarbeit von Tobi.
