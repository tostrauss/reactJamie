/**
 * Weekly incremental media replication → backup vault (BACKUP-KONZEPT.md §2.2).
 *
 * Copies every object of the LIVE uploads bucket that is not yet present under
 * media/ in the SEPARATE backup account's bucket. Incremental by key: R2 upload
 * keys are UUIDs and never overwritten (see config/storage.js), so "key missing
 * in vault" is a complete change detector — no mtime/etag comparison needed.
 *
 * Credential separation (insurance clause V3): the SOURCE is read with the
 * production STORAGE_* credentials (unavoidable — that is where the images
 * live); the DESTINATION is written exclusively with the BACKUP_R2_*
 * credentials of the separate account. The two clients never mix.
 *
 * Deliberate properties:
 *   - Vault media is a MIRROR, not a rotation: objects deleted in the live
 *     bucket stay in the vault (that is the ransomware protection), and no
 *     lifecycle rule may ever be applied to media/ (only db/ rotates).
 *   - Each copied object gets the same opportunistic COMPLIANCE retention as
 *     the DB dumps; re-uploads never happen, so nothing fights the lock.
 *   - Weekly is enough (Konzept: "Bilder sind weniger kritisch").
 */
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import db from '../config/database.js';
import { Sentry } from '../config/sentry.js';
import { isCloudStorageEnabled } from '../config/storage.js';
import {
  isBackupConfigured, getBackupConfig, uploadBackupObject, listBackupObjects,
  recentSuccess, insertRun, finishRun,
  MEDIA_BACKUP_PREFIX, MEDIA_BACKUP_LOCK_ID,
} from './backup.js';

// Bound one run's work; the next weekly run continues where this one stopped.
const MAX_OBJECTS_PER_RUN = 10000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read-only client for the LIVE uploads bucket (production account).
let _sourceS3 = null;
const getSourceS3Client = () => {
  if (!_sourceS3) {
    _sourceS3 = new S3Client({
      region: process.env.STORAGE_REGION || 'auto',
      endpoint: process.env.STORAGE_ENDPOINT,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY,
        secretAccessKey: process.env.STORAGE_SECRET_KEY,
      },
    });
  }
  return _sourceS3;
};

export const isMediaSyncEnabled = () =>
  isBackupConfigured() && isCloudStorageEnabled() && process.env.BACKUP_MEDIA_SYNC !== 'false';

/**
 * Returns { status: 'disabled'|'skipped-lock'|'skipped-recent'|'success'|'failed', ... }.
 * Never throws.
 */
export const runMediaBackupSync = async ({ jitterMs = 0 } = {}) => {
  if (!isMediaSyncEnabled()) {
    console.log('[backup] media sync skipped — needs BACKUP_* AND STORAGE_* env (or BACKUP_MEDIA_SYNC=false was set)');
    return { status: 'disabled' };
  }
  const cfg = getBackupConfig();
  if (jitterMs > 0) await sleep(jitterMs);

  let client;
  try {
    client = await db.pool.connect();
  } catch (err) {
    console.error('[backup] ❌ MEDIA SYNC FAILED — could not get a DB connection:', err.message);
    Sentry.captureException(err, { tags: { job: 'media-backup-sync' } });
    return { status: 'failed', error: err.message };
  }
  let locked = false;
  let runId = null;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [MEDIA_BACKUP_LOCK_ID]);
    if (!rows[0].ok) {
      console.log('[backup] another replica is already running the media sync — skipping');
      return { status: 'skipped-lock' };
    }
    locked = true;

    if (await recentSuccess(client, 'media', '6 days')) {
      console.log('[backup] media sync already succeeded in the last 6 days — skipping');
      return { status: 'skipped-recent' };
    }

    runId = await insertRun(client, 'media');
    const startedAt = Date.now();
    const srcBucket = process.env.STORAGE_BUCKET;
    console.log(`[backup] media sync: ${srcBucket} → ${cfg.bucket}/${MEDIA_BACKUP_PREFIX}`);

    // Existing vault keys (without the media/ prefix) — the "already copied" set.
    const vaultKeys = new Set(
      (await listBackupObjects(MEDIA_BACKUP_PREFIX)).map((o) => o.Key.slice(MEDIA_BACKUP_PREFIX.length))
    );

    const src = getSourceS3Client();
    let listed = 0, copied = 0, copiedBytes = 0, errors = 0, deferred = 0;
    let token;
    do {
      const page = await src.send(new ListObjectsV2Command({ Bucket: srcBucket, ContinuationToken: token }));
      for (const obj of page.Contents || []) {
        listed++;
        if (vaultKeys.has(obj.Key)) continue;
        if (copied >= MAX_OBJECTS_PER_RUN) { deferred++; continue; }
        try {
          await uploadBackupObject({
            key: MEDIA_BACKUP_PREFIX + obj.Key,
            retentionDays: cfg.retentionDays,
            // Factory re-fetches on retry — a consumed stream can't be reused
            // after an object-lock-header rejection.
            getBody: async () => {
              const res = await src.send(new GetObjectCommand({ Bucket: srcBucket, Key: obj.Key }));
              return { body: res.Body, contentLength: obj.Size, contentType: res.ContentType };
            },
          });
          copied++;
          copiedBytes += obj.Size || 0;
        } catch (err) {
          errors++;
          console.error(`[backup] media sync: copy failed for ${obj.Key}: ${err.message}`);
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    const mb = (copiedBytes / 1024 / 1024).toFixed(2);
    const summary = `${copied} new object(s) copied (${mb} MB), ${listed} listed, ${errors} error(s)` +
      (deferred ? `, ${deferred} deferred to next run (cap ${MAX_OBJECTS_PER_RUN})` : '') + `, ${secs}s`;

    if (errors > 0) {
      // Honest failure — the insurer's SLA (Konzept §7) needs red runs to be red.
      const err = new Error(`media sync finished with ${errors} copy error(s)`);
      console.error(`[backup] ❌ MEDIA SYNC FAILED: ${summary}`);
      Sentry.captureException(err, { tags: { job: 'media-backup-sync' } });
      await finishRun(client, runId, { status: 'failed', bytes: copiedBytes, detail: summary });
      return { status: 'failed', copied, errors, deferred };
    }

    console.log(`[backup] ✅ media sync done: ${summary}`);
    await finishRun(client, runId, { status: 'success', bytes: copiedBytes, detail: summary });
    return { status: 'success', copied, copiedBytes, deferred };
  } catch (err) {
    console.error('[backup] ❌ MEDIA SYNC FAILED:', err.message);
    Sentry.captureException(err, { tags: { job: 'media-backup-sync' } });
    await finishRun(client, runId, { status: 'failed', detail: String(err.message).slice(0, 1000) });
    return { status: 'failed', error: err.message };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [MEDIA_BACKUP_LOCK_ID]).catch(() => {});
    client.release();
  }
};
