import React, { createContext, useState, useCallback, useEffect, useRef } from 'react';
import { auth, silentRefreshIfNeeded } from '../utils/api';

export const AuthContext = createContext();

const getCachedUser = () => {
  try { return JSON.parse(localStorage.getItem('jamie_user') || 'null'); } catch { return null; }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(getCachedUser);
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const response = await auth.login(email, password);
      setUser(response.data.user);
      setToken(response.data.token);
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('jamie_user', JSON.stringify(response.data.user));
      return response.data.user;
    } catch (error) {
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (email, password, name, referral_code, date_of_birth) => {
    setLoading(true);
    try {
      const response = await auth.register(email, password, name, referral_code, date_of_birth);
      setUser(response.data.user);
      setToken(response.data.token);
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('jamie_user', JSON.stringify(response.data.user));
      return response.data.user;
    } catch (error) {
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithGoogle = useCallback(async (credential) => {
    setLoading(true);
    try {
      const response = await auth.googleLogin(credential);
      setUser(response.data.user);
      setToken(response.data.token);
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('jamie_user', JSON.stringify(response.data.user));
      return response.data.user;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginAsGuest = useCallback(async () => {
    const guestUser = {
      id: 0,
      name: 'Guest',
      email: 'guest@example.com',
      isGuest: true
    };
    setUser(guestUser);
    setToken('guest_token');
    localStorage.setItem('token', 'guest_token');
    return guestUser;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('jamie_user');
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!token || token === 'guest_token') return null;
    setLoading(true);
    try {
      const response = await auth.getProfile();
      setUser(response.data);
      localStorage.setItem('jamie_user', JSON.stringify(response.data));
      return response.data;
    } catch (error) {
      return null;
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Validate token and refresh profile on mount (non-blocking — user already set from cache)
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current || !token || token === 'guest_token') return;
    didMountRef.current = true;
    silentRefreshIfNeeded(); // Renew JWT before it expires (no-op if > 24h remaining)
    refreshProfile();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        token,
        loading,
        login,
        register,
        loginWithGoogle,
        loginAsGuest,
        logout,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
