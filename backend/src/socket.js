import jwt from 'jsonwebtoken';
import db from './config/database.js';

// Per-user DM rate limit: max 60 messages per minute
const dmCounters = new Map(); // userId → { count, resetAt }
const DM_LIMIT = 60;
const DM_WINDOW_MS = 60_000;

const isDmAllowed = (userId) => {
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

    // Join a specific chat room — verify the user is actually a member
    socket.on('join_room', async (groupId) => {
      if (!groupId) return;
      try {
        const { rows } = await db.query(
          'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
          [groupId, socket.userId]
        );
        if (rows.length > 0) {
          socket.join(groupId);
        }
        // Silently ignore unauthorized join attempts
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
      // Broadcast to all room members except the sender (sender adds it optimistically)
      socket.to(data.group_id || data.groupId).emit('receive_message', data);
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
      socket.to(data.groupId).emit('user_typing', {
        userId: socket.userId,
        userName: data.userName
      });
    });

    socket.on('stop_typing', (data) => {
      socket.to(data.groupId).emit('user_stop_typing', {
        userId: socket.userId
      });
    });

    // Direct Message Handlers
    socket.on('join_dm_room', ({ otherUserId }) => {
      // Use authenticated userId, not client-provided one
      const roomName = `dm_${Math.min(socket.userId, otherUserId)}_${Math.max(socket.userId, otherUserId)}`;
      socket.join(roomName);
    });

    socket.on('leave_dm_room', ({ otherUserId }) => {
      const roomName = `dm_${Math.min(socket.userId, otherUserId)}_${Math.max(socket.userId, otherUserId)}`;
      socket.leave(roomName);
    });

    socket.on('send_dm', (data) => {
      // Always use authenticated userId as senderId — never trust client-provided value
      const senderId = socket.userId;
      const { receiverId, message } = data;

      if (!isDmAllowed(senderId)) {
        socket.emit('dm_rate_limited', { error: 'Zu viele Nachrichten. Bitte kurz warten.' });
        return;
      }

      const roomName = `dm_${Math.min(senderId, receiverId)}_${Math.max(senderId, receiverId)}`;
      io.to(roomName).emit('receive_dm', { ...data, senderId });
      io.to(`user_${receiverId}`).emit('new_dm_notification', {
        senderId,
        message,
        timestamp: new Date()
      });
    });

    socket.on('dm_typing', ({ receiverId }) => {
      const roomName = `dm_${Math.min(socket.userId, receiverId)}_${Math.max(socket.userId, receiverId)}`;
      socket.to(roomName).emit('dm_user_typing', { userId: socket.userId });
    });

    socket.on('dm_stop_typing', ({ receiverId }) => {
      const roomName = `dm_${Math.min(socket.userId, receiverId)}_${Math.max(socket.userId, receiverId)}`;
      socket.to(roomName).emit('dm_user_stop_typing', { userId: socket.userId });
    });

    socket.on('disconnect', () => {});
  });

  return io;
};

export default socketHandler;