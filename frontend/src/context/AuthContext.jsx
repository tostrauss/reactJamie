import { createContext, useState, useCallback, useEffect, useRef } from 'react';
import { auth, restoreSession, setMemToken, clearMemToken, clearApiCache, subscription as subscriptionApi } from '../utils/api';
// safeStorage, not raw localStorage: in storage-denied WebViews even reading
// window.localStorage throws, and the unguarded setItem below broke LOGIN
// for those users (Sentry JAMIE-REACT-J). Auth truth is the httpOnly cookie;
// this cache is only a paint-speed nicety and may silently not persist.
import { safeStorage } from '../utils/safeStorage';
import { unsubscribeFromPush } from '../utils/pushNotifications';

export const AuthContext = createContext();

// User display data (name, avatar, etc.) is safe to cache locally — not a secret
const getCachedUser = () => {
  try { return JSON.parse(safeStorage.getItem('jamie_user') || 'null'); } catch { return null; }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(getCachedUser);
  // Token lives in memory only — never written to localStorage
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  // Pro flag — fetched once after authenticated session restore. Anything
  // that needs to gate features (#1 member preview, future paywalls) reads
  // this directly from AuthContext rather than firing its own getStatus call.
  const [isPro, setIsPro] = useState(false);

  const refreshProStatus = useCallback(async () => {
    try {
      const { data } = await subscriptionApi.getStatus();
      setIsPro(!!data?.is_pro);
    } catch {
      setIsPro(false);
    }
  }, []);

  const storeAuth = (userData, tok) => {
    setUser(userData);
    setToken(tok);
    setMemToken(tok); // sync to axios interceptor + Socket.IO
    safeStorage.setItem('jamie_user', JSON.stringify(userData));
    // Fresh login → drop any previous account's cached /api responses so a
    // shared device can't serve them to this user.
    clearApiCache();
  };

  const clearAuth = () => {
    setUser(null);
    setToken(null);
    clearMemToken();
    safeStorage.removeItem('jamie_user');
    // Logout → purge cached /api responses so the next account can't read them.
    clearApiCache();
  };

  const login = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const { data } = await auth.login(email, password);
      storeAuth(data.user, data.token);
      return data.user;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (email, password, name, referral_code, date_of_birth) => {
    setLoading(true);
    try {
      const { data } = await auth.register(email, password, name, referral_code, date_of_birth);
      storeAuth(data.user, data.token);
      return data.user;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithGoogle = useCallback(async (credential) => {
    setLoading(true);
    try {
      const { data } = await auth.googleLogin(credential);
      storeAuth(data.user, data.token);
      return data.user;
    } finally {
      setLoading(false);
    }
  }, []);

  // Auth-code redirect flow — see GoogleCallback.jsx.
  const loginWithGoogleCode = useCallback(async (code, redirectUri) => {
    setLoading(true);
    try {
      const { data } = await auth.googleLoginCode(code, redirectUri);
      storeAuth(data.user, data.token);
      return data.user;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithApple = useCallback(async (identityToken, appleUser) => {
    setLoading(true);
    try {
      const { data } = await auth.appleLogin(identityToken, appleUser || undefined);
      storeAuth(data.user, data.token);
      return data.user;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginAsGuest = useCallback(() => {
    const guestUser = { id: 0, name: 'Guest', email: 'guest@example.com', isGuest: true };
    setUser(guestUser);
    setToken('guest_token');
    setMemToken('guest_token');
    return guestUser;
  }, []);

  const logout = useCallback(async () => {
    // Deregister this device's push subscription BEFORE clearing auth — the
    // API call needs the in-memory token, and a logged-out device must stop
    // receiving this account's DMs (shared-device leak, audit 2026-08-10).
    // Hard 800ms cap so logout stays effectively instant even offline (the
    // old fully-awaited network call meant up to 10s of looking logged-in).
    try {
      await Promise.race([
        unsubscribeFromPush(),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
    } catch { /* best-effort */ }
    clearAuth();
    auth.logout?.().catch(() => {});
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!token || token === 'guest_token') return null;
    // NOTE: do NOT toggle the global `loading` flag here. `loading` is read by
    // ProtectedRoute to decide whether to show <PageLoader />; if we set it
    // true during a background refresh, the protected page unmounts mid-render,
    // the new mount fires its own refreshProfile() useEffect, and we get a
    // screen-flicker loop. Background refreshes should be invisible.
    try {
      const { data } = await auth.getProfile();
      setUser(data);
      safeStorage.setItem('jamie_user', JSON.stringify(data));
      return data;
    } catch {
      return null;
    }
  }, [token]);

  // On mount: restore session from httpOnly cookie (no localStorage token needed)
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    const cached = getCachedUser();
    if (!cached) return; // no prior session → nothing to restore

    restoreSession().then(({ token: tok, unauthorized }) => {
      if (tok) {
        setToken(tok);
        setMemToken(tok);
        // Refresh profile data in background (non-blocking)
        auth.getProfile()
          .then(({ data }) => {
            setUser(data);
            safeStorage.setItem('jamie_user', JSON.stringify(data));
          })
          .catch(() => {});
        // Same for Pro flag — silent best-effort.
        refreshProStatus();
      } else if (unauthorized) {
        // Cookie genuinely expired/invalid → clear the stale cached session.
        clearAuth();
      }
      // else: network failure (offline launch) → keep the cached user so the
      // app opens to its last state instead of bouncing to /login; the httpOnly
      // cookie re-authenticates every request once connectivity returns.
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Whenever we log in fresh, fetch Pro status.
  useEffect(() => {
    if (user && token && token !== 'guest_token') refreshProStatus();
    else setIsPro(false);
  }, [user?.id, token, refreshProStatus]);

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        token,
        loading,
        isPro,
        refreshProStatus,
        login,
        register,
        loginWithGoogle,
        loginWithGoogleCode,
        loginWithApple,
        loginAsGuest,
        logout,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
