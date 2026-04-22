import db from '../config/database.js';
import { sendPushToUser } from './pushController.js';

// ==========================================
// SEND FRIEND REQUEST
// ==========================================
export const sendFriendRequest = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId is required' });
    if (userId === req.userId) return res.status(400).json({ error: 'Cannot send friend request to yourself' });

    // Check if friendship already exists (in either direction)
    const existing = await db.query(
      `SELECT * FROM friendships 
       WHERE (requester_id = $1 AND addressee_id = $2) 
          OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, userId]
    );

    if (existing.rows.length > 0) {
      const f = existing.rows[0];
      if (f.status === 'accepted') return res.status(400).json({ error: 'Already friends' });
      if (f.status === 'pending') return res.status(400).json({ error: 'Friend request already pending' });
      if (f.status === 'rejected') {
        // Allow re-requesting after rejection
        await db.query(
          `UPDATE friendships SET status = 'pending', requester_id = $1, addressee_id = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [req.userId, userId, f.id]
        );
        notifyFriendRequest(req.userId, userId);
        return res.json({ message: 'Friend request sent', status: 'pending' });
      }
    }

    // Create new friend request
    const result = await db.query(
      `INSERT INTO friendships (requester_id, addressee_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [req.userId, userId]
    );

    notifyFriendRequest(req.userId, userId);
    res.status(201).json({ message: 'Friend request sent', friendship: result.rows[0] });
  } catch (error) {
    console.error('Error sending friend request:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// RESPOND TO FRIEND REQUEST (accept/reject)
// ==========================================
export const respondFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "accept" or "reject"' });
    }

    // Get request (must be addressed to current user)
    const request = await db.query(
      `SELECT * FROM friendships WHERE id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [requestId, req.userId]
    );

    if (request.rows.length === 0) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';

    await db.query(
      `UPDATE friendships SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newStatus, requestId]
    );

    if (action === 'accept') {
      notifyFriendAccepted(req.userId, request.rows[0].requester_id);
    }

    res.json({ message: `Friend request ${newStatus}`, status: newStatus });
  } catch (error) {
    console.error('Error responding to friend request:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// GET PENDING FRIEND REQUESTS (incoming)
// ==========================================
export const getPendingRequests = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.*, u.name as requester_name, u.avatar_url as requester_avatar, 
              u.bio as requester_bio, u.location as requester_location
       FROM friendships f
       JOIN users u ON f.requester_id = u.id
       WHERE f.addressee_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching friend requests:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// GET SENT REQUESTS (outgoing)
// ==========================================
export const getSentRequests = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.*, u.name as addressee_name, u.avatar_url as addressee_avatar
       FROM friendships f
       JOIN users u ON f.addressee_id = u.id
       WHERE f.requester_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sent requests:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// GET FRIENDS LIST
// ==========================================
export const getFriends = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
         f.id as friendship_id,
         f.created_at as friends_since,
         CASE 
           WHEN f.requester_id = $1 THEN f.addressee_id 
           ELSE f.requester_id 
         END as friend_id,
         u.name, u.avatar_url, u.bio, u.location, u.last_seen
       FROM friendships f
       JOIN users u ON u.id = CASE 
         WHEN f.requester_id = $1 THEN f.addressee_id 
         ELSE f.requester_id 
       END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1) 
         AND f.status = 'accepted'
       ORDER BY u.name ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// REMOVE FRIEND (unfriend)
// ==========================================
export const removeFriend = async (req, res) => {
  try {
    const { friendId } = req.params;

    const result = await db.query(
      `DELETE FROM friendships 
       WHERE ((requester_id = $1 AND addressee_id = $2) 
           OR (requester_id = $2 AND addressee_id = $1)) 
         AND status = 'accepted'`,
      [req.userId, friendId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    res.json({ message: 'Friend removed successfully' });
  } catch (error) {
    console.error('Error removing friend:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// CHECK FRIENDSHIP STATUS
// ==========================================
export const checkFriendship = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await db.query(
      `SELECT * FROM friendships 
       WHERE (requester_id = $1 AND addressee_id = $2) 
          OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, userId]
    );

    if (result.rows.length === 0) {
      return res.json({ status: 'none' });
    }

    const f = result.rows[0];
    res.json({
      status: f.status,
      friendship_id: f.id,
      is_requester: f.requester_id === req.userId
    });
  } catch (error) {
    console.error('Error checking friendship:', error);
    res.status(500).json({ error: error.message });
  }
};

// ── Push helpers (fire-and-forget) ──────────────────────────────────────────
async function notifyFriendRequest(fromUserId, toUserId) {
  try {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [fromUserId]);
    const name = rows[0]?.name || 'Jemand';
    sendPushToUser(toUserId, 'Neue Freundschaftsanfrage', `${name} möchte dein Freund sein`, '/friends');
  } catch { /* non-critical */ }
}

async function notifyFriendAccepted(fromUserId, toUserId) {
  try {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [fromUserId]);
    const name = rows[0]?.name || 'Jemand';
    sendPushToUser(toUserId, 'Freundschaft bestätigt', `${name} hat deine Anfrage angenommen`, '/friends');
  } catch { /* non-critical */ }
}