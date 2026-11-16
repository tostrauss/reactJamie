// „Clubs & Communities“ in the own profile (Tina 16.11.2026, PR2/PR3): which
// of the caller's clubs (GET /clubs/user/joined) become bubbles, and in which
// order. The server keeps its newest-first order for Home and old bundles, so
// the profile orders on the client.
//
//   own     is_own (the caller is the owner): always first, never sorted, in
//           the server's order. A co-manager's club is a joined one. Rare
//           case: a deleted account hands its clubs to the oldest member as
//           owner, who then sees „hast du erstellt“ for a club they took over.
//   joined  the order set in „Sortieren“ (profile_position); clubs joined
//           since then come first (NULLS FIRST, newest first), so a new club
//           is seen at once.
//   hidden  rejected and closed clubs (approval_status 'rejected', is_active
//           FALSE). Home always listed them; the profile does not.

const isShown = (c) => c && c.approval_status !== 'rejected' && c.is_active !== false;

const joinedAt = (c) => {
  const ms = Date.parse(c.joined_at);
  return Number.isNaN(ms) ? 0 : ms;
};

const byProfileOrder = (a, b) => {
  const pa = a.profile_position ?? null;
  const pb = b.profile_position ?? null;
  if (pa !== pb) {
    if (pa === null) return -1;
    if (pb === null) return 1;
    return pa - pb;
  }
  return joinedAt(b) - joinedAt(a);
};

/** { own, joined } — the bubbles left to right. */
export function profileClubRows(rows) {
  const shown = (Array.isArray(rows) ? rows : []).filter(isShown);
  return {
    own: shown.filter((c) => c.is_own),
    joined: shown.filter((c) => !c.is_own).sort(byProfileOrder),
  };
}

/**
 * The rows after saving `ids` as the order — what PUT /users/me/clubs/order
 * stores: positions 1…n for those ids, every other position forgotten. Lets
 * the bubbles keep the new order before the answer is in.
 */
export const withClubOrder = (rows, ids) => {
  const position = new Map(ids.map((id, i) => [id, i + 1]));
  return (Array.isArray(rows) ? rows : []).map((c) => ({ ...c, profile_position: position.get(c.id) ?? null }));
};
