import db from '../config/database.js';
import { checkTextSafety } from '../config/moderation.js';
import { sendPushToUser } from './pushController.js';

// Self-heal: production databases bootstrapped without the seed schema.sql
// don't have the direct_messages / dm_conversations tables. If a query throws
// Postgres error 42P01 ("relation does not exist"), create the tables inline
// and let the caller retry. Idempotent — safe to run on every cold cache.
const ensureDmTables = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id                  SERIAL PRIMARY KEY,
      sender_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content             TEXT NOT NULL,
      message_type        VARCHAR(20) DEFAULT 'text',
      is_read             BOOLEAN DEFAULT FALSE,
      is_deleted_sender   BOOLEAN DEFAULT FALSE,
      is_deleted_receiver BOOLEAN DEFAULT FALSE,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_conversation ON direct_messages(LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_unread ON direct_messages(receiver_id, is_read) WHERE is_read = FALSE`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS dm_conversations (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      other_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_message_id INTEGER REFERENCES direct_messages(id) ON DELETE SET NULL,
      last_message_at TIMESTAMP,
      unread_count    INTEGER DEFAULT 0,
      is_archived     BOOLEAN DEFAULT FALSE,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, other_user_id)
    )
  `);
};

const isMissingRelationError = (err) => err?.code === '42P01';

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
    // Self-heal wrapper: on first send against a fresh DB the tables may be
    // missing — create them on demand and retry once.
    let insertResult;
    let attempts = 0;
    while (attempts < 2) {
      try {
        insertResult = await db.query(
          'INSERT INTO direct_messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
          [req.userId, receiverId, content]
        );
        break;
      } catch (err) {
        if (isMissingRelationError(err) && attempts === 0) {
          console.warn('[dm] direct_messages missing on send, creating on demand');
          await ensureDmTables();
          attempts += 1;
          continue;
        }
        throw err;
      }
    }

    // Update or create conversation trackers atomically
    const msgId = insertResult.rows[0].id;
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

    res.status(201).json(insertResult.rows[0]);
  } catch (error) {
    console.error('Error sending DM:', error);
    res.status(500).json({
      error: 'Nachricht konnte nicht gesendet werden',
      detail: error.message,
      code: error.code,
    });
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

    const querySql = `
      SELECT dm.id, dm.sender_id, dm.receiver_id, dm.content, dm.message_type,
             dm.is_read, dm.is_deleted_sender, dm.is_deleted_receiver, dm.created_at,
             s.name as sender_name, s.avatar_url as sender_avatar,
             r.name as receiver_name, r.avatar_url as receiver_avatar
      FROM direct_messages dm
      LEFT JOIN users s ON dm.sender_id = s.id
      LEFT JOIN users r ON dm.receiver_id = r.id
      WHERE LEAST(dm.sender_id, dm.receiver_id)    = LEAST($1, $2)
        AND GREATEST(dm.sender_id, dm.receiver_id) = GREATEST($1, $2)
      ORDER BY dm.created_at ASC
      LIMIT $3 OFFSET $4
    `;
    let result;
    try {
      result = await db.query(querySql, [req.userId, userId, limit, offset]);
    } catch (err) {
      // Fresh DB without seed schema → table missing. Create it inline and
      // return an empty conversation so the user can start chatting.
      if (isMissingRelationError(err)) {
        console.warn('[dm] direct_messages table missing, creating on demand');
        await ensureDmTables();
        return res.json([]);
      }
      throw err;
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({
      error: 'Konversation konnte nicht geladen werden',
      detail: error.message,
      code: error.code,
    });
  }
};

// ==========================================
// GET ALL CONVERSATIONS LIST
// ==========================================
export const getConversations = async (req, res) => {
  try {
    const sql = `
      SELECT dc.*, u.name as other_user_name, u.avatar_url as other_user_avatar,
             dm.content as last_message_text, dm.created_at as last_message_at
      FROM dm_conversations dc
      JOIN users u ON dc.other_user_id = u.id
      LEFT JOIN direct_messages dm ON dc.last_message_id = dm.id
      WHERE dc.user_id = $1
      ORDER BY dc.updated_at DESC
      LIMIT 100
    `;
    let result;
    try {
      result = await db.query(sql, [req.userId]);
    } catch (err) {
      if (isMissingRelationError(err)) {
        console.warn('[dm] tables missing on list, creating on demand');
        await ensureDmTables();
        return res.json([]);
      }
      throw err;
    }
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      error: 'Konversationen konnten nicht geladen werden',
      detail: error.message,
      code: error.code,
    });
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

    try {
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
    } catch (err) {
      if (isMissingRelationError(err)) {
        await ensureDmTables();
        // Nothing to mark read on a freshly-created table — just return OK.
        return res.json({ success: true });
      }
      throw err;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking DM read:', error);
    res.status(500).json({ error: 'Internal server error', detail: error.message, code: error.code });
  }
};