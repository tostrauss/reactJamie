#!/usr/bin/env bash
#
# backup-db.sh — Verschlüsseltes PostgreSQL-Backup → Cloudflare R2 (unveränderbar)
#
# Erstellt einen vollständigen pg_dump, komprimiert ihn, verschlüsselt ihn mit
# AES-256 (kein Klartext verlässt den Rechner) und lädt ihn in einen separaten,
# Object-Lock-geschützten R2-Bucket. Siehe BACKUP-KONZEPT.md.
#
# Benötigte ENV-Variablen:
#   DATABASE_URL            postgres://…  (Quelle, read-only genügt)
#   BACKUP_ENCRYPTION_KEY   Passphrase für AES-256 (nur im Passwort-Manager!)
#   BACKUP_S3_BUCKET        z. B. jamie-backups
#   BACKUP_S3_ENDPOINT      z. B. https://<account>.r2.cloudflarestorage.com
#   AWS_ACCESS_KEY_ID       R2-Token mit NUR PutObject-Recht (Backup-Konto!)
#   AWS_SECRET_ACCESS_KEY   ↑
#
# Voraussetzungen: postgresql-client (pg_dump), awscli, openssl, gzip.
#
# ── Wiederherstellung ──────────────────────────────────────────────────────
#   aws s3 cp "s3://$BACKUP_S3_BUCKET/db/<DATEI>.sql.gz.enc" - \
#       --endpoint-url "$BACKUP_S3_ENDPOINT" \
#     | openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$BACKUP_ENCRYPTION_KEY" \
#     | gunzip \
#     | psql "$RESTORE_DATABASE_URL"     # NIE direkt auf Produktion!

set -euo pipefail

# ── Pflicht-Variablen prüfen ────────────────────────────────────────────────
: "${DATABASE_URL:?DATABASE_URL fehlt}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY fehlt}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET fehlt}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT fehlt}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID fehlt}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY fehlt}"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE="jamie-db-${STAMP}.sql.gz.enc"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[backup] Dump → gzip → AES-256 …"
# Streaming-Pipeline: zu keinem Zeitpunkt liegt ein unverschlüsselter Dump auf der Platte.
pg_dump --no-owner --no-privileges --format=plain "$DATABASE_URL" \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
  > "${TMP}/${FILE}"

SIZE="$(du -h "${TMP}/${FILE}" | cut -f1)"
echo "[backup] Upload → s3://${BACKUP_S3_BUCKET}/db/${FILE} (${SIZE})"
aws s3 cp "${TMP}/${FILE}" "s3://${BACKUP_S3_BUCKET}/db/${FILE}" \
  --endpoint-url "${BACKUP_S3_ENDPOINT}" \
  --only-show-errors

echo "[backup] ✅ Fertig: db/${FILE} (${SIZE})"
