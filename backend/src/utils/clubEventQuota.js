/**
 * The free tier of clubs (Tina's document of 17.11.2026, decided by Tobi).
 *
 *   „Ein Club kann 2 Events machen, sobald der Club versucht ein Drittes
 *    anzulegen kommt ein Text.“            → block 'third'
 *   „Gratis geht 1 Event gleichzeitig.“    → block 'concurrent'
 *   „Für Events mit Tickets … würde immer sofort eine Nachricht zu JAMIE
 *    Partner kommen.“                      → reason 'ticket'
 *
 * WHO. Official clubs only (groups.club_type = 'official', approved or still
 * in review). A community is never limited. Free of it: a paying partner
 * (groups.is_paid_partner, the mark an app admin sets) and an app admin as
 * the caller — the JAMIE team runs its own clubs. The limit belongs to the
 * CLUB: an event a plain member puts up (events_owner_only off) counts like
 * the owner's.
 *
 * WHAT COUNTS. Events created since the deploy only — the marker row
 * FREE_TIER_MARKER in one_shot_migrations, whose applied_at is the first boot
 * of this code („gezählt wird ab dem Deploy, nur neu angelegte Events;
 * bestehende bleiben“). An event taken down BEFORE it began gives its place
 * back; one that ran and was deleted afterwards does not. (deleteClubEvent
 * and deleteGroup stamp deleted_at. An event merely switched inactive keeps
 * its place in `used` and leaves `upcoming`.)
 *
 * UNITS. A single event is 1. A weekly series is one row for all of its
 * dates, so it counts them: the dates whose day is over, plus the next one
 * that is planned. Tina: „Außer der Club hat ‚wiederholendes Event‘
 * eingestellt. Da würde die Info erst kommen, nachdem es sich von selbst ein
 * zweites Mal wiederholt hat“ — a series' own repetitions never raise the
 * „ihr seid ja schnell“ message, but each uses up a free event. The series
 * itself runs on; nothing ends by itself (Tobi 17.11.2026).
 *
 * TIME. Vienna calendar days throughout. groups.date is a Vienna wall clock
 * without zone; created_at, deleted_at and one_shot_migrations.applied_at are
 * UTC wall clocks (the session zone). `now` is always a parameter so the
 * real-Postgres smoke test can set the clock.
 *
 * FAIL-OPEN. No marker row (the boot window, or a failed migration step), a
 * missing table, or CLUB_FREE_TIER=false: nothing is limited, and ticket
 * links in clubs fall back to the rule from before (JAMIE Pro).
 *
 * No database import: every function takes `q`, the pool or a client inside
 * a transaction — createClubEvent counts again under a lock on the club row.
 */
import { clubAliveSql } from './clubGate.js';

// Tina: „Ein Club kann 2 Events machen“.
export const FREE_CLUB_EVENTS = 2;
// Message 1: „Gratis geht 1 Event gleichzeitig.“
export const FREE_CLUB_EVENTS_AT_ONCE = 1;
export const FREE_TIER_MARKER = '2026-11-17_club_free_tier_start';

const TZ = 'Europe/Vienna';

// Emergency switch (backend/.env.example): CLUB_FREE_TIER=false turns the
// limit, the ticket rule and the deal rule off without a deploy.
export const clubFreeTierEnabled = () => process.env.CLUB_FREE_TIER !== 'false';

// The first boot of this code, or NULL while the marker is not there yet.
const FREE_TIER_START_SQL = `(SELECT applied_at FROM one_shot_migrations WHERE name = '${FREE_TIER_MARKER}')`;
// Today in Vienna, from the timestamptz parameter `p` (e.g. '$2').
const todaySql = (p) => `(${p}::timestamptz AT TIME ZONE '${TZ}')::date`;

/**
 * Whether event row `e` counts at all: a club event created since the free
 * tier began and not taken down before it started. Without the marker row
 * the comparison is NULL — nothing counts.
 */
export const countedEventSql = (e) => `${e}.type = 'event'
          AND ${e}.created_at >= ${FREE_TIER_START_SQL}
          AND (${e}.deleted_at IS NULL OR ${e}.date IS NULL
               OR (${e}.deleted_at AT TIME ZONE 'UTC') >= (${e}.date AT TIME ZONE '${TZ}'))`;

/**
 * How many free events row `e` uses up. Single event: 1. Weekly series, by
 * Vienna days: before or on its first day 1 (the planned one); from the day
 * after, every date whose day is over plus the next planned one — 2 through
 * the 7th day after the start, 3 through the 14th, … A deleted series stops
 * at the dates begun by its last day: floor((last day − first day) / 7) + 1.
 * Integer division on non-negative day counts, so it floors.
 */
export const unitsSql = (e, p) => `CASE
            WHEN ${e}.is_recurring_weekly IS NOT TRUE OR ${e}.date IS NULL THEN 1
            WHEN ${e}.deleted_at IS NOT NULL THEN
              GREATEST(((${e}.deleted_at AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')::date - ${e}.date::date, 0) / 7 + 1
            WHEN ${todaySql(p)} > ${e}.date::date THEN
              (${todaySql(p)} - ${e}.date::date - 1) / 7 + 2
            ELSE 1 END`;

/**
 * Whether row `e` is still ahead: live, and a series, or dated today or
 * later. By the DAY like getClubEvents — „sobald euer erstes vorbei ist“
 * means from the day after.
 */
export const upcomingEventSql = (e, p) => `(${e}.deleted_at IS NULL AND ${e}.is_active = TRUE
            AND (${e}.is_recurring_weekly IS TRUE OR ${e}.date IS NULL OR ${e}.date::date >= ${todaySql(p)}))`;

/** The decision, as a pure function → null | 'third' | 'concurrent'. */
export const quotaBlock = ({ limited, used, upcoming }) => {
  if (!limited) return null;
  if (used >= FREE_CLUB_EVENTS) return 'third';
  if (upcoming >= FREE_CLUB_EVENTS_AT_ONCE) return 'concurrent';
  return null;
};

/**
 * What an old app bundle shows as a toast (it reads only `error`): one German
 * sentence per reason. 'concurrent' and 'third' are Tina's own sentences from
 * the two partner messages; the new surface shows the full message instead.
 */
export const PARTNER_TEXTS = Object.freeze({
  concurrent: 'Gratis geht 1 Event gleichzeitig. Ein weiteres Event ist gratis, sobald euer erstes vorbei ist.',
  third: 'Ab dem dritten Event geht es als JAMIE Partner weiter.',
  ticket: 'Events mit Tickets gibt es für JAMIE Partner.',
  deal: 'Deals gibt es für die ersten 2 Events eures Clubs – danach als JAMIE Partner.',
});

/** The body of every 403 the free tier answers. */
export const partnerRequired = (reason, clubName) => ({
  error: PARTNER_TEXTS[reason],
  code: 'PARTNER_REQUIRED',
  reason,
  club_name: clubName || '',
});

/**
 * The club with everything the event paths and the quota need, and whether
 * the caller is an app admin — one query. `q` is the pool or a client in a
 * transaction. → the row, or undefined when `clubId` is no club.
 */
export async function loadClubForQuota(q, clubId, userId) {
  const { rows } = await q.query(
    `SELECT c.id, c.name, c.owner_id, c.club_type, c.is_paid_partner, c.is_private,
            c.location, c.lat, c.lng, c.category, c.events_owner_only,
            c.approval_status, c.is_active,
            (${clubAliveSql('c')}) AS is_live,
            COALESCE((SELECT u.is_admin FROM users u WHERE u.id = $2), FALSE) AS caller_is_admin
       FROM groups c
      WHERE c.id = $1 AND c.type = 'club'`,
    [clubId, userId || 0]
  );
  return rows[0];
}

/**
 * The club's counted events as of `now` → { started, used, upcoming }.
 * `started` is false while the marker row is missing. One query.
 */
export async function countClubEvents(q, clubId, now = new Date()) {
  const { rows } = await q.query(
    `SELECT ${FREE_TIER_START_SQL} IS NOT NULL AS started,
            COALESCE(SUM(x.units), 0)::int AS used,
            (COUNT(*) FILTER (WHERE x.upcoming))::int AS upcoming
       FROM (
         SELECT ${unitsSql('e', '$2')} AS units,
                ${upcomingEventSql('e', '$2')} AS upcoming
           FROM groups e
          WHERE e.parent_club_id = $1
            AND ${countedEventSql('e')}
       ) x`,
    [clubId, now]
  );
  return rows[0];
}

/**
 * Where a club's event stands among the club's free events — for deals
 * (Tina: „Deals anlegen, für die ersten 2 Events. Danach wäre das Event
 * sowieso nur mit Paid, dann gehen die Deals auch wieder“).
 * → null when `eventId` is no live event of this club, else
 *   { counted, before }: whether the event counts at all (countedEventSql — an
 *   event from before the deploy does not), and how many counted events of
 *   the club were created before it, by (created_at, id).
 * A deal goes with the event while `counted && before < FREE_CLUB_EVENTS`.
 */
export async function eventFreeRank(q, clubId, eventId) {
  const { rows } = await q.query(
    `SELECT COALESCE((${countedEventSql('e')}), FALSE) AS counted,
            (SELECT COUNT(*)::int FROM groups o
              WHERE o.parent_club_id = e.parent_club_id
                AND ${countedEventSql('o')}
                AND (o.created_at, o.id) < (e.created_at, e.id)) AS before
       FROM groups e
      WHERE e.id = $1 AND e.parent_club_id = $2 AND e.type = 'event' AND e.deleted_at IS NULL`,
    [eventId, clubId]
  );
  return rows[0] || null;
}

/** Whether a deal goes with this event in a LIMITED club (eventFreeRank). */
export const withinFreeEvents = (rank) => !!rank && rank.counted === true && rank.before < FREE_CLUB_EVENTS;

const NOT_LIMITED = Object.freeze({ active: false, limited: false, used: 0, upcoming: 0, block: null });

/**
 * Where a club (a row of loadClubForQuota) stands →
 *   { official, active, limited, used, upcoming, block }
 * `active`: the free tier applies to this kind of club right now (official,
 * switched on, begun). `limited`: active and neither a paying partner nor an
 * app admin calling. A missing table or column reads as not active.
 */
export async function quotaOf(q, club, now = new Date()) {
  const official = club?.club_type === 'official';
  if (!official || !clubFreeTierEnabled()) return { official, ...NOT_LIMITED };
  let counted;
  try {
    counted = await countClubEvents(q, club.id, now);
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
    return { official, ...NOT_LIMITED };
  }
  if (!counted.started) return { official, ...NOT_LIMITED };
  const limited = !club.is_paid_partner && !club.caller_is_admin;
  const { used, upcoming } = counted;
  return { official, active: true, limited, used, upcoming, block: quotaBlock({ limited, used, upcoming }) };
}

/** loadClubForQuota + quotaOf → { club, …quota }; `club` undefined: no club. */
export async function clubQuota(q, { clubId, userId, now = new Date() }) {
  const club = await loadClubForQuota(q, clubId, userId);
  if (!club) return { club: undefined, official: false, ...NOT_LIMITED };
  return { club, ...(await quotaOf(q, club, now)) };
}

/**
 * Who may put a ticket link on a club event →
 *   'partner'  a limited official club: only as a JAMIE partner (403 'ticket',
 *              with Pro too — Tina: „würde immer sofort eine Nachricht zu
 *              JAMIE Partner kommen“)
 *   'free'     an official club that is not limited (a paying partner, the
 *              JAMIE team): no Pro needed, the partnership pays for it
 *   'pro'      everything else — a community, and every club while the free
 *              tier is off or has not begun: the rule from before (JAMIE Pro)
 */
export const ticketRule = (quota) => {
  if (!quota?.active) return 'pro';
  return quota.limited ? 'partner' : 'free';
};
