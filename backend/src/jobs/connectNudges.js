// The Connect push — „Aus Fremden können Freundschaften werden!“ the day
// after an event (Tina 17.11.2026). Runs inside the 15-min engagement tick
// (jobs/engagementNudges.js runEngagementNudges).
//
// ONE push per event, D+1 from 10:00 until midnight and only 09:00–22:59
// Vienna — the review push's slot, which now goes to the creator alone; this
// one goes to everybody ELSE who took part (controllers/connectController.js
// has the rules of the list it opens). Meetups and club events of any size,
// as long as at least two people are still in it. The tap opens
// /group/<id>?connect=1: the new app shows the list there, an old bundle just
// opens the event page.
//
// Claimed in ONE statement and stamped BEFORE sending, like every other
// nudge: two Railway replicas never double-send, a crash loses at worst one
// push. The marker holds a COPY of groups.date (connect_nudge_sent_for), so a
// moved event gets the push again for its new date. groups.date is a Vienna
// WALL-CLOCK without zone — every comparison goes through AT TIME ZONE.
// `now` and `send` are injectable for the real-Postgres smoke tests.
//
// Emergency switch POST_EVENT_CONNECT=false: nothing is claimed or sent.
// Before the migration ran (42703/42P01) the claim throws; runEngagementNudges
// logs it and the next tick tries again.

import db from '../config/database.js';
import { sendPushToUsers } from '../controllers/pushController.js';
import { pushTexts } from '../utils/pushLocale.js';
import { joinedInTimeSql, remainingParticipantsSql } from '../utils/attendanceTiers.js';
import { parentClubGateSql } from '../utils/clubGate.js';

// Mirrors of engagementNudges.js — deliberately local, nothing is exported there.
const TZ = 'Europe/Vienna';
const DAYTIME = (p) => `EXTRACT(HOUR FROM (${p}::timestamptz AT TIME ZONE '${TZ}')) BETWEEN 9 AND 22`;

// Somebody besides the creator has to be in it — the list needs two people.
export const CONNECT_PUSH_MIN_PARTICIPANTS = 2;
export const connectPushUrl = (groupId) => `/group/${groupId}?connect=1`;

const connectEnabled = () => process.env.POST_EVENT_CONNECT !== 'false';

const CLAIM_SQL = `
  UPDATE groups g SET connect_nudge_sent_for = g.date
   WHERE g.id IN (
     SELECT x.id FROM groups x
      WHERE x.type IN ('group', 'event')
        AND x.date IS NOT NULL
        AND x.is_active = TRUE
        AND x.deleted_at IS NULL
        AND x.did_not_take_place IS NOT TRUE
        AND x.is_recurring_weekly IS NOT TRUE
        AND ${parentClubGateSql('x')}
        AND (x.connect_nudge_sent_for IS NULL OR x.connect_nudge_sent_for <> x.date)
        AND ${DAYTIME('$1')}
        AND ((x.date::date + 1)::timestamp + TIME '10:00') AT TIME ZONE '${TZ}' <= $1::timestamptz
        AND ((x.date::date + 2)::timestamp) AT TIME ZONE '${TZ}' >  $1::timestamptz
        AND ${remainingParticipantsSql('x')} >= ${CONNECT_PUSH_MIN_PARTICIPANTS}
      FOR UPDATE OF x SKIP LOCKED
      LIMIT $2
   )
   RETURNING g.id, g.name, to_char(g.date, 'YYYY-MM-DD HH24:MI:SS') AS claimed_date`;

// Who gets it: every participant but the creator, with reminders on and the
// chat not muted, never a frozen account, who has not closed this event's
// list — and who still has somebody to ask: another participant (active, in
// time) they are not friends with, not in a block with, and have not asked
// yet. An open request FROM that person counts as something to do („Annehmen“).
const RECIPIENTS_SQL = `
  SELECT gm.group_id, gm.user_id
    FROM group_members gm
    JOIN users  u ON u.id = gm.user_id
    JOIN groups g ON g.id = gm.group_id
   WHERE gm.group_id = ANY($1::int[])
     AND gm.user_id <> g.owner_id
     AND gm.notifications_muted = FALSE
     AND u.push_reminders = TRUE
     AND u.is_active IS DISTINCT FROM FALSE
     AND ${joinedInTimeSql('gm', 'g')}
     AND NOT EXISTS (SELECT 1 FROM event_connect_dismissals d
                      WHERE d.group_id = gm.group_id AND d.user_id = gm.user_id)
     AND EXISTS (
       SELECT 1 FROM group_members o
         JOIN users ou ON ou.id = o.user_id
        WHERE o.group_id = gm.group_id AND o.user_id <> gm.user_id
          AND ${joinedInTimeSql('o', 'g')}
          AND ou.is_active IS DISTINCT FROM FALSE
          AND NOT EXISTS (SELECT 1 FROM friendships f
                           WHERE ((f.requester_id = gm.user_id AND f.addressee_id = o.user_id)
                               OR (f.requester_id = o.user_id AND f.addressee_id = gm.user_id))
                             AND (f.status IN ('accepted', 'blocked')
                                  OR (f.status = 'pending' AND f.requester_id = gm.user_id))))`;

export async function runConnectNudges({ now = new Date(), limit = 200, send = sendPushToUsers } = {}) {
  if (!connectEnabled()) return { events: 0, pushes: 0 };

  const { rows: claimed } = await db.query(CLAIM_SQL, [now, limit]);
  if (!claimed.length) return { events: 0, pushes: 0 };

  let rows;
  try {
    ({ rows } = await db.query(RECIPIENTS_SQL, [claimed.map((e) => e.id)]));
  } catch (err) {
    // Undo only OUR stamp, so the next tick retries instead of never: if the
    // event was moved and claimed again for its new date meanwhile, that
    // marker must survive.
    console.error('[cron] connect nudge: recipient lookup failed, re-arming:', err.message);
    await db.query(
      `UPDATE groups g SET connect_nudge_sent_for = NULL
         FROM unnest($1::int[], $2::timestamp[]) AS c(id, d)
        WHERE g.id = c.id AND g.connect_nudge_sent_for = c.d`,
      [claimed.map((e) => e.id), claimed.map((e) => e.claimed_date)]
    ).catch(() => {});
    return { events: 0, pushes: 0 };
  }

  const byGroup = new Map();
  for (const r of rows) {
    if (!byGroup.has(r.group_id)) byGroup.set(r.group_id, []);
    byGroup.get(r.group_id).push(r.user_id);
  }

  let pushes = 0;
  await Promise.all(claimed.map((ev) => {
    const ids = byGroup.get(ev.id) || [];
    if (!ids.length) return null;
    pushes += ids.length;   // recipients dispatched to — not deliveries
    return Promise.resolve(send(ids, pushTexts('connectNudge'), null, connectPushUrl(ev.id)))
      .catch((err) => console.error(`[cron] connect nudge failed for group ${ev.id}:`, err.message));
  }));
  return { events: claimed.length, pushes };
}
