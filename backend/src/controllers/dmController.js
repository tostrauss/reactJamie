import db from '../config/database.js';
import { checkTextSafety } from '../config/moderation.js';
import { sendPushToUser } from './pushController.js';

// Self-heal: production databases bootstrapped without the seed schema.sql may
// be missing the direct_messages / dm_conversations tables OR have them with an
// older column set. We catch both Postgres 42P01 (missing relation) and 42703
// (missing column), then CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN
// IF NOT EXISTS for every column the queries reference. Idempotent and cheap
// — safe to run on every cold cache.
const ensureDmTables = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id                  SERIAL PRIMARY KEY,
      sender_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content             TEXT NOT NULL,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Add optional/newer columns one-by-one so a pre-existing table with an
  // older shape gets brought up to spec without dropping data.
  await db.query(`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS message_type        VARCHAR(20) DEFAULT 'text'`);
  await db.query(`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS is_read             BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS is_deleted_sender   BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS is_deleted_receiver BOOLEAN DEFAULT FALSE`);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_conversation ON direct_messages(LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_unread ON direct_messages(receiver_id, is_read) WHERE is_read = FALSE`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS dm_conversations (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      other_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS last_message_id INTEGER REFERENCES direct_messages(id) ON DELETE SET NULL`);
  await db.query(`ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP`);
  await db.query(`ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS unread_count    INTEGER DEFAULT 0`);
  await db.query(`ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS is_archived     BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
  // The UNIQUE constraint is needed for the ON CONFLICT upsert in sendDM —
  // add it via DO block so a pre-existing table without it gets the index.
  await db.query(`DO $$ BEGIN
    ALTER TABLE dm_conversations ADD CONSTRAINT dm_conv_user_pair_uniq UNIQUE (user_id, other_user_id);
  EXCEPTION WHEN duplicate_table THEN NULL;
            WHEN duplicate_object THEN NULL;
            WHEN unique_violation THEN NULL;
  END $$`);
};

// Match both "relation does not exist" (42P01) and "column does not exist" (42703)
// — the second case means the table was already there but with an older shape.
const isSchemaError = (err) => err?.code === '42P01' || err?.code === '42703';
// Backwards-compatible alias used by older call sites (keep both spellings).
const isMissingRelationError = isSchemaError;

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
       WHERE (requester_id = $1::int AND addressee_id = $2::int)
          OR (requester_id = $2::int AND addressee_id = $1::int)`,
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
          'INSERT INTO direct_messages (sender_id, receiver_id, content) VALUES ($1::int, $2::int, $3) RETURNING *',
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
         VALUES ($1::int, $2::int, $3::int, 0)
         ON CONFLICT (user_id, other_user_id)
         DO UPDATE SET last_message_id = $3::int, updated_at = CURRENT_TIMESTAMP`,
        [req.userId, receiverId, msgId]
      );
      await client.query(
        `INSERT INTO dm_conversations (user_id, other_user_id, last_message_id, unread_count)
         VALUES ($1::int, $2::int, $3::int, 1)
         ON CONFLICT (user_id, other_user_id)
         DO UPDATE SET last_message_id = $3::int, unread_count = dm_conversations.unread_count + 1, updated_at = CURRENT_TIMESTAMP`,
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

    // Verify friendship before allowing message history access. Casting both
    // params to int defensively because req.userId from JWT may come back as a
    // string depending on how the token was signed — then LEAST/GREATEST in
    // the next query trips on `integer = text` (PG error 42883).
    const friendship = await db.query(
      `SELECT id FROM friendships
       WHERE status = 'accepted'
       AND ((requester_id = $1::int AND addressee_id = $2::int)
            OR (requester_id = $2::int AND addressee_id = $1::int))`,
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
      WHERE LEAST(dm.sender_id, dm.receiver_id)    = LEAST($1::int, $2::int)
        AND GREATEST(dm.sender_id, dm.receiver_id) = GREATEST($1::int, $2::int)
      ORDER BY dm.created_at DESC
      LIMIT $3 OFFSET $4
    `;
    // NOTE: fetch the NEWEST page (DESC + LIMIT) then reverse to chronological
    // before responding — the old ASC LIMIT returned the 50 OLDEST messages,
    // so any thread past 50 messages never showed recent ones after reload.
    // Mirrors the group-chat getMessages pattern. The .reverse() is applied
    // to result.rows just before res.json below.
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

    // Reverse to chronological (oldest→newest) for the client; the query
    // fetched the newest page in DESC order.
    res.json(result.rows.reverse());
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({
      error: 'Konversation konnte nicht geladen werden',
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
      WHERE dc.user_id = $1::int
      -- Order by the actual last MESSAGE time, not dc.updated_at. A trigger
      -- (trg_dm_conversations_updated) bumps updated_at on ANY update, so just
      -- opening a chat (markDMRead → UPDATE unread_count) used to shoot it to
      -- the top. last_message_id only changes on send/receive, so dm.created_at
      -- reflects exactly "last sent or received".
      ORDER BY COALESCE(dm.created_at, dc.updated_at) DESC
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
          `UPDATE dm_conversations SET unread_count = 0 WHERE user_id = $1::int AND other_user_id = $2::int`,
          [req.userId, userId]
        ),
        db.query(
          `UPDATE direct_messages SET is_read = TRUE
           WHERE sender_id = $1::int AND receiver_id = $2::int AND is_read = FALSE`,
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
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// ARCHIVE / UNARCHIVE A DM CONVERSATION (per-user "hide")
// ==========================================
export const setConversationArchived = async (req, res) => {
  try {
    const otherUserId = parseInt(req.params.userId, 10);
    if (isNaN(otherUserId) || otherUserId <= 0) {
      return res.status(400).json({ error: 'Ungültige Nutzer-ID' });
    }
    const archived = req.body.archived === true || req.body.archived === 'true';
    // No conversation row yet (no message ever sent) → nothing to hide; the
    // chat wouldn't appear in the list anyway, so treat as a no-op success.
    await db.query(
      `UPDATE dm_conversations SET is_archived = $1 WHERE user_id = $2::int AND other_user_id = $3::int`,
      [archived, req.userId, otherUserId]
    ).catch(async (err) => {
      if (isMissingRelationError(err)) { await ensureDmTables(); return; }
      throw err;
    });
    res.json({ archived });
  } catch (error) {
    console.error('Error archiving conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};