import db from '../config/database.js';

export const sendMessage = async (req, res) => {
  try {
    const { groupId, content } = req.body;

    // Check if user is member of group
    const member = await db.query(
      'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.userId]
    );

    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const result = await db.query(
      'INSERT INTO messages (group_id, user_id, content) VALUES (?, ?, ?)',
      [groupId, req.userId, content]
    );

    res.status(201).json({
      id: result.lastID,
      group_id: groupId,
      user_id: req.userId,
      content,
      created_at: new Date()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { groupId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await db.query(
      `SELECT m.*, u.name as user_name, u.avatar_url
       FROM messages m
       LEFT JOIN users u ON m.user_id = u.id
       WHERE m.group_id = ?
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      [groupId, limit, offset]
    );

    res.json(result.rows.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await db.query(
      'SELECT * FROM messages WHERE id = ?',
      [messageId]
    );

    if (message.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.rows[0].user_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await db.query('DELETE FROM messages WHERE id = ?', [messageId]);
    res.json({ message: 'Message deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
