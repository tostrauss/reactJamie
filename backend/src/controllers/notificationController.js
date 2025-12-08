import db from '../config/database.js';

export const getNotifications = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT n.*, u.name as sender_name, u.avatar_url as sender_avatar
       FROM notifications n
       LEFT JOIN users u ON n.sender_id = u.id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const markRead = async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ?',
      [req.userId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Internal helper to create notification
export const createNotification = async (userId, senderId, type, title, message, refId, io) => {
  try {
    const result = await db.query(
      'INSERT INTO notifications (user_id, sender_id, type, title, message, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, senderId, type, title, message, refId]
    );
    
    // Realtime Push
    if (io) {
      const notifData = {
        id: result.lastID,
        user_id: userId,
        sender_id: senderId,
        type,
        title,
        message,
        reference_id: refId,
        created_at: new Date()
      };
      io.to(`user_${userId}`).emit('new_notification', notifData);
    }
  } catch (err) {
    console.error('Notification Error:', err);
  }
};