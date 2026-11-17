// „Hey, [Community] hat Potenzial! ✨ Jetzt fehlt nur noch das erste Treffen.
// Leg los!“ — a community that still has no meetup about a week after it was
// founded (Tina 17.11.2026). Runs inside the 15-min engagement tick
// (jobs/engagementNudges.js runEngagementNudges).
//
// WHAT counts: communities only (club_type NULL = community, the 22.10.
// split) — approved, alive, not deleted. Official clubs have their own
// partner logic.
// WHO: the creator (owner_id) only, never a frozen account.
// WHEN due: the community is at least COMMUNITY_NUDGE_AFTER_DAYS old and has
// never had an event (a deleted one counts as „had one“) — and is at most
// COMMUNITY_NUDGE_MAX_AGE_DAYS old: communities from before the deploy get
// nothing, so the first tick is no flood.
// HOW OFTEN: once per community — the marker row in community_event_nudges
// is claimed in ONE statement (INSERT … ON CONFLICT DO NOTHING RETURNING)
// and written BEFORE anything is sent, so two Railway replicas never
// double-send and a crash loses at worst one nudge.
// CHANNELS: a bell entry, a push (only with push_reminders on, only
// 09:00–22:59 Vienna — outside those hours nothing is claimed), and the card
// on the home screen (controllers/communityNudgeController.js), all leading
// to /club/<id>?newEvent=1: the new app opens the event form there, an old
// bundle just opens the community.
//
// `now` and `send` are injectable for the real-Postgres smoke test.
// Emergency switch COMMUNITY_NUDGES=false: nothing is claimed or sent.
// Before the migration ran (42P01) the claim throws; runEngagementNudges logs
// it and the next tick tries again.

import db from '../config/database.js';
import { sendPushToUsers } from '../controllers/pushController.js';
import { pushTexts } from '../utils/pushLocale.js';

export const COMMUNITY_NUDGE_AFTER_DAYS = 7;
export const COMMUNITY_NUDGE_MAX_AGE_DAYS = 30;
export const COMMUNITY_NUDGE_TYPE = 'community_first_event';
export const communityNudgeLink = (clubId) => `/club/${clubId}?newEvent=1`;

// Mirrors of engagementNudges.js — deliberately local, nothing is exported there.
const TZ = 'Europe/Vienna';
const DAYTIME = (p) => `EXTRACT(HOUR FROM (${p}::timestamptz AT TIME ZONE '${TZ}')) BETWEEN 9 AND 22`;

const nudgesEnabled = () => process.env.COMMUNITY_NUDGES !== 'false';

// groups.created_at is a naive TIMESTAMP written in the DB session zone, so
// comparing it to a timestamptz casts back through that same zone —
// consistent on any host (same reasoning as eventReminders' NUDGE_WINDOW).
const CLAIM_SQL = `
  WITH claimed AS (
    INSERT INTO community_event_nudges (club_id, due_at)
    SELECT x.id, $1::timestamptz FROM groups x
     WHERE x.type = 'club'
       AND COALESCE(x.club_type, 'community') = 'community'
       AND x.approval_status = 'approved'
       AND x.is_active = TRUE
       AND x.deleted_at IS NULL
       AND ${DAYTIME('$1')}
       AND x.created_at <= $1::timestamptz - INTERVAL '${COMMUNITY_NUDGE_AFTER_DAYS} days'
       AND x.created_at >  $1::timestamptz - INTERVAL '${COMMUNITY_NUDGE_MAX_AGE_DAYS} days'
       AND NOT EXISTS (SELECT 1 FROM groups e WHERE e.parent_club_id = x.id AND e.type = 'event')
       AND NOT EXISTS (SELECT 1 FROM community_event_nudges n WHERE n.club_id = x.id)
       AND EXISTS (SELECT 1 FROM users ou WHERE ou.id = x.owner_id AND ou.is_active IS DISTINCT FROM FALSE)
     LIMIT $2
    ON CONFLICT (club_id) DO NOTHING
    RETURNING club_id
  )
  SELECT g.id, g.name, g.owner_id, u.locale, u.push_reminders
    FROM claimed c
    JOIN groups g ON g.id = c.club_id
    JOIN users u ON u.id = g.owner_id`;

// The bell entry, in the creator's own language. notifications.link is a
// column from 2026-10: should it be missing (boot window), the row goes out
// without its link rather than not at all (newsController's rule).
async function writeBellRow(community, text) {
  const base = [community.owner_id, COMMUNITY_NUDGE_TYPE, text.title, text.body, 'club', community.id];
  try {
    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id, link)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [...base, communityNudgeLink(community.id)]
    );
  } catch (err) {
    if (err?.code !== '42703') throw err;
    console.warn('[cron] community nudge: notifications.link missing (boot window) — bell row without the link');
    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      base
    );
  }
}

export async function runCommunityEventNudges({ now = new Date(), limit = 100, send = sendPushToUsers } = {}) {
  if (!nudgesEnabled()) return { nudged: 0, pushes: 0 };

  const { rows } = await db.query(CLAIM_SQL, [now, limit]);
  let pushes = 0;
  for (const community of rows) {
    const builder = pushTexts('communityFirstEvent', { groupName: community.name || '' });
    await writeBellRow(community, builder(community.locale))
      .catch((err) => console.error(`[cron] community nudge: bell row failed for ${community.id}:`, err.message));
    if (community.push_reminders !== true) continue;
    pushes += 1;
    await Promise.resolve(send([community.owner_id], builder, null, communityNudgeLink(community.id)))
      .catch((err) => console.error(`[cron] community nudge failed for ${community.id}:`, err.message));
  }
  return { nudged: rows.length, pushes };
}
