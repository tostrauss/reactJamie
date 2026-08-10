/**
 * Daily analytics rollup — investor-grade, PERMANENT growth metrics.
 *
 * Why this exists: raw `analytics_events` are purged after 90 days (server.js
 * cron), so DAU curves / retention cohorts could never look back further than
 * ~3 months. This job aggregates ONE permanent row per day into
 * `analytics_daily`, sourced from BOTH the (opt-in, 90-day) event stream AND
 * the permanent core tables (users, groups, messages, joins, friendships,
 * Pinnwand). Once a day is rolled up its numbers are fixed forever — the row
 * survives the 90-day purge.
 *
 * "Active user" (for DAU/WAU/MAU) = a user who did ANY tracked thing that day:
 * opened the app (analytics_events), sent a group message or DM, joined or
 * created a group/club, uploaded a Pinnwand photo, or sent a friend request.
 * Using the permanent core tables — not just the opt-in event stream — keeps
 * the numbers meaningful even for users who declined analytics consent and for
 * days older than the 90-day event window.
 *
 * Days are bucketed by UTC calendar date (matches the existing admin KPIs).
 */
import db from '../config/database.js';

// Activity sources, unioned into (user_id, day) rows over [$1, $2). All the
// permanent signals plus the event stream. Kept as one string so the DAU
// window query and the retention query share the exact same definition of
// "active". $1 = inclusive start timestamp, $2 = exclusive end timestamp.
const ACTIVITY_UNION = `
  SELECT user_id,      created_at::date AS d FROM analytics_events WHERE user_id IS NOT NULL AND created_at >= $1 AND created_at < $2
  UNION ALL SELECT user_id,   created_at::date FROM messages        WHERE user_id IS NOT NULL AND created_at >= $1 AND created_at < $2
  UNION ALL SELECT sender_id, created_at::date FROM direct_messages WHERE created_at >= $1 AND created_at < $2
  UNION ALL SELECT user_id,   joined_at::date  FROM group_members   WHERE joined_at  >= $1 AND joined_at  < $2
  UNION ALL SELECT owner_id,  created_at::date FROM groups          WHERE created_at >= $1 AND created_at < $2
  UNION ALL SELECT user_id,   created_at::date FROM user_pinnwand   WHERE created_at >= $1 AND created_at < $2
  UNION ALL SELECT requester_id, created_at::date FROM friendships  WHERE created_at >= $1 AND created_at < $2
`;

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const todayUTC = () => new Date().toISOString().slice(0, 10);

/** Fraction of the cohort that signed up on `cohortDay` who were active on `targetDay`. */
async function retention(cohortDay, targetDay) {
  const cohortStart = cohortDay, cohortEnd = addDays(cohortDay, 1);
  const targetStart = targetDay, targetEnd = addDays(targetDay, 1);
  const { rows } = await db.query(
    `WITH cohort AS (SELECT id FROM users WHERE created_at >= $3 AND created_at < $4),
          act AS (SELECT DISTINCT user_id FROM (${ACTIVITY_UNION}) x WHERE user_id IS NOT NULL)
     SELECT (SELECT COUNT(*) FROM cohort)::int AS cohort_size,
            (SELECT COUNT(*) FROM cohort c WHERE c.id IN (SELECT user_id FROM act))::int AS retained`,
    [targetStart, targetEnd, cohortStart, cohortEnd]
  );
  const { cohort_size, retained } = rows[0];
  return cohort_size > 0 ? retained / cohort_size : null;
}

/** Compute + upsert one calendar day (YYYY-MM-DD, UTC). */
export async function rollupDay(day) {
  const dayStart = day, dayEnd = addDays(day, 1), mauStart = addDays(day, -29);
  const today = todayUTC();

  // DAU / WAU / MAU from the shared activity union over the trailing 30 days.
  const active = await db.query(
    `WITH act AS (SELECT DISTINCT user_id, d FROM (${ACTIVITY_UNION}) x WHERE user_id IS NOT NULL)
     SELECT COUNT(DISTINCT user_id) FILTER (WHERE d =  $3::date)      AS dau,
            COUNT(DISTINCT user_id) FILTER (WHERE d >  $3::date - 7)  AS wau,
            COUNT(DISTINCT user_id)                                    AS mau
       FROM act`,
    [mauStart, dayEnd, day]
  );
  const { dau, wau, mau } = active.rows[0];

  // Per-day engagement counts straight from the (permanent) core tables.
  const counts = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM users          WHERE created_at >= $1 AND created_at < $2)                                              AS new_users,
       (SELECT COUNT(*) FROM groups         WHERE type='group' AND deleted_at IS NULL AND created_at >= $1 AND created_at < $2)      AS groups_created,
       (SELECT COUNT(*) FROM groups         WHERE type='group' AND date IS NOT NULL AND deleted_at IS NULL AND created_at >= $1 AND created_at < $2) AS events_created,
       (SELECT COUNT(*) FROM groups         WHERE type='club'  AND deleted_at IS NULL AND created_at >= $1 AND created_at < $2)      AS clubs_created,
       (SELECT COUNT(*) FROM group_members  WHERE joined_at  >= $1 AND joined_at  < $2)                                              AS joins,
       (SELECT COUNT(*) FROM messages       WHERE created_at >= $1 AND created_at < $2)                                              AS messages,
       (SELECT COUNT(*) FROM direct_messages WHERE created_at >= $1 AND created_at < $2)                                             AS dms,
       (SELECT COUNT(*) FROM friendships    WHERE status='accepted' AND updated_at >= $1 AND updated_at < $2)                        AS friendships,
       (SELECT COUNT(*) FROM user_pinnwand  WHERE created_at >= $1 AND created_at < $2)                                              AS photos`,
    [dayStart, dayEnd]
  );
  const c = counts.rows[0];

  // Retention of THIS day's signup cohort — only for offsets that have fully
  // elapsed (target day strictly before today). Otherwise leave NULL; the
  // nightly recompute of the trailing 31 days fills them in as time passes.
  const r = {};
  for (const n of [1, 7, 30]) {
    const target = addDays(day, n);
    r[n] = target < today ? await retention(day, target) : null;
  }

  await db.query(
    `INSERT INTO analytics_daily
       (day, dau, wau, mau, new_users, cohort_size, retention_d1, retention_d7, retention_d30,
        groups_created, events_created, clubs_created, joins, messages, dms, friendships, photos, updated_at)
     VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, CURRENT_TIMESTAMP)
     ON CONFLICT (day) DO UPDATE SET
       dau=EXCLUDED.dau, wau=EXCLUDED.wau, mau=EXCLUDED.mau,
       new_users=EXCLUDED.new_users, cohort_size=EXCLUDED.cohort_size,
       retention_d1=COALESCE(EXCLUDED.retention_d1, analytics_daily.retention_d1),
       retention_d7=COALESCE(EXCLUDED.retention_d7, analytics_daily.retention_d7),
       retention_d30=COALESCE(EXCLUDED.retention_d30, analytics_daily.retention_d30),
       groups_created=EXCLUDED.groups_created, events_created=EXCLUDED.events_created,
       clubs_created=EXCLUDED.clubs_created, joins=EXCLUDED.joins, messages=EXCLUDED.messages,
       dms=EXCLUDED.dms, friendships=EXCLUDED.friendships, photos=EXCLUDED.photos,
       updated_at=CURRENT_TIMESTAMP`,
    [day, dau, wau, mau, c.new_users, r[1], r[7], r[30],
     c.groups_created, c.events_created, c.clubs_created, c.joins, c.messages, c.dms, c.friendships, c.photos]
  );
}

/**
 * Nightly job: recompute the trailing 32 days (today + 31 back) so today's
 * numbers land and each cohort's D1/D7/D30 retention fills in once enough days
 * have elapsed. Idempotent upsert → safe to run on multiple instances.
 */
export async function runDailyRollup() {
  const today = todayUTC();
  for (let i = 0; i <= 31; i++) {
    try { await rollupDay(addDays(today, -i)); }
    catch (err) { console.error('[analytics-rollup] day failed', addDays(today, -i), err.message); }
  }
  console.log('[analytics-rollup] nightly rollup done');
}

/**
 * One-time backfill: if analytics_daily is empty, populate every day from the
 * earliest activity we can see (capped at 400 days) up to today. Permanent
 * core tables give real history; the event stream fills the last 90 days.
 */
export async function backfillIfEmpty() {
  try {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM analytics_daily');
    if (rows[0].n > 0) return;

    const earliest = await db.query(`
      SELECT MIN(d)::date AS start FROM (
        SELECT MIN(created_at) d FROM users
        UNION ALL SELECT MIN(created_at) FROM groups
        UNION ALL SELECT MIN(created_at) FROM messages
      ) x`);
    // MIN(d)::date is OID 1082, which the pinned DATE parser (database.js)
    // returns as a STRING — .toISOString() on it was a TypeError that the
    // outer catch swallowed, so restored/bootstrapped DBs silently never
    // backfilled. String() handles both shapes.
    let start = earliest.rows[0].start ? String(earliest.rows[0].start).slice(0, 10) : todayUTC();
    const cap = addDays(todayUTC(), -400);
    if (start < cap) start = cap;

    const today = todayUTC();
    let count = 0;
    for (let day = start; day <= today; day = addDays(day, 1)) {
      try { await rollupDay(day); count++; }
      catch (err) { console.error('[analytics-rollup] backfill day failed', day, err.message); }
    }
    console.log(`[analytics-rollup] backfill complete: ${count} days from ${start}`);
  } catch (err) {
    console.error('[analytics-rollup] backfill failed:', err.message);
  }
}
