// ==========================================
// EMOJI-REAKTIONEN auf Nachrichten (Gruppen-Chat + DMs)
// ==========================================
// Shared between messageController (group chat) and dmController, because the
// rule set is identical on both sides and the two must never drift apart.
//
// THE ALLOWLIST IS THE WHOLE SECURITY MODEL. `emoji` is user-supplied text
// stored on someone else's message and rendered to everyone in the room, so a
// free-text column would be an unmoderated broadcast channel attached to every
// bubble — a slur, a URL, or a 400-character ZWJ bomb, with no report surface
// because a reaction is not a message. Only a member of this fixed list is
// ever written, everything else is a 400. That is also why there is no
// "custom emoji" input in the UI: there is nothing to moderate if nothing
// arbitrary can be stored.
//
// The first QUICK_REACTION_COUNT entries are the WhatsApp-style quick bar that
// appears on long-press; the rest are behind the "+" grid. Order matters —
// don't reshuffle the head without meaning to change the quick bar.
//
// ⚠️ This list is MIRRORED in frontend/src/utils/reactions.js and the two must
// stay byte-identical, or the client offers an emoji the server rejects with a
// 400. `tests/utils/reactions.test.js` reads both files and fails the build on
// any divergence — that test is the contract, don't skip it.
export const REACTION_EMOJI = [
  // Quick bar (long-press) — the six that cover almost every real reaction.
  '👍', '❤️', '😂', '🔥', '🎉', '🙏',
  // Everything below is behind the "+".
  '👏', '💪', '🤝', '😮', '😢', '👎',
  '😍', '🥳', '😎', '🤩', '😅', '🙃',
  '😴', '🤔', '🤗', '😭', '🤭', '🤯',
  '✅', '❌', '💯', '⭐', '✨', '👀',
  '🙌', '🤷', '🤞', '💚', '💜', '🧡',
  '🍻', '☕', '🍕', '⚽', '🎵', '📸',
  '🚴', '🏃', '🧗', '🎯', '📅', '📍',
];

export const QUICK_REACTION_COUNT = 6;

const ALLOWED = new Set(REACTION_EMOJI);

export const isAllowedReaction = (emoji) =>
  typeof emoji === 'string' && ALLOWED.has(emoji);

// The two reaction tables. Both key on `message_id`, so only the table name
// differs — but a table name cannot be a bound parameter, so it is resolved
// through this map and NEVER from a request value. Any new caller must add a
// key here rather than pass a string through.
const TABLES = {
  group: 'message_reactions',
  dm:    'dm_reactions',
};

const tableFor = (kind) => {
  const table = TABLES[kind];
  if (!table) throw new Error(`unknown reaction kind: ${kind}`);
  return table;
};

// SQL that aggregates one message's reactions into the array the clients
// render: [{ emoji, count, user_ids }], most-used first.
//
// `user_ids` rather than a per-viewer "did I react" flag, because this same
// shape goes out over the socket as ONE payload to the whole room — a
// viewer-dependent field would be wrong for everybody but the actor. Each
// client checks membership of its own id locally. Everyone who can receive it
// is already in the room (group member, or one of the two DM participants), so
// it exposes nothing they cannot see in the roster.
//
// Ordering: count DESC so the dominant reaction leads, then by who reacted
// first, so the chips don't reshuffle on every re-render when counts tie.
const aggregateSql = (table) => `
  SELECT COALESCE(
           json_agg(
             json_build_object('emoji', s.emoji, 'count', s.c, 'user_ids', s.ids)
             ORDER BY s.c DESC, s.first_at ASC
           ),
           '[]'::json
         ) AS reactions
    FROM (
      SELECT emoji,
             COUNT(*)::int              AS c,
             array_agg(user_id ORDER BY created_at) AS ids,
             MIN(created_at)            AS first_at
        FROM ${table}
       WHERE message_id = $1
       GROUP BY emoji
    ) s`;

// Read one message's reaction summary. Used after every write so the HTTP
// response and the socket broadcast carry the SAME authoritative state — the
// clients never have to reconstruct it from a delta, which is what keeps a
// dropped socket event from leaving a permanently wrong count on screen.
export const getReactionSummary = async (db, kind, messageId) => {
  const { rows } = await db.query(aggregateSql(tableFor(kind)), [messageId]);
  return rows[0]?.reactions ?? [];
};

// Reactions for a whole page of messages, as Map<messageId, summary[]>.
//
// Deliberately a SECOND query rather than a LATERAL join on the message list.
// A join would make the chat's hottest read depend on this table existing, and
// the server starts accepting traffic BEFORE startup migrations finish (listen
// → migrate) — so on the first deploy that carries this feature, every
// getMessages would 500 for the length of the boot window, and a migration that
// failed outright would take the entire chat down rather than just the chips.
// One extra indexed round trip per page is a cheap price for that isolation.
//
// Failure is swallowed on purpose: no reactions is a cosmetic loss, no chat is
// an outage. The caller always gets a Map, never a throw.
export const getReactionsFor = async (db, kind, ids) => {
  const out = new Map();
  // `> 0` rather than just Number.isInteger: ids are positive serials, and
  // Number(null) is 0, so a plain isInteger check quietly turns every null and
  // empty string in the page into a query for message 0. Optimistic bubbles
  // also carry `temp-…` ids, which must never reach the query.
  const clean = [...new Set(
    (ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0)
  )];
  if (!clean.length) return out;
  try {
    const { rows } = await db.query(
      `SELECT message_id,
              json_agg(
                json_build_object('emoji', s.emoji, 'count', s.c, 'user_ids', s.ids)
                ORDER BY s.c DESC, s.first_at ASC
              ) AS reactions
         FROM (
           SELECT message_id, emoji,
                  COUNT(*)::int                          AS c,
                  array_agg(user_id ORDER BY created_at)  AS ids,
                  MIN(created_at)                         AS first_at
             FROM ${tableFor(kind)}
            WHERE message_id = ANY($1::int[])
            GROUP BY message_id, emoji
         ) s
        GROUP BY message_id`,
      [clean]
    );
    for (const r of rows) out.set(Number(r.message_id), r.reactions);
  } catch (err) {
    // 42P01 = table not there yet (boot window / failed migration). Anything
    // else is logged once and treated the same way: the chat still renders.
    if (err?.code !== '42P01') {
      console.error(`[reactions] summary query failed (${kind}):`, err.message);
    }
  }
  return out;
};

// Attach `reactions` to each row of a message page, in place of the caller
// having to merge two result sets by hand in both controllers.
export const attachReactions = async (db, kind, rows) => {
  const byId = await getReactionsFor(db, kind, rows.map(r => r.id));
  for (const row of rows) row.reactions = byId.get(Number(row.id)) ?? [];
  return rows;
};

// Write (or clear) the caller's reaction.
//
// One reaction per person per message — the table's PRIMARY KEY (message_id,
// user_id) enforces it, so picking a second emoji REPLACES the first instead of
// stacking. That is WhatsApp's rule and the one Tobi asked for; it also bounds
// the table at one row per person per message rather than one per person per
// emoji, which is what keeps a 40-person club chat from turning a reaction
// storm into thousands of rows.
//
// `emoji: null` removes. Returns the fresh summary for broadcasting.
export const setReaction = async (db, kind, messageId, userId, emoji) => {
  const table = tableFor(kind);
  if (emoji == null) {
    await db.query(`DELETE FROM ${table} WHERE message_id = $1 AND user_id = $2`, [messageId, userId]);
  } else {
    // created_at is refreshed on a change so the chip ordering reflects when
    // this person landed on THIS emoji, not when they first reacted at all.
    await db.query(
      `INSERT INTO ${table} (message_id, user_id, emoji)
            VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id)
       DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
      [messageId, userId, emoji]
    );
  }
  return getReactionSummary(db, kind, messageId);
};
