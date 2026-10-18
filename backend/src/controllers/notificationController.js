import db from '../config/database.js';
import { sendPushToUser } from './pushController.js';

// The bell on Home (Robert / Lea, 18.10.2026) shows "9+" at most, so the count
// never has to be exact beyond that — the LIMIT bounds the work for someone
// who has not opened the list in months, on the partial unread index.
export const UNREAD_COUNT_CAP = 99;

// Postgres INTEGER bound — a larger "upToId" would fail the comparison as a 500.
const PG_INT_MAX = 2147483647;

// ==========================================
// GET NOTIFICATIONS
// ==========================================
// The bell's list renders by type (news, hof_like, …), so each row carries:
//   sender          {id, name, avatar} | null — null for JAMIE news (sender_id
//                   NULL) and for senders whose account is gone
//   reference_name  the group/club name for reference_type 'group' | 'club'
//                   (clubs, groups and club events all live in `groups`)
//   reference_gone  true when that group/club no longer exists or was deleted,
//                   so the row stops pointing at a 404
//   link            optional internal path (users of n.* — absent until the
//                   notifications.link migration ran, which the client tolerates)
// sender_name / sender_avatar / sender_age stay for older bundles.
export const getNotifications = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT n.*, u.name as sender_name, u.avatar_url as sender_avatar,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS sender_age,
              g.name AS reference_name,
              (n.reference_type IN ('group', 'club')
                AND (g.id IS NULL OR g.deleted_at IS NOT NULL)) AS reference_gone
       FROM notifications n
       LEFT JOIN users u ON n.sender_id = u.id
       LEFT JOIN groups g ON n.reference_type IN ('group', 'club') AND g.id = n.reference_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT 50`,
      [req.userId]
    );
    res.json(result.rows.map((row) => ({
      ...row,
      sender: row.sender_id != null && row.sender_name != null
        ? { id: row.sender_id, name: row.sender_name, avatar: row.sender_avatar || null }
        : null,
      reference_name: row.reference_name ?? null,
      reference_gone: row.reference_gone === true,
    })));
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// UNREAD COUNT (the bell's badge)
// ==========================================
// Fetched on Home mount and whenever the app returns to the foreground; live
// updates arrive as `new_notification` socket events and are counted on the
// client, so a "News an alle" never makes every open app call back here at once.
export const getUnreadCount = async (req, res) => {
  if (req.isGuest || !req.userId) return res.json({ count: 0 });
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT 1 FROM notifications
          WHERE user_id = $1 AND is_read = FALSE
          LIMIT ${UNREAD_COUNT_CAP}
       ) AS unread`,
      [req.userId]
    );
    res.json({ count: rows[0]?.count ?? 0 });
  } catch (error) {
    console.error('Error counting unread notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// MARK ALL AS READ
// ==========================================
// Optional body { upToId }: the newest id the list actually showed. Without it
// a notification arriving between the list GET and this POST was marked read
// although nobody ever saw it — and the bell then had nothing to show for it.
// Older bundles send no body and keep the old "everything" behaviour.
export const markRead = async (req, res) => {
  try {
    const raw = req.body?.upToId;
    const upToId = Number.isInteger(raw) && raw > 0 && raw <= PG_INT_MAX ? raw : null;
    if (upToId) {
      await db.query(
        'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE AND id <= $2',
        [req.userId, upToId]
      );
    } else {
      await db.query(
        'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE',
        [req.userId]
      );
    }
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
