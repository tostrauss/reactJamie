/**
 * Monthly budget for the "Neue Gruppe in deiner Kategorie" pushes.
 *
 * Tina, 07.11.2026: „2× im Monat (dass Gruppen in der Lieblingskategorie
 * entstanden sind, eh wie wir's haben, aber nicht so oft)". The existing
 * mechanics stay — one immediate push per 24 h, further matches bundled into
 * the 18:00 digest — but every push of either kind now draws from a budget of
 * CATEGORY_PUSH_MONTHLY_CAP per Vienna calendar month. Once it is spent, the
 * user hears nothing more about new groups until the month turns; the groups
 * are in the feed anyway.
 *
 * Every claim is a single atomic statement (INSERT … ON CONFLICT … WHERE …
 * RETURNING / UPDATE … RETURNING), so two near-simultaneous creations or two
 * Railway replicas can never both spend the last unit.
 */
import db from '../config/database.js';
import { sendPushToUsers } from '../controllers/pushController.js';
import { categoryDigestText } from './pushLocale.js';

export const CATEGORY_PUSH_MONTHLY_CAP = (() => {
  const n = Number.parseInt(process.env.CATEGORY_PUSH_MONTHLY_CAP, 10);
  return Number.isFinite(n) && n >= 0 ? n : 2;
})();

// First day of the current calendar month in Vienna. `now` is injectable for
// the smoke tests (never couple test data to the real NOW()).
const monthKeySql = (nowParam) =>
  `(date_trunc('month', ${nowParam} AT TIME ZONE 'Europe/Vienna'))::date`;

/**
 * Spend one unit for each user who still has budget and stamp their 24 h
 * immediate marker. Returns the ids that may be pushed now.
 */
export async function claimImmediate(userIds, { now = null, cap = CATEGORY_PUSH_MONTHLY_CAP } = {}) {
  if (!userIds.length || cap <= 0) return [];
  const { rows } = await db.query(
    `INSERT INTO category_push_state (user_id, last_immediate_at, month_key, month_sent, updated_at)
     SELECT unnest($1::int[]), COALESCE($2::timestamptz, NOW()), ${monthKeySql('COALESCE($2::timestamptz, NOW())')}, 1, CURRENT_TIMESTAMP
     ON CONFLICT (user_id) DO UPDATE
       SET last_immediate_at = EXCLUDED.last_immediate_at,
           month_sent = CASE WHEN category_push_state.month_key = EXCLUDED.month_key
                             THEN category_push_state.month_sent + 1 ELSE 1 END,
           month_key  = EXCLUDED.month_key,
           updated_at = CURRENT_TIMESTAMP
       WHERE category_push_state.month_key IS DISTINCT FROM EXCLUDED.month_key
          OR category_push_state.month_sent < $3
     RETURNING user_id`,
    [userIds, now, cap]
  );
  return rows.map((r) => r.user_id);
}

/**
 * Queue a suppressed match for tonight's digest — only for users who still
 * have budget this month (a pending count nobody will ever receive is noise).
 */
export async function bumpPending(userIds, { now = null, cap = CATEGORY_PUSH_MONTHLY_CAP } = {}) {
  if (!userIds.length || cap <= 0) return;
  await db.query(
    `INSERT INTO category_push_state (user_id, pending_count, updated_at)
     SELECT unnest($1::int[]), 1, CURRENT_TIMESTAMP
     ON CONFLICT (user_id) DO UPDATE
       SET pending_count = category_push_state.pending_count + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE category_push_state.month_key IS DISTINCT FROM ${monthKeySql('COALESCE($2::timestamptz, NOW())')}
          OR category_push_state.month_sent < $3`,
    [userIds, now, cap]
  );
}

/**
 * The 18:00 digest: claim every pending row whose owner still has budget,
 * spend one unit, and send ONE bundled push per user. Pending rows of users
 * over budget are cleared without a push. Returns how many users were pushed.
 */
export async function runCategoryDigest({ now = null, cap = CATEGORY_PUSH_MONTHLY_CAP, send = sendPushToUsers } = {}) {
  const month = monthKeySql('COALESCE($1::timestamptz, NOW())');
  // NB: RETURNING sees the post-UPDATE row (pending_count = 0), so the
  // pre-claim count comes from a self-join alias (`old`).
  const { rows } = cap <= 0 ? { rows: [] } : await db.query(
    `UPDATE category_push_state s
        SET pending_count = 0,
            month_sent = CASE WHEN old.month_key = ${month} THEN old.month_sent + 1 ELSE 1 END,
            month_key  = ${month},
            updated_at = CURRENT_TIMESTAMP
       FROM category_push_state old
       JOIN users u ON u.id = old.user_id
      WHERE old.user_id = s.user_id
        AND old.pending_count > 0
        AND (old.month_key IS DISTINCT FROM ${month} OR old.month_sent < $2)
      RETURNING s.user_id, old.pending_count AS claimed_count, u.locale`,
    [now, cap]
  );
  // Pending rows of users who are out of budget are dropped. Scoped to exactly
  // those rows, so a bump landing between the two statements survives for the
  // next digest instead of being wiped.
  if (cap <= 0) {
    await db.query(`UPDATE category_push_state SET pending_count = 0 WHERE pending_count > 0`);
  } else {
    await db.query(
      `UPDATE category_push_state SET pending_count = 0
        WHERE pending_count > 0 AND month_key = ${month} AND month_sent >= $2`,
      [now, cap]
    );
  }

  // Bucket by (locale, count) — identical text shares one bulk send.
  const buckets = new Map();
  for (const r of rows) {
    const key = `${r.locale || 'de'}:${r.claimed_count}`;
    if (!buckets.has(key)) buckets.set(key, { locale: r.locale, count: r.claimed_count, ids: [] });
    buckets.get(key).ids.push(r.user_id);
  }
  let sent = 0;
  for (const { locale, count, ids } of buckets.values()) {
    if (!count || count < 1) continue;
    const { title, body } = categoryDigestText(locale, count);
    send(ids, title, body, '/home');
    sent += ids.length;
  }
  return sent;
}
