// ==========================================
// Weekly group-join limit for free accounts (Tina's idea, 12.10.2026)
// ==========================================
// "Wenn wir limitieren würden, dass man nur xy Amount of Gruppen … in der
// Woche [beitreten kann] und so ein Popup kommt …, dann hätten wir da schon
// paar Kunden. So wie bei Swipes auf Hinge. Plus es würde auch so manche
// sicher abhalten, einfach überall reinzugehen." Decided with Tobi 12.10.:
//   • 3 per rolling 7 days (FREE_WEEKLY_GROUP_JOINS, 0 = switched off)
//   • plain GROUPS only — clubs and club events stay free (new users join
//     clubs straight from the onboarding page)
//   • a join REQUEST counts when it is sent; a REJECTED request gives the
//     slot back. Withdrawing does not (request/withdraw would be free spam).
//   • JAMIE Pro and app admins are unlimited.
//
// Counted from its own log, not from group_members: leaving deletes the
// membership row, so join → leave → join would otherwise refill the budget.
// Every helper fails OPEN on a missing table (42P01/42703): the server takes
// traffic before startup migrations finish, and a join must never 500 — or
// be refused — because a counter table is not there yet.

export const DEFAULT_WEEKLY_GROUP_JOINS = 3;

/** The weekly allowance; FREE_WEEKLY_GROUP_JOINS=0 switches the limit off. */
export function freeWeeklyGroupJoins(env = process.env) {
  const raw = env.FREE_WEEKLY_GROUP_JOINS;
  if (raw === undefined || raw === '') return DEFAULT_WEEKLY_GROUP_JOINS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_WEEKLY_GROUP_JOINS;
}

/** Only plain groups count — not clubs, not club events (type 'event'). */
export const countsTowardWeeklyLimit = (g) => g?.type === 'group' && !g.parent_club_id;

const isSchemaMissing = (err) => err?.code === '42P01' || err?.code === '42703';

/**
 * What this week already used.
 *   used           distinct groups joined / requested in the last 7 days,
 *                  minus requests that were rejected
 *   alreadyCounted this group is one of them — joining it again (e.g. after
 *                  leaving) does not cost a second slot, so it is never refused
 *   resetsAt       when the oldest counted entry drops out of the window
 */
export async function weeklyJoinState(db, userId, groupId) {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(DISTINCT l.group_id)::int                         AS used,
              COALESCE(BOOL_OR(l.group_id = $2), FALSE)               AS already_counted,
              MIN(l.created_at) + INTERVAL '7 days'                   AS resets_at
         FROM group_join_log l
         LEFT JOIN group_join_requests r
                ON r.group_id = l.group_id AND r.user_id = l.user_id
        WHERE l.user_id = $1
          AND l.created_at > NOW() - INTERVAL '7 days'
          AND NOT (l.kind = 'request' AND r.status IS NOT DISTINCT FROM 'rejected')`,
      [userId, groupId]
    );
    const row = rows[0] || {};
    return { used: row.used || 0, alreadyCounted: !!row.already_counted, resetsAt: row.resets_at || null };
  } catch (err) {
    if (isSchemaMissing(err)) return { used: 0, alreadyCounted: false, resetsAt: null };
    throw err;
  }
}

/** Record a join or a sent request. Best-effort: never fails the join itself. */
export async function logGroupJoin(db, userId, groupId, kind) {
  try {
    await db.query(
      'INSERT INTO group_join_log (user_id, group_id, kind) VALUES ($1, $2, $3)',
      [userId, groupId, kind]
    );
  } catch (err) {
    if (!isSchemaMissing(err)) console.error('[weekly-join-limit] log failed:', err.message);
  }
}

/** Pro subscribers and app admins are not limited. */
export async function weeklyLimitExempt(db, userId, isUserPro) {
  try {
    const { rows } = await db.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    if (rows[0]?.is_admin) return true;
  } catch { /* fall through to the Pro check */ }
  try {
    return await isUserPro(userId);
  } catch {
    return false;
  }
}

/** "16.10." in Vienna time — a day, not a moment, is what people plan with. */
const viennaDay = (d) => new Date(d).toLocaleDateString('de-AT', {
  timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit',
});

/**
 * The 403 body. The German sentence is the fallback that shipped clients show
 * verbatim, so it deliberately does NOT mention JAMIE Pro: an older iOS bundle
 * has no in-app purchase, and pointing it at a paid upgrade it cannot buy is
 * exactly what App Review 3.1.1 rejects. New clients branch on `code` and open
 * the Pro sheet themselves where buying is possible.
 */
export function weeklyLimitBody(limit, resetsAt) {
  const on = resetsAt ? viennaDay(resetsAt) : null;
  return {
    error: on
      ? `Du bist diese Woche schon ${limit} Gruppen beigetreten. Ab ${on} kannst du wieder einer neuen Gruppe beitreten.`
      : `Du bist diese Woche schon ${limit} Gruppen beigetreten.`,
    code: 'WEEKLY_JOIN_LIMIT',
    limit,
    resets_at: resetsAt ? new Date(resetsAt).toISOString() : null,
    resets_on: on,
  };
}
