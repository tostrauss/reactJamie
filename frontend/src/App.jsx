import React, { useContext, useState, useEffect, useRef, lazy, Suspense } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext, AuthProvider } from './context/AuthContext';
import { SocketContext, SocketProvider } from './context/SocketContext';
import { ToastProvider } from './context/ToastContext';
import { NetworkProvider } from './context/NetworkContext';
import ErrorBoundary from './components/ErrorBoundary';
import { isNative, isNativeIOS } from './utils/platform';
import { AppIntro, shouldShowIntro } from './pages/AppIntro';
const ProModal = lazy(() => import('./components/ProModal').then(m => ({ default: m.ProModal })));
import { useAnalytics } from './hooks/useAnalytics';
import { EventReviewModal } from './components/EventReviewModal';
import { ConsentBanner } from './components/ConsentBanner';
import { reviews } from './utils/api';

// Auth Pages (eagerly loaded - needed at startup)
import { Login } from './pages/Login';
import { Register } from './pages/Register';

// Lazy-loaded pages (code-split per route)
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Home = lazy(() => import('./pages/Home'));
const Explore = lazy(() => import('./pages/Explore'));
const Profile = lazy(() => import('./pages/Profile'));
const ProfileEdit = lazy(() => import('./pages/ProfileEdit'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ChatList = lazy(() => import('./pages/ChatList'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const DirectMessagePage = lazy(() => import('./pages/DirectMessagePage'));
const GroupDetail = lazy(() => import('./pages/GroupDetail'));
const CreateGroup = lazy(() => import('./pages/CreateGroup'));
const CreateClub = lazy(() => import('./pages/CreateClub'));
const GroupRequests = lazy(() => import('./pages/GroupRequests'));
const UserProfile = lazy(() => import('./pages/UserProfile'));
const ClubEdit = lazy(() => import('./pages/ClubEdit'));
const GroupEdit = lazy(() => import('./pages/GroupEdit'));
const Notifications = lazy(() => import('./pages/Notifications'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const SpotifyCallback = lazy(() => import('./pages/SpotifyCallback'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const Impressum = lazy(() => import('./pages/Impressum'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const WelcomeIntro   = lazy(() => import('./pages/WelcomeIntro'));
const OutOfRegion    = lazy(() => import('./pages/OutOfRegion'));
const Friends        = lazy(() => import('./pages/Friends'));
const DealDetail     = lazy(() => import('./pages/DealDetail'));

// Styles
import './styles/global.css';
import './styles/home.css';
import './styles/auth.css';
import './styles/chat.css';
import './styles/profile.css';

// Loading fallback
const PageLoader = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'var(--bg-primary, #1a1a2e)'
  }}>
    <div className="loading-spinner" />
  </div>
);

// SVG Icons
const HomeIcon = ({ active }) => (
  <svg width="26" height="24" viewBox="0 0 26 24" fill="none" stroke={active ? "#FD7666" : "#9BA2B0"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="7" r="3.5"/>
    <path d="M1 20c0-4 3.5-7 8-7s8 3 8 7"/>
    <circle cx="20" cy="8" r="2.5"/>
    <path d="M15 20c0-2.8 2-5 5-5s5 2.2 5 5"/>
  </svg>
);

const ExploreIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#FD7666" : "#9BA2B0"} strokeWidth="2">
    <circle cx="12" cy="12" r="10"/>
    <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" fill={active ? "#FD7666" : "none"} stroke={active ? "#FD7666" : "#9BA2B0"}/>
  </svg>
);

const ChatIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#FD7666" : "#9BA2B0"} strokeWidth="2">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>
);

const ProfileIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#FD7666" : "#9BA2B0"} strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

// ==========================================
// SW UPDATE BANNER
// ==========================================
const UpdateBanner = () => {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="update-banner">
      <span>Neue Version verfügbar</span>
      <button onClick={() => updateServiceWorker(true)}>Aktualisieren</button>
    </div>
  );
};

// ==========================================
// INSTALL PROMPT BANNER
// ==========================================
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInStandaloneMode = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const InstallBanner = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [iosMode, setIosMode] = useState(false);

  useEffect(() => {
    if (isInStandaloneMode()) return;

    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

    if (isIOS()) {
      setIosMode(true);
      setShowBanner(true);
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="install-banner">
      <div className="install-banner-content">
        <div className="install-banner-icon">J</div>
        <div className="install-banner-text">
          <strong>JAMIE installieren</strong>
          {iosMode
            ? <span>Tippe auf <strong>Teilen</strong> → <strong>Zum Home-Bildschirm</strong></span>
            : <span>App für schnellen Zugriff installieren</span>
          }
        </div>
      </div>
      <div className="install-banner-actions">
        {!iosMode && (
          <button className="install-btn" onClick={handleInstall}>Installieren</button>
        )}
        <button className="install-dismiss" onClick={handleDismiss}>✕</button>
      </div>
    </div>
  );
};

const CreateModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleOption = (path) => {
    onClose();
    navigate(path);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <h2 className="modal-title">Was möchtest du erstellen?</h2>

        <div className="modal-options">
          <button className="modal-option" onClick={() => handleOption('/create-group')}>
            <div className="modal-option-icon">👥</div>
            <div className="modal-option-text">
              <h3>Gruppe erstellen</h3>
              <p>Plane eine Aktivität mit 3-10 Leuten</p>
            </div>
            <div className="modal-option-arrow">→</div>
          </button>

          <button className="modal-option" onClick={() => handleOption('/create-club')}>
            <div className="modal-option-icon">🏆</div>
            <div className="modal-option-text">
              <h3>Club gründen</h3>
              <p>Starte eine dauerhafte Community</p>
            </div>
            <div className="modal-option-arrow">→</div>
          </button>
        </div>

        <button className="modal-close-btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </div>
  );
};

const Navigation = () => {
  const { user } = useContext(AuthContext);
  const { socket } = useContext(SocketContext);
  const location = useLocation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const unreadRef = useRef(0);

  const hideNavPaths = ['/login', '/register', '/onboarding', '/welcome'];
  const hideOnChat = location.pathname.startsWith('/chat/') || location.pathname.startsWith('/dm/');

  // Fetch initial unread count once on mount / user change
  useEffect(() => {
    if (!user) return;
    import('./utils/api').then(m =>
      m.directMessages.getConversations()
        .then(res => {
          const total = (res.data || []).reduce((sum, c) => sum + (c.unread_count || 0), 0);
          unreadRef.current = total;
          setUnreadCount(total);
        })
        .catch(() => {})
    );
  }, [user?.id]);

  // Clear badge when user opens the DM list (instead of on every path change)
  useEffect(() => {
    if (location.pathname === '/chats') {
      unreadRef.current = 0;
      setUnreadCount(0);
    }
  }, [location.pathname]);

  // Increment badge on incoming DM via socket — no polling needed
  useEffect(() => {
    if (!socket) return;
    const onNewDm = () => {
      if (location.pathname === '/chats') return; // already visible, skip
      unreadRef.current += 1;
      setUnreadCount(unreadRef.current);
    };
    socket.on('new_dm_notification', onNewDm);
    return () => socket.off('new_dm_notification', onNewDm);
  }, [socket, location.pathname]);

  if (!user || hideNavPaths.includes(location.pathname) || hideOnChat) return null;

  const isActive = (path) => {
    if (path === '/home') return location.pathname === '/home' || location.pathname.startsWith('/group/');
    return location.pathname === path || location.pathname.startsWith(path);
  };

  return (
    <>
      <nav className="bottom-nav">
        <div className="bottom-nav-items">
          <Link to="/home" className={`nav-item ${isActive('/home') ? 'active' : ''}`}>
            <div className="nav-icon"><HomeIcon active={isActive('/home')} /></div>
            <span className="nav-label">Home</span>
          </Link>

          <Link to="/explore" className={`nav-item ${isActive('/explore') ? 'active' : ''}`}>
            <div className="nav-icon"><ExploreIcon active={isActive('/explore')} /></div>
            <span className="nav-label">Entdecken</span>
          </Link>

          <button className="nav-add-button" onClick={() => setShowCreateModal(true)}>
            <span className="plus-icon">+</span>
          </button>

          <Link to="/chats" className={`nav-item ${isActive('/chats') ? 'active' : ''}`} style={{ position: 'relative' }}>
            <div className="nav-icon">
              <ChatIcon active={isActive('/chats')} />
              {unreadCount > 0 && <span className="nav-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </div>
            <span className="nav-label">Chats</span>
          </Link>

          <Link to="/profile" className={`nav-item ${isActive('/profile') ? 'active' : ''}`}>
            <div className="nav-icon">
              {user.avatar_url
                ? <img src={user.avatar_url} alt="Profil" className="nav-avatar" />
                : <ProfileIcon active={isActive('/profile')} />
              }
            </div>
            <span className="nav-label">Profil</span>
          </Link>
        </div>
      </nav>

      <CreateModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </>
  );
};

// Protected Route
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <PageLoader />;
  return user ? children : <Navigate to="/login" replace />;
};

const AuthRoute = ({ children }) => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <PageLoader />;
  return user ? <Navigate to="/home" replace /> : children;
};

// ==========================================
// GEOFENCING — block users outside DACH (Austria, Germany, Switzerland)
// ==========================================
const DACH_REGIONS = [
  { latMin: 46.37, latMax: 49.02, lngMin: 9.53,  lngMax: 17.16 }, // Austria
  { latMin: 47.27, latMax: 55.06, lngMin: 5.87,  lngMax: 15.04 }, // Germany
  { latMin: 45.82, latMax: 47.81, lngMin: 5.96,  lngMax: 10.49 }, // Switzerland
];

function isInRegion(lat, lng) {
  return DACH_REGIONS.some(r =>
    lat >= r.latMin && lat <= r.latMax && lng >= r.lngMin && lng <= r.lngMax
  );
}

// Returns 'allowed' | 'outside' | 'unknown'
function useGeoFence() {
  const [region, setRegion] = useState(() => {
    // Re-use result within the same browser session
    const cached = sessionStorage.getItem('jamie_region');
    // Migrate old 'austria' value to 'allowed'
    if (cached === 'austria') return 'allowed';
    return cached || 'unknown';
  });

  useEffect(() => {
    if (region !== 'unknown') return; // already checked
    if (!navigator.geolocation) { setRegion('unknown'); return; }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const r = isInRegion(coords.latitude, coords.longitude) ? 'allowed' : 'outside';
        sessionStorage.setItem('jamie_region', r);
        setRegion(r);
      },
      () => {
        // Permission denied or error — don't block access
        sessionStorage.setItem('jamie_region', 'unknown');
        setRegion('unknown');
      },
      { timeout: 6000, maximumAge: 60000 }
    );
  }, [region]);

  return region;
}

// ==========================================
// NATIVE IOS PUSH REGISTRATION
// ==========================================
function useNativePush(user) {
  useEffect(() => {
    if (!user || !isNativeIOS()) return;

    // Dynamic import — only available inside Capacitor native shell
    import('@capacitor/push-notifications').then(({ PushNotifications }) => {
      PushNotifications.requestPermissions().then(({ receive }) => {
        if (receive !== 'granted') return;
        PushNotifications.register();
      });

      const regListener = PushNotifications.addListener('registration', ({ value: token }) => {
        // Send APNs device token to backend
        import('./utils/api.js').then(({ push }) => {
          push.saveApnsToken(token).catch(() => {});
        });
      });

      return () => { regListener.remove(); };
    }).catch(() => {});
  }, [user]);
}

// Main App Routes
function AppRoutes() {
  const { user } = useContext(AuthContext);
  useNativePush(user);
  useAnalytics();
  const [showIntro, setShowIntro] = useState(() => !!user && !user?.isGuest && shouldShowIntro());
  const [showProModal, setShowProModal] = useState(false);
  const [pendingReviews, setPendingReviews] = useState(null);

  // Show intro when user first logs in
  useEffect(() => {
    if (user && !user.isGuest && shouldShowIntro()) setShowIntro(true);
  }, [user]);

  // Check for pending post-event reviews once after login
  useEffect(() => {
    if (!user) return;
    reviews.getPending()
      .then(res => { if (res.data?.length) setPendingReviews(res.data); })
      .catch(() => {});
  }, [user?.id]);

  // Show Pro modal if flagged from WelcomeIntro
  useEffect(() => {
    if (!user) return;
    if (localStorage.getItem('jamie_show_pro_modal') === '1') {
      localStorage.removeItem('jamie_show_pro_modal');
      setShowProModal(true);
    }
  }, [user?.id]);

  const region = useGeoFence();

  if (showIntro) return <AppIntro onDone={() => setShowIntro(false)} />;

  // Block users outside DACH (only when we have a confirmed location)
  if (region === 'outside') {
    return (
      <Suspense fallback={<PageLoader />}>
        <OutOfRegion />
      </Suspense>
    );
  }

  return (
    <>
      {!isNative() && <UpdateBanner />}
      {!isNative() && <InstallBanner />}
      <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Auth */}
          <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
          <Route path="/register" element={<AuthRoute><Register /></AuthRoute>} />
          <Route path="/welcome" element={<ProtectedRoute><WelcomeIntro /></ProtectedRoute>} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          {/* Main */}
          <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/explore" element={<ProtectedRoute><Explore /></ProtectedRoute>} />
          <Route path="/favorites" element={<Navigate to="/explore" replace />} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/profile/edit" element={<ProtectedRoute><ProfileEdit /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />

          {/* Chats */}
          <Route path="/chats" element={<ProtectedRoute><ChatList /></ProtectedRoute>} />
          <Route path="/chat/:groupId" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/dm/:userId" element={<ProtectedRoute><DirectMessagePage /></ProtectedRoute>} />

          {/* Groups */}
          <Route path="/group/:id" element={<ProtectedRoute><GroupDetail /></ProtectedRoute>} />
          <Route path="/group/:id/requests" element={<ProtectedRoute><GroupRequests /></ProtectedRoute>} />
          <Route path="/group/:id/edit" element={<ProtectedRoute><GroupEdit /></ProtectedRoute>} />
          <Route path="/create-group" element={<ProtectedRoute><CreateGroup /></ProtectedRoute>} />
          <Route path="/create-club" element={<ProtectedRoute><CreateClub /></ProtectedRoute>} />
          <Route path="/club/:id/edit" element={<ProtectedRoute><ClubEdit /></ProtectedRoute>} />

          {/* Friends */}
          <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />

          {/* Für Dich Deals */}
          <Route path="/deal/:id" element={<ProtectedRoute><DealDetail /></ProtectedRoute>} />

          {/* User */}
          <Route path="/user/:id" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />

          {/* Notifications */}
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />

          {/* Spotify */}
          <Route path="/spotify/callback" element={<ProtectedRoute><SpotifyCallback /></ProtectedRoute>} />

          {/* Admin — public but protected by secret header */}
          <Route path="/admin" element={<AdminDashboard />} />

          {/* Legal — public, no auth required */}
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/impressum" element={<Impressum />} />

          {/* Redirects */}
          <Route path="/" element={<Navigate to={user ? "/home" : "/login"} replace />} />

          {/* 404 */}
          <Route path="*" element={
            <div className="page not-found-page">
              <div className="not-found-icon">🤔</div>
              <h1>Seite nicht gefunden</h1>
              <p>Die Seite existiert nicht.</p>
              <Link to="/" className="btn btn-primary">Zur Startseite</Link>
            </div>
          } />
        </Routes>
      </Suspense>
      </ErrorBoundary>
      <Navigation />
      {pendingReviews && (
        <EventReviewModal
          pendingReviews={pendingReviews}
          onDone={() => setPendingReviews(null)}
        />
      )}
      {showProModal && (
        <Suspense fallback={null}>
          <ProModal
            onClose={() => setShowProModal(false)}
            onSuccess={() => setShowProModal(false)}
          />
        </Suspense>
      )}
    </>
  );
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '154096703629-0e84iqkd832vr2f68fv5phfhlqqfn474.apps.googleusercontent.com';

function App() {
  const inner = (
    <ErrorBoundary>
      <BrowserRouter>
        <NetworkProvider>
          <ToastProvider>
            <AuthProvider>
              <SocketProvider>
                <AppRoutes />
                <ConsentBanner />
              </SocketProvider>
            </AuthProvider>
          </ToastProvider>
        </NetworkProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );

  return GOOGLE_CLIENT_ID
    ? <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{inner}</GoogleOAuthProvider>
    : inner;
}

export default App;
