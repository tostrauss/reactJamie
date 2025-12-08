import React, { createContext, useContext, useEffect, useState } from 'react';
import io from 'socket.io-client';
import { AuthContext } from './AuthContext';

export const SocketContext = createContext();

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  // FIX 1: Destructure 'token' from context as well
  const { user, token } = useContext(AuthContext);

  useEffect(() => {
    if (user && token) {
      const newSocket = io('http://localhost:5000', {
        // Optional: Pass token in auth object for middleware verification if you add it later
        auth: {
          token: token
        }
      });

      setSocket(newSocket);

      // FIX 2: Send just the ID, not an object, to match backend expectation
      // Backend: socket.on('login', (userId) => socket.join(`user_${userId}`))
      newSocket.emit('login', user.id);

      return () => newSocket.close();
    } else {
      if (socket) {
        socket.close();
        setSocket(null);
      }
    }
  }, [user, token]); // Add token to dependency array

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};