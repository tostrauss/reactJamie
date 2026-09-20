// ==========================================
// EMOJI-REAKTIONEN — Client-Spiegel der Server-Allowlist
// ==========================================
// MIRROR of backend/src/utils/reactions.js. The server validates every write
// against its own copy, so an emoji that only exists here is a guaranteed 400
// — the picker would offer a button that cannot work. Keep the two byte-
// identical; backend/tests/utils/reactions.test.js reads both files and fails
// if they diverge.
//
// Why a fixed list and no free-text picker: a reaction is user content stored
// on someone else's message and shown to the whole room, with no report
// surface of its own. A closed set means there is nothing to moderate.
//
// The first QUICK_REACTION_COUNT entries are the quick bar in the long-press
// sheet; the rest sit behind the "+".
export const REACTION_EMOJI = [
  '👍', '❤️', '😂', '🔥', '🎉', '🙏',
  '👏', '💪', '🤝', '😮', '😢', '👎',
  '😍', '🥳', '😎', '🤩', '😅', '🙃',
  '😴', '🤔', '🤗', '😭', '🤭', '🤯',
  '✅', '❌', '💯', '⭐', '✨', '👀',
  '🙌', '🤷', '🤞', '💚', '💜', '🧡',
  '🍻', '☕', '🍕', '⚽', '🎵', '📸',
  '🚴', '🏃', '🧗', '🎯', '📅', '📍',
];

export const QUICK_REACTION_COUNT = 6;
export const QUICK_REACTIONS = REACTION_EMOJI.slice(0, QUICK_REACTION_COUNT);
export const MORE_REACTIONS  = REACTION_EMOJI.slice(QUICK_REACTION_COUNT);

// What the current user reacted with on this message, or null.
// `reactions` is the server summary: [{ emoji, count, user_ids }].
export const myReaction = (reactions, userId) => {
  if (!Array.isArray(reactions) || userId == null) return null;
  const mine = reactions.find(r => (r.user_ids || []).some(id => Number(id) === Number(userId)));
  return mine ? mine.emoji : null;
};

// Optimistic local application of a reaction change, so the chip moves on tap
// instead of after the round trip. Mirrors the server rule exactly: ONE
// reaction per person, so the old one is removed wherever it was, and an emoji
// whose count drops to zero disappears.
//
// The server's response (and its socket broadcast) then REPLACES this — it
// carries the full summary, not a delta, so a wrong guess here self-corrects on
// the next event rather than accumulating.
export const applyReactionLocally = (reactions, userId, emoji) => {
  const me = Number(userId);
  const next = (Array.isArray(reactions) ? reactions : [])
    .map(r => ({ ...r, user_ids: (r.user_ids || []).map(Number).filter(id => id !== me) }))
    .map(r => ({ ...r, count: r.user_ids.length }))
    .filter(r => r.count > 0);

  if (emoji) {
    const hit = next.find(r => r.emoji === emoji);
    if (hit) { hit.user_ids = [...hit.user_ids, me]; hit.count = hit.user_ids.length; }
    else next.push({ emoji, count: 1, user_ids: [me] });
  }
  return next.sort((a, b) => b.count - a.count);
};
