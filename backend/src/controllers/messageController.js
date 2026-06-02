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
    const isAuthor      = author_id      === req.userId;
    const isGroupOwner  = group_owner_id === req.userId;

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