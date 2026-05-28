import jwt from 'jsonwebtoken';
import db from './config/database.js';
import { redisClient } from './config/redis.js';

// 1-minute in-process membership cache for join_room.
// At 1 000 concurrent users each joining 3-5 group rooms, this prevents
// thousands of identical SELECT 1 queries hitting the DB on every app open.
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
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
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

    // Handle new message
    socket.on('send_message', (data) => {
      const roomId = String(data.group_id || data.groupId || '');
      // Only broadcast if this socket has actually joined the room (join_room verifies DB membership)
      if (!roomId || !socket.rooms.has(roomId)) return;
      socket.to(roomId).emit('receive_message', data);
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
      if (!data?.groupId || !socket.rooms.has(String(data.groupId))) return;
      socket.to(String(data.groupId)).emit('user_typing', {
        userId: socket.userId,
        userName: data.userName
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

      const roomName = `dm_${Math.min(senderId, receiverIdInt)}_${Math.max(senderId, receiverIdInt)}`;
      io.to(roomName).emit('receive_dm', { ...data, senderId });
      io.to(`user_${receiverIdInt}`).emit('new_dm_notification', {
        senderId,
        message,
        timestamp: new Date()
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