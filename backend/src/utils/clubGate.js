/**
 * "Is this row's parent club actually live?" — one predicate, every surface.
 *
 * Club events are `groups` rows with `parent_club_id` set. Their own columns are
 * a SNAPSHOT taken at creation time: `approval_status` inherits the column
 * default `'approved'` and `is_private` is copied from the club as it was then.
 * Neither ever changes again. So any query that judges an event by its own
 * columns is judging a club's state as of the moment the event was created —
 * which is how a pending club's events reached the public Events feed and the
 * unauthenticated map, and how a rejected club's events stayed there forever
 * (audit 2026-09-15, findings 3 + 10).
 *
 * The Gruppen feed already got this right and explained why in a comment:
 * gate against the LIVE parent club, never against a copied flag. This module
 * is that reasoning extracted, so a fifth surface cannot forget it.
 *
 * `requirePublic` is the one axis that legitimately differs per surface:
 *   - map        → TRUE. Its documented invariant is that a private entity's
 *                  exact coordinates never reach the public map.
 *   - Gruppen feed → TRUE. Tobi 2026-09-04: only public clubs' events.
 *   - Discover-Events → FALSE. Robert 2026-06-17 deliberately shows private
 *                  clubs' events there; the row carries `is_private` for the badge.
 */

/**
 * Club-side conditions, for a query that has already JOINed the club.
 * Includes the `type = 'club'` test, so a caller can drop its own.
 */
export const clubAliveSql = (c, { requirePublic = false } = {}) => [
  `${c}.type = 'club'`,
  `${c}.approval_status = 'approved'`,
  `${c}.is_active = TRUE`,
  `${c}.deleted_at IS NULL`,
  ...(requirePublic ? [`${c}.is_private IS NOT TRUE`] : []),
].join('\n            AND ');

/**
 * Row-level gate: the row has no parent club, or its parent club is live.
 * A plain group (`parent_club_id IS NULL`) always passes.
 *
 * Deliberately keyed on `parent_club_id` rather than `type = 'event'`: a row
 * with a parent club must be gated whatever its type says, and an event whose
 * parent_club_id is NULL is an orphan that no longer has a club to inherit
 * anything from.
 */
export const parentClubGateSql = (row, opts) => `(
        ${row}.parent_club_id IS NULL OR EXISTS (
          SELECT 1 FROM groups pc
           WHERE pc.id = ${row}.parent_club_id
             AND ${clubAliveSql('pc', opts)}
        ))`;

/**
 * „☆ Partner“ (Tina 16.11.2026, rule decided by Tobi): a club EVENT that a
 * live OFFICIAL club put up itself — its creator (the event's owner_id) is
 * the club's owner or one of its co-managers (group_members.role = 'admin',
 * the same people userManagesClub and getGroupById's is_manager let manage
 * the club). Any member may create events where events_owner_only is off
 * (the API default, and older clubs), and those are not the partner's.
 *
 * Always the PARENT club's club_type, compared with `= 'official'`: an event
 * row's own club_type is NULL (the column is for clubs), and 'community' is
 * set as well — so never `IS NOT NULL`, never a COALESCE. A club that is no
 * longer live makes nobody a partner. A boolean, never NULL, for every row
 * type. One definition for every surface (feed, event page, …).
 *
 * Since 17.11.2026 (Tina's new document, decided by Tobi) only PAYING
 * partners: the club carries the mark an app admin sets on it („Zahlender
 * Partner“, groups.is_paid_partner — admin → „Clubs umklassifizieren“). An
 * official club that does not pay gets no ☆, no yellow, no ✓ anywhere. The
 * column is read directly: it went live one deploy ahead of this reader
 * (migrations.js), so no request meets this without it. Always the PARENT
 * club's mark — an event row's own is always FALSE.
 */
export const partnerSql = (row) => `(${row}.type = 'event' AND EXISTS (
          SELECT 1 FROM groups pc
           WHERE pc.id = ${row}.parent_club_id
             AND ${clubAliveSql('pc')}
             AND pc.club_type = 'official'
             AND pc.is_paid_partner = TRUE
             AND (pc.owner_id = ${row}.owner_id OR EXISTS (
                   SELECT 1 FROM group_members mgr
                    WHERE mgr.group_id = pc.id AND mgr.user_id = ${row}.owner_id AND mgr.role = 'admin'))
        ))`;
