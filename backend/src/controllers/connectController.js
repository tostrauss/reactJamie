// „Aus Fremden können Freundschaften werden!“ — the friends list after an
// event (Tina 17.11.2026, „Connect“): „Mach den ersten Schritt und schicke
// eine Freundschaftsanfrage !“, and under it everybody who was in the group,
// each with „Freundschaftsanfrage senden“ — or „Befreundet“.
//
// WHO gets it: every participant EXCEPT the creator (the creator is asked
// „Wer war dabei?“ instead, reviewController.js) — at any group size, for
// meetups (type 'group') and club events (type 'event') alike. A participant
// is a member by the end of the event's day (joinedInTimeSql), never somebody
// who joined the past event afterwards. Not for weekly series, cancelled or
// deleted events, ones flagged „Hat nicht stattgefunden“, or events whose
// parent club is gone.
//
// WHEN: from the day after the event (Vienna calendar day) for
// CONNECT_WINDOW_DAYS — the same window as „Wer war dabei?“. In the app it
// comes up at start and on returning to the app (PostEventPrompts); the push
// goes out once per event the day after, from 10:00 (jobs/connectNudges.js).
//
// THE LIST: all other participants, the creator included; nobody in a block
// with the caller (either direction), no frozen accounts. Per person the
// state searchUsers also sends: accepted / pending_out / pending_in (with the
// friendship id, so „Annehmen“ works) / none — a rejected or expired request
// reads as none: the list shows everybody, and the daily limit of five
// requests applies anyway. An event where nobody is left to ask (everyone
// accepted or already asked) is not listed at all.
//
// Emergency switch POST_EVENT_CONNECT=false: no list, no push
// (backend/.env.example).
//
// Nothing here is on a hot path. The side table (event_connect_dismissals)
// may be missing in the boot window — the list then answers 200 [].

import db from '../config/database.js';
import { joinedInTimeSql, blockedWithSql, REVIEW_WINDOW_DAYS } from '../utils/attendanceTiers.js';
import { parentClubGateSql } from '../utils/clubGate.js';

export const CONNECT_WINDOW_DAYS = REVIEW_WINDOW_DAYS;
// Events looked at per request, events answered, people listed per event.
const MAX_EVENTS_READ = 10;
const MAX_EVENTS = 5;
const MAX_PEOPLE = 200;

const connectEnabled = () => process.env.POST_EVENT_CONNECT !== 'false';

// The events the caller took part in and did not create, whose day is over
// and which they have not closed yet. Newest first.
const EVENTS_SQL = `
  SELECT g.id, g.name, g.date, g.image_url, g.owner_id
    FROM group_members me
    JOIN groups g ON g.id = me.group_id
   WHERE me.user_id = $1
     AND g.owner_id IS DISTINCT FROM $1
     AND ${joinedInTimeSql('me', 'g')}
     AND g.type IN ('group', 'event')
     AND g.date IS NOT NULL
     AND g.is_active IS NOT FALSE
     AND g.deleted_at IS NULL
     AND g.did_not_take_place IS NOT TRUE
     AND g.is_recurring_weekly IS NOT TRUE
     AND ${parentClubGateSql('g')}
     AND g.date::date <  (NOW() AT TIME ZONE 'Europe/Vienna')::date
     AND g.date::date >= (NOW() AT TIME ZONE 'Europe/Vienna')::date - ${CONNECT_WINDOW_DAYS}
     AND NOT EXISTS (SELECT 1 FROM event_connect_dismissals d WHERE d.group_id = g.id AND d.user_id = $1)
   ORDER BY g.date DESC, g.id DESC
   LIMIT ${MAX_EVENTS_READ}`;

// Everybody else who took part in those events, the creator first, with the
// friendship between them and the caller (uniq_friend_pair: at most one row).
const PEOPLE_SQL = `
  SELECT gm.group_id, u.id, u.name, u.avatar_url,
         EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS age,
         (u.id = g.owner_id) AS is_owner,
         fs.friendship_id, fs.f_status, fs.f_requester
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    JOIN users  u ON u.id = gm.user_id
    LEFT JOIN LATERAL (
      SELECT f.id AS friendship_id, f.status AS f_status, f.requester_id AS f_requester
        FROM friendships f
       WHERE (f.requester_id = $1 AND f.addressee_id = u.id)
          OR (f.requester_id = u.id AND f.addressee_id = $1)
       LIMIT 1) fs ON TRUE
   WHERE gm.group_id = ANY($2::int[])
     AND gm.user_id <> $1
     AND ${joinedInTimeSql('gm', 'g')}
     AND u.is_active IS DISTINCT FROM FALSE
     AND gm.user_id NOT IN ${blockedWithSql('$1')}
   ORDER BY gm.group_id, (u.id = g.owner_id) DESC, gm.joined_at ASC NULLS FIRST, u.id`;

/** The friendship row between the caller and a listed person → the list's state. Exported for tests. */
export const friendStatusOf = (row, callerId) => {
  if (row.f_status === 'accepted') return 'accepted';
  if (row.f_status === 'pending') return Number(row.f_requester) === Number(callerId) ? 'pending_out' : 'pending_in';
  return 'none';
};

// Somebody the caller can still act on: send a request, or accept theirs.
const canStillAsk = (member) => member.friend_status === 'none' || member.friend_status === 'pending_in';

// ==========================================
// GET /api/reviews/connect/pending
// ==========================================
// → [{ group_id, group_name, event_date, image_url, members: [{ id, name,
//      avatar_url, age, is_owner, friend_status, friendship_id }] }]
//
// Never a 5xx: api.js retries GETs on any 5xx and counts them toward its
// circuit breaker. Any failure — also 42P01 before the migration ran — is
// logged and answered 200 [], and the app simply shows no list.
export const getPendingConnect = async (req, res) => {
  if (!connectEnabled()) return res.json([]);
  try {
    const events = (await db.query(EVENTS_SQL, [req.userId])).rows;
    if (!events.length) return res.json([]);

    const people = (await db.query(PEOPLE_SQL, [req.userId, events.map((e) => e.id)])).rows;
    const byEvent = new Map(events.map((e) => [e.id, []]));
    for (const row of people) {
      const list = byEvent.get(row.group_id);
      if (!list || list.length >= MAX_PEOPLE) continue;
      const status = friendStatusOf(row, req.userId);
      list.push({
        id: row.id,
        name: row.name,
        avatar_url: row.avatar_url,
        age: row.age,
        is_owner: !!row.is_owner,
        friend_status: status,
        friendship_id: status === 'none' ? null : row.friendship_id,
      });
    }

    const out = [];
    for (const e of events) {
      const members = byEvent.get(e.id);
      if (!members.some(canStillAsk)) continue;
      out.push({ group_id: e.id, group_name: e.name, event_date: e.date, image_url: e.image_url, members });
      if (out.length >= MAX_EVENTS) break;
    }
    res.json(out);
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') console.error('getPendingConnect error:', err?.message);
    res.json([]);
  }
};

// ==========================================
// POST /api/reviews/connect/dismiss   body: { group_id }
// ==========================================
// The X or „Fertig“ of the list: this event's list never comes back for this
// person. Only for somebody who is in the event — and idempotent, a second
// close answers the same.
export const dismissConnect = async (req, res) => {
  const gid = req.body?.group_id;
  if (!Number.isInteger(gid) || gid <= 0) {
    return res.status(400).json({ error: 'Ungültige Event-ID' });
  }
  try {
    const written = await db.query(
      `INSERT INTO event_connect_dismissals (group_id, user_id)
       SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)
       ON CONFLICT DO NOTHING RETURNING 1`,
      [gid, req.userId]
    );
    if (!written.rows.length) {
      // Nothing written: closed before (fine) — or not a member of it.
      const member = await db.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [gid, req.userId]);
      if (!member.rows.length) return res.status(403).json({ error: 'Nur Teilnehmer:innen können das schließen' });
    }
    res.json({ success: true });
  } catch (err) {
    if (err?.code === '42P01') {
      // The side table is not there yet (boot window).
      return res.status(503).json({
        error: 'Das geht gerade nicht – bitte versuch es gleich noch einmal.', code: 'CONNECT_UNAVAILABLE' });
    }
    console.error('dismissConnect error:', err?.message);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};
