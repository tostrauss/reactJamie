import jwt from 'jsonwebtoken';
import db from './config/database.js';
import { redisClient } from './config/redis.js';

// 10-second in-process membership cache for join_room.
// At 1 000 concurrent users each joining 3-5 group rooms, this prevents
// thousands of identical SELECT 1 queries hitting the DB on every app open.
// Short TTL keeps kicked-member latency low (max ~10s in stale state).
const _memberCache = new Map();
const MEMBER_CACHE_TTL = 10_000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _memberCache) {
    if (now > v.exp) _memberCache.delete(k);
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

const DM_LIMIT = 60;
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
    // any room member can impersonate any other user in real time.
    socket.on('send_message', (data) => {
      if (!data || typeof data !== 'object') return;
      const roomId = String(data.group_id || data.groupId || '');
      if (!roomId || !socket.rooms.has(roomId)) return;
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
    socket.on('join_dm_room', ({ otherUserId }) => {
      const other = parseInt(otherUserId, 10);
      if (!other || other <= 0 || other === socket.userId) return;
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
      const { receiverId, message } = data;

      // Basic input validation — drop malformed events silently
      const receiverIdInt = parseInt(receiverId, 10);
      if (isNaN(receiverIdInt) || receiverIdInt === senderId) return;
      if (typeof message !== 'string' || !message.trim() || message.length > 5000) return;

      if (!await isDmAllowed(senderId)) {
        socket.emit('dm_rate_limited', { error: 'Zu viele Nachrichten. Bitte kurz warten.' });
        return;
      }

      // Friendship gate — prevents socket DM spam to arbitrary user IDs
      try {
        const { rows } = await db.query(
          `SELECT 1 FROM friendships WHERE status = 'accepted'
           AND ((requester_id = $1 AND addressee_id = $2)
             OR (requester_id = $2 AND addressee_id = $1))`,
          [senderId, receiverIdInt]
        );
        if (!rows.length) return; // silently drop — not friends
      } catch { /* non-critical — degrade gracefully */ }

      // Whitelist fields broadcast to the DM room — never spread raw client data.
      // The HTTP /api/dm endpoint runs moderation + persistence; this socket
      // event only fans the live message out for typing-indicator-style UX.
      const safeDm = {
        senderId,
        receiverId: receiverIdInt,
        message: message.slice(0, 5000),
        timestamp: new Date(),
      };
      const roomName = `dm_${Math.min(senderId, receiverIdInt)}_${Math.max(senderId, receiverIdInt)}`;
      io.to(roomName).emit('receive_dm', safeDm);
      io.to(`user_${receiverIdInt}`).emit('new_dm_notification', {
        senderId,
        // Notification preview — truncate so a single payload can't push 5 KB to every receiver's socket
        message: message.slice(0, 200),
        timestamp: safeDm.timestamp,
      });
    });

    socket.on('dm_typing', ({ receiverId }) => {
      const recv = parseInt(receiverId, 10);
      if (!recv || recv <= 0) return;
      const roomName = `dm_${Math.min(socket.userId, recv)}_${Math.max(socket.userId, recv)}`;
      socket.to(roomName).emit('dm_user_typing', { userId: socket.userId });
    });

    socket.on('dm_stop_typing', ({ receiverId }) => {
      const recv = parseInt(receiverId, 10);
      if (!recv || recv <= 0) return;
      const roomName = `dm_${Math.min(socket.userId, recv)}_${Math.max(socket.userId, recv)}`;
      socket.to(roomName).emit('dm_user_stop_typing', { userId: socket.userId });
    });

    socket.on('disconnect', () => {});
  });

  return io;
};

export default socketHandler;