// Hall of Fame (Lea, 18.10.2026): the events somebody took part in, and the
// photos participants add to them.
//
// The profile list used to be the CHAT LIST filtered to past dates on the
// client, so everything that changes a chat list changed somebody's history:
// leaving the chat after the meetup, the owner's „Gruppe löschen", a
// cancellation — „wenn der Chat gelöscht wird, verschwindet auch die
// Markierung". It is now its own read, from three sources that survive that:
//   - group_members, joined by the end of the event's day (joining a past
//     public event afterwards must not add it to anybody's history);
//   - hall_of_fame_entries, written when a member LEAVES once the event's day
//     has begun (leaveGroup) — the one path that deletes a real participant's
//     membership row. A kick is the owner's judgement and is not recorded;
//   - event_reviews: whoever answered „Wer war dabei?" or was ticked present
//     by somebody else was there. This also restores the history of everyone
//     who left before hall_of_fame_entries existed, with nothing to backfill.
// Soft-deleted groups keep their rows, so a group deleted AFTER its day stays
// in the list; one deleted before it never happened (attendanceTiers' rule).
//
// Pure SQL builders + small db helpers; db is injected like attendanceTiers.

import { joinedInTimeSql, blockedWithSql } from './attendanceTiers.js';

const ALIAS = /^[a-z_][a-z0-9_]*$/i;
const alias = (a) => {
  if (!ALIAS.test(a)) throw new Error(`hallOfFame: bad SQL alias ${a}`);
  return a;
};
const PARAM = /^\$[1-9][0-9]*$/;
const param = (p) => {
  if (!PARAM.test(p)) throw new Error(`hallOfFame: bad SQL parameter ${p}`);
  return p;
};

// Photos per participant per event, and per event overall. Generous for a
// meetup, small enough that one person cannot turn a card into their album.
export const MAX_PHOTOS_PER_USER = 5;
export const MAX_PHOTOS_PER_EVENT = 40;

// groups.date is Vienna wall-clock, deleted_at session-zone (UTC) wall-clock.
const VIENNA_NOW = `(NOW() AT TIME ZONE 'Europe/Vienna')`;

// A past one-off event that stands: no weekly series (its stored date is the
// FIRST occurrence and stays in the past while it runs), not cancelled
// (is_active FALSE), not „nicht stattgefunden", not deleted before its day.
// Clubs carry no date and drop out on their own.
export const hallOfFameEventSql = (a) => {
  const g = alias(a);
  return `(${g}.type IN ('group', 'event')`
    + ` AND ${g}.date IS NOT NULL`
    + ` AND ${g}.date < ${VIENNA_NOW}`
    + ` AND ${g}.is_recurring_weekly IS NOT TRUE`
    + ` AND ${g}.did_not_take_place IS NOT TRUE`
    + ` AND ${g}.is_active IS NOT FALSE`
    + ` AND (${g}.deleted_at IS NULL`
    + ` OR (${g}.deleted_at::timestamptz AT TIME ZONE 'Europe/Vienna')::date > ${g}.date::date))`;
};

// Ids of every group user `p` took part in, whatever its date — the caller
// narrows with hallOfFameEventSql. Uncorrelated, so `g.id IN (…)` is planned
// once per query; each arm starts from a user-leading index.
// withEntries=false is the boot-window fallback while the table is missing.
export const participatedIdsSql = (p, { withEntries = true } = {}) => {
  const u = param(p);
  return `(SELECT gm.group_id FROM group_members gm JOIN groups gj ON gj.id = gm.group_id`
    + ` WHERE gm.user_id = ${u} AND ${joinedInTimeSql('gm', 'gj')}`
    + (withEntries ? ` UNION SELECT h.group_id FROM hall_of_fame_entries h WHERE h.user_id = ${u}` : '')
    + ` UNION SELECT er.group_id FROM event_reviews er`
    + ` WHERE er.reviewer_id = ${u} OR (er.reviewed_user_id = ${u} AND er.was_present))`;
};

export const isMissingRelation = (err) => err?.code === '42P01';

// Called by leaveGroup BEFORE it deletes the membership row: keeps the event
// in the leaver's Hall of Fame once its day has begun. Joined-in-time like
// every other source, so join-then-leave on a past event records nothing.
// Never throws — leaving must not fail over a history row.
export async function recordHallOfFameEntry(db, groupId, userId) {
  try {
    await db.query(
      `INSERT INTO hall_of_fame_entries (user_id, group_id)
       SELECT gm.user_id, g.id
         FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
        WHERE gm.group_id = $1 AND gm.user_id = $2
          AND g.type IN ('group', 'event')
          AND g.date IS NOT NULL
          AND g.date::date <= ${VIENNA_NOW}::date
          AND g.is_recurring_weekly IS NOT TRUE
          AND ${joinedInTimeSql('gm', 'g')}
       ON CONFLICT DO NOTHING`,
      [groupId, userId]
    );
  } catch (err) {
    if (!isMissingRelation(err)) console.error('[hall-of-fame] record entry failed:', err.message);
  }
}

// A new like on a Hall-of-Fame card → an in-app notification (the bell) for
// the event's owner AND everyone who added a photo to it, never the liker,
// never across a block. Previously only the owner got a push and nothing
// stayed in the app („man kriegt keine Like-Benachrichtigungen"). One row per
// liker, event and recipient a day, so like/unlike/like cannot spam. The push
// to the owner stays where it was (notifyEventLike). Returns the inserted rows
// so the caller can emit them live; never throws.
export async function insertHofLikeNotifications(db, { groupId, likerId, title }) {
  const run = (withPhotos) => db.query(
    `/* hof-like-notify */
     INSERT INTO notifications (user_id, sender_id, type, title, message, reference_type, reference_id)
     SELECT r.uid, $2, 'hof_like', $3, NULL, 'group', $1
       FROM (SELECT g.owner_id AS uid FROM groups g WHERE g.id = $1
             ${withPhotos ? 'UNION SELECT ep.user_id FROM event_photos ep WHERE ep.group_id = $1' : ''}) r
      WHERE r.uid IS NOT NULL
        AND r.uid <> $2
        AND r.uid NOT IN ${blockedWithSql('$2')}
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.user_id = r.uid AND n.sender_id = $2 AND n.type = 'hof_like'
             AND n.reference_type = 'group' AND n.reference_id = $1
             AND n.created_at > NOW() - INTERVAL '1 day')
     RETURNING *`,
    [groupId, likerId, title]
  );
  try {
    return (await run(true)).rows;
  } catch (err) {
    if (!isMissingRelation(err)) {
      console.error('[hall-of-fame] like notification failed:', err.message);
      return [];
    }
    try { return (await run(false)).rows; } catch { return []; }
  }
}
