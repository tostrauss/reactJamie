import { Server } from 'socket.io';

export const initializeSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: "http://localhost:3000",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

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
      // data should contain: groupId, content, user_id, user_name, created_at
      io.to(data.groupId).emit('receive_message', data);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected', socket.id);
    });
  });

  return io;
};