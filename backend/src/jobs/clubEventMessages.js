// Automated messages of club events — Tina's document of 17.11.2026 (the bar
// „Automatisierte Nachrichten“ in the event form: „Erinnerungen und Infos zum
// Event gehen automatisch in euren Namen an die Gruppe“). Runs every 15 min
// (server.js), for events whose switch is on (utils/clubAutoMessages.js).
//
//   1. welcome — 2 days after the switch was set (with the event, normally):
//                „Hey, freut mich, dass ihr dabei seid! 😊 Wir sind [Betrieb]…“
//   2. eve     — the day before: „Morgen ist es so weit! 🎉 Wir sehen uns in
//                der [Adresse]. Vergesst nicht euren Deal: [Deal].“
//   3. soon    — 2 hours before: „Wir sind bereit für euch! Bis gleich 👋“
//   4. thanks  — the day after: „Danke, dass ihr da wart! 💛 Hat es euch
//                gefallen?“
//
// WHO WRITES (decided 17.11.2026, F-16): the messages appear as an ordinary
// text message of the person who created the event — an owner or co-manager
// of the club — with their name and picture, like one they typed. That is
// „in euren Namen“. No system line (it has no name) and no new message type:
// every bundle in the field shows them right at once. If the creator is no
// longer in the event's chat, the club's owner writes, if they are in it;
// otherwise nothing is sent (logged, the marker stays set — never late).
//
// WEEKLY SERIES (F-4): the welcome only. Their date is the first meeting and
// never moves, so „the day before“ has no meaning for the weeks after.
//
// Every message is claimed in ONE statement (UPDATE … FOR UPDATE SKIP
// LOCKED), so two Railway replicas never double-send, and stamped BEFORE
// sending — a crash loses at worst one message, never repeats one. The
// markers of 2.–4. hold a COPY of groups.date: moving the event re-arms them.
// Times follow eventReminders.js / engagementNudges.js: groups.date is a
// Vienna WALL-CLOCK without zone, so every comparison goes through AT TIME
// ZONE. `now` is injectable for the real-Postgres smoke tests, `post` too.
//
// Only between 09:00 and 22:59 Vienna (a claim outside those hours simply
// does not happen), only while somebody besides the creator is in the event
// (not claimed → looked at again next tick), only under a live official club.
// Kill switch: CLUB_AUTO_MESSAGES=false (no deploy needed).
//
// A message is delivered like any chat message (deliverGroupMessage): live to
// the open chat, the chat-list nudge, a push — with the mute bell, the
// live-in-room rule and the 30-second cooldown. The row is written first; the
// socket only carries what is stored.

import db from '../config/database.js';
import { clubAliveSql } from '../utils/clubGate.js';
import { CLUB_AUTO_TEXTS, clubAutoMessagesEnabled } from '../utils/clubAutoMessages.js';
import { getDealsForEvents } from '../controllers/dealController.js';
import { deliverGroupMessage, withReply } from '../controllers/messageController.js';

// Copied from engagementNudges.js (that file belongs to another work stream).
const TZ = 'Europe/Vienna';
const LOCAL = (p) => `(${p}::timestamptz AT TIME ZONE '${TZ}')`;
const DAYTIME = (p) => `EXTRACT(HOUR FROM ${LOCAL(p)}) BETWEEN 9 AND 22`;
// The true instant an event starts; date-only events (00:00) start at the
// beginning of their day.
const START = (a) => `(${a}.date AT TIME ZONE '${TZ}')`;
// „At the event's own time of day“, kept inside the daytime: a 07:00 run
// counts from 09:00, a date-only event too, a midnight party from 22:00.
const AT_ITS_HOUR = (p) => `${LOCAL(p)}::time >= LEAST(GREATEST(e.date::time, TIME '09:00'), TIME '22:00')`;
const ONE_OFF = 'e.is_recurring_weekly IS NOT TRUE';

// What every claim asks for. am = the switch row, e = the event, c = its club.
const COMMON = `am.enabled = TRUE
          AND e.type = 'event'
          AND e.is_active = TRUE
          AND e.deleted_at IS NULL
          AND e.did_not_take_place IS NOT TRUE
          AND e.date IS NOT NULL
          AND e.members_count > 1
          AND ${clubAliveSql('c')}
          AND c.club_type = 'official'
          AND ${DAYTIME('$1')}`;

// One claim: lock the due rows (skipping what another replica holds), stamp
// them, hand back what the message needs.
const claimSql = (stamp, due) => `
  WITH due AS MATERIALIZED (
    SELECT am.group_id, e.date, e.name AS event_name, e.location, e.owner_id AS creator_id,
           c.name AS club_name, c.owner_id AS club_owner_id
      FROM club_event_auto_messages am
      JOIN groups e ON e.id = am.group_id
      JOIN groups c ON c.id = e.parent_club_id
     WHERE ${COMMON}
       AND ${due}
     ORDER BY am.group_id
       FOR UPDATE OF am SKIP LOCKED
     LIMIT $2
  )
  UPDATE club_event_auto_messages m
     SET ${stamp}
    FROM due
   WHERE m.group_id = due.group_id
  RETURNING m.group_id, due.event_name, due.location, due.creator_id, due.club_name, due.club_owner_id`;

export const CLUB_MESSAGE_KINDS = Object.freeze(['welcome', 'eve', 'soon', 'thanks']);

export const CLUB_MESSAGE_CLAIMS = Object.freeze({
  // 48 hours after the switch was set, while the event is still ahead. A
  // weekly series has no „still ahead“ (its date is the first meeting): it
  // gets its welcome either way. Not after „Morgen ist es so weit!“ — a
  // greeting that follows the day-before message reads backwards; until the
  // event starts it may still come first on that day.
  welcome: claimSql(
    'welcome_sent_at = $1::timestamptz',
    `am.welcome_sent_at IS NULL
       AND am.created_at + INTERVAL '48 hours' <= $1::timestamptz
       AND (e.is_recurring_weekly IS TRUE OR ${START('e')} > $1::timestamptz)
       AND am.eve_sent_for IS DISTINCT FROM e.date`),
  // The calendar day before, from the event's own time of day on.
  eve: claimSql(
    'eve_sent_for = due.date',
    `${ONE_OFF}
       AND am.eve_sent_for IS DISTINCT FROM e.date
       AND (e.date::date - 1) = ${LOCAL('$1')}::date
       AND ${AT_ITS_HOUR('$1')}`),
  // The last two hours before the start. A date-only event has no hour.
  soon: claimSql(
    'soon_sent_for = due.date',
    `${ONE_OFF}
       AND e.date::time <> '00:00'
       AND am.soon_sent_for IS DISTINCT FROM e.date
       AND ${START('e')} - INTERVAL '2 hours' <= $1::timestamptz
       AND ${START('e')} > $1::timestamptz`),
  // The calendar day after, from the event's own time of day on.
  thanks: claimSql(
    'thanks_sent_for = due.date',
    `${ONE_OFF}
       AND am.thanks_sent_for IS DISTINCT FROM e.date
       AND (e.date::date + 1) = ${LOCAL('$1')}::date
       AND ${AT_ITS_HOUR('$1')}`),
});

// The text of one message for one claimed event.
const textFor = (kind, ev, deal) => {
  if (kind === 'welcome') return CLUB_AUTO_TEXTS.welcome(ev.club_name || '');
  if (kind === 'eve') return CLUB_AUTO_TEXTS.eve({ address: ev.location, deal: deal?.deal_label });
  if (kind === 'soon') return CLUB_AUTO_TEXTS.soon();
  return CLUB_AUTO_TEXTS.thanks();
};

// Who writes: the event's creator if they are (still) in its chat, else the
// club's owner if they are — else nobody (null).
export async function resolveClubMessageSender(ev) {
  const candidates = [ev.creator_id, ev.club_owner_id].map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!candidates.length) return null;
  const { rows } = await db.query(
    `SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])`,
    [ev.group_id, candidates]
  );
  const inChat = new Set(rows.map((r) => Number(r.user_id)));
  return candidates.find((id) => inChat.has(id)) ?? null;
}

// Store the message as the sender's own text message, then deliver it like
// one: the row first, the socket after — it only ever carries what is stored.
// One round trip for the row and the sender's name and picture, the shape
// sendMessage answers with.
export async function postClubMessage({ groupId, senderId, text, groupName, io }) {
  const { rows } = await db.query(
    `WITH inserted AS (
       INSERT INTO messages (group_id, user_id, content, message_type)
       VALUES ($1, $2, $3, 'text') RETURNING *
     )
     SELECT i.*, u.name AS user_name, u.avatar_url
       FROM inserted i
       JOIN users u ON u.id = i.user_id`,
    [groupId, senderId, text]
  );
  const created = withReply(rows[0]);
  if (!created) return null;
  const sender = created.user_name || 'Jemand';
  // deliverGroupMessage reads the sender and the socket server off a request;
  // there is none in a cron tick. It never throws.
  await deliverGroupMessage(
    { userId: senderId, app: { get: (key) => (key === 'io' ? io : undefined) } },
    {
      groupId,
      groupType: 'event',
      groupName,
      created,
      nudge: { message_type: 'text', content: text.slice(0, 200) },
      push: { sender, isVoice: false, isImage: false, line: `${sender}: ${text.slice(0, 120)}` },
    }
  );
  return created;
}

// One kind for one tick → how many messages went out.
async function runKind(kind, { now, io, limit, post }) {
  const { rows: claimed } = await db.query(CLUB_MESSAGE_CLAIMS[kind], [now, limit]);
  if (!claimed.length) return 0;

  // Only „the day before“ names the deal. getDealsForEvents never throws.
  const deals = kind === 'eve' ? await getDealsForEvents(claimed.map((ev) => ev.group_id)) : new Map();

  let sent = 0;
  // One after the other: a tick with many events must not take the pool.
  for (const ev of claimed) {
    try {
      const senderId = await resolveClubMessageSender(ev);
      if (!senderId) {
        console.log(`[cron] club event messages (${kind}): event ${ev.group_id} has neither its creator nor the club owner in the chat — not sent`);
        continue;
      }
      const created = await post({
        groupId: ev.group_id,
        senderId,
        text: textFor(kind, ev, deals.get(Number(ev.group_id))),
        groupName: ev.event_name || '',
        io,
      });
      if (created) sent += 1;
    } catch (err) {
      // Stamped already: this one message is lost, the next event still goes out.
      console.error(`[cron] club event messages (${kind}) failed for event ${ev.group_id}:`, err.message);
    }
  }
  return sent;
}

// One tick for all four. Each is isolated: a failure (the table missing in
// the boot window before the migration landed) logs, and the next still runs.
export async function runClubEventMessages({ now = new Date(), io, limit = 100, post = postClubMessage } = {}) {
  const out = { welcome: 0, eve: 0, soon: 0, thanks: 0 };
  if (!clubAutoMessagesEnabled()) return out;
  for (const kind of CLUB_MESSAGE_KINDS) {
    try {
      out[kind] = await runKind(kind, { now, io, limit, post });
    } catch (err) {
      // The table is not there yet (boot window): nothing to send this tick,
      // and nothing to report four times every quarter of an hour — a failed
      // migration has its own line at boot.
      if (err?.code === '42P01' || err?.code === '42703') break;
      console.error(`[cron] club event messages (${kind}) failed:`, err.message);
    }
  }
  if (Object.values(out).some((n) => n > 0)) console.log('[cron] club event messages:', JSON.stringify(out));
  return out;
}
