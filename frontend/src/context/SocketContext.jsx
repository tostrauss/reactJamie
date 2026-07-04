import { createContext, useContext, useEffect, useState } from 'react';
import io from 'socket.io-client';
import { AuthContext } from './AuthContext';
import { useToast } from './ToastContext';
import { isNative, NATIVE_API_ORIGIN } from '../utils/platform';

export const SocketContext = createContext();

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user, token } = useContext(AuthContext);
  const toast = useToast();

  useEffect(() => {
    if (user && token) {
      // Web/PWA: frontend and backend are served by the SAME Railway service
      // (one origin), so VITE_SOCKET_URL stays empty and io() connects to the
      // same host (proxied by Vite in dev).
      // Native: the WebView origin is served locally by Capacitor — a same-
      // origin socket connection would hit the local scheme handler (polling
      // transport gets index.html back). Connect to the real API domain
      // instead (same service, second domain — see NATIVE_API_ORIGIN).
      const socketUrl = isNative()
        ? NATIVE_API_ORIGIN
        : (import.meta.env.VITE_SOCKET_URL || undefined);

      const newSocket = io(socketUrl, {
        path: '/socket.io',
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000
      });

      setSocket(newSocket);

      // Only show "reconnected" toast if we actually warned the user about a disconnect.
      // Brief blips recovered within 3s never surface a disconnect, so they must not
      // surface a reconnect either — that's the noise Tina was seeing.
      let disconnectTimer = null;
      let disconnectShown = false;

      newSocket.on('connect', () => {
        setIsConnected(true);
        newSocket.emit('join_user', user.id);
        if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
        if (disconnectShown) {
          toast.success('Verbindung wiederhergestellt');
          disconnectShown = false;
        }
      });

      newSocket.on('disconnect', (reason) => {
        setIsConnected(false);
        if (reason !== 'io client disconnect') {
          if (disconnectTimer) clearTimeout(disconnectTimer);
          disconnectTimer = setTimeout(() => {
            toast.warning('Verbindung unterbrochen – Wiederverbindung...');
            disconnectShown = true;
            disconnectTimer = null;
          }, 3000);
        }
      });

      newSocket.on('connect_error', () => {
        setIsConnected(false);
      });

      newSocket.io.on('reconnect_failed', () => {
        toast.error('Verbindung fehlgeschlagen. Bitte Seite neu laden.');
      });

      return () => {
        if (disconnectTimer) clearTimeout(disconnectTimer);
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
  }, [user?.id, token]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};