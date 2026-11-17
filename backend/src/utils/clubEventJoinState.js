// What the caller's „join“ button of each event in a club's event list should
// say (audit ziel-d-privat-events, Tina-Update 17.11.2026, contract V-14).
//
// The list used to offer „Beitreten“ on every event, also on one that only
// takes requests — the request went out, the button stayed, and a second tap
// ran into a 400. Per event, additively:
//
//   joins_by_request      the event itself is private in a PUBLIC club — the
//                         same rule as groupController's usesJoinRequest. The
//                         events of a PRIVATE club inherit is_private and are
//                         gated by club membership instead: its members join
//                         directly, so there it is false.
//   join_request_status   the status of the caller's own row in
//                         group_join_requests ('pending', 'accepted',
//                         'rejected'), or null without one.
//   join_request_blocked  the caller used up their attempts (two rejections,
//                         utils/joinAttempts.js) — only where a request is the
//                         way in.
//
// Pure module: db is injected (never imports database.js). One batched query
// for the whole list. Without a caller or without events nothing is read and
// `events` comes back untouched. A database error is THROWN — the caller
// (getClubEvents) catches it and serves the list without these fields, which
// reads exactly like before.

import { JOIN_ATTEMPT_COLS, joinAttemptsExhausted } from './joinAttempts.js';

export async function attachJoinRequestState(db, { userId, clubIsPrivate, events }) {
  if (!userId || !Array.isArray(events) || events.length === 0) return events;
  const { rows } = await db.query(
    `SELECT group_id, ${JOIN_ATTEMPT_COLS} FROM group_join_requests
      WHERE user_id = $1 AND group_id = ANY($2::int[])`,
    [userId, events.map((e) => e.id)]
  );
  const byId = new Map(rows.map((r) => [r.group_id, r]));
  for (const ev of events) {
    const row = byId.get(ev.id);
    ev.joins_by_request = !!ev.is_private && clubIsPrivate === false;
    ev.join_request_status = row?.status || null;
    ev.join_request_blocked = ev.joins_by_request && joinAttemptsExhausted(row);
  }
  return events;
}
