import db from '../config/database.js';

// ==========================================
// SEND MESSAGE
// ==========================================
export const sendMessage = async (req, res) => {
  try {
    const { groupId, content } = req.body;

    // Check membership
    const member = await db.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.userId]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Insert message with RETURNING
    const result = await db.query(
      'INSERT INTO messages (group_id, user_id, content) VALUES ($1, $2, $3) RETURNING *',
      [groupId, req.userId, content]
    );

    const newMessage = result.rows[0];

    // Fetch sender info for realtime display
    const userResult = await db.query(
      'SELECT name, avatar_url FROM users WHERE id = $1',
      [req.userId]
    );
    const sender = userResult.rows[0];

    res.status(201).json({
      ...newMessage,
      user_name: sender?.name,
      avatar_url: sender?.avatar_url
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// GET MESSAGES (for a group)
// ==========================================
export const getMessages = async (req, res) => {
  try {
    const { groupId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await db.query(
      `SELECT m.*, u.name as user_name, u.avatar_url
       FROM messages m
       LEFT JOIN users u ON m.user_id = u.id
       WHERE m.group_id = $1
       ORDER BY m.created_at ASC
       LIMIT $2 OFFSET $3`,
      [groupId, limit, offset]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: error.message });
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
      return res.status(403).json({ error: 'Not authorized to delete this message' });
    }

    await db.query('DELETE FROM messages WHERE id = $1', [messageId]);
    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: error.message });
  }
};