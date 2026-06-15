import jwt from 'jsonwebtoken';
import db from './config/database.js';
import { redisClient } from './config/redis.js';

// 10-second in-process membership cache for join_room.
// At 1 000 concurrent users each joining 3-5 group rooms, this prevents
// thousands of identical SELECT 1 queries hitting the DB on every app open.
// Short TTL keeps kicked-member latency low (max ~10s in stale state).
const _memberCache = new Map();
const MEMBER_CACHE_TTL = 10_000;

// Single sweep covers every TTL Map below (all share the 10s TTL semantics).
// _groupCtxCache + _friendCache were previously never swept → unbounded growth.
const _sweepCaches = [_memberCache];
setInterval(() => {
  const now = Date.now();
  for (const cache of _sweepCaches) {
    for (const [k, v] of cache) {
      if (now > v.exp) cache.delete(k);
    }
  }
}, 60_000).unref();

async function checkMembership(groupId, userId) {
  const key = `${groupId}:${userId}`;
  const cached = _memberCache.get(key);
  if (cached !== undefined && Date.now() < cached.exp) return cached.result;
  const { rows } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
    [groupId, userId]
  );
  const result = rows.length > 0;
  _memberCache.set(key, { result, exp: Date.now() + MEMBER_CACHE_TTL });
  return result;
}

// Mirrors the HTTP /api/messages chat_only_owner rule (messageController.js:40-45)
// so a non-owner can't bypass the restriction by emitting send_message directly.
const _groupCtxCache = new Map();
_sweepCaches.push(_groupCtxCache);
async function canChatInGroup(groupId, userId) {
  const key = `ctx:${groupId}:${userId}`;
  const cached = _groupCtxCache.get(key);
  if (cached !== undefined && Date.now() < cached.exp) return cached.result;
  let result = false;
  try {
    const { rows } = await db.query(
      `SELECT g.type, g.owner_id, g.chat_only_owner, gm.user_id AS member_user_id
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
       WHERE g.id = $1`,
      [groupId, userId]
    );
    if (rows.length) {
      const { type, owner_id, chat_only_owner, member_user_id } = rows[0];
      const isMember = member_user_id != null;
      const ownerOnlyBlocks = type === 'club' && chat_only_owner && owner_id !== userId;
      result = isMember && !ownerOnlyBlocks;
    }
  } catch {
    result = false; // fail closed on DB error
  }
  _groupCtxCache.set(key, { result, exp: Date.now() + MEMBER_CACHE_TTL });
  return result;
}

// Used by DM socket events to gate room-join + typing on friendship.
// Without this, any authenticated user can join_dm_room with a guessed
// userId and eavesdrop on real-time DMs.
// Cached like _memberCache (10s TTL): dm_typing/dm_stop_typing/send_dm all
// gate on this, so two people actively chatting otherwise fire one identical
// friendship SELECT per keystroke. 10s stale window on unfriend/block matches
// the accepted staleness of the membership cache.
const _friendCache = new Map();
_sweepCaches.push(_friendCache);
async function areFriends(a, b) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  const cached = _friendCache.get(key);
  if (cached !== undefined && Date.now() < cached.exp) return cached.result;
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM friendships WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2)
         OR (requester_id = $2 AND addressee_id = $1)) LIMIT 1`,
      [a, b]
    );
    const result = rows.length > 0;
    _friendCache.set(key, { result, exp: Date.now() + MEMBER_CACHE_TTL });
    return result;
  } catch {
    return false; // fail closed (not cached — retry next event)
  }
}

// Keep in sync with the HTTP dmSendLimiter (dmRoutes.js, 10/min) — a looser
// socket cap let the real-time path bypass the anti-spam limit.
const DM_LIMIT = 10;
const DM_WINDOW_MS = 60_000;

// In-memory fallback (single-instance only) — used when Redis is absent
const dmCounters = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of dmCounters) {
    if (now > entry.resetAt) dmCounters.delete(userId);
  }
}, 5 * 60_000).unref();

// Redis-backed when available (works across multiple instances), Map fallback otherwise
const isDmAllowed = async (userId) => {
  if (redisClient) {
    try {
      const key = `dm:rl:${userId}`;
      const count = await redisClient.incr(key);
      if (count === 1) await redisClient.pexpire(key, DM_WINDOW_MS);
      return count <= DM_LIMIT;
    } catch {
      // Redis error — degrade gracefully to in-memory
    }
  }
  const now = Date.now();
  const entry = dmCounters.get(userId);
  if (!entry || now > entry.resetAt) {
    dmCounters.set(userId, { count: 1, resetAt: now + DM_WINDOW_MS });
    return true;
  }
  if (entry.count >= DM_LIMIT) return false;
  entry.count++;
  return true;
};

const socketHandler = (io) => {
  // Verify JWT on every connection attempt
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    // Guest token only allowed when explicitly enabled
    if (token === 'guest_token') {
      if (process.env.ALLOW_GUEST_TOKEN === 'true') {
        socket.userId = 0;
        socket.isGuest = true;
        return next();
      }
      return next(new Error('Guest access is disabled'));
    }
    try {
      // Verifier options must match middleware/auth.js exactly — otherwise
      // a token valid for HTTP could be rejected on the socket or vice
      // versa. Pinning iss/aud blocks cross-service token replay.
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'jamie-api',
        audience: 'jamie-app',
      });
      socket.userId = decoded.id;
      socket.isGuest = false;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    // Auto-join the authenticated user's personal notification room
    if (socket.userId) {
      socket.join(`user_${socket.userId}`);
    }

    // join_user is kept for compatibility but enforces the authenticated userId
    socket.on('join_user', () => {
      if (socket.userId) socket.join(`user_${socket.userId}`);
    });

    // Join a specific chat room — verify membership (cached for 1 min)
    socket.on('join_room', async (groupId) => {
      if (!groupId) return;
      try {
        if (await checkMembership(groupId, socket.userId)) {
          socket.join(groupId);
        }
      } catch {
        // Non-critical — don't crash the socket on a DB error
      }
    });

    // Leave a room
    socket.on('leave_room', (groupId) => {
      socket.leave(groupId);
    });

    // Handle new message. The HTTP /api/messages endpoint is the source of
    // truth for persistence + moderation; this socket event only fans the
    // already-persisted message out to other room members. We pick a fixed
    // shape so a malicious client cannot inject arbitrary fields, and we
    // override identity fields from the authenticated socket — without this,
    // any room member can impersonate any other user in real time. We also
    // re-check chat_only_owner here so a non-owner can't bypass the HTTP gate
    // by emitting on the socket directly (the message would be a "ghost"
    // visible to other members until refresh).
    socket.on('send_message', async (data) => {
      if (!data || typeof data !== 'object') return;
      const roomId = String(data.group_id || data.groupId || '');
      if (!roomId || !socket.rooms.has(roomId)) return;
      const groupIdInt = parseInt(roomId, 10);
      if (!groupIdInt || !(await canChatInGroup(groupIdInt, socket.userId))) return;
      // Whitelist fields — everything else from the client is dropped
      const safeMessage = {
        id:         data.id,
        group_id:   data.group_id ?? data.groupId,
        content:    typeof data.content === 'string' ? data.content.slice(0, 5000) : '',
        created_at: data.created_at,
        // user_id is authoritative — cannot be spoofed
        user_id:    socket.userId,
        user_name:  typeof data.user_name === 'string' ? data.user_name.slice(0, 100) : undefined,
        avatar_url: typeof data.avatar_url === 'string' ? data.avatar_url.slice(0, 1024) : undefined,
      };
      socket.to(roomId).emit('receive_message', safeMessage);
      // Note: the per-member `group_message_notification` nudge (nav badge,
      // chat-list rows) is deliberately NOT sent from here — it fires from
      // the HTTP POST /api/messages persist path (messageController), so it
      // only ever announces messages that passed moderation + rate limiting.
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
      if (!data?.groupId || !socket.rooms.has(String(data.groupId))) return;
      socket.to(String(data.groupId)).emit('user_typing', {
        userId: socket.userId,
        userName: typeof data.userName === 'string' ? data.userName.slice(0, 100) : undefined,
      });
    });

    socket.on('stop_typing', (data) => {
      if (!data?.groupId || !socket.rooms.has(String(data.groupId))) return;
      socket.to(String(data.groupId)).emit('user_stop_typing', {
        userId: socket.userId
      });
    });

    // Direct Message Handlers
    // ─────────────────────────────────────────────────────────────────────
    // SECURITY: DM room names are deterministic (`dm_${min(a,b)}_${max(a,b)}`)
    // so any authenticated user can guess another user's room id. Without
    // a friendship check at join time, an attacker could join_dm_room with
    // arbitrary userIds and silently receive every receive_dm broadcast.
    // Same applies to typing — without the gate, a stranger can impersonate
    // typing indicators inside a victim's DM thread.
    socket.on('join_dm_room', async ({ otherUserId }) => {
      const other = parseInt(otherUserId, 10);
      if (!other || other <= 0 || other === socket.userId) return;
      if (!(await areFriends(socket.userId, other))) return;
      const roomName = `dm_${Math.min(socket.userId, other)}_${Math.max(socket.userId, other)}`;
      socket.join(roomName);
    });

    socket.on('leave_dm_room', ({ otherUserId }) => {
      const other = parseInt(otherUserId, 10);
      if (!other || other <= 0) return;
      const roomName = `dm_${Math.min(socket.userId, other)}_${Math.max(socket.userId, other)}`;
      socket.leave(roomName);
    });

    socket.on('send_dm', async (data) => {
      // Always use authenticated userId as senderId — never trust client-provided value
      const senderId = socket.userId;
      if (!data || typeof data !== 'object') return;
      const receiverIdInt = parseInt(data.receiverId, 10);
      if (isNaN(receiverIdInt) || receiverIdInt <= 0 || receiverIdInt === senderId) return;

      // The frontend sends `message` as the full DB row (object) returned by
      // POST /api/dm. Legacy clients may still pass a raw string. Normalize
      // both into a canonical message object — never trust client identity.
      let normalized;
      if (typeof data.message === 'string') {
        const content = data.message.trim();
        if (!content || content.length > 5000) return;
        normalized = {
          id: null,
          sender_id: senderId,
          receiver_id: receiverIdInt,
          content: content.slice(0, 5000),
          created_at: new Date().toISOString(),
        };
      } else if (data.message && typeof data.message === 'object') {
        const content = typeof data.message.content === 'string' ? data.message.content.trim() : '';
        if (!content || content.length > 5000) return;
        normalized = {
          id: Number.isInteger(data.message.id) ? data.message.id : null,
          sender_id: senderId, // authoritative override
          receiver_id: receiverIdInt,
          content: content.slice(0, 5000),
          created_at: typeof data.message.created_at === 'string'
            ? data.message.created_at
            : new Date().toISOString(),
          sender_name: typeof data.message.sender_name === 'string'
            ? data.message.sender_name.slice(0, 100) : undefined,
          sender_avatar: typeof data.message.sender_avatar === 'string'
            ? data.message.sender_avatar.slice(0, 1024) : undefined,
        };
      } else {
        return;
      }

      if (!await isDmAllowed(senderId)) {
        socket.emit('dm_rate_limited', { error: 'Zu viele Nachrichten. Bitte kurz warten.' });
        return;
      }

      // Friendship gate — prevents socket DM spam to arbitrary user IDs
      if (!(await areFriends(senderId, receiverIdInt))) return;

      // Broadcast shape matches what frontend handleReceiveDM expects:
      // `data.message` is the full message object, appended directly to messagesList.
      const roomName = `dm_${Math.min(senderId, receiverIdInt)}_${Math.max(senderId, receiverIdInt)}`;
      io.to(roomName).emit('receive_dm', {
        senderId,
        receiverId: receiverIdInt,
        message: normalized,
        timestamp: normalized.created_at,
      });
      io.to(`user_${receiverIdInt}`).emit('new_dm_notification', {
        senderId,
        // Notification preview — truncate so a single payload can't push 5 KB to every receiver's socket
        message: normalized.content.slice(0, 200),
        timestamp: normalized.created_at,
      });
    });

    socket.on('dm_typing', async ({ receiverId }) => {
      const recv = parseInt(receiverId, 10);
      if (!recv || recv <= 0 || recv === socket.userId) return;
      if (!(await areFriends(socket.userId, recv))) return;
      const roomName = `dm_${Math.min(socket.userId, recv)}_${Math.max(socket.userId, recv)}`;
      socket.to(roomName).emit('dm_user_typing', { userId: socket.userId });
    });

    socket.on('dm_stop_typing', async ({ receiverId }) => {
      const recv = parseInt(receiverId, 10);
      if (!recv || recv <= 0 || recv === socket.userId) return;
      if (!(await areFriends(socket.userId, recv))) return;
      const roomName = `dm_${Math.min(socket.userId, recv)}_${Math.max(socket.userId, recv)}`;
      socket.to(roomName).emit('dm_user_stop_typing', { userId: socket.userId });
    });

    socket.on('disconnect', () => {});
  });

  return io;
};

export default socketHandler;