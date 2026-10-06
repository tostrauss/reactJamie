// Abzeichen-Stufen — confirmed attendance, never sign-ups (B2, tester 06.10.2026).
//
// The trusted seal (users.is_trusted_user) is reached after ONE event: it is
// COUNT(DISTINCT reviewer_id) >= 3 across all events, so three people ticking
// you at a single meetup is enough — and someone who only says yes and then
// does not come keeps it. The tester asked for steps that reward the people
// who actually show up: from 5 meetups 🏅, from 10 🏆, from 100 🎆.
//
// What counts as ONE confirmed meetup of user u at event g:
//   - only the votes OTHER members cast about u in the "Wer war dabei?" review
//     (the reviewer's own sentinel row, reviewer = reviewed, means "I
//     reviewed", never "I was absent"),
//   - and ✓ must STRICTLY outnumber ✗ — the ✗ button exists to flag
//     no-shows, so one friendly tick does not outvote two honest "war nicht
//     da". A tie does not count.
// Sign-ups, RSVPs and group_members are never read, so people who left a
// group keep their history. Only events that stand (eventStandsSql), only
// once the event's review round has closed (REVIEW_WINDOW_DAYS), and a group
// deleted BEFORE its day was over never happened — one cleaned up AFTERWARDS
// keeps its attendees' credit (deleteGroup "preserves reviews", attendees must
// not lose a badge to somebody else's tidying up).
//
// Recorded votes are judged by WHEN they were cast, not by the group's
// current, still editable date: an owner moving a past group to a new date,
// deleting it before that new date, or ticking „wöchentlich“ afterwards must
// not take a meetup that already happened out of everyone's count. Who may
// vote at all (members by the end of the event day, never across a block,
// only while the round is open) is decided ONCE, at write time, in
// submitReview — the read never re-judges it.
//
// Every step also needs a floor of DISTINCT people who confirmed you. Without
// it two accounts could farm 🏆 within days (createGroup allows 10 groups a
// day) by creating events and ticking each other — the badge would then be
// weaker evidence than the seal. Real meetups of 4–20 people pass naturally.
//
// Computed at READ time from the existing review rows, deliberately not stored:
//   - the read IS the backfill: every confirmation ever given counts from the
//     first request after deploy, idempotently, with nothing to run on boot
//     and nothing a fresh database could trip over;
//   - no new column on the hot paths — the server takes traffic before the
//     startup migrations run, and a users column in SAFE_USER_COLS would 500
//     every profile load in that window (same reasoning as utils/reactions.js);
//   - an owner flagging „nicht stattgefunden“ after confirmations exist, a
//     cancellation, a confirmer's account deletion (CASCADE) — all take effect
//     on the next read, there is no recompute to forget.
// One batched query per response, for exactly the user ids that response
// returns, after that endpoint's own gates (roster Pro gate, blocks).
//
// Unknown is NOT zero: on failure getAttendanceStats returns null and callers
// leave the field ABSENT, so a broken lookup renders nothing rather than
// telling somebody they have never been anywhere.
//
// The trusted seal is independent and keeps its meaning: tiers are never
// derived from trusted_count (that counts distinct REVIEWERS and ignores
// „nicht stattgefunden“), and old clients that only know is_trusted_user lose
// nothing — steps are purely additive fields.
//
// Pure module: db is injected (never imports database.js), like reactions.js.

// Minimum confirmed meetups for 🏅 / 🏆 / 🎆.
// MIRRORED in frontend/src/utils/attendanceTiers.js — a parity test reads both.
export const TIER_MIN_EVENTS = [5, 10, 100];
// Minimum DISTINCT people who confirmed you, per step. Server-side rule;
// [1, 1, 1] would be the literal reading of "ab 5 Treffen". MIRRORED as well.
export const TIER_MIN_CONFIRMERS = [2, 3, 10];

// How long the "Wer war dabei?" round of an event stays open — the prompts'
// window since 2026-07. A meetup counts only once its round has CLOSED: the
// modal promises „Deine Angaben sind anonym“, and a count that moved with
// every single vote would let the flagged person watch a ✗ land (+1, then −1)
// and work out who cast it. A closed round changes the count at most once,
// with every vote final. Sent to the own card (getMyAttendance window_days),
// whose note explains the wait.
export const REVIEW_WINDOW_DAYS = 14;

const ALIAS = /^[a-z_][a-z0-9_]*$/i;
const alias = (a) => {
  if (!ALIAS.test(a)) throw new Error(`attendanceTiers: bad SQL alias ${a}`);
  return a;
};
const PARAM = /^\$[1-9][0-9]*$/;
const param = (p) => {
  if (!PARAM.test(p)) throw new Error(`attendanceTiers: bad SQL parameter ${p}`);
  return p;
};

// The event stands: a standalone group nobody called off. `is_active IS NOT
// FALSE` because groups.is_active is nullable; FALSE means cancelled/rejected,
// never "over". did_not_take_place is the owner's „nicht stattgefunden“. What
// RECORDED votes are judged by — a later cancellation or flag still removes
// the meetup on the next read.
export const eventStandsSql = (a) => {
  const g = alias(a);
  return `(${g}.type = 'group' AND ${g}.did_not_take_place IS NOT TRUE AND ${g}.is_active IS NOT FALSE)`;
};

// Events NEW answers may be given about — shared by the review prompts and
// the write gate, so the app never asks about an event that can never count.
// Weekly series are excluded: their stored date is the FIRST occurrence, so
// the prompt used to fire one day after week one of a series still running.
// Deliberately NOT part of eventStandsSql: votes recorded before an owner
// ticked „wöchentlich“ on a past group keep counting.
export const countableEventSql = (a) => `(${eventStandsSql(a)} AND ${alias(a)}.is_recurring_weekly IS NOT TRUE)`;

// What the review prompts may ask about: countable, and not deleted — deleting
// a group already told its members the event is gone.
export const reviewableEventSql = (a) => `(${countableEventSql(a)} AND ${alias(a)}.deleted_at IS NULL)`;

// The event's review round is still open: within REVIEW_WINDOW_DAYS of its
// date, and no answer about it is older than that — moving a past group to a
// new date must not reopen a round that already closed (and whose result is
// already showing). The count below waits for exactly the complement, so a
// meetup never counts while votes about it can still change.
export const reviewRoundOpenSql = (a) => {
  const g = alias(a);
  return `(${g}.date > NOW() - INTERVAL '${REVIEW_WINDOW_DAYS} days'`
    + ` AND NOT EXISTS (SELECT 1 FROM event_reviews rr WHERE rr.group_id = ${g}.id`
    + ` AND rr.created_at <= NOW() - INTERVAL '${REVIEW_WINDOW_DAYS} days'))`;
};

// The member belonged to the event by the end of its day — only they can say
// who was there, and only they can be confirmed. Without it anybody could join
// a past public event afterwards and tick a friend in, or ✗ a real attendee
// out. joined_at is session-zone wall-clock (UTC on Railway), groups.date
// Vienna wall-clock: compare Vienna days. NULL (legacy rows) counts as in time.
export const joinedInTimeSql = (m, a) => {
  const gm = alias(m);
  return `(${gm}.joined_at IS NULL`
    + ` OR (${gm}.joined_at::timestamptz AT TIME ZONE 'Europe/Vienna') < ${alias(a)}.date::date + 1)`;
};

// Everybody in a 'blocked' friendship with the user in parameter `p`, either
// direction — the two-way rule getGroupMembers enforces: neither side is
// listed in the other's prompt or answers about the other.
export const blockedWithSql = (p) => {
  const u = param(p);
  return `(SELECT CASE WHEN requester_id = ${u} THEN addressee_id ELSE requester_id END`
    + ` FROM friendships WHERE status = 'blocked' AND (requester_id = ${u} OR addressee_id = ${u}))`;
};

// The leading marker is what the unit-test mocks route on (getPendingReviews
// also reads FROM event_reviews er), and it names the query in
// pg_stat_statements.
//
// Per (person, event) group, g.* is constant — MIN(g.x) is just g.x. The
// event-level rules sit in HAVING so ✓ and ✗ are always judged together:
//   - the round has closed: REVIEW_WINDOW_DAYS after the event, or after the
//     first vote about this person if the owner moved the date later (a vote
//     is only ever written once the event's day is over, so its time is proof
//     the meetup had happened);
//   - deleted only after the event's day: Vienna days on both sides (deleted_at
//     is session-zone wall-clock, date Vienna; a date-only event is stored at
//     00:00, so comparing instants called a deletion at 10:00 ON the day
//     "afterwards"), and the vote time again stands in for a moved date.
export const ATTENDANCE_SQL = `/* attendance-tiers */
WITH counted AS (
  SELECT er.reviewed_user_id AS user_id, er.group_id,
         array_agg(er.reviewer_id) FILTER (WHERE er.was_present) AS confirmed_by
    FROM event_reviews er
    JOIN groups g ON g.id = er.group_id
   WHERE er.reviewed_user_id = ANY($1::int[])
     AND er.reviewer_id <> er.reviewed_user_id
     AND ${eventStandsSql('g')}
   GROUP BY er.reviewed_user_id, er.group_id
  HAVING COUNT(*) FILTER (WHERE er.was_present) > COUNT(*) FILTER (WHERE NOT er.was_present)
     AND LEAST(MIN(g.date), MIN(er.created_at)) <= NOW() - INTERVAL '${REVIEW_WINDOW_DAYS} days'
     AND (MIN(g.deleted_at) IS NULL
          OR (MIN(g.deleted_at)::timestamptz AT TIME ZONE 'Europe/Vienna')::date
             > LEAST(MIN(g.date)::date, (MIN(er.created_at)::timestamptz AT TIME ZONE 'Europe/Vienna')::date))
)
SELECT c.user_id,
       COUNT(DISTINCT c.group_id)::int    AS confirmed_events,
       COUNT(DISTINCT x.reviewer_id)::int AS confirmers
  FROM counted c
  CROSS JOIN LATERAL unnest(c.confirmed_by) AS x(reviewer_id)
 GROUP BY c.user_id`;

/** 0 = none, 1 = 🏅, 2 = 🏆, 3 = 🎆 */
export const tierFor = (events, confirmers) => {
  let tier = 0;
  TIER_MIN_EVENTS.forEach((min, i) => {
    if (events >= min && confirmers >= TIER_MIN_CONFIRMERS[i]) tier = i + 1;
  });
  return tier;
};

/**
 * What the NEXT step still needs, for the person's own progress card — or null
 * at the top. Both numbers are what is missing (0 = already enough).
 */
export const nextStepFor = (events, confirmers) => {
  const tier = tierFor(events, confirmers);
  if (tier >= TIER_MIN_EVENTS.length) return null;
  return {
    tier: tier + 1,
    events_missing: Math.max(0, TIER_MIN_EVENTS[tier] - events),
    confirmers_missing: Math.max(0, TIER_MIN_CONFIRMERS[tier] - confirmers),
  };
};

const CHUNK = 1000;
let lastLogAt = 0;

/**
 * Map userId → { confirmedEvents, confirmers } for the given ids (ids without
 * a confirmed meetup are absent), or NULL when the lookup failed — never 0 for
 * "unknown". Never throws. 42P01/42703 (fresh DB, boot window) stay silent;
 * anything else is logged at most once a minute.
 */
export const getAttendanceStats = async (db, ids) => {
  const clean = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map();
  if (!clean.length) return out;
  try {
    for (let i = 0; i < clean.length; i += CHUNK) {
      const res = await db.query(ATTENDANCE_SQL, [clean.slice(i, i + CHUNK)]);
      for (const r of res?.rows ?? []) {
        out.set(Number(r.user_id), {
          confirmedEvents: Number(r.confirmed_events) || 0,
          confirmers: Number(r.confirmers) || 0,
        });
      }
    }
    return out;
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703' && Date.now() - lastLogAt > 60_000) {
      lastLogAt = Date.now();
      console.error('[attendance] stats query failed:', err?.message);
    }
    return null;
  }
};

/**
 * Stamp `field` (default attendance_tier, 0–3) onto each row keyed by
 * row[idKey]. Only the LEVEL leaves the server for other people — exact counts
 * are activity data (the person's own numbers: GET /api/reviews/attendance).
 * `countField` adds the count, for the admin list only. When the lookup
 * failed the field stays ABSENT.
 */
export const attachAttendanceTiers = async (db, rows, { idKey = 'id', field = 'attendance_tier', countField = null } = {}) => {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const stats = await getAttendanceStats(db, rows.map((r) => r?.[idKey]));
  if (!stats) return rows;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const s = stats.get(Number(row[idKey]));
    row[field] = s ? tierFor(s.confirmedEvents, s.confirmers) : 0;
    if (countField) row[countField] = s ? s.confirmedEvents : 0;
  }
  return rows;
};

/** Test hook. */
export const _resetAttendanceLog = () => { lastLogAt = 0; };
