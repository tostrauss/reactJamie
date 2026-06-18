# 🗄️ JAMIE — Backup- & Wiederherstellungskonzept

Stand: 2026-06-18 · Verantwortlich: Tobi (Technik), Tina (Inhaberin)

Dieses Dokument beschreibt, **was** gesichert wird, **wie oft**, **wie lange**,
**wo**, **wie unveränderbar** und **wie die Wiederherstellung getestet** wird.
Es ist so aufgebaut, dass es als **Nachweis gegenüber der Cyber-Versicherung**
dient: Abschnitt 0 zitiert den **wörtlichen Police-Fragebogen** und bildet jede
Klausel direkt auf ihre technische Umsetzung ab.

---

## 0. Versicherungs-Anforderungen → Nachweis

### ⚠️ Wichtig: Wir haben „Ja" zugesichert — das ist eine Obliegenheit

Im Cyber-Versicherungs-Fragebogen wurden die Fragen 2 und 3 mit **„Ja"**
beantwortet. Damit hat JAMIE dem Versicherer **verbindlich zugesichert**, die
unten zitierten Maßnahmen zu betreiben. Im Schadensfall prüft der Versicherer
das. Wird eine zugesicherte Maßnahme **nicht** tatsächlich betrieben, kann er
die Leistung **kürzen oder verweigern** (Obliegenheitsverletzung).

> 🔴 **Aktueller Stand:** Das Konzept passt, aber die Einrichtung steht noch aus
> (Abschnitt 8, alle ⬜). **Bis die Checkliste abgehakt ist, ist die „Ja"-Antwort
> nicht durch die Realität gedeckt.** Das hat Priorität.

### 0.1 Wörtlicher Police-Text (Frage 2 + 3, beide mit „Ja" beantwortet)

> **Frage 2 — „Betreiben Sie mindestens die folgenden IT-Schutzmaßnahmen?"**
>
> - Ihre Datensicherung erfüllt **sämtliche** der folgenden Anforderungen:
>   - **Vollständige wöchentliche Datensicherung**
>   - **Aufbewahrung der vollständigen Datensicherung über mind. 30 Tage**
>   - Nutzung einer **Offline**-Datensicherung mit dauerhafter physischer
>     Trennung von den IT-Systemen **ODER** Nutzung einer **unveränderbaren
>     Online**-Datensicherung, auf welche die Administratoren nur mit einer
>     **von der betreffenden Domäne unabhängigen Zwei-Faktor-Authentifizierung
>     oder aus einer separaten Domäne** zugreifen können.
> - Einspielen von **Sicherheitsupdates** auf Servern und Clients (mobile Geräte,
>   Desktops, Terminals) sowie auf Netzwerkgeräten und Sicherheitssystemen
>   (z. B. Firewalls, Virenschutz) **innerhalb von 30 Tagen** nach Veröffentlichung.
> - Sie nutzen **keine Alt-Betriebssysteme** ohne Sicherheitsupdates **ODER**
>   betreiben diese ausschließlich isoliert ohne direkten Internetzugang.
>
> **Frage 3 —** „Verwenden Sie ein **abgestuftes Berechtigungskonzept** mit
> administrativen Kennungen, die **ausschließlich durch IT-Verantwortliche**
> verwendet werden?"

### 0.2 Mapping: Police-Klausel → Umsetzung bei JAMIE

| # | Police-Klausel (verbatim sinngemäß) | Umsetzung bei JAMIE | Beleg / Ort | Status |
|---|---|---|---|---|
| V1 | **Vollständige wöchentliche** Datensicherung | **Täglicher** `pg_dump` (Schema **+** alle Daten) → übertrifft „wöchentlich" | `backup-db.sh`, `backup.yml` | ⬜ einzurichten |
| V2 | Aufbewahrung der vollständigen Sicherung **über mind. 30 Tage** | Object-Lock-Retention **30 Tage** + Lifecycle-Löschung Tag 37 (jeder Tagesstand ≥ 30 T) | Abschnitt 3 + 5 | ⬜ |
| V3 | **Unveränderbare Online**-Sicherung, Zugriff nur mit **domänen-unabhängiger 2FA / aus separater Domäne** | R2 **Object Lock (Compliance/WORM)** in **eigenem, getrenntem** Cloudflare-Konto mit **eigener 2FA** (≠ Produktions-Identität) | Abschnitt 3 | ⬜ |
| V4 | (verschärfend, Best Practice) Sicherung verschlüsselt | **AES-256** vor Upload, kein Klartext in der Cloud | Abschnitt 4 | ⬜ |
| V5 | (3-2-1) Managed **+ externe** Sicherung | Railway Managed Backups **+** R2 (anderes Konto/Anbieter) | Abschnitt 2 | ⬜ |
| V6 | (Best Practice) Restore testen | **Vierteljährlicher** Restore-Drill mit Protokoll | Abschnitt 6 | ⬜ |
| V7 | Definierte Wiederanlaufzeit / max. Datenverlust | **RTO ≤ 4 h**, **RPO ≤ 24 h** | Abschnitt 1.1 | ✅ definiert |
| V8 | Alarmierung bei fehlgeschlagenem Backup | GitHub-Action wird rot → Mail an Admins; 48-h-SLA | Abschnitt 7 | ⬜ |
| **P1** | **Sicherheitsupdates innerhalb 30 Tagen** | Patch-Prozess (Deps/Plattform) | Abschnitt 10.1 | 🟡 prüfen |
| **P2** | **Keine Alt-/EOL-Betriebssysteme** | Railway + Cloudflare (managed, aktuell); keine selbst-betriebenen Altsysteme | Abschnitt 10.2 | ✅ erfüllt |
| **P3** | **Abgestuftes Berechtigungskonzept**, Admin-Kennungen nur für IT-Verantwortliche (Frage 3) | Infra-Adminrechte (Railway/Cloudflare/GitHub) einschränken | Abschnitt 10.3 | 🟡 prüfen |

> **Kritischster Einzelpunkt (V3):** Der Backup-Bucket **darf nicht** im selben
> Cloudflare-Konto liegen wie die Live-Uploads (`STORAGE_*`). Sonst erreicht ein
> Admin die Backups mit derselben Anmeldung wie die Produktion → die Klausel
> „separate Domäne / unabhängige 2FA" wäre **verletzt**. Daher: **eigenes
> Cloudflare-Konto, eigene 2FA.**

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
4. Das R2-API-Token ist **auf den einen Backup-Bucket beschränkt** (Scope:
   nur `jamie-backups`). R2 bietet keine feinere „nur PutObject"-Stufe — das
   ist aber unkritisch, weil die **eigentliche** Unveränderbarkeit vom
   **Object Lock (Compliance)** kommt: selbst ein geleaktes Token, das
   `DeleteObject` aufruft, kann ein Backup innerhalb der 30-Tage-Sperrfrist
   **nicht** löschen oder überschreiben.

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

> 👉 **Klick-für-Klick-Anleitung mit allen Befehlen:**
> [BACKUP-SETUP-ANLEITUNG.md](BACKUP-SETUP-ANLEITUNG.md). Die folgende Liste ist
> die Kurzfassung zum Abhaken.

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

---

## 10. Weitere zugesicherte Maßnahmen (Frage 2 + 3, über Backup hinaus)

Mit „Ja" wurden im Fragebogen auch Punkte **außerhalb der Datensicherung**
zugesichert. Sie gehören hier dokumentiert, damit nichts Zugesichertes
unbelegt bleibt.

### 10.1 Sicherheitsupdates innerhalb 30 Tagen (P1) — 🟡 prüfen

- **Plattform/OS:** Railway (Backend + Postgres) und Cloudflare sind **managed**
  → Betriebssystem- und Plattform-Patches spielt der Anbieter laufend ein.
  Kein selbst betriebener Server, der manuell gepatcht werden müsste.
- **Anwendungs-Abhängigkeiten:** Backend-Deps wurden zuletzt auf **0 bekannte
  Schwachstellen** gebracht (Audit 06/2026). Zu etablieren: **fester Rhythmus**
  (z. B. monatlich `npm audit` + Dependabot/Renovate), damit neue CVEs **binnen
  30 Tagen** behoben werden — genau das fordert die Police.
- **To-do:** Dependabot/Renovate aktivieren ODER monatlichen `npm audit`-Termin
  fixieren und protokollieren.

### 10.2 Keine Alt-/EOL-Betriebssysteme (P2) — ✅ erfüllt

- Es werden **keine** veralteten, nicht mehr mit Updates versorgten
  Betriebssysteme betrieben. Backend/DB laufen auf der aktuellen,
  herstellergepflegten Railway-/Cloudflare-Plattform. Damit ist die Klausel
  erfüllt (die „isolierte Umgebung"-Alternative wird nicht benötigt).

### 10.3 Abgestuftes Berechtigungskonzept, Admin nur für IT (Frage 3 / P3) — 🟡 prüfen

Hier ist **zwischen zwei Ebenen zu trennen:**

- **Infrastruktur-Admin (gemeint von der Police):** Vollzugriff auf
  **Railway, Cloudflare, GitHub, Domain/DNS** ist eine *administrative Kennung*
  i. S. d. Frage 3 und sollte **ausschließlich bei IT-Verantwortlichen** (Tobi)
  liegen. **To-do/Prüfen:** Haben Robert/Arno (oder Tina) Voll-Adminrechte auf
  diesen Plattformen? Falls ja → auf das nötige Minimum reduzieren, sonst ist
  die „Ja"-Antwort zu Frage 3 angreifbar.
- **Anwendungs-Admin (NICHT von der Police gemeint):** Das `is_admin`-Flag der
  JAMIE-App (Dashboard `/admin`) ist **Anwendungs-RBAC**, keine System-
  administration. Dass Tina/Robert/Arno hier Zugriff haben, ist fachlich
  begründet und berührt Frage 3 nicht — gehört aber sauber abgegrenzt
  dokumentiert, damit im Audit keine Verwechslung entsteht.

> **Empfehlung:** Kurze Liste „Wer hat wo Admin?" (Railway/Cloudflare/GitHub vs.
> App-`is_admin`) führen und bei den Infra-Plattformen das Least-Privilege-Prinzip
> durchsetzen.
