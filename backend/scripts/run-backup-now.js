/**
 * run-backup-now.js — trigger the offsite backup once, outside the nightly cron.
 *
 * The in-process equivalent of the concept's "Run workflow" test step
 * (BACKUP-SETUP-ANLEITUNG.md Schritt 9): proves env vars + bucket + encryption
 * work before trusting the nightly cron. Safe to run anytime — same locks and
 * markers as the cron, so it can never collide with a running nightly job.
 * NOTE: the "already succeeded in the last 20 h" marker applies here too; a
 * second run right after a successful first one reports skipped-recent.
 *
 * Usage (locally with Railway env injected, or via railway ssh):
 *   railway run node scripts/run-backup-now.js            # DB dump → vault
 *   railway run node scripts/run-backup-now.js --media    # media sync as well
 *
 * Exit code 0 on success/skip, 1 on failure — scriptable for drills.
 */
import 'dotenv/config';
import { runDbBackup, isBackupConfigured, missingBackupEnv } from '../src/jobs/backup.js';
import { runMediaBackupSync } from '../src/jobs/mediaBackupSync.js';

if (!isBackupConfigured()) {
  console.error(`FATAL: backup env not configured — missing: ${missingBackupEnv().join(', ')}`);
  console.error('See BACKUP-SETUP-ANLEITUNG.md (BACKUP_R2_* block of the SEPARATE Cloudflare account).');
  process.exit(1);
}

const dbResult = await runDbBackup({ jitterMs: 0 });
console.log('[run-backup-now] db backup result:', dbResult);

let mediaResult = null;
if (process.argv.includes('--media')) {
  mediaResult = await runMediaBackupSync({ jitterMs: 0 });
  console.log('[run-backup-now] media sync result:', mediaResult);
}

const ok = (r) => r === null || ['success', 'skipped-recent', 'skipped-lock', 'disabled'].includes(r.status);
process.exit(ok(dbResult) && ok(mediaResult) ? 0 : 1);
