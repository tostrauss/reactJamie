import db from '../config/database.js';
import { checkTextSafety } from '../config/moderation.js';
import { isSafeVoiceUrl, isSafeImageUrl } from '../utils/safeUrl.js';
// One reply shape for group chat and DMs alike — see messageController.
import { withReply } from './messageController.js';
import { sendPushToUser } from './pushController.js';
import { pushTexts } from '../utils/pushLocale.js';

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

// Who may exchange DMs: accepted friends, OR any pair where at least one side is
// an admin. Admins can message any user without a friend request (support /
// moderation / outreach — Robert 2026-07-19), and the recipient can see + reply
// to that thread, so both send + read gates use this single rule.
async function dmAllowed(userA, userB) {
  const { rows } = await db.query(
    `SELECT
       EXISTS(SELECT 1 FROM friendships
              WHERE status = 'accepted'
                AND ((requester_id = $1::int AND addressee_id = $2::int)
                  OR (requester_id = $2::int AND addressee_id = $1::int))) AS friends,
       EXISTS(SELECT 1 FROM users
              WHERE id IN ($1::int, $2::int) AND is_admin = TRUE)          AS admin_party`,
    [userA, userB]
  );
  return rows[0].friends || rows[0].admin_party;
}

// ==========================================
// SEND DIRECT MESSAGE
// Per-PAIR push cooldown, mirroring messageController's per-member one — same
// 30 s window, same replica-local best-effort (worst case one extra banner per
// replica), same sweep so the map cannot grow unbounded.
const DM_PUSH_COOLDOWN_MS = 30_000;
const _dmPushCooldown = new Map(); // `${receiverId}:${senderId}` → last push ms
setInterval(() => {
  const cutoff = Date.now() - DM_PUSH_COOLDOWN_MS;
  for (const [k, t] of _dmPushCooldown) if (t < cutoff) _dmPushCooldown.delete(k);
}, 60_000).unref();

/** True when this pair was pushed within the window; stamps it otherwise. */
export const onDmCooldown = (receiverId, senderId, now = Date.now()) => {
  const key = `${receiverId}:${senderId}`;
  const last = _dmPushCooldown.get(key);
  if (last && now - last < DM_PUSH_COOLDOWN_MS) return true;
  _dmPushCooldown.set(key, now);
  return false;
};

// ==========================================
export const sendDM = async (req, res) => {
  try {
    const receiverId = parseInt(req.body.receiverId, 10);
    const { content, message_type, reply_to_id, duration_ms } = req.body;

    if (isNaN(receiverId) || receiverId <= 0) {
      return res.status(400).json({ error: 'Ungültiger Empfänger' });
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Empfänger und Inhalt erforderlich' });
    }

    // Mirrors sendMessage — see the reasoning there.
    const isVoice = message_type === 'voice';
    const isImage = message_type === 'image';
    if (message_type != null && message_type !== 'text' && !isVoice && !isImage) {
      return res.status(400).json({ error: 'Ungültiger Nachrichtentyp' });
    }

    if (isVoice) {
      if (!isSafeVoiceUrl(content.trim())) {
        return res.status(400).json({ error: 'Ungültige Sprachnachricht' });
      }
    } else if (isImage) {
      // Same boundary as a voice URL: `content` is fed straight to an <img>,
      // so it must be a URL our own upload route minted. That route is also
      // where Sightengine runs — the real difference between photos and voice
      // notes here is that a photo IS moderated before it can ever be sent.
      if (!isSafeImageUrl(content.trim())) {
        return res.status(400).json({ error: 'Ungültiges Bild' });
      }
    } else {
      if (content.length > 5000) {
        return res.status(400).json({ error: 'Nachricht darf maximal 5.000 Zeichen lang sein' });
      }
      const { safe, reason } = await checkTextSafety(content);
      if (!safe) {
        return res.status(422).json({ error: reason });
      }
    }

    // Accepted friends may DM each other; admins may DM anyone (and be replied
    // to). A 'blocked' row is not 'accepted' so DMs stay refused between normal
    // users, and we hand back the same generic error so a blocker isn't outed.
    if (!(await dmAllowed(req.userId, receiverId))) {
      return res.status(403).json({
        error: 'Ihr müsst befreundet sein, um Direktnachrichten zu senden',
        requiresFriendship: true
      });
    }

    // Persist the message AND both conversation trackers in ONE transaction.
    // Previously the message INSERT auto-committed on its own and the trackers
    // ran in a separate transaction — if the tracker step failed (pool timeout,
    // deadlock) the message was durably stored but the receiver's conversation
    // list never surfaced it (no last_message_id) and the sender saw a 500 and
    // retried → duplicate. One transaction makes it all-or-nothing.
    // Self-heal wrapper: on a fresh DB the tables may be missing — create them
    // and retry once.
    // Quote target, scoped to THIS conversation in both directions — a client
    // must not be able to quote a DM from a different thread and have the
    // snippet rendered to the other person.
    let replyToId = null;
    if (reply_to_id != null) {
      const rid = parseInt(reply_to_id, 10);
      if (Number.isInteger(rid) && rid > 0) {
        const tgt = await db.query(
          `SELECT 1 FROM direct_messages
            WHERE id = $1
              AND ((sender_id = $2 AND receiver_id = $3) OR (sender_id = $3 AND receiver_id = $2))`,
          [rid, req.userId, receiverId]
        );
        if (tgt.rowCount > 0) replyToId = rid;
      }
    }

    const rawDuration = parseInt(duration_ms, 10);
    const durationMs = isVoice && Number.isFinite(rawDuration)
      ? Math.min(Math.max(rawDuration, 0), 120_000)
      : null;

    let insertResult;
    for (let attempt = 0; attempt < 2; attempt++) {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        insertResult = await client.query(
          `INSERT INTO direct_messages (sender_id, receiver_id, content, message_type, reply_to_id, duration_ms)
           VALUES ($1::int, $2::int, $3, $4::varchar, $5::int, $6::int) RETURNING *`,
          [req.userId, receiverId, content, isVoice ? 'voice' : isImage ? 'image' : 'text', replyToId, durationMs]
        );
        const msgId = insertResult.rows[0].id;
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
        break; // success
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (isMissingRelationError(err) && attempt === 0) {
          console.warn('[dm] dm tables missing on send, creating on demand');
          await ensureDmTables();
          continue; // retry once on the now-created tables
        }
        throw err;
      } finally {
        client.release();
      }
    }

    // Authoritative live delivery + notification, server-side. This REPLACES the
    // old client→socket `send_dm` re-broadcast, which ran no moderation and
    // trusted client identity. The persisted row is already moderated (checkText
    // Safety above); we attach the sender's name/avatar (server truth) so the
    // receiver's bubble renders correctly, then emit to the shared DM room and
    // the receiver's personal room. The receiver's client filters its own
    // senderId, and the sender rendered optimistically, so a room-wide emit is
    // safe. Fire-and-forget: DB is the source of truth if a socket is down.
    (async () => {
      try {
        const s = await db.query('SELECT name, avatar_url FROM users WHERE id = $1', [req.userId]);
        const senderName = s.rows[0]?.name || 'Jemand';
        const senderAvatar = s.rows[0]?.avatar_url || null;
        const msgRow = insertResult.rows[0];

        // The quoted message for the live payload. Only when this message
        // actually is a reply — one extra indexed lookup on a rare path,
        // inside the fire-and-forget block, so it costs the sender nothing.
        // The 201 response body carries the same quote (added below).
        let replyQuote = {};
        if (msgRow.reply_to_id) {
          const q = await db.query(
            `SELECT q.id, q.content, q.message_type, u.name
               FROM direct_messages q LEFT JOIN users u ON u.id = q.sender_id
              WHERE q.id = $1`,
            [msgRow.reply_to_id]
          ).catch(() => ({ rows: [] }));
          if (q.rows[0]) {
            replyQuote = {
              reply_id: q.rows[0].id,
              reply_content: q.rows[0].content,
              reply_message_type: q.rows[0].message_type,
              reply_user_name: q.rows[0].name,
            };
          }
        }

        const io = req.app.get('io');
        if (io) {
          const roomName = `dm_${Math.min(req.userId, receiverId)}_${Math.max(req.userId, receiverId)}`;
          io.to(roomName).emit('receive_dm', {
            senderId: req.userId,
            receiverId,
            message: withReply({ ...msgRow, sender_name: senderName, sender_avatar: senderAvatar, ...replyQuote }),
            timestamp: msgRow.created_at,
          });
          io.to(`user_${receiverId}`).emit('new_dm_notification', {
            senderId: req.userId,
            // The TYPE travels, not a label — the recipient's client knows
            // their locale, this server does not. `message` stays empty for a
            // voice note rather than leaking the storage URL.
            message_type: isVoice ? 'voice' : isImage ? 'image' : 'text',
            message: (isVoice || isImage) ? '' : (msgRow.content || '').slice(0, 200),
            timestamp: msgRow.created_at,
          });
        }
        // Push for the closed/backgrounded receiver — WITH the text, like the
        // group-chat push (same 120-char cut, messageController). Until
        // 2026-09-06 only the socket payload above carried a preview; the push
        // said "X hat dir eine Nachricht geschickt" (Stefan: "warum gibts keine
        // vorschau?"). Content is already moderated (checkTextSafety above).
        // ── Don't push a message the receiver is already reading ────────
        // The group-chat path has done this since it was written (see
        // computePushRecipients in messageController): skip anyone with a live
        // socket IN the room, plus a 30 s per-recipient cooldown. The DM path
        // had NEITHER, so a normal back-and-forth in an open thread produced
        // one banner with vibration per message — 30 messages, 30 banners, for
        // text already on screen. Users read that as the app being broken and
        // turn notifications off entirely, which also kills the event
        // reminders the 06.09. release was for. Audit 2026-09-15, finding 15.
        //
        // Reuses the room name computed above, and the same `socket.data.userId`
        // mirroring the group path relies on. Best-effort: on any error we fall
        // through and push, exactly like the group path does.
        let receiverIsReading = false;
        try {
          if (io) {
            const roomName = `dm_${Math.min(req.userId, receiverId)}_${Math.max(req.userId, receiverId)}`;
            const sockets = await io.in(roomName).fetchSockets();
            receiverIsReading = sockets.some(
              (sock) => Number(sock.data?.userId ?? sock.userId) === Number(receiverId)
            );
          }
        } catch { /* fall through and push */ }

        if (!receiverIsReading && !onDmCooldown(receiverId, req.userId)) {
          sendPushToUser(
            receiverId,
            pushTexts('newDm', {
              name: senderName,
              isVoice,
              isImage,
              preview: (isVoice || isImage) ? null : (msgRow.content || '').slice(0, 120),
            }),
            null,
            `/dm/${req.userId}`
          );
        }
      } catch { /* non-critical */ }
    })();

    // The sender needs the quote too — they render their own bubble from this
    // response, not from the socket echo (which deliberately excludes them).
    let created = withReply(insertResult.rows[0]);
    if (created.reply_to_id && !created.reply_to) {
      const q = await db.query(
        `SELECT q.id, q.content, q.message_type, u.name
           FROM direct_messages q LEFT JOIN users u ON u.id = q.sender_id
          WHERE q.id = $1`,
        [created.reply_to_id]
      ).catch(() => ({ rows: [] }));
      if (q.rows[0]) {
        created = withReply({
          ...insertResult.rows[0],
          reply_id: q.rows[0].id,
          reply_content: q.rows[0].content,
          reply_message_type: q.rows[0].message_type,
          reply_user_name: q.rows[0].name,
        });
      }
    }
    res.status(201).json(created);
  } catch (error) {
    console.error('Error sending DM:', error);
    res.status(500).json({
      error: 'Nachricht konnte nicht gesendet werden',
    });
  }
};

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
    // Cursor pagination (preferred): ?before=<oldest loaded message id>.
    // OFFSET drifts in an active thread — every message that arrives between
    // page loads shifts the window, so "load earlier" repeated or skipped
    // rows. The offset form stays supported for older app bundles.
    const before = parseInt(req.query.before, 10);
    const hasBefore = Number.isFinite(before) && before > 0;

    // Gate history access: accepted friends, or any thread involving an admin
    // (so the admin can open it AND the recipient can read/reply). Same rule as
    // the send gate.
    if (!(await dmAllowed(req.userId, userId))) {
      return res.status(403).json({
        error: 'Ihr müsst befreundet sein, um diese Konversation anzusehen',
        requiresFriendship: true
      });
    }

    const querySql = `
      SELECT dm.id, dm.sender_id, dm.receiver_id, dm.content, dm.message_type,
             dm.is_read, dm.is_deleted_sender, dm.is_deleted_receiver, dm.created_at,
             dm.duration_ms, dm.reply_to_id,
             s.name as sender_name, s.avatar_url as sender_avatar,
             r.name as receiver_name, r.avatar_url as receiver_avatar,
             q.id AS reply_id, q.content AS reply_content,
             q.message_type AS reply_message_type, qu.name AS reply_user_name
      FROM direct_messages dm
      LEFT JOIN users s ON dm.sender_id = s.id
      LEFT JOIN users r ON dm.receiver_id = r.id
      LEFT JOIN direct_messages q ON q.id = dm.reply_to_id
      LEFT JOIN users qu ON qu.id = q.sender_id
      WHERE LEAST(dm.sender_id, dm.receiver_id)    = LEAST($1::int, $2::int)
        AND GREATEST(dm.sender_id, dm.receiver_id) = GREATEST($1::int, $2::int)
        ${hasBefore ? 'AND dm.id < $4' : ''}
      ORDER BY dm.created_at DESC
      LIMIT $3 ${hasBefore ? '' : 'OFFSET $4'}
    `;
    // NOTE: fetch the NEWEST page (DESC + LIMIT) then reverse to chronological
    // before responding — the old ASC LIMIT returned the 50 OLDEST messages,
    // so any thread past 50 messages never showed recent ones after reload.
    // Mirrors the group-chat getMessages pattern. The .reverse() is applied
    // to result.rows just before res.json below.
    let result;
    try {
      result = await db.query(querySql, [req.userId, userId, limit, hasBefore ? before : offset]);
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
    res.json(result.rows.reverse().map(withReply));
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
             dm.content as last_message_text, dm.created_at as last_message_at,
             -- A voice message stores a URL in content; the chat list renders
             -- a label off this instead of showing the storage path.
             dm.message_type as last_message_type
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
    const doUpdate = () => db.query(
      `UPDATE dm_conversations SET is_archived = $1 WHERE user_id = $2::int AND other_user_id = $3::int`,
      [archived, req.userId, otherUserId]
    );
    await doUpdate().catch(async (err) => {
      if (isMissingRelationError(err)) {
        // Heal AND RETRY — the old code healed but returned {archived:true}
        // without writing, silently dropping the user's first tap.
        await ensureDmTables();
        return doUpdate();
      }
      throw err;
    });
    res.json({ archived });
  } catch (error) {
    console.error('Error archiving conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};