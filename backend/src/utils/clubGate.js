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
