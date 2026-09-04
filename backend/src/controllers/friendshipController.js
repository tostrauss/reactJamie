import db from '../config/database.js';
import { sendPushToUser } from './pushController.js';
import { pushTexts } from '../utils/pushLocale.js';

// ==========================================
// SEND FRIEND REQUEST
// ==========================================
export const sendFriendRequest = async (req, res) => {
  try {
    const userId = parseInt(req.body.userId, 10);

    if (!userId || isNaN(userId) || userId <= 0) return res.status(400).json({ error: 'Ungültige Nutzer-ID' });
    if (userId === req.userId) return res.status(400).json({ error: 'Du kannst dir selbst keine Freundschaftsanfrage schicken' });

    // Target must exist — otherwise the INSERT trips an addressee_id FK violation
    // and falls through to a generic 500. blockUser already does this check.
    const target = await db.query('SELECT 1 FROM users WHERE id = $1', [userId]);
    if (target.rows.length === 0) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

    // Check if friendship already exists (in either direction)
    const existing = await db.query(
      `SELECT id, status, requester_id FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, userId]
    );

    if (existing.rows.length > 0) {
      const f = existing.rows[0];
      if (f.status === 'blocked') {
        // Don't leak whether the OTHER party blocked us — same generic 403 either way.
        return res.status(403).json({ error: 'Diese Anfrage kann nicht gesendet werden' });
      }
      if (f.status === 'accepted') return res.status(400).json({ error: 'Already friends' });
      if (f.status === 'pending') return res.status(400).json({ error: 'Friend request already pending' });
      // Any other status ('rejected', cron-minted 'expired', future values) →
      // re-request by reusing the row. Falling through to the INSERT instead
      // would collide with uniq_friend_pair (23505) and permanently lock the
      // pair out of friendship, so this branch must catch everything.
      await db.query(
        `UPDATE friendships SET status = 'pending', requester_id = $1, addressee_id = $2,
         updated_at = CURRENT_TIMESTAMP, expires_at = NOW() + INTERVAL '30 days'
         WHERE id = $3`,
        [req.userId, userId, f.id]
      );
      notifyFriendRequest(req.userId, userId).catch(() => {});
      return res.json({ message: 'Friend request sent', status: 'pending' });
    }

    // Create new friend request — expires after 30 days
    try {
      await db.query(
        `INSERT INTO friendships (requester_id, addressee_id, status, expires_at)
         VALUES ($1, $2, 'pending', NOW() + INTERVAL '30 days')`,
        [req.userId, userId]
      );
    } catch (e) {
      // 23505 = the uniq_friend_pair index caught a concurrent reverse-direction
      // request landing at the same instant — treat as already pending.
      if (e.code === '23505') {
        return res.status(400).json({ error: 'Friend request already pending' });
      }
      throw e;
    }

    notifyFriendRequest(req.userId, userId).catch(() => {});
    res.status(201).json({ message: 'Friend request sent' });
  } catch (error) {
    console.error('Error sending friend request:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// RESPOND TO FRIEND REQUEST (accept/reject)
// ==========================================
export const respondFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action } = req.body; // 'accept' | 'reject' | 'undo'

    if (!['accept', 'reject', 'undo'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "accept", "reject" or "undo"' });
    }

    // Undo an accidental reject → back to pending (only a currently-rejected
    // request addressed to me; reject has no side effects so this is clean).
    if (action === 'undo') {
      const restored = await db.query(
        `UPDATE friendships SET status = 'pending', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND addressee_id = $2 AND status = 'rejected' RETURNING id`,
        [requestId, req.userId]
      );
      if (restored.rows.length === 0) {
        return res.status(404).json({ error: 'Friend request not found' });
      }
      return res.json({ message: 'Friend request restored', status: 'pending' });
    }

    // Get request (must be addressed to current user)
    const request = await db.query(
      `SELECT id, requester_id FROM friendships WHERE id = $1 AND addressee_id = $2 AND status = 'pending'`,
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
      notifyFriendAccepted(req.userId, request.rows[0].requester_id).catch(() => {});
    }

    res.json({ message: `Friend request ${newStatus}`, status: newStatus });
  } catch (error) {
    console.error('Error responding to friend request:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET PENDING FRIEND REQUESTS (incoming)
// ==========================================
export const getPendingRequests = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.*, u.name as requester_name, u.avatar_url as requester_avatar,
              u.bio as requester_bio, u.location as requester_location,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS requester_age
       FROM friendships f
       JOIN users u ON f.requester_id = u.id
       WHERE f.addressee_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC LIMIT 100`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching friend requests:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET SENT REQUESTS (outgoing)
// ==========================================
export const getSentRequests = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.*, u.name as addressee_name, u.avatar_url as addressee_avatar,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS addressee_age
       FROM friendships f
       JOIN users u ON f.addressee_id = u.id
       WHERE f.requester_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC LIMIT 100`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sent requests:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
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
         u.name, u.avatar_url, u.bio, u.location, u.last_seen,
         EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS age
       FROM friendships f
       JOIN users u ON u.id = CASE 
         WHEN f.requester_id = $1 THEN f.addressee_id 
         ELSE f.requester_id 
       END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
       ORDER BY u.name ASC LIMIT 500`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
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
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// CHECK FRIENDSHIP STATUS
// ==========================================
export const checkFriendship = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await db.query(
      `SELECT id, status, requester_id FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, userId]
    );

    if (result.rows.length === 0) {
      return res.json({ status: 'none' });
    }

    const f = result.rows[0];
    // For a 'blocked' row the requester_id is always the blocker (see blockUser).
    // We expose only `blocked_by_me` so the UI can show "Blockierung aufheben"
    // but the other side just sees a normal "no relationship" view — they
    // shouldn't know they were blocked.
    if (f.status === 'blocked') {
      if (f.requester_id === req.userId) {
        return res.json({ status: 'blocked', blocked_by_me: true, friendship_id: f.id });
      }
      return res.json({ status: 'none' });
    }
    res.json({
      status: f.status,
      friendship_id: f.id,
      is_requester: f.requester_id === req.userId
    });
  } catch (error) {
    console.error('Error checking friendship:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// BLOCK USER
// ==========================================
// A block is stored in the friendships table as status='blocked'. The row is
// owned by the blocker (requester_id = blocker, addressee_id = blockee) so we
// can tell who initiated it. Any existing row between the two users is replaced
// — blocking unfriends as a side-effect, which is the expected UX.
export const blockUser = async (req, res) => {
  try {
    const targetId = parseInt(req.body.userId, 10);

    if (!targetId || isNaN(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Ungültige Nutzer-ID' });
    }
    if (targetId === req.userId) {
      return res.status(400).json({ error: 'Du kannst dich nicht selbst blockieren' });
    }

    // Make sure the user exists at all
    const exists = await db.query('SELECT 1 FROM users WHERE id = $1', [targetId]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const existing = await db.query(
      `SELECT id, status, requester_id FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, targetId]
    );

    if (existing.rows.length > 0) {
      // Take over the row so requester_id is the blocker — EXCEPT when the
      // other side has already blocked us. Taking over their block let a
      // blocked user "block back", then unblock (which deletes the row), and
      // then send a request + push to the person who blocked them (release
      // audit 2026-09-04). Their block stays theirs; from our side the effect
      // (no contact) is identical, so we still answer 200.
      await db.query(
        `UPDATE friendships
           SET status = 'blocked',
               requester_id = $1,
               addressee_id = $2,
               updated_at = CURRENT_TIMESTAMP,
               expires_at = NULL
         WHERE id = $3
           AND NOT (status = 'blocked' AND requester_id = $2)`,
        [req.userId, targetId, existing.rows[0].id]
      );
    } else {
      await db.query(
        `INSERT INTO friendships (requester_id, addressee_id, status)
         VALUES ($1, $2, 'blocked')`,
        [req.userId, targetId]
      );
    }

    res.json({ message: 'Nutzer blockiert', status: 'blocked' });
  } catch (error) {
    console.error('Error blocking user:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// UNBLOCK USER
// ==========================================
// Only the original blocker can unblock — deletes the row entirely so the two
// users return to the 'none' relationship and can re-add each other.
export const unblockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const targetId = parseInt(userId, 10);

    if (!targetId || isNaN(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Ungültige Nutzer-ID' });
    }

    const result = await db.query(
      `DELETE FROM friendships
       WHERE status = 'blocked'
         AND requester_id = $1
         AND addressee_id = $2`,
      [req.userId, targetId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Blockierung nicht gefunden' });
    }

    res.json({ message: 'Blockierung aufgehoben', status: 'none' });
  } catch (error) {
    console.error('Error unblocking user:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET BLOCKED USERS (for settings screen)
// ==========================================
export const getBlockedUsers = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.id as friendship_id,
              u.id, u.name, u.avatar_url,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS age
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.status = 'blocked' AND f.requester_id = $1
       ORDER BY f.updated_at DESC
       LIMIT 200`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching blocked users:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ── Push helpers (fire-and-forget) ──────────────────────────────────────────
async function notifyFriendRequest(fromUserId, toUserId) {
  try {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [fromUserId]);
    const name = rows[0]?.name || 'Jemand';
    // Deep-link straight to the requester's profile — UserProfile shows the
    // Accept/Reject buttons for an incoming pending request, so the recipient
    // can act on it in one tap. (Was '/friends', which only opened the default
    // "Freunde" tab and never surfaced the request or the sender's profile.)
    sendPushToUser(toUserId, pushTexts('friendRequest', { name }), null, `/user/${fromUserId}`);
  } catch { /* non-critical */ }
}

async function notifyFriendAccepted(fromUserId, toUserId) {
  try {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [fromUserId]);
    const name = rows[0]?.name || 'Jemand';
    // Open the profile of the person who accepted (now a friend) — from there
    // the recipient can message them directly.
    sendPushToUser(toUserId, pushTexts('friendAccepted', { name }), null, `/user/${fromUserId}`);
  } catch { /* non-critical */ }
}