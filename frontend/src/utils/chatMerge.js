// Catch-up merge helpers — group chat (ChatPage) and DMs (DirectMessagePage).
//
// A chat page in the background leaves its socket room (roomPresence.js, so a
// hidden page no longer counts as "reading along" and suppresses pushes). The
// live `message_deleted` / `dm_deleted` events only go to the room, so a page
// that was hidden never hears about a deletion — the catch-up refetch on
// return is the only way to learn about it. That merge only ever appended or
// patched rows and never removed one: an admin takedown or the sender's own
// delete stayed on screen after coming back, quote bars included.

const isServerId = (id) =>
  (typeof id === 'number' && Number.isInteger(id)) || (typeof id === 'string' && /^\d+$/.test(id));

/** The quoted message's id as a string, or null — for comparing quote bars. */
export const quoteIdOf = (m) => (m?.reply_to?.id == null ? null : String(m.reply_to.id));

/**
 * Drop the rows the server no longer returns. The fetched page is a contiguous
 * window [lo, hi] of the conversation, and both endpoints filter deleted
 * messages — so a held row whose id lies INSIDE that window but is missing
 * from it was deleted. Kept: rows outside the window (older history loaded
 * via "Ältere laden", live rows newer than the fetch) and local bubbles
 * (pending / failed, temp ids). Quote bars pointing at a dropped message are
 * cleared, like the live delete handlers do. Returns `prev` itself when
 * nothing changed, so React can bail out.
 */
export function dropVanished(prev, fetched) {
  if (!Array.isArray(prev) || !prev.length || !Array.isArray(fetched)) return prev;
  const ids = fetched.map((m) => m?.id).filter(isServerId).map(Number);
  if (!ids.length) return prev;
  const lo = Math.min(...ids);
  const hi = Math.max(...ids);
  const present = new Set(ids);
  const gone = new Set();
  const kept = prev.filter((m) => {
    if (!m || m._pending || m._failed || !isServerId(m.id)) return true;
    const id = Number(m.id);
    if (id < lo || id > hi || present.has(id)) return true;
    gone.add(String(id));
    return false;
  });
  if (!gone.size) return prev;
  return kept.map((m) => (gone.has(quoteIdOf(m)) ? { ...m, reply_to: null } : m));
}
