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

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  return io;
};

export default socketHandler;