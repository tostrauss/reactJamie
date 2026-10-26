import db from '../config/database.js';

/**
 * The texts of the automatic chat lines — the ONE place to change them.
 *
 * Deliberately a German server constant, not an i18n key: a system message
 * is persisted as a single `content` string that every reader in every
 * language sees as-is, and the shipped clients (iOS 1.4.1 included) render
 * nothing but `content`. A per-language rendering would need structured
 * message data and a client update. Same rule as before the texts lived
 * here (2026-10-26) — only the source moved.
 *
 * Tina's final welcome text is still open (drafts with Tobi): swapping it is
 * a one-line change of welcomeGroup/welcomeClub/welcomeEvent below. Keep it
 * under the 500-character cap of postSystemMessage, which cuts silently.
 */
export const SYSTEM_TEXTS = Object.freeze({
  // A new group's chat — the creator is alone in it, so "dich".
  welcomeGroup: (name) => `Willkommen bei ${name}! Stell dich kurz vor 👋`,
  // A new club or community (createClub, and the legacy club path of
  // createGroup) — members arrive over time, so "euch".
  welcomeClub: (name) => `Willkommen bei ${name}! Stell euch kurz vor 👋`,
  // A new club event (since 2026-10-26). Participants join one by one, so
  // the group wording until Tina wants a text of its own.
  welcomeEvent: (name) => `Willkommen bei ${name}! Stell dich kurz vor 👋`,
  joined: (name) => `${name} ist der Gruppe beigetreten 🎉`,
  left: (name) => `${name} hat die Gruppe verlassen 👋`,
});

/**
 * Insert a system message into a group's chat and (optionally) broadcast it
 * over Socket.IO so any room members currently watching the chat see it live.
 *
 * System messages have:
 *   - user_id = NULL     (no real author; ChatPage renders them as centered pills)
 *   - message_type = 'system'
 *
 * The receive_message socket payload mirrors the regular message shape so the
 * ChatPage handler can append it without a special branch — the renderer
 * differentiates by `message_type` alone.
 *
 * @param {number} groupId - group/club ID
 * @param {string} content - the system text (already localized)
 * @param {import('socket.io').Server} [io] - optional Socket.IO instance for live fanout
 */
export async function postSystemMessage(groupId, content, io) {
  if (!groupId || typeof content !== 'string' || !content.trim()) return null;

  const trimmed = content.slice(0, 500);

  try {
    const result = await db.query(
      `INSERT INTO messages (group_id, user_id, content, message_type)
       VALUES ($1, NULL, $2, 'system')
       RETURNING id, group_id, user_id, content, message_type, created_at`,
      [groupId, trimmed]
    );
    const msg = result.rows[0];

    if (io && msg) {
      // Match the shape ChatPage expects from `receive_message`
      io.to(String(groupId)).emit('receive_message', {
        id: msg.id,
        group_id: msg.group_id,
        user_id: null,
        content: msg.content,
        message_type: 'system',
        created_at: msg.created_at,
      });
    }
    return msg;
  } catch (err) {
    // Never let a chat-system-message failure block the join/create flow that
    // called us. Worst case the welcome line is missing — the chat still works.
    console.error('[systemMessage] insert failed:', err.message);
    return null;
  }
}
