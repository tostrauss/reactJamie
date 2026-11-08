// Engagement nudges — Tina's notification concept (03.11.2026) and To-Do
// (04.11.2026), decided with Tobi on 08.11.2026. Runs every 15 min (server.js).
//
//   1. momentPrompt — „📷 Wie war X? Lade ein Foto hoch und halte den Moment
//      fest!" to EVERY participant after the event (was: the creator only).
//   2. sayHello     — „Sag kurz Hallo 👋 Die anderen in X freuen sich auf
//      dich!" to a member who joined ≥ 3 h ago and has not written yet.
//   3. silence      — JAMIE's funny chat lines when nobody has written at all:
//      stage 1 a day after creation, stage 2 the day before the meetup.
//   4. coverNag     — communities without a cover photo: at 5 members
//      „Hey! Deine Community hat schon X Mitglieder…", 7 days later
//      „Huch! …um sichtbar zu bleiben!" — then never again.
//
// Every nudge is claimed in ONE statement (UPDATE … SKIP LOCKED / INSERT … ON
// CONFLICT DO NOTHING RETURNING), so two Railway replicas never double-send,
// and stamped BEFORE sending — a crash loses at worst one nudge, never spams.
// Times follow eventReminders.js: groups.date is a Vienna WALL-CLOCK without
// zone, so every comparison goes through AT TIME ZONE. `now` is injectable
// for the real-Postgres smoke tests; `send` and `post` for the same reason.
//
// Pushes go out between 09:00 and 22:59 Vienna only (a claim outside those
// hours simply doesn't happen; the windows are wide enough to catch the
// morning). Chat lines (stage 1/2) are system messages and never push —
// deliberate since 06.09. — but are still kept to the same daytime.

import db from '../config/database.js';
import { sendPushToUsers } from '../controllers/pushController.js';
import { pushTexts } from '../utils/pushLocale.js';
import { postSystemMessage, SYSTEM_TEXTS } from '../utils/systemMessage.js';
import { parentClubGateSql } from '../utils/clubGate.js';

const TZ = 'Europe/Vienna';
const LOCAL = (p) => `(${p}::timestamptz AT TIME ZONE '${TZ}')`;
const DAYTIME = (p) => `EXTRACT(HOUR FROM ${LOCAL(p)}) BETWEEN 9 AND 22`;
// The true instant an event starts; date-only events (00:00) start at the
// beginning of their day.
const START = (a) => `(${a}.date AT TIME ZONE '${TZ}')`;
// The moment an event is over for the purpose of „is it still upcoming": a
// timed event at its start, a date-only one at the end of its day.
const UPCOMING = (a, p) => `(${a}.date IS NULL OR CASE WHEN ${a}.date::time = '00:00'
             THEN ((${a}.date::date + 1)::timestamp) AT TIME ZONE '${TZ}'
             ELSE ${START(a)} END > ${p}::timestamptz)`;
const LIVE = (a) => `${a}.type IN ('group', 'event')
         AND ${a}.is_active = TRUE
         AND ${a}.deleted_at IS NULL
         AND ${a}.did_not_take_place IS NOT TRUE
         AND ${a}.is_recurring_weekly IS NOT TRUE
         AND ${parentClubGateSql(a)}`;

const byGroup = (rows, key = 'group_id') => {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
};

// ── 1. Photo push after the event ─────────────────────────────────────────
// Window: a timed event from start+3 h (the review push follows the next
// morning, so this lands the same evening) up to start+30 h; a date-only
// event the evening of its day, 21:00–24:00 (we don't know when it ended,
// and D+1 10:00 belongs to the review push). Recipients: every member with
// reminders on and the chat not muted — minus whoever already shared a photo
// of it, and minus the creator once the moment photo is set.
export async function runMomentPrompts({ now = new Date(), limit = 200, send = sendPushToUsers } = {}) {
  const claimed = await db.query(
    `UPDATE groups g SET moment_prompt_sent_at = $1::timestamptz
      WHERE g.id IN (
        SELECT x.id FROM groups x
         WHERE ${LIVE('x')}
           AND x.date IS NOT NULL
           AND x.moment_prompt_sent_at IS NULL
           AND ${DAYTIME('$1')}
           AND (
                (x.date::time <> '00:00'
                 AND ${START('x')} + INTERVAL '3 hours'  <= $1::timestamptz
                 AND ${START('x')} + INTERVAL '30 hours' >  $1::timestamptz)
             OR (x.date::time = '00:00'
                 AND ((x.date::date)::timestamp + TIME '21:00') AT TIME ZONE '${TZ}' <= $1::timestamptz
                 AND ((x.date::date + 1)::timestamp) AT TIME ZONE '${TZ}' > $1::timestamptz)
           )
         FOR UPDATE OF x SKIP LOCKED
         LIMIT $2
      )
      RETURNING g.id, g.name, g.owner_id, g.moment_photo_url IS NOT NULL AS has_moment`,
    [now, limit]
  );
  if (!claimed.rowCount) return { events: 0, pushes: 0 };

  let recipients;
  try {
    const { rows } = await db.query(
      `SELECT gm.group_id, gm.user_id
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         JOIN groups g ON g.id = gm.group_id
        WHERE gm.group_id = ANY($1::int[])
          AND gm.notifications_muted = FALSE
          AND u.push_reminders = TRUE
          AND NOT (gm.user_id = g.owner_id AND g.moment_photo_url IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM event_photos ep
                           WHERE ep.group_id = gm.group_id AND ep.user_id = gm.user_id)`,
      [claimed.rows.map(e => e.id)]
    );
    recipients = byGroup(rows);
  } catch (err) {
    // Re-arm OUR stamp only, so the next tick retries instead of never.
    console.error('[cron] moment prompt: recipient lookup failed, re-arming:', err.message);
    await db.query(
      `UPDATE groups SET moment_prompt_sent_at = NULL
        WHERE id = ANY($1::int[]) AND moment_prompt_sent_at = $2::timestamptz`,
      [claimed.rows.map(e => e.id), now]
    ).catch(() => {});
    return { events: 0, pushes: 0 };
  }

  let pushes = 0;
  await Promise.all(claimed.rows.map(ev => {
    const ids = (recipients.get(ev.id) || []).map(r => r.user_id);
    if (!ids.length) return null;
    pushes += ids.length;
    // /explore?share=1 → „Warst du dabei.."; old bundles read only ?tab and
    // land on the wall, where the upload card still is.
    return Promise.resolve(send(ids, pushTexts('momentPrompt', { groupName: ev.name || '' }), null, '/explore?share=1'))
      .catch(err => console.error(`[cron] moment prompt failed for group ${ev.id}:`, err.message));
  }));
  return { events: claimed.rowCount, pushes };
}

// ── 2. „Sag kurz Hallo" ───────────────────────────────────────────────────
// A member (not the creator — they get the in-app „Erste Nachricht
// schreiben" sheet) who joined 3–48 h ago, has not written a single message
// in this chat, and whose meetup is still ahead. Once per membership.
export async function runSayHello({ now = new Date(), limit = 500, send = sendPushToUsers } = {}) {
  const { rows } = await db.query(
    `WITH claimed AS (
       INSERT INTO chat_hello_nudges (group_id, user_id, sent_at)
       SELECT gm.group_id, gm.user_id, $1::timestamptz
         FROM group_members gm
         JOIN groups x ON x.id = gm.group_id
         JOIN users u  ON u.id = gm.user_id
        WHERE ${LIVE('x')}
          AND ${UPCOMING('x', '$1')}
          AND ${DAYTIME('$1')}
          AND x.members_count > 1
          AND gm.role IS DISTINCT FROM 'owner'
          AND gm.user_id IS DISTINCT FROM x.owner_id
          AND gm.joined_at <= $1::timestamptz - INTERVAL '3 hours'
          AND gm.joined_at >  $1::timestamptz - INTERVAL '48 hours'
          AND gm.notifications_muted = FALSE
          AND u.push_reminders = TRUE
          AND NOT EXISTS (SELECT 1 FROM messages m
                           WHERE m.group_id = gm.group_id AND m.user_id = gm.user_id)
          -- Already-nudged rows must not fill the LIMIT and starve the rest.
          AND NOT EXISTS (SELECT 1 FROM chat_hello_nudges h
                           WHERE h.group_id = gm.group_id AND h.user_id = gm.user_id)
        LIMIT $2
       ON CONFLICT (group_id, user_id) DO NOTHING
       RETURNING group_id, user_id
     )
     SELECT c.group_id, c.user_id, g.name FROM claimed c JOIN groups g ON g.id = c.group_id`,
    [now, limit]
  );
  let pushes = 0;
  await Promise.all([...byGroup(rows).entries()].map(([gid, list]) => {
    pushes += list.length;
    return Promise.resolve(send(list.map(r => r.user_id),
      pushTexts('sayHello', { groupName: list[0].name || '' }), null, `/chat/${gid}`))
      .catch(err => console.error(`[cron] say-hello failed for group ${gid}:`, err.message));
  }));
  return { pushes };
}

// ── 3. Funny lines in a silent chat ───────────────────────────────────────
// Only while NOBODY has written (system lines don't count) and someone besides
// the creator is in. Stage 1: the chat is ≥ 24 h (and ≤ 14 days) old and the
// eve of the meetup hasn't started. Stage 2: the eve — from D-1 10:00 until
// 2 h before the start (a date-only meetup: until D-1 22:00). Each at most
// once; the line rotates by group id so not every chat says the same thing.
// `pickLine` is exported for the unit tests.
export const pickLine = (stage, groupId, isEve) => {
  if (stage === 1) return SYSTEM_TEXTS.silenceEarly[groupId % SYSTEM_TEXTS.silenceEarly.length];
  return isEve ? SYSTEM_TEXTS.silenceEve[groupId % SYSTEM_TEXTS.silenceEve.length] : SYSTEM_TEXTS.silenceSoon;
};

const EVE_FROM = (a) => `(((${a}.date::date - 1)::timestamp + TIME '10:00') AT TIME ZONE '${TZ}')`;
const EVE_UNTIL = (a) => `(CASE WHEN ${a}.date::time = '00:00'
             THEN ((${a}.date::date - 1)::timestamp + TIME '22:00') AT TIME ZONE '${TZ}'
             ELSE ${START(a)} - INTERVAL '2 hours' END)`;

export async function runSilenceNudges({ now = new Date(), limit = 200, post = postSystemMessage, io } = {}) {
  const silent = (a) => `${LIVE(a)}
          AND ${DAYTIME('$1')}
          AND ${a}.members_count > 1
          AND NOT EXISTS (SELECT 1 FROM messages m
                           WHERE m.group_id = ${a}.id AND m.message_type IS DISTINCT FROM 'system')`;
  const stage1 = await db.query(
    `INSERT INTO chat_silence_nudges (group_id, stage, sent_at)
     SELECT x.id, 1, $1::timestamptz FROM groups x
      WHERE ${silent('x')}
        AND x.created_at <= $1::timestamptz - INTERVAL '24 hours'
        AND x.created_at >  $1::timestamptz - INTERVAL '14 days'
        AND ${UPCOMING('x', '$1')}
        AND (x.date IS NULL OR ${EVE_FROM('x')} > $1::timestamptz)
        AND NOT EXISTS (SELECT 1 FROM chat_silence_nudges n WHERE n.group_id = x.id AND n.stage = 1)
      LIMIT $2
     ON CONFLICT (group_id, stage) DO NOTHING
     RETURNING group_id`,
    [now, limit]
  );
  const stage2 = await db.query(
    `WITH claimed AS (
       INSERT INTO chat_silence_nudges (group_id, stage, sent_at)
       SELECT x.id, 2, $1::timestamptz FROM groups x
        WHERE ${silent('x')}
          AND x.date IS NOT NULL
          AND ${EVE_FROM('x')} <= $1::timestamptz
          AND ${EVE_UNTIL('x')} >  $1::timestamptz
          AND NOT EXISTS (SELECT 1 FROM chat_silence_nudges n WHERE n.group_id = x.id AND n.stage = 2)
        LIMIT $2
       ON CONFLICT (group_id, stage) DO NOTHING
       RETURNING group_id
     )
     SELECT c.group_id, (g.date::date - 1) = ${LOCAL('$1')}::date AS is_eve
       FROM claimed c JOIN groups g ON g.id = c.group_id`,
    [now, limit]
  );
  for (const r of stage1.rows) await post(r.group_id, pickLine(1, r.group_id), io);
  for (const r of stage2.rows) await post(r.group_id, pickLine(2, r.group_id, r.is_eve), io);
  return { stage1: stage1.rowCount, stage2: stage2.rowCount };
}

// ── 4. Cover photo for communities ────────────────────────────────────────
// Communities (club_type NULL = community, see the 22.10. split) without a
// cover picture, approved and alive, with ≥ 5 members → the owner and every
// co-manager get a push + a bell entry. Seven days later, still no picture →
// the second message. Never a third.
export const COVER_NAG_MIN_MEMBERS = 5;
export const COVER_NAG_SECOND_AFTER_DAYS = 7;

const NO_COVER_COMMUNITY = (a) => `${a}.type = 'club'
          AND COALESCE(${a}.club_type, 'community') = 'community'
          AND ${a}.approval_status = 'approved'
          AND ${a}.is_active = TRUE
          AND ${a}.deleted_at IS NULL
          AND NULLIF(${a}.image_url, '') IS NULL`;

async function notifyManagers(communities, textKey, send) {
  if (!communities.length) return 0;
  const { rows } = await db.query(
    `SELECT gm.group_id, gm.user_id, u.locale
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       JOIN groups g ON g.id = gm.group_id
      WHERE gm.group_id = ANY($1::int[])
        AND (gm.user_id = g.owner_id OR gm.role = 'admin')
        AND u.push_reminders = TRUE`,
    [communities.map(c => c.id)]
  );
  const managers = byGroup(rows);
  let pushes = 0;
  for (const c of communities) {
    const list = managers.get(c.id) || [];
    if (!list.length) continue;
    const builder = pushTexts(textKey, { groupName: c.name || '', count: Number(c.members_count) || 0 });
    // The bell entry — same text, in each manager's own language.
    await db.query(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[])`,
      [list.map(r => r.user_id),
       list.map(() => 'community_cover'),
       list.map(r => builder(r.locale).title),
       list.map(r => builder(r.locale).body),
       list.map(() => 'club'),
       list.map(() => c.id)]
    ).catch(err => console.error(`[cron] cover nag: bell row failed for ${c.id}:`, err.message));
    pushes += list.length;
    await Promise.resolve(send(list.map(r => r.user_id), builder, null, `/club/${c.id}/edit`))
      .catch(err => console.error(`[cron] cover nag failed for ${c.id}:`, err.message));
  }
  return pushes;
}

export async function runCoverNags({ now = new Date(), limit = 100, send = sendPushToUsers } = {}) {
  const first = await db.query(
    `WITH claimed AS (
       INSERT INTO community_cover_nags (group_id, first_sent_at)
       SELECT x.id, $1::timestamptz FROM groups x
        WHERE ${NO_COVER_COMMUNITY('x')}
          AND ${DAYTIME('$1')}
          AND x.members_count >= ${COVER_NAG_MIN_MEMBERS}
          AND NOT EXISTS (SELECT 1 FROM community_cover_nags n WHERE n.group_id = x.id)
        LIMIT $2
       ON CONFLICT (group_id) DO NOTHING
       RETURNING group_id
     )
     SELECT g.id, g.name, g.members_count FROM claimed c JOIN groups g ON g.id = c.group_id`,
    [now, limit]
  );
  const second = await db.query(
    `UPDATE community_cover_nags n SET second_sent_at = $1::timestamptz
       FROM groups x
      WHERE n.group_id = x.id
        AND n.second_sent_at IS NULL
        AND n.first_sent_at <= $1::timestamptz - INTERVAL '${COVER_NAG_SECOND_AFTER_DAYS} days'
        AND ${NO_COVER_COMMUNITY('x')}
        AND ${DAYTIME('$1')}
      RETURNING x.id, x.name, x.members_count`,
    [now]
  );
  const pushes = await notifyManagers(first.rows, 'coverNagFirst', send)
    + await notifyManagers(second.rows, 'coverNagSecond', send);
  return { first: first.rowCount, second: second.rowCount, pushes };
}

// One tick for all four. Each is isolated: a failure (e.g. a missing table in
// the boot window before the migration landed) logs, and the next still runs.
export async function runEngagementNudges({ now = new Date(), io } = {}) {
  const out = {};
  for (const [name, fn] of [
    ['moment', () => runMomentPrompts({ now })],
    ['hello', () => runSayHello({ now })],
    ['silence', () => runSilenceNudges({ now, io })],
    ['cover', () => runCoverNags({ now })],
  ]) {
    try {
      out[name] = await fn();
    } catch (err) {
      console.error(`[cron] engagement nudges (${name}) failed:`, err.message);
    }
  }
  const busy = Object.values(out).some(r => r && Object.values(r).some(v => v > 0));
  if (busy) console.log('[cron] engagement nudges:', JSON.stringify(out));
  return out;
}
