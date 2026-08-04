import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import crypto from 'crypto';
import zlib from 'zlib';
import { Readable } from 'stream';
import {
  isBackupConfigured, missingBackupEnv, getBackupConfig,
  buildDbBackupKey, parseDbBackupKey, isPrunable, retainUntilDate,
  createEncryptStream, createDecryptStream, deriveKeyIv,
  OPENSSL_MAGIC, OPENSSL_PBKDF2_ITERATIONS, DB_BACKUP_PREFIX,
} from '../../src/jobs/backup.js';

const BACKUP_VARS = [
  'BACKUP_R2_ACCOUNT_ID', 'BACKUP_R2_ENDPOINT', 'BACKUP_R2_ACCESS_KEY_ID',
  'BACKUP_R2_SECRET_ACCESS_KEY', 'BACKUP_R2_BUCKET', 'BACKUP_ENCRYPTION_KEY',
  'BACKUP_RETENTION_DAYS', 'BACKUP_PRUNE_AFTER_DAYS', 'BACKUP_MIN_BYTES',
];
const saved = Object.fromEntries(BACKUP_VARS.map(k => [k, process.env[k]]));
const clearAll = () => BACKUP_VARS.forEach(k => delete process.env[k]);
const setRequired = () => {
  process.env.BACKUP_R2_ACCOUNT_ID = 'abc123';
  process.env.BACKUP_R2_ACCESS_KEY_ID = 'key';
  process.env.BACKUP_R2_SECRET_ACCESS_KEY = 'secret';
  process.env.BACKUP_R2_BUCKET = 'jamie-backups';
  process.env.BACKUP_ENCRYPTION_KEY = 'passphrase';
};

beforeEach(clearAll);
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const collect = async (stream) => {
  const bufs = [];
  for await (const b of stream) bufs.push(b);
  return Buffer.concat(bufs);
};
const encrypt = (buf, pass) => collect(Readable.from([buf]).pipe(createEncryptStream(pass)));
const decrypt = (buf, pass) => collect(Readable.from([buf]).pipe(createDecryptStream(pass)));

describe('env gating (isBackupConfigured / missingBackupEnv)', () => {
  it('is fully inert when nothing is set', () => {
    expect(isBackupConfigured()).toBe(false);
    expect(missingBackupEnv()).toHaveLength(5);
  });

  it('stays off when only some vars are set', () => {
    process.env.BACKUP_R2_ACCOUNT_ID = 'abc123';
    process.env.BACKUP_R2_ACCESS_KEY_ID = 'key';
    expect(isBackupConfigured()).toBe(false);
    expect(missingBackupEnv()).toEqual([
      'BACKUP_R2_SECRET_ACCESS_KEY', 'BACKUP_R2_BUCKET', 'BACKUP_ENCRYPTION_KEY',
    ]);
  });

  it('arms when all five are set', () => {
    setRequired();
    expect(isBackupConfigured()).toBe(true);
    expect(missingBackupEnv()).toEqual([]);
  });

  it('accepts an explicit endpoint instead of the account id', () => {
    setRequired();
    delete process.env.BACKUP_R2_ACCOUNT_ID;
    process.env.BACKUP_R2_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    expect(isBackupConfigured()).toBe(true);
  });

  it('never reads the production STORAGE_* vars', () => {
    process.env.STORAGE_ENDPOINT = 'https://prod.r2.cloudflarestorage.com';
    process.env.STORAGE_ACCESS_KEY = 'prod-key';
    process.env.STORAGE_SECRET_KEY = 'prod-secret';
    process.env.STORAGE_BUCKET = 'jamie-uploads';
    expect(isBackupConfigured()).toBe(false);
    delete process.env.STORAGE_ENDPOINT;
    delete process.env.STORAGE_ACCESS_KEY;
    delete process.env.STORAGE_SECRET_KEY;
    delete process.env.STORAGE_BUCKET;
  });
});

describe('getBackupConfig', () => {
  it('derives the R2 endpoint from the account id', () => {
    setRequired();
    expect(getBackupConfig().endpoint).toBe('https://abc123.r2.cloudflarestorage.com');
  });

  it('lets BACKUP_R2_ENDPOINT override the derived endpoint', () => {
    setRequired();
    process.env.BACKUP_R2_ENDPOINT = 'https://custom.example.com';
    expect(getBackupConfig().endpoint).toBe('https://custom.example.com');
  });

  it('uses the concept defaults: 30d retention, day-37 prune, 10 KiB min size', () => {
    setRequired();
    const cfg = getBackupConfig();
    expect(cfg.retentionDays).toBe(30);
    expect(cfg.pruneAfterDays).toBe(37);
    expect(cfg.minBytes).toBe(10240);
  });

  it('honours numeric overrides and ignores garbage values', () => {
    setRequired();
    process.env.BACKUP_RETENTION_DAYS = '60';
    process.env.BACKUP_PRUNE_AFTER_DAYS = 'not-a-number';
    const cfg = getBackupConfig();
    expect(cfg.retentionDays).toBe(60);
    expect(cfg.pruneAfterDays).toBe(37);
  });
});

describe('backup key naming', () => {
  it('matches the backup-db.sh format: db/jamie-db-<STAMP>.sql.gz.enc', () => {
    const key = buildDbBackupKey(new Date('2026-08-04T03:15:07.123Z'));
    expect(key).toBe('db/jamie-db-2026-08-04T03-15-07Z.sql.gz.enc');
    expect(key.startsWith(DB_BACKUP_PREFIX)).toBe(true);
  });

  it('round-trips through parseDbBackupKey (second precision)', () => {
    const date = new Date('2026-12-31T23:59:59.000Z');
    expect(parseDbBackupKey(buildDbBackupKey(date))?.getTime()).toBe(date.getTime());
  });

  it('sorts lexicographically in chronological order', () => {
    const a = buildDbBackupKey(new Date('2026-08-04T03:15:00Z'));
    const b = buildDbBackupKey(new Date('2026-08-05T03:15:00Z'));
    const c = buildDbBackupKey(new Date('2026-12-01T03:15:00Z'));
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });

  it('rejects foreign keys', () => {
    expect(parseDbBackupKey('media/uploads/abc.jpg')).toBeNull();
    expect(parseDbBackupKey('db/random-file.txt')).toBeNull();
    expect(parseDbBackupKey('')).toBeNull();
    expect(parseDbBackupKey(undefined)).toBeNull();
  });
});

describe('WORM retention window', () => {
  const now = new Date('2026-08-04T12:00:00Z');

  it('retainUntilDate adds exactly the retention days', () => {
    expect(retainUntilDate(now, 30).toISOString()).toBe('2026-09-03T12:00:00.000Z');
  });

  it('keeps dumps inside the 37-day window', () => {
    const fresh = { Key: buildDbBackupKey(new Date('2026-08-03T03:15:00Z')) };
    const day36 = { Key: buildDbBackupKey(new Date('2026-06-29T12:00:00Z')) };
    expect(isPrunable(fresh, now, 37)).toBe(false);
    expect(isPrunable(day36, now, 37)).toBe(false);
  });

  it('prunes dumps strictly older than the window', () => {
    const day38 = { Key: buildDbBackupKey(new Date('2026-06-27T11:00:00Z')) };
    expect(isPrunable(day38, now, 37)).toBe(true);
  });

  it('exactly at the boundary is NOT prunable (strictly older only)', () => {
    const day37 = { Key: buildDbBackupKey(new Date('2026-06-28T12:00:00Z')) };
    expect(isPrunable(day37, now, 37)).toBe(false);
  });

  it('never touches media/ replicas, whatever their age', () => {
    const ancient = { Key: 'media/uploads/old.jpg', LastModified: new Date('2020-01-01T00:00:00Z') };
    expect(isPrunable(ancient, now, 37)).toBe(false);
  });

  it('falls back to LastModified when the key stamp is unparseable', () => {
    const old = { Key: 'db/manual-upload.sql.gz.enc', LastModified: new Date('2026-01-01T00:00:00Z') };
    const fresh = { Key: 'db/manual-upload2.sql.gz.enc', LastModified: now };
    const unknown = { Key: 'db/manual-upload3.sql.gz.enc' };
    expect(isPrunable(old, now, 37)).toBe(true);
    expect(isPrunable(fresh, now, 37)).toBe(false);
    expect(isPrunable(unknown, now, 37)).toBe(false); // no date at all → keep
  });
});

describe('OpenSSL-compatible AES-256 encryption (Konzept §4)', () => {
  const pass = 'test-passphrase-42';

  it('produces the OpenSSL "Salted__" container format', async () => {
    const out = await encrypt(Buffer.from('hello world'), pass);
    expect(out.subarray(0, 8).equals(OPENSSL_MAGIC)).toBe(true);
    expect(out.length).toBeGreaterThan(16);
    expect(out.length % 16).toBe(0); // header 16 + CBC blocks
  });

  it('round-trips plaintext through encrypt → decrypt', async () => {
    const plain = crypto.randomBytes(100000); // multi-chunk through the Transform
    const restored = await decrypt(await encrypt(plain, pass), pass);
    expect(restored.equals(plain)).toBe(true);
  });

  it('round-trips a gzip payload (the real dump shape)', async () => {
    const sql = Buffer.from('-- PostgreSQL database dump\nCREATE TABLE users (id serial);\n');
    const encrypted = await encrypt(zlib.gzipSync(sql), pass);
    expect(zlib.gunzipSync(await decrypt(encrypted, pass)).equals(sql)).toBe(true);
  });

  it('matches the exact openssl enc -pbkdf2 key derivation (10000× SHA-256)', async () => {
    // Decrypts with a MANUAL decipher built per the documented OpenSSL layout —
    // proves the concept's `openssl enc -d -aes-256-cbc -pbkdf2` restore
    // one-liner keeps working on our files.
    expect(OPENSSL_PBKDF2_ITERATIONS).toBe(10000);
    const plain = Buffer.from('restore me with the openssl cli');
    const out = await encrypt(plain, pass);
    const salt = out.subarray(8, 16);
    const keyIv = crypto.pbkdf2Sync(Buffer.from(pass, 'utf8'), salt, 10000, 48, 'sha256');
    expect(keyIv.equals(Buffer.concat(Object.values(deriveKeyIv(pass, salt)).map(b => Buffer.from(b))))).toBe(true);
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyIv.subarray(0, 32), keyIv.subarray(32, 48));
    const manual = Buffer.concat([decipher.update(out.subarray(16)), decipher.final()]);
    expect(manual.equals(plain)).toBe(true);
  });

  it('fails (or garbles) with the wrong passphrase — never silently succeeds', async () => {
    const plain = Buffer.from('secret database contents');
    const encrypted = await encrypt(plain, pass);
    try {
      const out = await decrypt(encrypted, 'wrong-passphrase');
      expect(out.equals(plain)).toBe(false); // ~1/256 padding fluke: still not the plaintext
    } catch (err) {
      expect(String(err.message)).toMatch(/BACKUP_ENCRYPTION_KEY/);
    }
  });

  it('rejects non-"Salted__" input with a clear error', async () => {
    await expect(decrypt(Buffer.from('this is definitely not an encrypted backup'), pass))
      .rejects.toThrow(/Salted__/);
  });

  it('rejects truncated input (shorter than the header)', async () => {
    await expect(decrypt(Buffer.from('Salted_'), pass)).rejects.toThrow(/too short/);
  });
});
