// Friend feed push — "Lisa ist 'Bar Abend' beigetreten – auch dabei?"
//
// Fires after a PUBLIC join (groupController.joinGroup) and after a group is
// created (createGroup). Never for private groups, events of private clubs,
// join-request acceptances or owner invites — a friend feed must not leak a
// membership the public feed itself hides. Blocks need no extra check: a block
// REPLACES the friendships row (status 'blocked'), so `status = 'accepted'`
// already excludes the pair.
//
// Capped at FRIEND_PUSH_DAILY_CAP per recipient per LOCAL day through
// friend_push_state, claimed atomically BEFORE sending — same stance as
// category_push_state: stamp first, so two near-simultaneous joins can't both
// count as the first of the day, and two replicas can't both send.

import db from '../config/database.js';
import { sendPushToUsers } from '../controllers/pushController.js';
import { pushTexts } from './pushLocale.js';

export const FRIEND_PUSH_DAILY_CAP = 2;
const APP_TZ = 'Europe/Vienna';

/**
 * @param {{ actorId: number, groupId: number|string, kind: 'joined'|'created' }} p
 * @returns {Promise<number>} recipients pushed (0 when the group isn't public)
 */
export async function notifyFriendsOfActivity({ actorId, groupId, kind }) {
  // 1) Visibility + actor name in one round trip. Mirrors the public feed's
  //    gate (groupController.getGroups) incl. the LIVE parent club for club
  //    events — the event's own is_private is only a creation-time copy.
  const { rows: g } = await db.query(
    `SELECT g.id, g.name, u.name AS actor_name
     FROM groups g
     JOIN users u ON u.id = $2
     WHERE g.id = $1
       AND g.type IN ('group', 'event')
       AND g.is_active = TRUE
       AND g.deleted_at IS NULL
       AND g.is_private IS NOT TRUE
       AND (g.parent_club_id IS NULL OR EXISTS (
         SELECT 1 FROM groups c
         WHERE c.id = g.parent_club_id
           AND c.type = 'club'
           AND c.is_private IS NOT TRUE
           AND c.approval_status = 'approved'
           AND c.is_active = TRUE
           AND c.deleted_at IS NULL))`,
    [groupId, actorId]
  );
  if (!g.length) return 0;
  const group = g[0];

  // 2) Accepted friends who opted in, aren't in the group yet, and still have
  //    budget today — claimed in ONE statement. The ON CONFLICT … WHERE drops
  //    the capped rows, so RETURNING is exactly the set we may push to.
  const { rows: claimed } = await db.query(
    `WITH friends AS (
       SELECT CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS user_id
       FROM friendships f
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
     ),
     eligible AS (
       SELECT fr.user_id
       FROM friends fr
       JOIN users u ON u.id = fr.user_id
       WHERE u.push_friends = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM group_members gm
           WHERE gm.group_id = $2 AND gm.user_id = fr.user_id
         )
     )
     INSERT INTO friend_push_state (user_id, day, sent_count, updated_at)
     SELECT user_id, (NOW() AT TIME ZONE '${APP_TZ}')::date, 1, CURRENT_TIMESTAMP FROM eligible
     ON CONFLICT (user_id) DO UPDATE
       SET sent_count = CASE WHEN friend_push_state.day = EXCLUDED.day
                             THEN friend_push_state.sent_count + 1 ELSE 1 END,
           day        = EXCLUDED.day,
           updated_at = CURRENT_TIMESTAMP
       WHERE friend_push_state.day <> EXCLUDED.day
          OR friend_push_state.sent_count < $3
     RETURNING user_id`,
    [actorId, groupId, FRIEND_PUSH_DAILY_CAP]
  );
  if (!claimed.length) return 0;

  // Distinct URL → own notification slot in the service worker (which keys on
  // the URL); GroupDetail ignores the query string.
  await sendPushToUsers(
    claimed.map(r => r.user_id),
    pushTexts(kind === 'created' ? 'friendCreated' : 'friendJoined', {
      name: group.actor_name,
      groupName: group.name || '',
    }),
    null,
    `/group/${group.id}?via=friend`
  );
  return claimed.length;
}
