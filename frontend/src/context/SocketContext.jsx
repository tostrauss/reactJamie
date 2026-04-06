import { createContext, useContext, useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import { AuthContext } from './AuthContext';
import { useToast } from './ToastContext';

export const SocketContext = createContext();

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user, token } = useContext(AuthContext);
  const toast = useToast();
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    if (user && token) {
      // In production the frontend and backend are on different domains,
      // so VITE_SOCKET_URL must point to the backend (e.g. https://your-backend.railway.app).
      // In dev it's left empty so io() connects to the same host (proxied by Vite).
      const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;

      const newSocket = io(socketUrl, {
        path: '/socket.io',
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000
      });

      setSocket(newSocket);

      newSocket.on('connect', () => {
        setIsConnected(true);
        newSocket.emit('join_user', user.id);
        if (wasConnectedRef.current) {
          toast.success('Verbindung wiederhergestellt');
        }
        wasConnectedRef.current = true;
      });

      newSocket.on('disconnect', (reason) => {
        setIsConnected(false);
        if (reason !== 'io client disconnect') {
          toast.warning('Verbindung unterbrochen – Wiederverbindung...');
        }
      });

      newSocket.on('connect_error', () => {
        setIsConnected(false);
      });

      newSocket.io.on('reconnect_failed', () => {
        toast.error('Verbindung fehlgeschlagen. Bitte Seite neu laden.');
      });

      return () => {
        wasConnectedRef.current = false;
        setIsConnected(false);
        newSocket.close();
      };
    } else {
      if (socket) {
        socket.close();
        setSocket(null);
        setIsConnected(false);
      }
    }
  }, [user, token]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};