import db from '../config/database.js';
import { parentClubGateSql } from '../utils/clubGate.js';
import { NEXT_AT_SQL, COUNTRY_BOUNDS } from './groupController.js';

// The two lists of the new Friends page (Tina, 17.11.2026 — „JAMIE: Neue
// Friends Seite“):
//
//   GET /friends/going   „Wo gehen deine Freunde hin? 🎉“
//   GET /friends/people  „Leute, die du kennen könntest“
//
// Their own file, not friendshipController: /going needs the feed's rule, and
// with it groupController — the request/accept/block paths stay free of that
// import. Both are new endpoints; app bundles from before this page keep
// calling GET /friends/suggestions, which is untouched.
//
// Neither ever answers 5xx: the page shows three more sections next to these
// two, and a failing list must leave them standing — 200 with nothing in it,
// the section then simply is not there.

const VIENNA_NOW = `(NOW() AT TIME ZONE 'Europe/Vienna')`;

/** Cards in „Wo gehen deine Freunde hin?“. */
export const GOING_LIMIT = 12;
/** Friends named on one card (profile pictures); friend_count is all of them. */
export const GOING_FRIENDS_SHOWN = 3;
/** Cards in „Leute, die du kennen könntest“. */
export const PEOPLE_LIMIT = 20;
/** The caller's most recent past meetups the suggestions are drawn from. */
export const PEOPLE_SOURCE_EVENTS = 30;

// ==========================================
// WHERE FRIENDS GO  („Wo gehen deine Freunde hin? 🎉“)
// ==========================================
// Coming meetups and events an accepted friend is in — the next one first, at
// most GOING_LIMIT.
//
// What may appear is the Gruppen feed's own rule (groupController.getGroups
// with include_club_events), for THIS caller: active, not deleted, a meetup or
// an event, the parent club live AND public (parentClubGateSql requirePublic —
// read from the live club, never the event's copied flag), inside the caller's
// age range and country box. A membership the feed hides never shows up here:
// the friends' push has the same stance (utils/friendActivity.js). Groups that
// take requests are in — the feed lists them too.
//
// On top of the feed's rule:
//   - only accepted friendships (a block replaces the row, so it is out) and
//     only friends whose account is active;
//   - only what has a date and is still to come by the Vienna day; a weekly
//     series counts with its next date (NEXT_AT_SQL, the feed's expression);
//   - a full meetup only if the caller is in it or has asked — „Mitkommen“
//     would run into „Die Gruppe ist bereits voll“.
//
// Per card: friend_count and the first GOING_FRIENDS_SHOWN friends (creator
// first, then join order — the order of every member list), and the caller's
// own state for the button: 'member' („Du bist dabei“), 'requested'
// („Angefragt“) or 'none' („Mitkommen“).
//
// Two round trips: the caller's age and country, then the cards.
export const getFriendsGoing = async (req, res) => {
  try {
    const me = await db.query(
      `SELECT EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age, country
         FROM users WHERE id = $1`,
      [req.userId]
    );
    const age = me.rows[0]?.age ?? null;
    const boxes = (me.rows[0]?.country && COUNTRY_BOUNDS[me.rows[0].country]) || null;

    const params = [req.userId];
    let gate = `g.type IN ('group', 'event')
            AND g.is_active = TRUE
            AND g.deleted_at IS NULL
            AND ${parentClubGateSql('g', { requirePublic: true })}`;
    // No date of birth: everything passes (the feed's friendly default).
    if (age !== null) {
      params.push(age);
      gate += `
            AND (g.target_age_min IS NULL OR g.target_age_min <= $${params.length})
            AND (g.target_age_max IS NULL OR g.target_age_max >= $${params.length})`;
    }
    // Meetups without coordinates are kept, like in the feed.
    if (boxes) {
      const clauses = boxes.map((b) => {
        params.push(b.latMin, b.latMax, b.lngMin, b.lngMax);
        const n = params.length;
        return `(g.lat BETWEEN $${n - 3} AND $${n - 2} AND g.lng BETWEEN $${n - 1} AND $${n})`;
      });
      gate += `
            AND (g.lat IS NULL OR ${clauses.join(' OR ')})`;
    }

    const { rows } = await db.query(
      `/* friends:going */
       WITH friends AS (
         SELECT CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS user_id
           FROM friendships f
          WHERE (f.requester_id = $1 OR f.addressee_id = $1)
            AND f.status = 'accepted'
       ),
       going AS (
         SELECT g.id, ${NEXT_AT_SQL} AS next_at,
                fu.id AS friend_id, fu.name AS friend_name, fu.avatar_url AS friend_avatar,
                gm.role, gm.joined_at
           FROM friends fr
           JOIN users fu ON fu.id = fr.user_id AND fu.is_active IS DISTINCT FROM FALSE
           JOIN group_members gm ON gm.user_id = fu.id
           JOIN groups g ON g.id = gm.group_id
          WHERE ${gate}
       ),
       cards AS (
         SELECT go.id, go.next_at,
                COUNT(*)::int AS friend_count,
                json_agg(
                  json_build_object('id', go.friend_id, 'name', go.friend_name, 'avatar_url', go.friend_avatar)
                  ORDER BY CASE WHEN go.role = 'owner' THEN 0 ELSE 1 END, go.joined_at, go.friend_id
                ) AS friends
           FROM going go
          WHERE go.next_at IS NOT NULL
            AND go.next_at::date >= ${VIENNA_NOW}::date
          GROUP BY go.id, go.next_at
       ),
       mine AS (
         SELECT c.id, c.next_at, c.friend_count, c.friends,
                EXISTS (SELECT 1 FROM group_members m
                         WHERE m.group_id = c.id AND m.user_id = $1) AS is_member,
                EXISTS (SELECT 1 FROM group_join_requests jr
                         WHERE jr.group_id = c.id AND jr.user_id = $1 AND jr.status = 'pending') AS has_requested
           FROM cards c
       ),
       page AS (
         SELECT m.*
           FROM mine m
           JOIN groups g ON g.id = m.id
          WHERE m.is_member OR m.has_requested
             OR g.max_members IS NULL OR g.members_count < g.max_members
          ORDER BY m.next_at ASC, m.id
          LIMIT ${GOING_LIMIT}
       )
       SELECT g.id, g.name, g.type, g.image_url, g.date, page.next_at, g.is_recurring_weekly,
              page.friend_count, page.friends, page.is_member, page.has_requested
         FROM page
         JOIN groups g ON g.id = page.id
        -- Re-stated: the JOIN above does not preserve the CTE's ordering.
        ORDER BY page.next_at ASC, g.id`,
      params
    );

    res.json(rows.map(({ is_member, has_requested, friends, ...card }) => ({
      ...card,
      friends: (Array.isArray(friends) ? friends : []).slice(0, GOING_FRIENDS_SHOWN),
      my_status: is_member ? 'member' : has_requested ? 'requested' : 'none',
    })));
  } catch (err) {
    console.error('Error fetching where friends go:', err);
    res.json([]);
  }
};

// ==========================================
// PEOPLE YOU MAY KNOW  („Leute, die du kennen könntest“)
// ==========================================
// Tina: „Zeigt Leute, die mit dir in einer gemeinsamen Gruppe waren (keine
// bestehenden Freunde)“, each with „War mit dir bei Kochabend“.
//
// „Gemeinsam“ is the same meetup or event (type group/event) — never the same
// club or community, a club of 500 would flood the list — and one that has
// taken place: dated, in the past by Vienna time, not cancelled, not marked
// „hat nicht stattgefunden“. Drawn from the caller's PEOPLE_SOURCE_EVENTS most
// recent such meetups (no 120-day window like GET /friends/suggestions — but
// bounded, the page loads this on every visit). Each person once, under the
// most recent meetup shared with the caller; most recent first, at most
// PEOPLE_LIMIT.
//
// Never listed: friends, an open request in EITHER direction (the card only
// knows „Anfrage senden“ — a person who asked sits in the Anfragen deck), a
// rejected request („wer nicht akzeptiert hat, erscheint vorerst nicht mehr“,
// Tina 07.11.2026), blocks in either direction, inactive accounts.
//
// has_shared: there was at least one such meetup with somebody else in it.
// The page shows Tina's sentence „Nimm bei deinem ersten Treffen oder Event
// teil, um Vorschläge zu erhalten“ only for `false`; with shared meetups but
// nobody left to suggest it shows nothing. On a failure it is null — the page
// then shows nothing either, never a sentence that may be wrong.
export const getPeopleYouMayKnow = async (req, res) => {
  try {
    const { rows } = await db.query(
      `/* friends:people */
       WITH my_events AS (
         SELECT g.id, g.name, g.date
           FROM group_members gm
           JOIN groups g ON g.id = gm.group_id
          WHERE gm.user_id = $1
            AND g.type IN ('group', 'event')
            AND g.is_active = TRUE
            AND g.deleted_at IS NULL
            AND g.did_not_take_place IS NOT TRUE
            AND g.date IS NOT NULL
            AND g.date < ${VIENNA_NOW}
          ORDER BY g.date DESC, g.id DESC
          LIMIT ${PEOPLE_SOURCE_EVENTS}
       ),
       co AS (
         SELECT DISTINCT ON (gm.user_id) gm.user_id, me.name AS event_name, me.date AS event_date
           FROM my_events me
           JOIN group_members gm ON gm.group_id = me.id
          WHERE gm.user_id <> $1
          ORDER BY gm.user_id, me.date DESC, me.id DESC
       ),
       people AS (
         SELECT u.id, u.name, u.avatar_url,
                EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS age,
                co.event_name, co.event_date
           FROM co
           JOIN users u ON u.id = co.user_id
          WHERE u.is_active IS DISTINCT FROM FALSE
            AND NOT EXISTS (
              SELECT 1 FROM friendships f
               WHERE ((f.requester_id = $1 AND f.addressee_id = u.id)
                   OR (f.requester_id = u.id AND f.addressee_id = $1))
                 AND f.status IN ('accepted', 'pending', 'rejected', 'blocked'))
          ORDER BY co.event_date DESC, u.id
          LIMIT ${PEOPLE_LIMIT}
       )
       SELECT COALESCE((
                SELECT json_agg(
                         json_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url,
                                           'age', p.age, 'event_name', p.event_name)
                         ORDER BY p.event_date DESC, p.id)
                  FROM people p), '[]'::json) AS people,
              EXISTS (SELECT 1 FROM co) AS has_shared`,
      [req.userId]
    );
    const row = rows[0] || {};
    res.json({
      people: Array.isArray(row.people) ? row.people : [],
      has_shared: row.has_shared === true,
    });
  } catch (err) {
    console.error('Error fetching people you may know:', err);
    res.json({ people: [], has_shared: null });
  }
};
