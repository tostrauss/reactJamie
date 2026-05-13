import db from '../config/database.js';
import { checkTextSafety } from '../config/moderation.js';

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

    // Single query: membership check + group info in one JOIN
    const ctx = await db.query(
      `SELECT g.type, g.owner_id, g.chat_only_owner, gm.id AS member_id
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
       WHERE g.id = $1`,
      [groupId, req.userId]
    );
    if (ctx.rows.length === 0) {
      return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    }
    const { type, owner_id, chat_only_owner, member_id } = ctx.rows[0];
    if (!member_id) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }
    if (type === 'club' && chat_only_owner && owner_id !== req.userId) {
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
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const before = req.query.before ? parseInt(req.query.before, 10) : null;

    const params = [groupId, limit + 1]; // fetch one extra to detect has_more
    let whereClause = 'WHERE m.group_id = $1';
    if (before) {
      whereClause += ` AND m.id < $3`;
      params.push(before);
    }

    const result = await db.query(
      `SELECT m.id, m.group_id, m.user_id, m.content, m.created_at,
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

    // Return in chronological order so the UI renders oldest→newest
    res.json({ messages: rows.reverse(), has_more: hasMore });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Nachrichten konnten nicht geladen werden' });
  }
};

// ==========================================
// DELETE MESSAGE
// ==========================================
export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    // Check message exists & ownership
    const message = await db.query(
      'SELECT * FROM messages WHERE id = $1',
      [messageId]
    );
    if (message.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (message.rows[0].user_id !== req.userId) {
      return res.status(403).json({ error: 'Keine Berechtigung, diese Nachricht zu löschen' });
    }

    await db.query('DELETE FROM messages WHERE id = $1', [messageId]);
    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Nachricht konnte nicht gelöscht werden' });
  }
};