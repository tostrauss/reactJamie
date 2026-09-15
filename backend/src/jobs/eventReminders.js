// Event reminders + owner nudge — runs every 15 min (wired in server.js).
//
// Three one-shot pushes per event, each claimed atomically so two Railway
// replicas never double-send (same UPDATE … FOR UPDATE SKIP LOCKED shape as
// the moment-prompt cron):
//   • day-before  — "Morgen: X · 19:00 · 6 dabei"       → members, evening before
//   • hour-before — "Heute 19:00: X"                    → members, 30–60 min before
//   • owner nudge — "Noch 2 Tage bis X — erst 1 dabei"  → owner only, 2 days before
//
// MARKERS store the EVENT DATE the push was sent for (`*_sent_for` = groups.date
// at send time), not a sent-at timestamp: when the owner moves the event,
// groups.date no longer matches and the reminder re-arms for the new date —
// without touching updateGroup/updateClubEvent (whose hand-numbered UPDATEs are
// where the 42P08 profile-save incident came from).
//
// TIMEZONE — the trap every earlier cron fell into: groups.date is a TIMESTAMP
// WITHOUT TIME ZONE holding the organiser's WALL-CLOCK (18:00 means 18:00 in
// Vienna). Comparing it to NOW() casts via the DB session zone (UTC on Railway)
// and lands 1–2 h off — the moment cron fires 3–4 h late for exactly this
// reason. Every comparison here goes through `AT TIME ZONE APP_TZ`, which turns
// the naive value into the true instant. All six launch markets (AT/DE/CH/IT/
// FR/ES) share CET/CEST, so one zone is a documented approximation, not a bug.
//
// DATE-ONLY events (every standalone group — CreateGroup.jsx sends no time) are
// stored at 00:00 → `date::time = '00:00'` is the all-day contract the UI uses
// (EventCard getUTCHours()===0). They get the day-before push only; "in an
// hour" would fire at 23:00 the night before.
//
// Excluded on purpose (follow-ups, not oversights): weekly series (date = FIRST
// occurrence; one marker would fire once per series), clubs (type='club' keeps
// a "next meetup" date in the same column — must never remind a whole roster).

import db from '../config/database.js';
import { sendPushToUser, sendPushToUsers } from '../controllers/pushController.js';
import { pushTexts } from '../utils/pushLocale.js';

export const APP_TZ = 'Europe/Vienna';
// Owner nudge fires while fewer than this many OTHER people have joined.
// members_count INCLUDES the owner (createEntityWithOwner inserts them).
export const NUDGE_MIN_OTHERS = 3;

// Shared liveness predicate (alias `x` = candidate row inside the claim).
const LIVE_EVENT = `
           x.type IN ('group', 'event')
           AND x.date IS NOT NULL
           AND x.is_active = TRUE
           AND x.deleted_at IS NULL
           AND x.did_not_take_place = FALSE
           AND x.is_recurring_weekly IS NOT TRUE
           -- A club event outlives its club: the app never hard-deletes a
           -- group row, so parent_club_id's ON DELETE CASCADE never fires and
           -- deleteClub/cancelClub touch only the club itself. Without this,
           -- members kept getting "Morgen: Clubabend · 19:00" the evening
           -- before an event whose club was deleted a week earlier — the most
           -- visible symptom of finding 24, because it actively pushes.
           -- One indexed lookup per candidate (idx_groups_parent_club), and
           -- the claim query is already row-limited.
           AND (x.parent_club_id IS NULL OR EXISTS (
                 SELECT 1 FROM groups pc
                  WHERE pc.id = x.parent_club_id
                    AND pc.is_active = TRUE
                    AND pc.deleted_at IS NULL
                    AND pc.approval_status = 'approved'
               ))`;

// $1 = now (timestamptz). Windows are half-open [from, to) in local wall-clock.
// Day-before: the evening before, 18:00 → midnight. Strict end: after midnight
// "Morgen" would be a lie, and a timed event still gets its hour push.
// Both member-facing windows skip events whose only member is the owner: an
// event created INSIDE its own window would otherwise "remind" its creator five
// minutes after creation (review 2026-09-06). Not claimed → re-evaluated next
// tick, so the push goes out as soon as someone has joined.
const DAY_WINDOW = `
           x.members_count > 1
           AND ((x.date::date - 1)::timestamp + TIME '18:00') AT TIME ZONE '${APP_TZ}' <= $1::timestamptz
           AND (x.date::date::timestamp) AT TIME ZONE '${APP_TZ}' > $1::timestamptz`;
// Hour-before: timed events only, 60 → 30 min before the true start. 30 min
// wide so one missed 15-min tick can't lose it; text says "Heute 19:00", which
// is honest at any lead time inside the window.
// Clamped to the event's LOCAL DAY: a 00:30 start has its whole window on the
// evening before, where "Heute" would be false — and, sharing the URL, would
// overwrite the correct "Morgen" banner. Such events get the day-before only.
const HOUR_WINDOW = `
           x.members_count > 1
           AND x.date::time <> '00:00'
           AND (x.date::date::timestamp) AT TIME ZONE '${APP_TZ}' <= $1::timestamptz
           AND (x.date AT TIME ZONE '${APP_TZ}') - INTERVAL '60 minutes' <= $1::timestamptz
           AND (x.date AT TIME ZONE '${APP_TZ}') - INTERVAL '30 minutes' > $1::timestamptz`;
// Owner nudge: anchored to 11:00 two days before (never a midnight push for
// date-only events), open until the day before starts. Only while not full and
// short of NUDGE_MIN_OTHERS others.
// The 6 h minimum age keeps "Noch niemand dabei – teile dein Event" from landing
// five minutes after the owner published it. created_at is a naive TIMESTAMP
// written in the DB session zone, so comparing it to a timestamptz casts back
// through that same zone — consistent on any host.
const NUDGE_WINDOW = `
           x.created_at < $1::timestamptz - INTERVAL '6 hours'
           AND ((x.date::date - 2)::timestamp + TIME '11:00') AT TIME ZONE '${APP_TZ}' <= $1::timestamptz
           AND ((x.date::date - 1)::timestamp) AT TIME ZONE '${APP_TZ}' > $1::timestamptz
           AND x.members_count - 1 < ${NUDGE_MIN_OTHERS}
           AND (x.max_members IS NULL OR x.members_count < x.max_members)`;
// Review nudge (Batch 3): the morning AFTER the event, once — anchored to
// D+1 10:00 → D+2 00:00 (≈14 h). On first deploy only YESTERDAY's events fire
// (bounded burst), and a missed 15-min tick still lands inside the window.
// GROUP events only (club events have no review flow — mirrors getPendingReviews);
// LIVE_EVENT already excludes cancelled/deleted/did-not-take-place/recurring.
const REVIEW_WINDOW = `
           x.type = 'group'
           AND ((x.date::date + 1)::timestamp + TIME '10:00') AT TIME ZONE '${APP_TZ}' <= $1::timestamptz
           AND ((x.date::date + 2)::timestamp) AT TIME ZONE '${APP_TZ}' > $1::timestamptz`;

// Pure: SQL row → pushTexts params. Exported for tests. `time_hhmm` is
// formatted in SQL with to_char on the raw column so the naive wall-clock is
// shown exactly as typed — never via a JS Date, whose getHours() depends on the
// process zone (UTC on Railway, CEST on a Vienna dev box).
export const reminderParams = (row) => ({
  groupName: row.name || '',
  time: row.time_hhmm || null,
  count: Number(row.members_count) || 0,
  location: row.location || null,
});
export const nudgeParams = (row) => ({
  groupName: row.name || '',
  others: Math.max(0, (Number(row.members_count) || 0) - 1),
});
export const reviewNudgeParams = (row) => ({ groupName: row.name || '' });

// Atomic claim: stamp the marker with the CURRENT date and hand back the rows.
// `join` lets a variant filter on the owner row (nudge → owner's preference).
// `FOR UPDATE OF x`: lock only the group row — without OF, the nudge's JOIN
// also locks the owner's users row, and an in-flight profile save would make
// SKIP LOCKED skip the event for a tick. `claimed_date` (as text, no tz
// round-trip) lets fanOut undo exactly this stamp if the roster lookup fails.
async function claim(markerCol, windowSql, { join = '', where = '' } = {}, now, limit) {
  const { rows } = await db.query(
    `UPDATE groups g SET ${markerCol} = g.date
     WHERE g.id IN (
       SELECT x.id FROM groups x
       ${join}
       WHERE ${LIVE_EVENT}
         AND (x.${markerCol} IS NULL OR x.${markerCol} <> x.date)
         AND ${windowSql}
         ${where}
       FOR UPDATE OF x SKIP LOCKED
       LIMIT $2
     )
     RETURNING g.id, g.owner_id, g.name, g.location, g.members_count,
       to_char(g.date, 'YYYY-MM-DD HH24:MI:SS') AS claimed_date,
       CASE WHEN g.date::time = '00:00' THEN NULL ELSE to_char(g.date, 'HH24:MI') END AS time_hhmm`,
    [now, limit]
  );
  return rows;
}

// Members who should get an event reminder: honours the chat-header mute
// (group_members.notifications_muted — the user's existing "leave me alone
// about this group" signal) AND the per-user Settings toggle.
async function reminderRecipients(groupIds) {
  const byGroup = new Map();
  if (!groupIds.length) return byGroup;
  const { rows } = await db.query(
    `SELECT gm.group_id, gm.user_id
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ANY($1::int[])
       AND gm.notifications_muted = FALSE
       AND u.push_reminders = TRUE`,
    [groupIds]
  );
  for (const r of rows) {
    if (!byGroup.has(r.group_id)) byGroup.set(r.group_id, []);
    byGroup.get(r.group_id).push(r.user_id);
  }
  return byGroup;
}

// Review-nudge recipients: same opt-out gates as reminders, PLUS skip anyone who
// already reviewed or dismissed this event (mirrors getPendingReviews) so the
// nudge only lands on people who still have something to do.
async function reviewNudgeRecipients(groupIds) {
  const byGroup = new Map();
  if (!groupIds.length) return byGroup;
  const { rows } = await db.query(
    `SELECT gm.group_id, gm.user_id
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ANY($1::int[])
       AND gm.notifications_muted = FALSE
       AND u.push_reminders = TRUE
       AND NOT EXISTS (SELECT 1 FROM event_reviews er
                       WHERE er.group_id = gm.group_id AND er.reviewer_id = gm.user_id)
       AND NOT EXISTS (SELECT 1 FROM event_review_dismissals d
                       WHERE d.group_id = gm.group_id AND d.user_id = gm.user_id)`,
    [groupIds]
  );
  for (const r of rows) {
    if (!byGroup.has(r.group_id)) byGroup.set(r.group_id, []);
    byGroup.get(r.group_id).push(r.user_id);
  }
  return byGroup;
}

// If the roster lookup fails AFTER the claim stamped the markers, those events
// would silently never be reminded (marker = date → never re-claimed). Re-arm
// them so the next tick retries. Push-send failures themselves are contained
// per group (sendPushToUsers never rejects, and we .catch anyway).
async function fanOut(events, markerCol, textKey, url, counters, key) {
  if (!events.length) return;
  let recipients;
  try {
    recipients = await reminderRecipients(events.map(e => e.id));
  } catch (err) {
    console.error(`[cron] ${textKey}: roster lookup failed, re-arming ${events.length} event(s):`, err.message);
    // Undo only OUR stamp: if the owner moved the event meanwhile and another
    // run already claimed + sent for the new date, that marker must survive.
    await db.query(
      `UPDATE groups g SET ${markerCol} = NULL
       FROM unnest($1::int[], $2::timestamp[]) AS c(id, d)
       WHERE g.id = c.id AND g.${markerCol} = c.d`,
      [events.map(e => e.id), events.map(e => e.claimed_date)]
    ).catch(e2 => console.error(`[cron] ${textKey}: re-arm failed too:`, e2.message));
    return;
  }
  counters[key] = events.length;
  await Promise.all(events.map(ev => {
    const ids = recipients.get(ev.id) || [];
    if (!ids.length) return null;
    counters.pushes += ids.length; // recipients dispatched to — not deliveries
    return sendPushToUsers(ids, pushTexts(textKey, reminderParams(ev)), null, url(ev))
      .catch(err => console.error(`[cron] ${textKey} failed for group ${ev.id}:`, err.message));
  }));
}

// `now` is injectable so the real-Postgres smoke test can place itself inside
// a window; production passes nothing and gets the wall clock. The three
// variants are isolated from each other: a failing claim (e.g. 42703 in the
// boot window before the migration lands) logs, and the next one still runs.
export async function runEventReminders({ now = new Date(), limit = 200 } = {}) {
  const out = { dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 0 };

  try {
    const day = await claim('reminder_day_sent_for', DAY_WINDOW, {}, now, limit);
    await fanOut(day, 'reminder_day_sent_for', 'eventReminderDay', ev => `/group/${ev.id}`, out, 'dayBefore');
  } catch (err) {
    console.error('[cron] event reminders (day-before) failed:', err.message);
  }

  try {
    const hour = await claim('reminder_hour_sent_for', HOUR_WINDOW, {}, now, limit);
    // Same URL as the day-before push on purpose: the service worker keys its
    // notification slot on the URL, so the newer "Heute 19:00" REPLACES a
    // still-unread "Morgen" banner instead of stacking under it.
    await fanOut(hour, 'reminder_hour_sent_for', 'eventReminderHour', ev => `/group/${ev.id}`, out, 'hourBefore');
  } catch (err) {
    console.error('[cron] event reminders (hour-before) failed:', err.message);
  }

  try {
    // Gated on the OWNER's Settings toggle only — deliberately NOT on their
    // chat mute of the group: this is a share nudge about their own event,
    // not chat noise.
    const nudge = await claim('owner_nudge_sent_for', NUDGE_WINDOW, {
      join: 'JOIN users o ON o.id = x.owner_id',
      where: 'AND o.push_reminders = TRUE',
    }, now, limit);
    if (nudge.length) {
      out.ownerNudge = nudge.length;
      // Distinct URL → own notification slot; it must not overwrite (or be
      // overwritten by) the event's reminder. GroupDetail ignores the query
      // and lands the owner right on the Share button.
      await Promise.all(nudge.map(ev => {
        out.pushes += 1;
        return sendPushToUser(ev.owner_id, pushTexts('ownerNudge', nudgeParams(ev)), null, `/group/${ev.id}?via=nudge`)
          .catch(err => console.error(`[cron] owner nudge failed for group ${ev.id}:`, err.message));
      }));
    }
  } catch (err) {
    console.error('[cron] event reminders (owner-nudge) failed:', err.message);
  }

  try {
    // Post-event review nudge. REVIEW_WINDOW already restricts to type='group'.
    // Own recipient query (skips reviewed/dismissed) + own params, so it can't
    // reuse the shared fanOut — but it mirrors its re-arm-on-lookup-failure.
    const review = await claim('review_nudge_sent_for', REVIEW_WINDOW, {}, now, limit);
    if (review.length) {
      let recipients = null;
      try {
        recipients = await reviewNudgeRecipients(review.map(e => e.id));
      } catch (err) {
        console.error(`[cron] review-nudge: recipient lookup failed, re-arming ${review.length} event(s):`, err.message);
        await db.query(
          `UPDATE groups g SET review_nudge_sent_for = NULL
           FROM unnest($1::int[], $2::timestamp[]) AS c(id, d)
           WHERE g.id = c.id AND g.review_nudge_sent_for = c.d`,
          [review.map(e => e.id), review.map(e => e.claimed_date)]
        ).catch(e2 => console.error('[cron] review-nudge: re-arm failed too:', e2.message));
      }
      if (recipients) {
        out.reviewNudge = review.length;
        // Deep-link to '/' — App.jsx polls getPendingReviews on load and pops the
        // EventReviewModal globally, so home is the reliable landing spot.
        await Promise.all(review.map(ev => {
          const ids = recipients.get(ev.id) || [];
          if (!ids.length) return null;
          out.pushes += ids.length;
          return sendPushToUsers(ids, pushTexts('reviewNudge', reviewNudgeParams(ev)), null, '/')
            .catch(err => console.error(`[cron] review-nudge failed for group ${ev.id}:`, err.message));
        }));
      }
    }
  } catch (err) {
    console.error('[cron] event reminders (review-nudge) failed:', err.message);
  }

  if (out.dayBefore || out.hourBefore || out.ownerNudge || out.reviewNudge) {
    console.log(`[cron] event reminders: day-before=${out.dayBefore} hour-before=${out.hourBefore} owner-nudge=${out.ownerNudge} review-nudge=${out.reviewNudge} (${out.pushes} recipients)`);
  }
  return out;
}
