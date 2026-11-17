// „Wie war’s bei X?“ — stars and an optional line of feedback after an event
// (Tina 17.11.2026: „ALLE: Wenn man bei einem Event war, sollte 24h danach
// kommen … mit Sternen zum Bewerten. Und drunter eine Zeile mit ‚Feedback
// (optional):‘. Man kann das auch mit ‚X‘ wegdrücken.“).
//
// Not to be confused with „Wer war dabei?“ (reviewController.js, table
// event_reviews): that is the attendance question for the creator. This is
// new — table event_ratings, one row per person and event; stars NULL means
// „closed with the X“, and that question never comes back.
//
// WHO: every participant, the creator included — a member by the end of the
// event's day (joinedInTimeSql).
// WHICH events: meetups and club events with at least two participants; not
// cancelled, deleted or flagged „Hat nicht stattgefunden“, no weekly series,
// the parent club alive.
// WHEN: a timed event 24 h after its start; a date-only meetup (stored at
// 00:00) the day after at 18:00 Vienna. Open for RATING_WINDOW_DAYS from then.
// HOW: in the app only, NO push — the day after an event already brings the
// Connect push (10:00) and the memory push (12:00).
// WHO READS IT: the JAMIE team only (GET /ratings/admin).
//
// Emergency switch EVENT_RATINGS=false: the app no longer asks
// (backend/.env.example). Nothing here is on a hot path; before the migration
// ran (42P01) the question simply does not come up.

import db from '../config/database.js';
import { joinedInTimeSql, participantsAtEventSql } from '../utils/attendanceTiers.js';
import { parentClubGateSql } from '../utils/clubGate.js';

export const RATING_AFTER_HOURS = 24;
export const RATING_DATEONLY_AT = '18:00';
export const RATING_WINDOW_DAYS = 7;
export const RATING_FEEDBACK_MAX = 1000;
// Asked about at most this many events at once — the dialog shows them one by one.
const MAX_PENDING = 3;

const ratingsEnabled = () => process.env.EVENT_RATINGS !== 'false';

// The true instant from which event `a` may be rated. groups.date is a Vienna
// WALL-CLOCK without zone, so it goes through AT TIME ZONE.
const RATING_FROM = (a) => `(CASE WHEN ${a}.date::time = '00:00'
       THEN ((${a}.date::date + 1)::timestamp + TIME '${RATING_DATEONLY_AT}') AT TIME ZONE 'Europe/Vienna'
       ELSE (${a}.date AT TIME ZONE 'Europe/Vienna') + INTERVAL '${RATING_AFTER_HOURS} hours' END)`;

// Participant `m` may rate event `g` right now („already rated“ aside). The
// question, the write gate and nothing else read this — one definition.
export const ratableSql = (g, m) => `(${g}.type IN ('group', 'event') AND ${g}.date IS NOT NULL
       AND ${g}.is_active IS NOT FALSE AND ${g}.deleted_at IS NULL
       AND ${g}.did_not_take_place IS NOT TRUE AND ${g}.is_recurring_weekly IS NOT TRUE
       AND ${parentClubGateSql(g)} AND ${joinedInTimeSql(m, g)}
       AND ${participantsAtEventSql(g)} >= 2
       AND ${RATING_FROM(g)} <= NOW()
       AND ${RATING_FROM(g)} >  NOW() - INTERVAL '${RATING_WINDOW_DAYS} days')`;

const positiveInt = (v) => Number.isInteger(v) && v > 0;
const missingTable = (err) => err?.code === '42P01' || err?.code === '42703';
const unavailable = (res) => res.status(503).json({
  error: 'Das geht gerade nicht – bitte versuch es gleich noch einmal.', code: 'RATINGS_UNAVAILABLE' });

// ==========================================
// GET /api/reviews/ratings/pending
// ==========================================
// → [{ group_id, group_name, event_date, image_url }] — the events the caller
// took part in, may rate now and has neither rated nor closed.
//
// Never a 5xx: api.js retries GETs on any 5xx and counts them toward its
// circuit breaker. Any failure is logged and answered 200 [].
export const getPendingRatings = async (req, res) => {
  if (!ratingsEnabled()) return res.json([]);
  try {
    const { rows } = await db.query(
      `SELECT g.id AS group_id, g.name AS group_name, g.date AS event_date, g.image_url
         FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id = $1
          AND ${ratableSql('g', 'gm')}
          AND NOT EXISTS (SELECT 1 FROM event_ratings r WHERE r.group_id = g.id AND r.user_id = $1)
        ORDER BY g.date DESC
        LIMIT ${MAX_PENDING}`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    if (!missingTable(err)) console.error('getPendingRatings error:', err?.message);
    res.json([]);
  }
};

/**
 * The feedback line as it is stored: a trimmed string of at most
 * RATING_FEEDBACK_MAX characters, or null when there is none.
 * → { ok: true, value } | { ok: false, code }. Exported for tests.
 */
export const parseFeedback = (raw) => {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, code: 'FEEDBACK_INVALID' };
  // Postgres text cannot hold a NUL byte (it would be a 500, not a 400).
  const text = raw.split('\u0000').join('').trim();
  if (!text) return { ok: true, value: null };
  // Code points, like the table's char_length CHECK — an emoji counts once.
  if (Array.from(text).length > RATING_FEEDBACK_MAX) return { ok: false, code: 'FEEDBACK_TOO_LONG' };
  return { ok: true, value: text };
};

// ==========================================
// POST /api/reviews/ratings   body: { group_id, stars, feedback? }
// ==========================================
// One rating per person and event, final. 201 on success.
export const submitRating = async (req, res) => {
  const { group_id: gid, stars } = req.body || {};
  if (!positiveInt(gid)) {
    return res.status(400).json({ error: 'Ungültige Event-ID', code: 'RATING_INVALID' });
  }
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Bitte wähle 1 bis 5 Sterne', code: 'STARS_INVALID' });
  }
  const feedback = parseFeedback(req.body.feedback);
  if (!feedback.ok) {
    return res.status(400).json({
      error: feedback.code === 'FEEDBACK_TOO_LONG'
        ? `Das Feedback darf höchstens ${RATING_FEEDBACK_MAX} Zeichen lang sein`
        : 'Ungültiges Feedback',
      code: feedback.code,
    });
  }

  try {
    // A participant of an event that may be rated right now.
    const allowed = await db.query(
      `SELECT 1 FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
        WHERE gm.group_id = $1 AND gm.user_id = $2
          AND ${ratableSql('g', 'gm')}`,
      [gid, req.userId]
    );
    if (!allowed.rows.length) {
      return res.status(403).json({ error: 'Bewertung nicht möglich', code: 'RATING_NOT_ALLOWED' });
    }
    const written = await db.query(
      `INSERT INTO event_ratings (group_id, user_id, stars, feedback)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, user_id) DO NOTHING RETURNING 1`,
      [gid, req.userId, stars, feedback.value]
    );
    if (!written.rows.length) {
      // Rated before — or closed with the X, which is just as final.
      return res.status(409).json({ error: 'Bereits bewertet', code: 'ALREADY_RATED' });
    }
    res.status(201).json({ success: true });
  } catch (err) {
    if (missingTable(err)) return unavailable(res);
    console.error('submitRating error:', err?.message);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// POST /api/reviews/ratings/dismiss   body: { group_id }
// ==========================================
// The X: a row without stars, so the question about this event never comes
// back. Only for somebody who is in the event; idempotent, and a no-op after
// a real rating.
export const dismissRating = async (req, res) => {
  const gid = req.body?.group_id;
  if (!positiveInt(gid)) {
    return res.status(400).json({ error: 'Ungültige Event-ID', code: 'RATING_INVALID' });
  }
  try {
    const written = await db.query(
      `INSERT INTO event_ratings (group_id, user_id, stars)
       SELECT $1, $2, NULL WHERE EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)
       ON CONFLICT (group_id, user_id) DO NOTHING RETURNING 1`,
      [gid, req.userId]
    );
    if (!written.rows.length) {
      const member = await db.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [gid, req.userId]);
      if (!member.rows.length) {
        return res.status(403).json({ error: 'Bewertung nicht möglich', code: 'RATING_NOT_ALLOWED' });
      }
    }
    res.json({ success: true });
  } catch (err) {
    if (missingTable(err)) return unavailable(res);
    console.error('dismissRating error:', err?.message);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET /api/reviews/ratings/admin   (requireAdmin)   ?limit=&offset=
// ==========================================
// The admin dashboard's „Event-Bewertungen“: newest first, only real ratings
// (rows closed with the X are not ratings). Same { …, total, limit, offset }
// paging shape as getFeedbackAdmin. Never a 5xx either: a missing table
// answers an empty page marked `unavailable`.
export const getRatingsAdmin = async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query?.offset, 10) || 0, 0);
  try {
    const [totalRes, pageRes] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS total FROM event_ratings WHERE stars IS NOT NULL'),
      db.query(
        `SELECT r.group_id, g.name AS group_name, g.date AS event_date, g.type, pc.name AS club_name,
                r.stars, r.feedback, r.created_at, u.id AS user_id, u.name AS user_name
           FROM event_ratings r
           JOIN groups g ON g.id = r.group_id
           LEFT JOIN groups pc ON pc.id = g.parent_club_id
           LEFT JOIN users u ON u.id = r.user_id
          WHERE r.stars IS NOT NULL
          ORDER BY r.created_at DESC
          LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
    ]);
    res.json({ ratings: pageRes.rows, total: totalRes.rows[0]?.total ?? 0, limit, offset });
  } catch (err) {
    if (!missingTable(err)) console.error('getRatingsAdmin error:', err?.message);
    res.json({ ratings: [], total: 0, limit, offset, unavailable: true });
  }
};
