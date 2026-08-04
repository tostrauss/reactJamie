/**
 * Nightly offsite DB backup → encrypted WORM vault (BACKUP-KONZEPT.md §2.1 Ebene B).
 *
 * What it does, in order:
 *   pg_dump (schema + ALL data) → gzip → AES-256-CBC (OpenSSL-compatible, so the
 *   concept's documented `openssl enc -d` restore command works unchanged) →
 *   upload to the SEPARATE backup Cloudflare account's R2 bucket → prune vault
 *   objects older than the WORM window.
 *
 * Insurance-critical invariants (do not weaken):
 *   - The vault lives in a SEPARATE Cloudflare account (Police-Klausel V3:
 *     "separate Domäne / unabhängige 2FA"). This module therefore reads ONLY the
 *     BACKUP_R2_* credentials — never the production STORAGE_* ones.
 *   - No plaintext leaves the process (V4): the dump is encrypted in-stream
 *     before it touches disk; the temp file is already ciphertext.
 *   - WORM (V2/V3): the uploader opportunistically asserts S3 Object Lock
 *     COMPLIANCE retention per object. R2 REALITY (verified live 2026-08-04):
 *     R2 does NOT implement the S3 Object-Lock API at all (NotImplemented) —
 *     the real, verified guarantee is Cloudflare's native **Bucket-Lock rule**
 *     `retain-db-30d` (prefix db/, 30 days; dashboard → bucket → Settings →
 *     Bucket Lock Rules, provisioned via scripts/provision-backup-bucket.js).
 *     The per-object headers stay for portability to a true S3 vault; their
 *     rejection on R2 is EXPECTED and logged as info, never a failure.
 *   - A too-small (empty/aborted) dump is NEVER uploaded: it would sit
 *     undeletable in the vault for 30 days pretending to be a good backup.
 *
 * Multi-replica safety: startup jitter + pg advisory lock (held on a dedicated
 * pool client for the whole run) + "already succeeded in the last 20 h" marker
 * in backup_runs. backup_runs doubles as the audit trail for the insurer.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import db from '../config/database.js';
import { Sentry } from '../config/sentry.js';

export const DB_BACKUP_PREFIX = 'db/';
export const MEDIA_BACKUP_PREFIX = 'media/';

// Arbitrary but stable app-wide advisory-lock ids (must differ per job).
export const DB_BACKUP_LOCK_ID = 815072601;
export const MEDIA_BACKUP_LOCK_ID = 815072602;

const intEnv = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// ── Config / env gating ─────────────────────────────────────────────────────

/**
 * The BACKUP_* block is strictly separate from the production STORAGE_* block.
 * BACKUP_R2_ENDPOINT may replace BACKUP_R2_ACCOUNT_ID (it wins when both set).
 */
export const getBackupConfig = () => ({
  endpoint:
    process.env.BACKUP_R2_ENDPOINT ||
    (process.env.BACKUP_R2_ACCOUNT_ID
      ? `https://${process.env.BACKUP_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : undefined),
  accessKeyId: process.env.BACKUP_R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.BACKUP_R2_SECRET_ACCESS_KEY,
  bucket: process.env.BACKUP_R2_BUCKET,
  encryptionKey: process.env.BACKUP_ENCRYPTION_KEY,
  retentionDays: intEnv('BACKUP_RETENTION_DAYS', 30),   // WORM window (Konzept §3/§5)
  pruneAfterDays: intEnv('BACKUP_PRUNE_AFTER_DAYS', 37), // Konzept §5: Löschung an Tag 37
  minBytes: intEnv('BACKUP_MIN_BYTES', 10240),           // reject empty/aborted dumps
});

/** Names of missing required env vars — used for the one-line startup log. */
export const missingBackupEnv = () => {
  const missing = [];
  if (!process.env.BACKUP_R2_ACCOUNT_ID && !process.env.BACKUP_R2_ENDPOINT) {
    missing.push('BACKUP_R2_ACCOUNT_ID (or BACKUP_R2_ENDPOINT)');
  }
  for (const k of ['BACKUP_R2_ACCESS_KEY_ID', 'BACKUP_R2_SECRET_ACCESS_KEY', 'BACKUP_R2_BUCKET', 'BACKUP_ENCRYPTION_KEY']) {
    if (!process.env[k]) missing.push(k);
  }
  return missing;
};

export const isBackupConfigured = () => missingBackupEnv().length === 0;

// ── Key naming (matches scripts/backup-db.sh so both paths share one vault) ──

/** db/jamie-db-YYYY-MM-DDTHH-MM-SSZ.sql.gz.enc — lexicographic sort = chronological. */
export const buildDbBackupKey = (date = new Date()) => {
  const stamp = date.toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
  return `${DB_BACKUP_PREFIX}jamie-db-${stamp}.sql.gz.enc`;
};

/** Inverse of buildDbBackupKey; null when the key isn't one of ours. */
export const parseDbBackupKey = (key) => {
  const m = /jamie-db-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.sql\.gz\.enc$/.exec(key || '');
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const retainUntilDate = (now, days) => new Date(now.getTime() + days * 86400000);

/**
 * Prune eligibility (Konzept §5): ONLY db/ dumps, ONLY strictly older than the
 * prune window (default day 37 — after the 30-day WORM lock has expired).
 * Timestamp preference: the key's own stamp (deterministic) over LastModified.
 * Media replicas are never pruned — they are a mirror, not a rotation.
 */
export const isPrunable = (obj, now, pruneAfterDays) => {
  if (!obj?.Key || !obj.Key.startsWith(DB_BACKUP_PREFIX)) return false;
  const ts = parseDbBackupKey(obj.Key) || (obj.LastModified ? new Date(obj.LastModified) : null);
  if (!ts || Number.isNaN(ts.getTime())) return false;
  return now.getTime() - ts.getTime() > pruneAfterDays * 86400000;
};

// ── OpenSSL-compatible AES-256-CBC (Konzept §4) ─────────────────────────────
// Format identical to `openssl enc -aes-256-cbc -pbkdf2 -salt`:
//   "Salted__" + 8-byte salt + ciphertext, key+iv = PBKDF2-HMAC-SHA256,
//   10000 iterations, 48 bytes (32 key + 16 iv) — openssl 1.1.1+/3.x defaults.
// This keeps the concept's documented one-liner restore command valid:
//   openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$BACKUP_ENCRYPTION_KEY"

export const OPENSSL_MAGIC = Buffer.from('Salted__');
export const OPENSSL_PBKDF2_ITERATIONS = 10000;

export const deriveKeyIv = (passphrase, salt) => {
  const keyIv = crypto.pbkdf2Sync(Buffer.from(passphrase, 'utf8'), salt, OPENSSL_PBKDF2_ITERATIONS, 48, 'sha256');
  return { key: keyIv.subarray(0, 32), iv: keyIv.subarray(32, 48) };
};

/** Transform: plaintext in → "Salted__"+salt+AES-256-CBC ciphertext out. */
export const createEncryptStream = (passphrase, salt = crypto.randomBytes(8)) => {
  const { key, iv } = deriveKeyIv(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let headerSent = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      try {
        if (!headerSent) { this.push(Buffer.concat([OPENSSL_MAGIC, salt])); headerSent = true; }
        const out = cipher.update(chunk);
        if (out.length) this.push(out);
        cb();
      } catch (err) { cb(err); }
    },
    flush(cb) {
      try {
        if (!headerSent) { this.push(Buffer.concat([OPENSSL_MAGIC, salt])); headerSent = true; }
        this.push(cipher.final());
        cb();
      } catch (err) { cb(err); }
    },
  });
};

/** Transform: "Salted__"-format ciphertext in → plaintext out. Throws on wrong key. */
export const createDecryptStream = (passphrase) => {
  let header = Buffer.alloc(0);
  let decipher = null;
  return new Transform({
    transform(chunk, _enc, cb) {
      try {
        if (!decipher) {
          header = Buffer.concat([header, chunk]);
          if (header.length < 16) return cb();
          if (!header.subarray(0, 8).equals(OPENSSL_MAGIC)) {
            return cb(new Error('not an OpenSSL "Salted__" file — is this really a jamie-db-*.sql.gz.enc backup?'));
          }
          const { key, iv } = deriveKeyIv(passphrase, header.subarray(8, 16));
          decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
          const rest = header.subarray(16);
          if (rest.length) this.push(decipher.update(rest));
          return cb();
        }
        const out = decipher.update(chunk);
        if (out.length) this.push(out);
        cb();
      } catch (err) { cb(err); }
    },
    flush(cb) {
      if (!decipher) return cb(new Error('backup file too short — missing "Salted__" header'));
      try {
        this.push(decipher.final());
        cb();
      } catch (err) {
        cb(new Error(`decryption failed — wrong BACKUP_ENCRYPTION_KEY? (${err.message})`));
      }
    },
  });
};

// ── Backup-account S3 client (NEVER the production STORAGE_* client) ────────

let _backupS3 = null;
export const getBackupS3Client = () => {
  if (!_backupS3) {
    const cfg = getBackupConfig();
    _backupS3 = new S3Client({
      region: 'auto',
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  return _backupS3;
};

// Once the bucket rejects Object-Lock headers we stop sending them for this
// process lifetime (avoids a doomed extra round-trip per media object). The
// bucket-side default retention still applies; the warning below tells Tobi
// to verify it.
let _lockHeadersRejected = false;

/**
 * Upload one object to the vault, asserting WORM retention opportunistically.
 * `getBody` is an (async) factory returning { body, contentLength, contentType }
 * — a factory because a consumed stream cannot be retried after a lock-header
 * rejection.
 */
export const uploadBackupObject = async ({ key, getBody, retentionDays }) => {
  const cfg = getBackupConfig();
  const s3 = getBackupS3Client();

  if (!_lockHeadersRejected && retentionDays > 0) {
    const { body, contentLength, contentType } = await getBody();
    try {
      await s3.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentLength: contentLength,
        ContentType: contentType,
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: retainUntilDate(new Date(), retentionDays),
      }));
      return { locked: true };
    } catch (err) {
      // 4xx/501 = the bucket genuinely refuses lock headers (created without
      // Object Lock) → latch the flag so we stop wasting a round-trip per
      // object. Transient errors (network, 5xx) fall through to a plain retry
      // WITHOUT latching — the next upload tries lock headers again.
      const status = err?.$metadata?.httpStatusCode;
      if (err.name === 'NotImplemented') {
        // R2 never implements the S3 Object-Lock API — EXPECTED, not a
        // problem: WORM comes from the bucket-level Cloudflare Bucket-Lock
        // rule `retain-db-30d` (verified 2026-08-04). Info, not warning, so
        // nightly logs don't cry wolf after every restart.
        _lockHeadersRejected = true;
        console.log('[backup] R2 rejects S3 object-lock headers (expected) — WORM via the bucket-level Bucket-Lock rule.');
      } else if ((status >= 400 && status < 500) || status === 501) {
        _lockHeadersRejected = true;
        console.warn(
          `[backup] ⚠️ Object-Lock header rejected by bucket (${err.name}: ${err.message}). ` +
          'Falling back to plain upload — WORM protection now relies SOLELY on the ' +
          'bucket-side retention rule. Verify BACKUP-SETUP-ANLEITUNG.md Schritt 3+4 ' +
          '(Bucket-Lock rule retain-db-30d enabled)!'
        );
      } else {
        console.warn(`[backup] upload with object-lock header failed (${err.name}: ${err.message}) — retrying without header`);
      }
    }
  }

  const { body, contentLength, contentType } = await getBody();
  await s3.send(new PutObjectCommand({
    Bucket: cfg.bucket, Key: key, Body: body, ContentLength: contentLength, ContentType: contentType,
  }));
  return { locked: false };
};

/** Full (paginated) listing of the vault under a prefix. */
export const listBackupObjects = async (prefix) => {
  const cfg = getBackupConfig();
  const s3 = getBackupS3Client();
  const out = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token,
    }));
    out.push(...(page.Contents || []));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
};

export const getBackupObject = async (key) => {
  const cfg = getBackupConfig();
  return getBackupS3Client().send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
};

// ── backup_runs bookkeeping (audit trail; every call failure-tolerant) ──────

export const recentSuccess = async (client, kind, interval) => {
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM backup_runs WHERE kind = $1 AND status = 'success' AND started_at > NOW() - $2::interval LIMIT 1`,
      [kind, interval]
    );
    return rows.length > 0;
  } catch {
    return false; // table missing/unreadable must never block a backup
  }
};

export const insertRun = async (client, kind) => {
  try {
    const { rows } = await client.query(
      `INSERT INTO backup_runs (kind, status) VALUES ($1, 'running') RETURNING id`, [kind]
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
};

export const finishRun = async (client, id, { status, objectKey = null, bytes = null, detail = null }) => {
  if (id === null) return;
  try {
    await client.query(
      `UPDATE backup_runs SET status = $2, object_key = $3, bytes = $4, detail = $5, finished_at = NOW() WHERE id = $1`,
      [id, status, objectKey, bytes, detail]
    );
  } catch { /* audit row is best-effort */ }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** pg_dump source — same resolution order as config/database.js. */
export const sourceDatabaseUrl = () =>
  process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USER || 'postgres'}:${encodeURIComponent(process.env.DB_PASSWORD || 'postgres')}` +
  `@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'jamie_db'}`;

// ── The dump itself ─────────────────────────────────────────────────────────

/**
 * pg_dump → gzip → AES-256 → tmp file (ciphertext only, no plaintext on disk).
 * Rejects when pg_dump exits non-zero, is missing, or output < minBytes.
 * Returns { tmpPath, bytes }.
 */
const dumpEncryptedToTmp = async (cfg) => {
  const tmpPath = path.join(os.tmpdir(), `jamie-backup-${crypto.randomUUID()}.sql.gz.enc`);

  const dump = spawn('pg_dump', ['--no-owner', '--no-privileges', '--format=plain', `--dbname=${sourceDatabaseUrl()}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  dump.stderr.on('data', (d) => { if (stderr.length < 8192) stderr += d.toString(); });

  const spawnFailed = new Promise((_res, rej) => {
    dump.on('error', (err) => rej(new Error(
      err.code === 'ENOENT'
        ? 'pg_dump not found in PATH — the Dockerfile must install postgresql-client'
        : `pg_dump spawn failed: ${err.message}`
    )));
  });
  // If the pipeline rejects first, nothing else awaits spawnFailed — mark it
  // handled so a late 'error' event can't become an unhandled rejection.
  spawnFailed.catch(() => {});
  const exited = new Promise((res) => dump.on('close', res));

  try {
    await Promise.race([
      pipeline(
        dump.stdout,
        zlib.createGzip({ level: 9 }),
        createEncryptStream(cfg.encryptionKey),
        fs.createWriteStream(tmpPath)
      ),
      spawnFailed,
    ]);

    const code = await Promise.race([exited, spawnFailed]);
    if (code !== 0) {
      throw new Error(`pg_dump exited with code ${code}: ${stderr.trim().slice(0, 1000)}`);
    }

    const { size } = await fs.promises.stat(tmpPath);
    if (size < cfg.minBytes) {
      // An empty/aborted dump must NEVER reach the vault — it would be locked
      // for 30 days while masquerading as a good backup (Konzept §7).
      throw new Error(`encrypted dump too small (${size} B < ${cfg.minBytes} B) — refusing to upload. pg_dump stderr: ${stderr.trim().slice(0, 500)}`);
    }
    return { tmpPath, bytes: size };
  } catch (err) {
    try { dump.kill('SIGKILL'); } catch { /* already gone */ }
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
};

/** Safety-net prune (primary deletion = the bucket lifecycle rule, Anleitung 4b). */
export const pruneOldDbBackups = async (now = new Date()) => {
  const cfg = getBackupConfig();
  const objects = await listBackupObjects(DB_BACKUP_PREFIX);
  let deleted = 0, rejected = 0;
  for (const obj of objects) {
    if (!isPrunable(obj, now, cfg.pruneAfterDays)) continue;
    try {
      await getBackupS3Client().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: obj.Key }));
      deleted++;
    } catch (err) {
      // Expected for objects still inside the COMPLIANCE window (or when the
      // token lacks delete rights) — the lifecycle rule will get them later.
      rejected++;
      console.log(`[backup] prune: delete rejected for ${obj.Key} (${err.name || err.message}) — object-lock/lifecycle will handle it`);
    }
  }
  if (deleted || rejected) {
    console.log(`[backup] prune: ${deleted} old dump(s) deleted, ${rejected} rejected (>${cfg.pruneAfterDays}d window)`);
  }
  return { deleted, rejected };
};

// ── The nightly job ─────────────────────────────────────────────────────────

/**
 * Returns { status: 'disabled'|'skipped-lock'|'skipped-recent'|'success'|'failed', ... }.
 * Never throws — cron callers only log; scripts/run-backup-now.js checks status.
 */
export const runDbBackup = async ({ jitterMs = 0 } = {}) => {
  if (!isBackupConfigured()) {
    console.log('[backup] db backup skipped — BACKUP_* env vars not set');
    return { status: 'disabled' };
  }
  const cfg = getBackupConfig();
  if (jitterMs > 0) await sleep(jitterMs);

  let client;
  try {
    client = await db.pool.connect();
  } catch (err) {
    console.error('[backup] ❌ DB BACKUP FAILED — could not get a DB connection:', err.message);
    Sentry.captureException(err, { tags: { job: 'db-backup' } });
    return { status: 'failed', error: err.message };
  }
  let locked = false;
  let runId = null;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [DB_BACKUP_LOCK_ID]);
    if (!rows[0].ok) {
      console.log('[backup] another replica is already running the db backup — skipping');
      return { status: 'skipped-lock' };
    }
    locked = true;

    if (await recentSuccess(client, 'db', '20 hours')) {
      console.log('[backup] db backup already succeeded in the last 20 h — skipping');
      return { status: 'skipped-recent' };
    }

    runId = await insertRun(client, 'db');
    const startedAt = Date.now();
    const key = buildDbBackupKey(new Date());
    console.log(`[backup] starting encrypted DB dump → ${key}`);

    const { tmpPath, bytes } = await dumpEncryptedToTmp(cfg);
    try {
      const { locked: wormLocked } = await uploadBackupObject({
        key,
        retentionDays: cfg.retentionDays,
        getBody: async () => ({
          body: fs.createReadStream(tmpPath),
          contentLength: bytes,
          contentType: 'application/octet-stream',
        }),
      });

      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      const mb = (bytes / 1024 / 1024).toFixed(2);
      console.log(`[backup] ✅ ${key} uploaded (${mb} MB, ${secs}s, object-lock ${wormLocked ? `COMPLIANCE +${cfg.retentionDays}d asserted` : 'NOT asserted — bucket default must cover WORM'})`);

      await finishRun(client, runId, { status: 'success', objectKey: key, bytes, detail: wormLocked ? 'object-lock asserted' : 'object-lock header rejected — relying on bucket default retention' });

      // Prune failures must never turn a good backup into a red run.
      try { await pruneOldDbBackups(); }
      catch (err) { console.error('[backup] prune failed (non-fatal):', err.message); }

      return { status: 'success', key, bytes, wormLocked };
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  } catch (err) {
    console.error('[backup] ❌ DB BACKUP FAILED:', err.message);
    Sentry.captureException(err, { tags: { job: 'db-backup' } });
    await finishRun(client, runId, { status: 'failed', detail: String(err.message).slice(0, 1000) });
    return { status: 'failed', error: err.message };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [DB_BACKUP_LOCK_ID]).catch(() => {});
    client.release();
  }
};
