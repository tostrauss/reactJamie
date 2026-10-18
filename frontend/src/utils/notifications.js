// Shared bits of the bell on Home and the notification list behind it
// (Lea / Robert, 18.10.2026: new features and deals went unnoticed, and
// nothing in the app linked to /notifications at all).

// Fired by the list once its mark-read has landed on the server. Whoever shows
// a badge re-reads the count then: on a fast "open the list, go back" Home
// remounts and fetches BEFORE that POST settles — the badge would otherwise
// come back with the count the user just cleared.
export const NOTIFICATIONS_READ_EVENT = 'jamie:notifications-read';

// More precision than this helps nobody on an 18px badge.
const BADGE_MAX = 9;
export const badgeLabel = (count) => (count > BADGE_MAX ? `${BADGE_MAX}+` : String(count));

/**
 * An internal app path: ONE leading slash. "//host" and "/\host" are
 * protocol-relative and would leave the app; whitespace never belongs in a path.
 * The server validates admin links the same way (newsController.isInternalLink);
 * this is the client's own guard for whatever is already stored.
 */
export function isInternalPath(value) {
  return typeof value === 'string' && /^\/(?![/\\])[^\s\\]*$/.test(value);
}

/**
 * Where a row leads when tapped, or null. Rows without a target render as
 * plain, non-tappable cards — a tap that goes nowhere, or to a "nicht
 * gefunden" page, reads as a bug.
 *   1. `link` (admin news, e.g. "/deal/12") wins when it is an internal path
 *   2. hof_like → the Hall of Fame on /explore (the like is about a moment there)
 *   3. reference_type group → /group/:id, club → /club/:id, user → /user/:id —
 *      unless the server marked the group/club as gone (deleted since)
 */
export function notificationTarget(n) {
  if (!n) return null;
  if (isInternalPath(n.link)) return n.link;
  if (n.type === 'hof_like') return '/explore';
  const id = Number(n.reference_id);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (n.reference_type === 'user') return `/user/${id}`;
  if (n.reference_gone) return null;
  if (n.reference_type === 'group') return `/group/${id}`;
  if (n.reference_type === 'club') return `/club/${id}`;
  return null;
}
