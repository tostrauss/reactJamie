import db from '../config/database.js';
import { checkTextSafety } from '../config/moderation.js';
import { isSafeVoiceUrl, isSafeImageUrl } from '../utils/safeUrl.js';
import { deleteCached } from '../utils/cache.js';
import { sendPushToUsers } from './pushController.js';
import { pushTexts } from '../utils/pushLocale.js';

// Stamp the caller's read marker for a group chat and drop their cached
// joined-groups list (it embeds unread_count, TTL 15s — without the
// invalidation the nav badge could show stale counts right after reading).
const stampChatRead = (groupId, userId) =>
  db.query(
    'UPDATE group_members SET last_read_at = NOW() WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  ).then(() => deleteCached(`user_groups:${userId}`));

// ── Push discipline for the chat hot path (audit 2026-09-02, risk #8) ──────
// A rapid conversation must produce ONE banner per member, not sixty, and a
// member who has the chat OPEN (live socket in the room, already receiving
// `receive_message`) must get none. Cooldown state is per-process — replica-
// local best-effort, which is fine: each HTTP send lands on one replica and
// stamps its own map; worst case across replicas is an extra banner.
const PUSH_COOLDOWN_MS = 30_000;
const _pushCooldown = new Map(); // `${userId}:${groupId}` → last-push epoch ms
setInterval(() => {
  const cutoff = Date.now() - PUSH_COOLDOWN_MS;
  for (const [k, t] of _pushCooldown) if (t < cutoff) _pushCooldown.delete(k);
}, 60_000).unref();

// Pure + exported for unit tests: decide who gets a push and stamp the
// cooldown for exactly those members.
export const computePushRecipients = (memberRows, activeUserIds, cooldownMap, groupId, now = Date.now()) => {
  const recipients = [];
  for (const r of memberRows) {
    if (r.notifications_muted) continue;
    if (activeUserIds.has(Number(r.user_id))) continue; // reading it live right now
    const key = `${r.user_id}:${groupId}`;
    const last = cooldownMap.get(key);
    if (last != null && now - last < PUSH_COOLDOWN_MS) continue;
    cooldownMap.set(key, now);
    recipients.push(r.user_id);
  }
  return recipients;
};

// The quoted message, reshaped from the flat reply_* columns the queries
// select into one nested object the client can render directly. Kept in one
// place so sendMessage, getMessages and the socket payload cannot disagree
// about the shape.
//
// The snippet is CLIPPED here rather than in the UI: a quote is a one-line
// reference, and shipping 5000 characters of it to every client that loads the
// chat — once per reply — is real bytes for something nobody reads.
export const withReply = (row) => {
  if (!row) return row;
  const { reply_id, reply_content, reply_message_type, reply_user_name, ...rest } = row;
  return {
    ...rest,
    reply_to: reply_id
      ? {
          id: reply_id,
          // A voice quote shows a label, not a URL — the client renders
          // "🎤 Sprachnachricht" from the type.
          // voice AND image store a URL, not prose — the client labels both off
      // the type rather than quoting a storage path.
      content: (reply_message_type === 'voice' || reply_message_type === 'image')
        ? null
        : String(reply_content || '').slice(0, 160),
          message_type: reply_message_type || 'text',
          user_name: reply_user_name || null,
        }
      : null,
  };
};

// ==========================================
// SEND MESSAGE
// ==========================================
export const sendMessage = async (req, res) => {
  try {
    const { groupId, content, message_type, reply_to_id, duration_ms } = req.body;

    // A voice message carries a URL in `content` instead of typed text
    // (2026-09-15). The type is authoritative for how the row is read back, so
    // it is validated here rather than trusted — otherwise a client could mark
    // arbitrary text as 'voice' and the player would try to fetch it.
    const isVoice = message_type === 'voice';
    const isImage = message_type === 'image';
    if (message_type != null && message_type !== 'text' && !isVoice && !isImage) {
      return res.status(400).json({ error: 'Ungültiger Nachrichtentyp' });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    if (isVoice) {
      // Must be a URL our own upload route just minted — see isSafeVoiceUrl.
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
      // Recorded speech cannot be text-moderated; voice relies on the reactive
      // report path instead (see routes/uploadRoutes.js). Running the text
      // moderator over a URL would only ever cost a round trip.
      const { safe, reason } = await checkTextSafety(content);
      if (!safe) {
        return res.status(422).json({ error: reason });
      }
    }

    // Single query: membership check + group info in one JOIN.
    // group_members has a composite PK (group_id, user_id) — no `id` column —
    // so we use gm.user_id as the existence marker.
    const ctx = await db.query(
      `SELECT g.type, g.name AS group_name, g.owner_id, g.chat_only_owner, gm.user_id AS member_user_id
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
       WHERE g.id = $1`,
      [groupId, req.userId]
    );
    if (ctx.rows.length === 0) {
      return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    }
    const { type, group_name, owner_id, chat_only_owner, member_user_id } = ctx.rows[0];
    if (member_user_id == null) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }
    if (type === 'club' && chat_only_owner && Number(owner_id) !== Number(req.userId)) {
      return res.status(403).json({
        error: 'Nur der Club-Gründer kann Nachrichten senden',
        isOwnerOnly: true
      });
    }

    // Quote-reply target. Validated to live in THIS group: without the check a
    // client could quote a message out of a private group it is not in, and the
    // quoted snippet returned below would leak that content to everyone here.
    let replyToId = null;
    if (reply_to_id != null) {
      const rid = parseInt(reply_to_id, 10);
      if (Number.isInteger(rid) && rid > 0) {
        const tgt = await db.query(
          'SELECT 1 FROM messages WHERE id = $1 AND group_id = $2 AND is_deleted = FALSE',
          [rid, groupId]
        );
        // A quote of something that is gone is dropped, not an error: the
        // message the user typed should still send.
        if (tgt.rowCount > 0) replyToId = rid;
      }
    }

    const rawDuration = parseInt(duration_ms, 10);
    const durationMs = isVoice && Number.isFinite(rawDuration)
      ? Math.min(Math.max(rawDuration, 0), 120_000)
      : null;

    // INSERT + fetch sender info + the quoted message in one CTE — still a
    // single round trip, and the client needs the quote to render the bubble
    // immediately rather than after a second fetch.
    const result = await db.query(
      `WITH inserted AS (
         INSERT INTO messages (group_id, user_id, content, message_type, reply_to_id, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
       )
       SELECT i.*, u.name AS user_name, u.avatar_url,
              r.id AS reply_id, r.content AS reply_content,
              r.message_type AS reply_message_type, ru.name AS reply_user_name
       FROM inserted i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN messages r ON r.id = i.reply_to_id
       LEFT JOIN users ru ON ru.id = r.user_id`,
      [groupId, req.userId, content, isVoice ? 'voice' : isImage ? 'image' : 'text', replyToId, durationMs]
    );

    // Respond FIRST: everything below is delivery-side bookkeeping (emits,
    // presence lookup, push) whose result never feeds the response body. The
    // presence check in particular is a cross-replica adapter round trip under
    // Redis (up to its 5s request timeout) — the sender must not wait on it
    // (review 2026-09-02; this is the app's hottest write path).
    const created = withReply(result.rows[0]);
    res.status(201).json(created);

    // Nudge every member's personal `user_<id>` room (DM pattern) so nav
    // badges + chat-list rows update for members who do NOT have this chat
    // open — `receive_message` is room-scoped and never reaches them.
    // Deliberately HERE and not in the socket send_message handler: this
    // runs only for messages that passed moderation + rate limit and are
    // actually persisted, and it works even if the sender's socket is down.
    // One batched emit (array of rooms) = one adapter publish.
    try {
      const memberRows = await db.query(
        'SELECT user_id, notifications_muted FROM group_members WHERE group_id = $1 AND user_id <> $2',
        [groupId, req.userId]
      );

      // In-app nudge for connected clients (nav badges + chat-list rows).
      const io = req.app.get('io');
      if (io) {
        // Authoritative live delivery: broadcast the already-moderated, persisted
        // row to everyone in the open chat EXCEPT the sender (who rendered it
        // optimistically and reconciles via the 201). This REPLACES the old
        // client→socket `send_message` re-broadcast, which ran no moderation and
        // trusted client-supplied identity — a member could emit unmoderated,
        // name-spoofed text live to the room. Here content is server-moderated
        // and user_id/name/avatar come from the DB row, so neither is forgeable.
        // `.except(user_<id>)` drops all the sender's own sockets (every client
        // joins its personal room on connect).
        io.to(String(groupId)).except(`user_${req.userId}`).emit('receive_message', created);

        const rooms = memberRows.rows.map(r => `user_${r.user_id}`);
        if (rooms.length) {
          io.to(rooms).emit('group_message_notification', {
            group_id: created.group_id,
            group_type: type,
            user_name: created.user_name,
            // The TYPE travels, not a label: the recipient's client knows their
            // locale, this server does not (one emit, many recipients).
            message_type: isVoice ? 'voice' : isImage ? 'image' : 'text',
            // A voice/image message stores a URL — the client renders a label
            // off the type instead.
            content: (isVoice || isImage) ? '' : content.slice(0, 200),
          });
        }
      }

      // Web push for members with the app closed/backgrounded — the socket emit
      // above only reaches connected clients. This was the long-standing gap:
      // group/club chat messages sent no push, so members learned of them only
      // on next open. Fire-and-forget (no await); the DB unread count is the
      // source of truth if a push fails.
      //
      // Uses the BULK variant deliberately: every member gets the identical
      // title/body, so one `WHERE user_id = ANY(...)` fetches all subscriptions
      // instead of one SELECT per member. This is the hottest path in the app
      // (60 msg/min/user) — the per-user loop meant a 50-member club chat fired
      // 50 extra round trips per message and could saturate the pg pool.
      const senderName = created.user_name || 'Jemand';
      const preview = isImage ? null : content.slice(0, 120);
      // Skip members who muted this group's notifications via the chat-header
      // bell — the in-app nudge above still updates their unread badge, but no
      // push is sent (Tina 2026-07-31). Additionally suppress members with a
      // live socket IN THIS ROOM (they just received `receive_message`) and
      // apply the per-member 30s cooldown. fetchSockets() is cluster-correct
      // under the Redis adapter; remote sockets expose only socket.data, so
      // the handshake mirrors userId into data (socket.js).
      let activeInRoom = new Set();
      if (io) {
        try {
          const roomSockets = await io.in(String(groupId)).fetchSockets();
          activeInRoom = new Set(
            roomSockets.map(s => Number(s.data?.userId ?? s.userId)).filter(Boolean)
          );
        } catch { /* best-effort — fall back to pushing everyone non-muted */ }
      }
      const pushRecipients = computePushRecipients(
        memberRows.rows, activeInRoom, _pushCooldown, groupId
      );
      if (pushRecipients.length) {
        sendPushToUsers(
          pushRecipients,
          // isVoice + sender, not a pre-joined line: the voice label has to be
          // chosen per RECIPIENT locale, which only the builder knows.
          pushTexts('groupMessage', {
            groupName: group_name,
            sender: senderName,
            isVoice,
            isImage,
            line: (isVoice || isImage) ? null : `${senderName}: ${preview}`,
          }),
          null,
          `/chat/${groupId}`
        );
      }
    } catch {
      // Best-effort: unread truth lives in the DB, the next refetch catches up
    }
  } catch (error) {
    console.error('Error sending message:', error);
    // Only if the response hasn't been sent — post-201 failures are best-effort
    // delivery bookkeeping and must not attempt a second write.
    if (!res.headersSent) {
      res.status(500).json({ error: 'Nachricht konnte nicht gesendet werden' });
    }
  }
};

// ==========================================
// GET MESSAGES (for a group) — cursor-based pagination
// ?limit=50          — max messages to return (default 50, max 100)
// ?before=<id>       — return messages with id < this value (for "load earlier")
// Returns messages in chronological order (ASC); use `has_more` to know if older messages exist.
// ==========================================
export const getMessages = async (req, res) => {
  try {
    const { groupId } = req.params;

    // Verify the requesting user is a member of this group before returning messages.
    // Without this check any authenticated user can read messages from private groups.
    const memberCheck = await db.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
      [groupId, req.userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const before = req.query.before ? parseInt(req.query.before, 10) : null;

    const params = [groupId, limit + 1]; // fetch one extra to detect has_more
    // is_deleted is a SOFT delete (deleteMessage, 2026-09-15): the row is kept
    // as moderation evidence — a report's whole point is the content, and the
    // enforcement action is usually what destroys it — but it must never be
    // served back into the chat.
    let whereClause = 'WHERE m.group_id = $1 AND m.is_deleted = FALSE';
    // Members see the FULL history including messages from before they joined
    // ("Pre-Join Chat history muss es geben!" — Tobi 2026-08-04, reversing his
    // own 2026-07-06 hide-pre-join call after Mia's feedback). Membership is
    // still required (403 above), so private-group history never leaks to
    // outsiders. The unread badge keeps its COALESCE(last_read_at, joined_at)
    // baseline in getJoined — old history is readable but never counts as new.
    if (before) {
      params.push(before);
      whereClause += ` AND m.id < $${params.length}`;
    }

    const result = await db.query(
      `SELECT m.id, m.group_id, m.user_id, m.content, m.message_type, m.created_at,
              m.duration_ms, m.reply_to_id,
              u.name AS user_name, u.avatar_url,
              -- The quoted message, joined in rather than fetched per bubble.
              -- Two LEFT JOINs on an indexed FK for the whole page beats N+1
              -- round trips on the app's hottest read.
              r.id AS reply_id, r.content AS reply_content,
              r.message_type AS reply_message_type, ru.name AS reply_user_name
       FROM messages m
       LEFT JOIN users u ON m.user_id = u.id
       LEFT JOIN messages r ON r.id = m.reply_to_id AND r.is_deleted = FALSE
       LEFT JOIN users ru ON ru.id = r.user_id
       ${whereClause}
       ORDER BY m.created_at DESC
       LIMIT $2`,
      params
    );

    const rows = result.rows.map(withReply);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop(); // remove the extra sentinel row

    // Opening the chat reads it — fire-and-forget so the response isn't
    // delayed. ("Load earlier" pagination re-stamps too; harmless.)
    stampChatRead(groupId, req.userId).catch(() => {});

    // Return in chronological order so the UI renders oldest→newest
    res.json({ messages: rows.reverse(), has_more: hasMore });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Nachrichten konnten nicht geladen werden' });
  }
};

// ==========================================
// MARK CHAT READ
// ==========================================
// Called by ChatPage on unmount so messages that arrived WHILE the chat was
// open (after getMessages already stamped) don't linger as phantom unreads.
// The UPDATE's WHERE doubles as the membership check — 0 rows = not a member.
export const markChatRead = async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    if (!groupId) return res.status(400).json({ error: 'Ungültige Gruppen-ID' });
    await stampChatRead(groupId, req.userId);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error marking chat read:', error);
    res.status(500).json({ error: 'Chat konnte nicht als gelesen markiert werden' });
  }
};

// ==========================================
// DELETE MESSAGE
// ==========================================
export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    // Fetch message + group owner + whether the caller is a platform admin in
    // one query, so all three permissions are checked together.
    const result = await db.query(
      `SELECT m.user_id AS author_id, m.group_id, g.owner_id AS group_owner_id,
              (SELECT is_admin FROM users WHERE id = $2) AS caller_is_admin
       FROM messages m
       JOIN groups g ON g.id = m.group_id
       WHERE m.id = $1 AND m.is_deleted = FALSE`,
      [messageId, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const { author_id, group_owner_id, group_id, caller_is_admin } = result.rows[0];
    const isAuthor      = Number(author_id)      === Number(req.userId);
    const isGroupOwner  = Number(group_owner_id) === Number(req.userId);

    // Platform admins may remove any message (audit 2026-09-15, finding 11).
    // Until now the moderation queue could label a report but not act on it:
    // the ONLY enforcement lever in the product was hard-deleting the author's
    // entire account — irreversible, cascading, and it did not even remove the
    // message. An admin reading a reported message had no way to take it down.
    if (!isAuthor && !isGroupOwner && !caller_is_admin) {
      return res.status(403).json({ error: 'Keine Berechtigung, diese Nachricht zu löschen' });
    }

    // SOFT delete. A hard DELETE destroyed the evidence behind any report
    // filed against this message — including the report the admin is acting
    // on right now. The row stays, blanked, and getMessages filters it out;
    // utils/reportContext.js surfaces it to admins with `deleted: true`, which
    // is what makes that flag (and the admin card's "wurde inzwischen
    // gelöscht" line) mean something instead of being dead code.
    await db.query(
      `UPDATE messages SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1`,
      [messageId]
    );

    // Tell the room so the message disappears for everyone who has the chat
    // open, instead of lingering until their next reload.
    try {
      req.app?.get('io')?.to(String(group_id)).emit('message_deleted', {
        id: Number(messageId), groupId: Number(group_id),
      });
    } catch { /* delivery is best-effort; the DB write is what counts */ }

    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Nachricht konnte nicht gelöscht werden' });
  }
};