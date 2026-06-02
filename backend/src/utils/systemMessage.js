import db from '../config/database.js';

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
