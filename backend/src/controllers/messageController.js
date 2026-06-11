import db from '../config/database.js';
import { checkTextSafety } from '../config/moderation.js';
import { deleteCached } from '../utils/cache.js';

// Stamp the caller's read marker for a group chat and drop their cached
// joined-groups list (it embeds unread_count, TTL 15s — without the
// invalidation the nav badge could show stale counts right after reading).
const stampChatRead = (groupId, userId) =>
  db.query(
    'UPDATE group_members SET last_read_at = NOW() WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  ).then(() => deleteCached(`user_groups:${userId}`));

// ==========================================
// SEND MESSAGE
// ==========================================
export const sendMessage = async (req, res) => {
  try {
    const { groupId, content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }
    if (content.length > 5000) {
      return res.status(400).json({ error: 'Nachricht darf maximal 5.000 Zeichen lang sein' });
    }

    const { safe, reason } = await checkTextSafety(content);
    if (!safe) {
      return res.status(422).json({ error: reason });
    }

    // Single query: membership check + group info in one JOIN.
    // group_members has a composite PK (group_id, user_id) — no `id` column —
    // so we use gm.user_id as the existence marker.
    const ctx = await db.query(
      `SELECT g.type, g.owner_id, g.chat_only_owner, gm.user_id AS member_user_id
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
       WHERE g.id = $1`,
      [groupId, req.userId]
    );
    if (ctx.rows.length === 0) {
      return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    }
    const { type, owner_id, chat_only_owner, member_user_id } = ctx.rows[0];
    if (member_user_id == null) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }
    if (type === 'club' && chat_only_owner && Number(owner_id) !== Number(req.userId)) {
      return res.status(403).json({
        error: 'Nur der Club-Gründer kann Nachrichten senden',
        isOwnerOnly: true
      });
    }

    // INSERT + fetch sender info in one CTE — eliminates a second round trip
    const result = await db.query(
      `WITH inserted AS (
         INSERT INTO messages (group_id, user_id, content) VALUES ($1, $2, $3) RETURNING *
       )
       SELECT i.*, u.name AS user_name, u.avatar_url
       FROM inserted i
       JOIN users u ON u.id = i.user_id`,
      [groupId, req.userId, content]
    );

    // Nudge every member's personal `user_<id>` room (DM pattern) so nav
    // badges + chat-list rows update for members who do NOT have this chat
    // open — `receive_message` is room-scoped and never reaches them.
    // Deliberately HERE and not in the socket send_message handler: this
    // runs only for messages that passed moderation + rate limit and are
    // actually persisted, and it works even if the sender's socket is down.
    // One batched emit (array of rooms) = one adapter publish.
    try {
      const io = req.app.get('io');
      if (io) {
        const memberRows = await db.query(
          'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id <> $2',
          [groupId, req.userId]
        );
        const rooms = memberRows.rows.map(r => `user_${r.user_id}`);
        if (rooms.length) {
          io.to(rooms).emit('group_message_notification', {
            group_id: result.rows[0].group_id,
            group_type: type,
            user_name: result.rows[0].user_name,
            content: content.slice(0, 200),
          });
        }
      }
    } catch {
      // Best-effort: unread truth lives in the DB, the next refetch catches up
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Nachricht konnte nicht gesendet werden' });
  }
};

// ==========================================
// GET MESSAGES (for a group) — cursor-based pagination
// ?limit=50          — max messages to return (default 50, max 100)
// ?before=<id>       — return messages with id < this value (for "load earlier")
// Returns messages in chronological order (ASC); use `has_more` to know if older messages exist.
// ==========================================
export const getMessages = async (req, res) => {
  try {
    const { groupId } = req.params;

    // Verify the requesting user is a member of this group before returning messages.
    // Without this check any authenticated user can read messages from private groups.
    const memberCheck = await db.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
      [groupId, req.userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const before = req.query.before ? parseInt(req.query.before, 10) : null;

    const params = [groupId, limit + 1]; // fetch one extra to detect has_more
    let whereClause = 'WHERE m.group_id = $1';
    if (before) {
      whereClause += ` AND m.id < $3`;
      params.push(before);
    }

    const result = await db.query(
      `SELECT m.id, m.group_id, m.user_id, m.content, m.message_type, m.created_at,
              u.name AS user_name, u.avatar_url
       FROM messages m
       LEFT JOIN users u ON m.user_id = u.id
       ${whereClause}
       ORDER BY m.created_at DESC
       LIMIT $2`,
      params
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop(); // remove the extra sentinel row

    // Opening the chat reads it — fire-and-forget so the response isn't
    // delayed. ("Load earlier" pagination re-stamps too; harmless.)
    stampChatRead(groupId, req.userId).catch(() => {});

    // Return in chronological order so the UI renders oldest→newest
    res.json({ messages: rows.reverse(), has_more: hasMore });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Nachrichten konnten nicht geladen werden' });
  }
};

// ==========================================
// MARK CHAT READ
// ==========================================
// Called by ChatPage on unmount so messages that arrived WHILE the chat was
// open (after getMessages already stamped) don't linger as phantom unreads.
// The UPDATE's WHERE doubles as the membership check — 0 rows = not a member.
export const markChatRead = async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    if (!groupId) return res.status(400).json({ error: 'Ungültige Gruppen-ID' });
    await stampChatRead(groupId, req.userId);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error marking chat read:', error);
    res.status(500).json({ error: 'Chat konnte nicht als gelesen markiert werden' });
  }
};

// ==========================================
// DELETE MESSAGE
// ==========================================
export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    // Fetch message + group owner in one query so we can check both permissions
    const result = await db.query(
      `SELECT m.user_id AS author_id, g.owner_id AS group_owner_id
       FROM messages m
       JOIN groups g ON g.id = m.group_id
       WHERE m.id = $1`,
      [messageId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const { author_id, group_owner_id } = result.rows[0];
    const isAuthor      = Number(author_id)      === Number(req.userId);
    const isGroupOwner  = Number(group_owner_id) === Number(req.userId);

    if (!isAuthor && !isGroupOwner) {
      return res.status(403).json({ error: 'Keine Berechtigung, diese Nachricht zu löschen' });
    }

    await db.query('DELETE FROM messages WHERE id = $1', [messageId]);
    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Nachricht konnte nicht gelöscht werden' });
  }
};