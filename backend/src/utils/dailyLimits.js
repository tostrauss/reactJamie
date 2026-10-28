// ==========================================
// Daily free-account limits (Tina + Tobi, 28.10.2026)
// ==========================================
// Supersedes the weekly join limit from 12.10.2026 ("3 per rolling week").
// Tina: "Ich würde eher welche pro Tag machen … damit Leute täglich
// reingehen." Decided in the 28.10. chat:
//   • JOIN:   3 per Vienna calendar day (FREE_DAILY_GROUP_JOINS, 0 = off).
//             Plain groups AND club events count ("bei den Events ist
//             dasselbe wie bei den Gruppen"); clubs/communities never do
//             ("Clubs kann man allgemein immer beitreten").
//   • CREATE: 1 plain group per Vienna calendar day (FREE_DAILY_GROUP_CREATES,
//             0 = off). Club events and communities are NOT covered here —
//             communities have their own 3/day brake in clubController.
//   • A join REQUEST counts when it is sent; a REJECTED request gives the
//     slot back. Withdrawing does not (request/withdraw would be free spam).
//   • JAMIE Pro and app admins are unlimited (the 10/24h spam cap in
//     createGroup stays for everyone).
//
// The day is the VIENNA calendar day — the dialog says "Morgen wieder
// dabei", so the reset must be local midnight, not a rolling 24h window
// (same convention as the push triggers: AT TIME ZONE 'Europe/Vienna').
//
// Joins are counted from their own log (group_join_log), not from
// group_members: leaving deletes the membership row, so join → leave → join
// would otherwise refill the budget. Creates are counted straight from
// `groups` incl. soft-deleted rows — create → delete → create must not
// refill the budget either.
// Every helper fails OPEN on a missing table (42P01/42703): the server takes
// traffic before startup migrations finish, and a join must never 500 — or
// be refused — because a counter table is not there yet.

export const DEFAULT_DAILY_GROUP_JOINS = 3;
export const DEFAULT_DAILY_GROUP_CREATES = 1;

/** The daily join allowance; FREE_DAILY_GROUP_JOINS=0 switches the limit off. */
export function freeDailyGroupJoins(env = process.env) {
  const raw = env.FREE_DAILY_GROUP_JOINS;
  if (raw === undefined || raw === '') return DEFAULT_DAILY_GROUP_JOINS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_GROUP_JOINS;
}

/** The daily create allowance; FREE_DAILY_GROUP_CREATES=0 switches it off. */
export function freeDailyGroupCreates(env = process.env) {
  const raw = env.FREE_DAILY_GROUP_CREATES;
  if (raw === undefined || raw === '') return DEFAULT_DAILY_GROUP_CREATES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_GROUP_CREATES;
}

/**
 * Groups and club events count, clubs (and communities) never do.
 * joinGroup also resolves club ids (the mirror route), so the club
 * exclusion must be explicit, not implied.
 */
export const countsTowardJoinLimit = (g) => g?.type === 'group' || g?.type === 'event';

const isSchemaMissing = (err) => err?.code === '42P01' || err?.code === '42703';

// Vienna midnight as a timestamptz, and the next one (the reset moment).
const VIENNA_DAY_START =
  "(date_trunc('day', NOW() AT TIME ZONE 'Europe/Vienna') AT TIME ZONE 'Europe/Vienna')";
const VIENNA_NEXT_DAY =
  "((date_trunc('day', NOW() AT TIME ZONE 'Europe/Vienna') + INTERVAL '1 day') AT TIME ZONE 'Europe/Vienna')";

/**
 * What today (Vienna) already used.
 *   used           distinct groups joined / requested since Vienna midnight,
 *                  minus requests that were rejected
 *   alreadyCounted this group is one of them — joining it again (e.g. after
 *                  leaving) does not cost a second slot, so it is never refused
 *   resetsAt       the next Vienna midnight
 */
export async function dailyJoinState(db, userId, groupId) {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(DISTINCT l.group_id)::int                         AS used,
              COALESCE(BOOL_OR(l.group_id = $2), FALSE)               AS already_counted,
              ${VIENNA_NEXT_DAY}                                      AS resets_at
         FROM group_join_log l
         LEFT JOIN group_join_requests r
                ON r.group_id = l.group_id AND r.user_id = l.user_id
        WHERE l.user_id = $1
          AND l.created_at >= ${VIENNA_DAY_START}
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
    if (!isSchemaMissing(err)) console.error('[daily-join-limit] log failed:', err.message);
  }
}

/** How many plain groups this user created today (Vienna), soft-deleted included. */
export async function dailyCreateState(db, userId) {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS used, ${VIENNA_NEXT_DAY} AS resets_at
         FROM groups
        WHERE owner_id = $1
          AND type = 'group'
          AND created_at >= ${VIENNA_DAY_START}`,
      [userId]
    );
    const row = rows[0] || {};
    return { used: row.used || 0, resetsAt: row.resets_at || null };
  } catch (err) {
    if (isSchemaMissing(err)) return { used: 0, resetsAt: null };
    throw err;
  }
}

/** Pro subscribers and app admins are not limited. */
export async function limitExempt(db, userId, isUserPro) {
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

/**
 * The 403 bodies. The German sentence is the fallback that shipped clients
 * show verbatim, so it deliberately does NOT mention JAMIE Pro: an older iOS
 * bundle has no in-app purchase, and pointing it at a paid upgrade it cannot
 * buy is exactly what App Review 3.1.1 rejects. New clients branch on `code`,
 * show the "Tageslimit erreicht" sheet first (Tina 28.10.: the info must come
 * before any upsell) and open the Pro sheet only from its button.
 */
export function dailyJoinLimitBody(limit, resetsAt) {
  return {
    error: `Du bist heute schon ${limit} Gruppen beigetreten. Ab morgen kannst du wieder einer neuen Gruppe beitreten.`,
    code: 'DAILY_JOIN_LIMIT',
    limit,
    resets_at: resetsAt ? new Date(resetsAt).toISOString() : null,
  };
}

export function dailyCreateLimitBody(limit, resetsAt) {
  return {
    error: limit === 1
      ? 'Du hast heute schon ein Treffen erstellt. Ab morgen kannst du ein neues erstellen.'
      : `Du hast heute schon ${limit} Treffen erstellt. Ab morgen kannst du neue erstellen.`,
    code: 'DAILY_CREATE_LIMIT',
    limit,
    resets_at: resetsAt ? new Date(resetsAt).toISOString() : null,
  };
}
