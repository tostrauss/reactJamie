import { Server } from 'socket.io';

const socketHandler = (io) => {
  io.on('connection', (socket) => {
    console.log(`🔌 User connected: ${socket.id}`);

    // Join user's personal room (for notifications)
    socket.on('join_user', (userId) => {
      socket.join(`user_${userId}`);
      console.log(`User ${socket.id} joined personal room user_${userId}`);
    });

    // Join a specific chat room (group)
    socket.on('join_room', (groupId) => {
      socket.join(groupId);
      console.log(`User ${socket.id} joined room ${groupId}`);
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
        userId: data.userId,
        userName: data.userName
      });
    });

    socket.on('stop_typing', (data) => {
      socket.to(data.groupId).emit('user_stop_typing', {
        userId: data.userId
      });
    });

    // Direct Message Handlers
    socket.on('join_dm_room', ({ userId, otherUserId }) => {
      // Create consistent room name (sorted user IDs)
      const roomName = `dm_${Math.min(userId, otherUserId)}_${Math.max(userId, otherUserId)}`;
      socket.join(roomName);
      console.log(`User ${socket.id} joined DM room ${roomName}`);
    });

    socket.on('leave_dm_room', ({ userId, otherUserId }) => {
      const roomName = `dm_${Math.min(userId, otherUserId)}_${Math.max(userId, otherUserId)}`;
      socket.leave(roomName);
    });

    socket.on('send_dm', (data) => {
      const { senderId, receiverId, message } = data;
      const roomName = `dm_${Math.min(senderId, receiverId)}_${Math.max(senderId, receiverId)}`;

      // Broadcast to DM room (both users)
      io.to(roomName).emit('receive_dm', data);

      // Also emit to receiver's personal room for notifications
      io.to(`user_${receiverId}`).emit('new_dm_notification', {
        senderId,
        message,
        timestamp: new Date()
      });
    });

    socket.on('dm_typing', ({ senderId, receiverId }) => {
      const roomName = `dm_${Math.min(senderId, receiverId)}_${Math.max(senderId, receiverId)}`;
      socket.to(roomName).emit('dm_user_typing', { userId: senderId });
    });

    socket.on('dm_stop_typing', ({ senderId, receiverId }) => {
      const roomName = `dm_${Math.min(senderId, receiverId)}_${Math.max(senderId, receiverId)}`;
      socket.to(roomName).emit('dm_user_stop_typing', { userId: senderId });
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  return io;
};

export default socketHandler;