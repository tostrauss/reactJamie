import db from '../config/database.js';

// ==========================================
// SEND DIRECT MESSAGE
// ==========================================
export const sendDM = async (req, res) => {
  try {
    const { receiverId, content } = req.body;

    if (!receiverId || !content) {
      return res.status(400).json({ error: 'receiverId and content required' });
    }

    // Verify friendship exists and is accepted
    const friendship = await db.query(
      `SELECT * FROM friendships
       WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2)
            OR (requester_id = $2 AND addressee_id = $1))`,
      [req.userId, receiverId]
    );

    if (friendship.rows.length === 0) {
      return res.status(403).json({
        error: 'You must be friends to send direct messages',
        requiresFriendship: true
      });
    }

    // Insert message
    const result = await db.query(
      'INSERT INTO direct_messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
      [req.userId, receiverId, content]
    );

    // Update or create conversation tracker
    await db.query(
      `INSERT INTO dm_conversations (user_id, other_user_id, last_message_id, unread_count)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (user_id, other_user_id) 
       DO UPDATE SET last_message_id = $3, updated_at = CURRENT_TIMESTAMP`,
      [req.userId, receiverId, result.rows[0].id]
    );

    await db.query(
      `INSERT INTO dm_conversations (user_id, other_user_id, last_message_id, unread_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (user_id, other_user_id) 
       DO UPDATE SET last_message_id = $3, unread_count = dm_conversations.unread_count + 1, updated_at = CURRENT_TIMESTAMP`,
      [receiverId, req.userId, result.rows[0].id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error sending DM:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// GET CONVERSATION WITH USER
// ==========================================
export const getConversation = async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await db.query(
      `SELECT dm.*, 
              s.name as sender_name, s.avatar_url as sender_avatar,
              r.name as receiver_name, r.avatar_url as receiver_avatar
       FROM direct_messages dm
       LEFT JOIN users s ON dm.sender_id = s.id
       LEFT JOIN users r ON dm.receiver_id = r.id
       WHERE (dm.sender_id = $1 AND dm.receiver_id = $2) 
          OR (dm.sender_id = $2 AND dm.receiver_id = $1)
       ORDER BY dm.created_at ASC
       LIMIT $3 OFFSET $4`,
      [req.userId, userId, limit, offset]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// GET ALL CONVERSATIONS LIST
// ==========================================
export const getConversations = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT dc.*, u.name as other_name, u.avatar_url as other_avatar,
              dm.content as last_message_text, dm.created_at as last_message_at
       FROM dm_conversations dc
       JOIN users u ON dc.other_user_id = u.id
       LEFT JOIN direct_messages dm ON dc.last_message_id = dm.id
       WHERE dc.user_id = $1
       ORDER BY dc.updated_at DESC`,
      [req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// MARK CONVERSATION AS READ
// ==========================================
export const markDMRead = async (req, res) => {
  try {
    const { userId } = req.params;

    await db.query(
      `UPDATE dm_conversations SET unread_count = 0 WHERE user_id = $1 AND other_user_id = $2`,
      [req.userId, userId]
    );

    // Also mark messages as read
    await db.query(
      `UPDATE direct_messages SET is_read = TRUE 
       WHERE sender_id = $1 AND receiver_id = $2 AND is_read = FALSE`,
      [userId, req.userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking DM read:', error);
    res.status(500).json({ error: error.message });
  }
};