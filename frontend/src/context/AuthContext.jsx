import React, { createContext, useState, useCallback } from 'react';
import { auth } from '../utils/api';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const response = await auth.login(email, password);
      setUser(response.data.user);
      setToken(response.data.token);
      localStorage.setItem('token', response.data.token);
      return response.data.user;
    } catch (error) {
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (email, password, name) => {
    setLoading(true);
    try {
      const response = await auth.register(email, password, name);
      setUser(response.data.user);
      setToken(response.data.token);
      localStorage.setItem('token', response.data.token);
      return response.data.user;
    } catch (error) {
      throw error;
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
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, loginAsGuest, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
