import db from '../config/database.js';

/**
 * Nightly retention purge for `analytics_events`.
 *
 * Was a single unbounded `DELETE … WHERE created_at < NOW() - INTERVAL '90 days'`
 * (server.js). Every pooled connection carries `SET statement_timeout = 30000`
 * (config/database.js), so the moment that statement exceeds 30 s it is killed
 * and FULLY ROLLED BACK — nothing deleted. The next night has even more to
 * delete, so it fails again: a permanent ratchet whose only trace is one line
 * in a catch block. `analytics_events` is the highest-volume insert in the app
 * (every screen view) and carries six indexes, so each deleted row costs six
 * index maintenance operations. At 50k users (~2.5M rows/night) the single
 * statement cannot finish. At today's ~1300 it takes well under a second —
 * which is exactly why this would have gone unnoticed until it mattered.
 * Audit 2026-09-15, finding 7.
 *
 * Chunked so each statement stays far under the timeout, and idempotent so a
 * missed night self-heals instead of ratcheting: the loop simply has more to
 * do and keeps going until it is caught up or hits its budget.
 *
 * The long-term shape is monthly RANGE partitioning with DROP PARTITION (O(1),
 * no index churn, no timeout risk at any scale). This is the version that does
 * not need a migration.
 */

// Chosen so one statement is ~100ms at current row widths — two orders of
// magnitude under the 30 s timeout even on a loaded database.
export const PURGE_CHUNK = 20_000;
// Stop after this long and log it. The next night resumes where this left off.
export const PURGE_BUDGET_MS = 10 * 60_000;
// Backstop against a pathological loop; 500 × 20k = 10M rows per run.
export const PURGE_MAX_ITERATIONS = 500;

// Dedicated lock id so two Railway replicas never fight over the same rows.
// (jobs/backup.js uses its own; keep these distinct.)
export const PURGE_LOCK_ID = 927_150_915;

/**
 * @returns {{status: string, deleted: number, iterations: number, caughtUp: boolean}}
 */
export async function runAnalyticsPurge({ now = Date.now, chunk = PURGE_CHUNK } = {}) {
  const client = await db.pool.connect();
  let locked = false;
  let deleted = 0;
  let iterations = 0;
  let caughtUp = false;

  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [PURGE_LOCK_ID]);
    if (!rows[0]?.ok) {
      console.log('[purge] another replica is already purging analytics_events — skipping');
      return { status: 'skipped-lock', deleted: 0, iterations: 0, caughtUp: false };
    }
    locked = true;

    const startedAt = now();
    while (iterations < PURGE_MAX_ITERATIONS) {
      // ctid + an ORDER BY that rides idx_analytics_created: the subquery picks
      // a bounded batch of the OLDEST rows, so each statement is predictable in
      // size regardless of how far behind the job is.
      const res = await client.query(
        `DELETE FROM analytics_events
          WHERE ctid IN (
            SELECT ctid FROM analytics_events
             WHERE created_at < NOW() - INTERVAL '90 days'
             ORDER BY created_at
             LIMIT $1
          )`,
        [chunk]
      );
      iterations++;
      deleted += res.rowCount;
      if (res.rowCount === 0) { caughtUp = true; break; }
      if (now() - startedAt > PURGE_BUDGET_MS) break;
    }

    if (caughtUp) {
      console.log(`[purge] analytics_events purged: ${deleted} rows in ${iterations} chunk(s)`);
    } else {
      // THE alarm line: the job is falling behind and the table is growing.
      // Silent truncation here would read as "purged everything" when it did not.
      console.warn(
        `[purge] analytics_events purge hit its cap after ${deleted} rows / ${iterations} chunk(s) — ` +
        'rows older than 90 days REMAIN. Consider partitioning if this repeats.'
      );
    }
    return { status: 'ok', deleted, iterations, caughtUp };
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [PURGE_LOCK_ID]).catch(() => {});
    }
    client.release();
  }
}
