import db from '../config/database.js';
import { checkTextSafety } from '../config/moderation.js';
import { sendPushToUser } from './pushController.js';

// ==========================================
// SEND DIRECT MESSAGE
// ==========================================
export const sendDM = async (req, res) => {
  try {
    const receiverId = parseInt(req.body.receiverId, 10);
    const { content } = req.body;

    if (isNaN(receiverId) || receiverId <= 0) {
      return res.status(400).json({ error: 'Ungültiger Empfänger' });
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Empfänger und Inhalt erforderlich' });
    }

    if (content.length > 5000) {
      return res.status(400).json({ error: 'Nachricht darf maximal 5.000 Zeichen lang sein' });
    }

    const { safe, reason } = await checkTextSafety(content);
    if (!safe) {
      return res.status(422).json({ error: reason });
    }

    // Verify friendship exists and is accepted. A 'blocked' row hides under the
    // same status check — it isn't 'accepted' so DMs are refused in both
    // directions, but we hand back the same generic friendship error so a
    // blocker isn't outed by a different message text.
    const friendship = await db.query(
      `SELECT status FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, receiverId]
    );

    const status = friendship.rows[0]?.status;
    if (status !== 'accepted') {
      return res.status(403).json({
        error: 'Ihr müsst befreundet sein, um Direktnachrichten zu senden',
        requiresFriendship: true
      });
    }

    // Insert message
    const result = await db.query(
      'INSERT INTO direct_messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
      [req.userId, receiverId, content]
    );

    // Update or create conversation trackers atomically
    const msgId = result.rows[0].id;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO dm_conversations (user_id, other_user_id, last_message_id, unread_count)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (user_id, other_user_id)
         DO UPDATE SET last_message_id = $3, updated_at = CURRENT_TIMESTAMP`,
        [req.userId, receiverId, msgId]
      );
      await client.query(
        `INSERT INTO dm_conversations (user_id, other_user_id, last_message_id, unread_count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (user_id, other_user_id)
         DO UPDATE SET last_message_id = $3, unread_count = dm_conversations.unread_count + 1, updated_at = CURRENT_TIMESTAMP`,
        [receiverId, req.userId, msgId]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Notify receiver (fire-and-forget)
    notifyDMReceived(req.userId, receiverId).catch(() => {});

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error sending DM:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

async function notifyDMReceived(fromUserId, toUserId) {
  try {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [fromUserId]);
    const name = rows[0]?.name || 'Jemand';
    sendPushToUser(toUserId, 'Neue Nachricht', `${name} hat dir eine Nachricht geschickt`, '/messages');
  } catch { /* non-critical */ }
}

// ==========================================
// GET CONVERSATION WITH USER
// ==========================================
export const getConversation = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Ungültige Nutzer-ID' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    // Verify friendship before allowing message history access
    const friendship = await db.query(
      `SELECT id FROM friendships
       WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2)
            OR (requester_id = $2 AND addressee_id = $1))`,
      [req.userId, userId]
    );
    if (friendship.rows.length === 0) {
      return res.status(403).json({
        error: 'Ihr müsst befreundet sein, um diese Konversation anzusehen',
        requiresFriendship: true
      });
    }

    const result = await db.query(
      `SELECT dm.id, dm.sender_id, dm.receiver_id, dm.content, dm.message_type,
              dm.is_read, dm.is_deleted_sender, dm.is_deleted_receiver, dm.created_at,
              s.name as sender_name, s.avatar_url as sender_avatar,
              r.name as receiver_name, r.avatar_url as receiver_avatar
       FROM direct_messages dm
       LEFT JOIN users s ON dm.sender_id = s.id
       LEFT JOIN users r ON dm.receiver_id = r.id
       WHERE LEAST(dm.sender_id, dm.receiver_id)    = LEAST($1, $2)
         AND GREATEST(dm.sender_id, dm.receiver_id) = GREATEST($1, $2)
       ORDER BY dm.created_at ASC
       LIMIT $3 OFFSET $4`,
      [req.userId, userId, limit, offset]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// GET ALL CONVERSATIONS LIST
// ==========================================
export const getConversations = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT dc.*, u.name as other_user_name, u.avatar_url as other_user_avatar,
              dm.content as last_message_text, dm.created_at as last_message_at
       FROM dm_conversations dc
       JOIN users u ON dc.other_user_id = u.id
       LEFT JOIN direct_messages dm ON dc.last_message_id = dm.id
       WHERE dc.user_id = $1
       ORDER BY dc.updated_at DESC
       LIMIT 100`,
      [req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// MARK CONVERSATION AS READ
// ==========================================
export const markDMRead = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Ungültige Nutzer-ID' });
    }

    await Promise.all([
      db.query(
        `UPDATE dm_conversations SET unread_count = 0 WHERE user_id = $1 AND other_user_id = $2`,
        [req.userId, userId]
      ),
      db.query(
        `UPDATE direct_messages SET is_read = TRUE
         WHERE sender_id = $1 AND receiver_id = $2 AND is_read = FALSE`,
        [userId, req.userId]
      ),
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking DM read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};