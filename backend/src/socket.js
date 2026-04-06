import jwt from 'jsonwebtoken';

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

    // Join a specific chat room (group)
    socket.on('join_room', (groupId) => {
      socket.join(groupId);
    });

    // Leave a room
    socket.on('leave_room', (groupId) => {
      socket.leave(groupId);
    });

    // Handle new message
    socket.on('send_message', (data) => {
      // Broadcast to all room members (including sender for confirmation)
      io.to(data.group_id || data.groupId).emit('receive_message', data);
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