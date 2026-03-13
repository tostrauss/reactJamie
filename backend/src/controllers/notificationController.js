import db from '../config/database.js';
import { sendPushToUser } from './pushController.js';

// ==========================================
// GET NOTIFICATIONS
// ==========================================
export const getNotifications = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT n.*, u.name as sender_name, u.avatar_url as sender_avatar
       FROM notifications n
       LEFT JOIN users u ON n.sender_id = u.id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// MARK ALL AS READ
// ==========================================
export const markRead = async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = $1',
      [req.userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notifications read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// MARK SINGLE NOTIFICATION AS READ
// ==========================================
export const markSingleRead = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// CREATE NOTIFICATION (internal helper)
// ==========================================
export const createNotification = async (userId, senderId, type, title, message, refId, io) => {
  try {
    const result = await db.query(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, reference_id) 
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, senderId, type, title, message, refId]
    );

    const notification = result.rows[0];

    // Realtime: Socket.io (for active sessions)
    if (io) {
      io.to(`user_${userId}`).emit('new_notification', notification);
    }

    // Push notification (non-blocking — fires for background/closed sessions)
    sendPushToUser(userId, title, message, '/notifications');

    return notification;
  } catch (err) {
    console.error('Notification Error:', err);
    return null;
  }
};