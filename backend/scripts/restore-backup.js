/**
 * restore-backup.js — restore an encrypted DB dump from the R2 backup vault.
 *
 * ██████████████████████████████████████████████████████████████████████████
 * ██  A RESTORE OVERWRITES THE TARGET DATABASE. NEVER POINT THIS AT        ██
 * ██  PRODUCTION UNLESS YOU ARE DELIBERATELY RECOVERING FROM A DISASTER.  ██
 * ██  Default mode is DRY-RUN: it downloads + decrypts + verifies the     ██
 * ██  backup but touches NO database. Nothing is written without          ██
 * ██  --execute.                                                          ██
 * ██████████████████████████████████████████████████████████████████████████
 *
 * Usage (see also BACKUP-SETUP-ANLEITUNG.md → RESTORE-Runbook):
 *   node scripts/restore-backup.js --list
 *       List available dumps in the vault (newest last).
 *
 *   node scripts/restore-backup.js --latest
 *   node scripts/restore-backup.js --key db/jamie-db-2026-08-04T03-15-00Z.sql.gz.enc
 *       DRY-RUN (default): download, decrypt, gunzip, verify integrity and
 *       report the plain SQL size — no database is touched.
 *
 *   node scripts/restore-backup.js --latest --target postgresql://... --execute
 *       ACTUALLY restore into --target (must be an EMPTY database).
 *       Asks for interactive confirmation unless --yes is passed.
 *
 * Flags:
 *   --list                 list vault contents and exit
 *   --key <key>            exact object key (db/jamie-db-...sql.gz.enc)
 *   --latest               newest dump by timestamp in the key
 *   --target <url>         target Postgres URL (or env RESTORE_DATABASE_URL)
 *   --execute              really restore (without it: dry-run)
 *   --yes                  skip the interactive "RESTORE" confirmation
 *   --force-production     required additionally if --target equals DATABASE_URL
 *
 * Env: BACKUP_R2_ACCOUNT_ID (or BACKUP_R2_ENDPOINT), BACKUP_R2_ACCESS_KEY_ID,
 *      BACKUP_R2_SECRET_ACCESS_KEY, BACKUP_R2_BUCKET, BACKUP_ENCRYPTION_KEY.
 * Needs `psql` in PATH for --execute (Docker image has it; locally install
 * postgresql-client).
 */
import 'dotenv/config';
import { spawn } from 'child_process';
import readline from 'readline';
import zlib from 'zlib';
import { PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import {
  isBackupConfigured, missingBackupEnv, getBackupConfig,
  listBackupObjects, getBackupObject, createDecryptStream,
  parseDbBackupKey, DB_BACKUP_PREFIX,
} from '../src/jobs/backup.js';

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const argValue = (f) => {
  const i = args.indexOf(f);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

const maskUrl = (url) => {
  try { return url.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@'); } catch { return url; }
};

if (!isBackupConfigured()) {
  die(`FATAL: backup env not configured — missing: ${missingBackupEnv().join(', ')}\n` +
      'Set the BACKUP_R2_* vars of the SEPARATE backup Cloudflare account (see BACKUP-SETUP-ANLEITUNG.md).');
}

const cfg = getBackupConfig();

// ── --list ──────────────────────────────────────────────────────────────────
if (hasFlag('--list')) {
  const objects = (await listBackupObjects(DB_BACKUP_PREFIX))
    .sort((a, b) => a.Key.localeCompare(b.Key)); // stamp in key → chronological
  if (!objects.length) die(`No dumps found under ${DB_BACKUP_PREFIX} in bucket "${cfg.bucket}".`);
  console.log(`Dumps in "${cfg.bucket}" (oldest first):`);
  for (const o of objects) {
    console.log(`  ${o.Key}  ${(o.Size / 1024 / 1024).toFixed(2)} MB  ${o.LastModified?.toISOString?.() || ''}`);
  }
  process.exit(0);
}

// ── Resolve dump key ────────────────────────────────────────────────────────
let key = argValue('--key');
if (!key && hasFlag('--latest')) {
  const objects = (await listBackupObjects(DB_BACKUP_PREFIX))
    .filter((o) => parseDbBackupKey(o.Key))
    .sort((a, b) => a.Key.localeCompare(b.Key));
  if (!objects.length) die(`No dumps found under ${DB_BACKUP_PREFIX} in bucket "${cfg.bucket}".`);
  key = objects[objects.length - 1].Key;
}
if (!key) die('Pass --key <db/jamie-db-...sql.gz.enc>, --latest, or --list. See header comment for usage.');

const execute = hasFlag('--execute');
const target = argValue('--target') || process.env.RESTORE_DATABASE_URL;

if (execute) {
  if (!target) die('--execute needs --target <postgres-url> (or env RESTORE_DATABASE_URL).');
  if (process.env.DATABASE_URL && target === process.env.DATABASE_URL && !hasFlag('--force-production')) {
    die(
      '\n████ REFUSED ████\n' +
      '--target is identical to DATABASE_URL (the LIVE production database).\n' +
      'A restore DESTROYS what is there. If this is a real disaster recovery,\n' +
      'add --force-production. Otherwise restore into an EMPTY test database.\n'
    );
  }
}

console.log(`\nBackup:  s3://${cfg.bucket}/${key}`);
console.log(`Mode:    ${execute ? '⚠️  EXECUTE — WILL WRITE TO THE TARGET DB' : 'dry-run (no database touched)'}`);
if (target) console.log(`Target:  ${maskUrl(target)}`);

// ── Interactive confirmation for --execute ──────────────────────────────────
if (execute && !hasFlag('--yes')) {
  console.log(
    '\n██████████████████████████████████████████████████████████████████\n' +
    '██  FINAL WARNING: this will replay the full dump into the      ██\n' +
    '██  target database. The target should be EMPTY. This cannot    ██\n' +
    '██  be undone.                                                  ██\n' +
    '██████████████████████████████████████████████████████████████████\n'
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question('Type RESTORE to continue: ', res));
  rl.close();
  if (answer.trim() !== 'RESTORE') die('Aborted — nothing was restored.');
}

// ── Download → decrypt → gunzip → (count | psql) ───────────────────────────
const startedAt = Date.now();
const res = await getBackupObject(key);

let sqlBytes = 0;
let firstLine = null;
const counter = new PassThrough();
counter.on('data', (chunk) => {
  sqlBytes += chunk.length;
  if (firstLine === null) firstLine = chunk.toString('utf8', 0, Math.min(chunk.length, 200)).split('\n')[0];
});

if (!execute) {
  // Dry-run: full download + decrypt + gunzip proves the backup is intact and
  // the BACKUP_ENCRYPTION_KEY is correct — without touching any database.
  // (The 'data' listener above keeps `counter` flowing, so it drains itself.)
  await pipeline(res.Body, createDecryptStream(cfg.encryptionKey), zlib.createGunzip(), counter);

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n✅ DRY-RUN OK — backup is downloadable, decryptable and gunzips cleanly.');
  console.log(`   Plain SQL size: ${(sqlBytes / 1024 / 1024).toFixed(2)} MB (${secs}s)`);
  console.log(`   First line:     ${firstLine || '(empty)'}`);
  console.log('\nTo actually restore, re-run with:');
  console.log(`   node scripts/restore-backup.js --key ${key} --target <EMPTY-db-url> --execute`);
  process.exit(0);
}

// EXECUTE: stream into psql. ON_ERROR_STOP aborts on the first error, and
// --single-transaction rolls the whole restore back so a half-restored DB
// never survives. Target must be EMPTY (plain-format dump has no --clean).
const psql = spawn('psql', ['--dbname', target, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '--quiet'], {
  stdio: ['pipe', 'inherit', 'inherit'],
});
psql.on('error', (err) => {
  die(err.code === 'ENOENT'
    ? 'FATAL: psql not found in PATH — install postgresql-client.'
    : `FATAL: psql spawn failed: ${err.message}`);
});

try {
  await pipeline(res.Body, createDecryptStream(cfg.encryptionKey), zlib.createGunzip(), counter, psql.stdin);
} catch (err) {
  die(`FATAL: restore pipeline failed: ${err.message}`);
}
const code = await new Promise((r) => psql.on('close', r));
const secs = ((Date.now() - startedAt) / 1000).toFixed(1);

if (code !== 0) {
  die(`\n❌ RESTORE FAILED — psql exited with code ${code} after ${secs}s.\n` +
      'The --single-transaction flag rolled everything back; the target is unchanged.\n' +
      'Typical causes: target DB not empty, target unreachable, version mismatch.');
}

console.log(`\n✅ RESTORE COMPLETE: ${(sqlBytes / 1024 / 1024).toFixed(2)} MB of SQL applied in ${secs}s.`);
console.log('Next (BACKUP-KONZEPT.md §6): check tables + row counts, boot the backend');
console.log('against the restored DB, record duration + result in the §6 drill table.');
process.exit(0);
