import { useContext, useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { lazyWithReload } from './utils/lazyRetry';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { safeStorage } from './utils/safeStorage';
import { AuthContext, AuthProvider } from './context/AuthContext';
import { SocketContext, SocketProvider } from './context/SocketContext';
import { ToastProvider } from './context/ToastContext';
import { NetworkProvider } from './context/NetworkContext';
import ErrorBoundary from './components/ErrorBoundary';
import { isNative, isNativeIOS } from './utils/platform';
import { REGION_BOUNDS } from './utils/regions';
import { AppIntro, shouldShowIntro } from './pages/AppIntro';
const ProModal = lazyWithReload(() => import('./components/ProModal').then(m => ({ default: m.ProModal })));
import { useAnalytics } from './hooks/useAnalytics';
import { EventReviewModal } from './components/EventReviewModal';
import { FeedbackModal } from './components/FeedbackModal';
import { NotificationPrompt } from './components/NotificationPrompt';
import { NativePushDeniedBanner } from './components/NativePushDeniedBanner';
import PullToRefresh from './components/PullToRefresh';
import AvatarGateModal from './components/AvatarGateModal';
import { reviews } from './utils/api';

// Auth Pages (eagerly loaded - needed at startup)
import { Login } from './pages/Login';
import { Register } from './pages/Register';

// Lazy-loaded pages (code-split per route)
const Onboarding = lazyWithReload(() => import('./pages/Onboarding'));
const Home = lazyWithReload(() => import('./pages/Home'));
const Explore = lazyWithReload(() => import('./pages/Explore'));
const Profile = lazyWithReload(() => import('./pages/Profile'));
const ProfileEdit = lazyWithReload(() => import('./pages/ProfileEdit'));
const SettingsPage = lazyWithReload(() => import('./pages/SettingsPage'));
const ChatList = lazyWithReload(() => import('./pages/ChatList'));
const ChatPage = lazyWithReload(() => import('./pages/ChatPage'));
const DirectMessagePage = lazyWithReload(() => import('./pages/DirectMessagePage'));
const GroupDetail = lazyWithReload(() => import('./pages/GroupDetail'));
const ClubDetail = lazyWithReload(() => import('./pages/ClubDetail'));
const Events = lazyWithReload(() => import('./pages/Events'));
const ClubMembers = lazyWithReload(() => import('./pages/ClubMembers'));
const CreateGroup = lazyWithReload(() => import('./pages/CreateGroup'));
const CreateClub = lazyWithReload(() => import('./pages/CreateClub'));
const GroupRequests = lazyWithReload(() => import('./pages/GroupRequests'));
const UserProfile = lazyWithReload(() => import('./pages/UserProfile'));
const GroupEdit = lazyWithReload(() => import('./pages/GroupEdit'));
const Notifications = lazyWithReload(() => import('./pages/Notifications'));
const ForgotPassword = lazyWithReload(() => import('./pages/ForgotPassword'));
const ResetPassword = lazyWithReload(() => import('./pages/ResetPassword'));
const VerifyEmail = lazyWithReload(() => import('./pages/VerifyEmail'));
const SpotifyCallback = lazyWithReload(() => import('./pages/SpotifyCallback'));
const PrivacyPolicy = lazyWithReload(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazyWithReload(() => import('./pages/TermsOfService'));
const Impressum = lazyWithReload(() => import('./pages/Impressum'));
const Widerruf = lazyWithReload(() => import('./pages/Widerruf'));
const CommunityGuidelines = lazyWithReload(() => import('./pages/CommunityGuidelines'));
const ChildSafety = lazyWithReload(() => import('./pages/ChildSafety'));
const AdminDashboard = lazyWithReload(() => import('./pages/AdminDashboard'));
const OutOfRegion    = lazyWithReload(() => import('./pages/OutOfRegion'));
const GoogleCallback = lazyWithReload(() => import('./pages/GoogleCallback'));
const Friends        = lazyWithReload(() => import('./pages/Friends'));
const DealDetail     = lazyWithReload(() => import('./pages/DealDetail'));
const DealRedeem     = lazyWithReload(() => import('./pages/DealRedeem'));
const Help           = lazyWithReload(() => import('./pages/Help'));
const BlockedUsers   = lazyWithReload(() => import('./pages/BlockedUsers'));

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
  const { t } = useTranslation();

  if (!needRefresh) return null;

  return (
    <div className="update-banner">
      <span>{t('app.updateAvailable')}</span>
      <button onClick={() => updateServiceWorker(true)}>{t('app.updateBtn')}</button>
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
  const { t } = useTranslation();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [iosMode, setIosMode] = useState(false);

  useEffect(() => {
    if (isInStandaloneMode()) return;

    const dismissed = safeStorage.getItem('pwa-install-dismissed');
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
    safeStorage.setItem('pwa-install-dismissed', Date.now().toString());
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="install-banner">
      <div className="install-banner-content">
        <div className="install-banner-icon">J</div>
        <div className="install-banner-text">
          <strong>{t('app.install.title')}</strong>
          {iosMode
            ? <span>{t('app.install.iosHintPrefix')} <strong>{t('app.install.iosShare')}</strong> {t('app.install.iosHintArrow')} <strong>{t('app.install.iosHomeScreen')}</strong></span>
            : <span>{t('app.install.defaultText')}</span>
          }
        </div>
      </div>
      <div className="install-banner-actions">
        {!iosMode && (
          <button className="install-btn" onClick={handleInstall}>{t('app.install.btn')}</button>
        )}
        <button className="install-dismiss" onClick={handleDismiss}>✕</button>
      </div>
    </div>
  );
};

const CreateModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const [showAvatarGate, setShowAvatarGate] = useState(false);

  const handleOption = (path) => {
    // Creating a group/club requires a profile photo (Tina 2026-08-03) — the
    // backend enforces this too; here we prompt before the user fills a whole
    // form only to be rejected. "Freunde finden" stays open.
    const needsAvatar = path === '/create-group' || path === '/create-club';
    if (needsAvatar && !user?.avatar_url) {
      onClose();
      setShowAvatarGate(true);
      return;
    }
    onClose();
    navigate(path);
  };

  return (
    <>
      {isOpen && (
        <div className="modal-overlay" onClick={onClose}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <h2 className="modal-title">{t('app.createModal.title')}</h2>

            <div className="modal-options">
              <button className="modal-option" onClick={() => handleOption('/create-group')}>
                <div className="modal-option-icon">👥</div>
                <div className="modal-option-text">
                  <h3>{t('app.createModal.groupTitle')}</h3>
                  <p>{t('app.createModal.groupDesc')}</p>
                </div>
                <div className="modal-option-arrow">→</div>
              </button>

              <button className="modal-option" onClick={() => handleOption('/create-club')}>
                <div className="modal-option-icon">🏆</div>
                <div className="modal-option-text">
                  <h3>{t('app.createModal.clubTitle')}</h3>
                  <p>{t('app.createModal.clubDesc')}</p>
                </div>
                <div className="modal-option-arrow">→</div>
              </button>

              <button className="modal-option" onClick={() => handleOption('/friends')}>
                <div className="modal-option-icon">🔍</div>
                <div className="modal-option-text">
                  <h3>{t('app.createModal.friendsTitle')}</h3>
                  <p>{t('app.createModal.friendsDesc')}</p>
                </div>
                <div className="modal-option-arrow">→</div>
              </button>
            </div>

            <button className="modal-close-btn" onClick={onClose}>
              {t('app.createModal.cancel')}
            </button>
          </div>
        </div>
      )}
      <AvatarGateModal isOpen={showAvatarGate} onClose={() => setShowAvatarGate(false)} />
    </>
  );
};

const Navigation = () => {
  const { user } = useContext(AuthContext);
  const { socket } = useContext(SocketContext);
  const location = useLocation();
  const { t } = useTranslation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const unreadRef = useRef(0);

  const hideNavPaths = ['/login', '/register', '/onboarding', '/welcome'];
  // Routes that own the whole screen and shouldn't render the bottom nav.
  // Includes the deal redemption proof screen — staff is supposed to glance
  // at the brand + deal card, the nav would just be visual noise.
  const hideOnChat = location.pathname.startsWith('/chat/')
    || location.pathname.startsWith('/dm/')
    || /^\/deal\/[^/]+\/redeem$/.test(location.pathname);

  // Server-truth total across all three chat tabs: DMs + group chats + club
  // chats (events excluded — they have no row in the chat list). The badge
  // only drops when a conversation is actually READ (opening it stamps
  // last_read_at / zeroes dm unread server-side) — NOT when the chat list is
  // merely viewed. Tester bug 2026-06-11: the old clear-on-/chats hack wiped
  // the badge before the message was opened, so unread chats got forgotten.
  const refreshUnread = useCallback(() => {
    if (!user) return;
    import('./utils/api').then(m =>
      Promise.all([
        m.directMessages.getConversations(),
        m.groups.getJoined(true), // fresh — bypass the backend's 15s cache
      ]).then(([dmRes, grpRes]) => {
        const dmTotal = (dmRes.data || [])
          .reduce((sum, c) => sum + (c.unread_count || 0), 0);
        const grpTotal = (grpRes.data || [])
          .filter(g => g.type !== 'event')
          .reduce((sum, g) => sum + (g.unread_count || 0), 0);
        unreadRef.current = dmTotal + grpTotal;
        setUnreadCount(unreadRef.current);
      }).catch(() => {
        // Network blip / 500: keep the current value. Overwriting with a
        // partial sum would silently zero a badge that has real unread.
      })
    );
  }, [user?.id]);

  // Initial fetch on mount / user change
  useEffect(() => { refreshUnread(); }, [refreshUnread]);

  // Re-sync with the server after leaving a conversation — by then the read
  // marker landed (getMessages stamp + ChatPage unmount markRead). The timer
  // lives in a ref ON PURPOSE: an effect-cleanup timer would be cancelled by
  // any second navigation within the delay (e.g. /dm/5 → /chats → /home) and
  // never rescheduled, silently dropping the resync.
  const prevPathRef = useRef(location.pathname);
  const resyncTimerRef = useRef(null);
  useEffect(() => {
    const was = prevPathRef.current;
    prevPathRef.current = location.pathname;
    if (/^\/(chat|dm)\//.test(was) && was !== location.pathname) {
      clearTimeout(resyncTimerRef.current);
      resyncTimerRef.current = setTimeout(refreshUnread, 400);
    }
  }, [location.pathname, refreshUnread]);
  useEffect(() => () => clearTimeout(resyncTimerRef.current), []);

  // Precise resync: ChatPage fires this AFTER its unmount markRead settled,
  // eliminating the race the 400ms timer can only approximate.
  useEffect(() => {
    const onResync = () => {
      clearTimeout(resyncTimerRef.current);
      refreshUnread();
    };
    window.addEventListener('jamie:unread-resync', onResync);
    return () => window.removeEventListener('jamie:unread-resync', onResync);
  }, [refreshUnread]);

  // Live increments via socket. Skip only when the user is INSIDE that very
  // conversation (they're reading it; the room handler covers the UI there).
  useEffect(() => {
    if (!socket) return;
    const bump = () => {
      unreadRef.current += 1;
      setUnreadCount(unreadRef.current);
    };
    const onNewDm = (data) => {
      if (location.pathname === `/dm/${data?.senderId}`) return;
      bump();
    };
    const onGroupMsg = (data) => {
      if (data?.group_type === 'event') return; // no chat-list row → no badge
      if (location.pathname === `/chat/${data?.group_id}`) return;
      bump();
    };
    socket.on('new_dm_notification', onNewDm);
    socket.on('group_message_notification', onGroupMsg);
    return () => {
      socket.off('new_dm_notification', onNewDm);
      socket.off('group_message_notification', onGroupMsg);
    };
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
            <span className="nav-label">{t('app.nav.home')}</span>
          </Link>

          <Link to="/explore" className={`nav-item ${isActive('/explore') ? 'active' : ''}`}>
            <div className="nav-icon"><ExploreIcon active={isActive('/explore')} /></div>
            <span className="nav-label">{t('app.nav.explore')}</span>
          </Link>

          <button className="nav-add-button" onClick={() => setShowCreateModal(true)}>
            <span className="plus-icon">+</span>
          </button>

          <Link to="/chats" className={`nav-item ${isActive('/chats') ? 'active' : ''}`} style={{ position: 'relative' }}>
            <div className="nav-icon">
              <ChatIcon active={isActive('/chats')} />
              {unreadCount > 0 && <span className="nav-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </div>
            <span className="nav-label">{t('app.nav.chats')}</span>
          </Link>

          <Link to="/profile" className={`nav-item ${isActive('/profile') ? 'active' : ''}`}>
            <div className="nav-icon">
              {user.avatar_url
                ? <img src={user.avatar_url} alt={t('app.nav.profileAlt')} className="nav-avatar" decoding="async" fetchPriority="high" />
                : <ProfileIcon active={isActive('/profile')} />
              }
            </div>
            <span className="nav-label">{t('app.nav.profile')}</span>
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
  const { user } = useContext(AuthContext);
  // No PageLoader swap here: the global `loading` flips during login/register
  // attempts, and unmounting the form resets its state — a wrong password
  // threw users back to the first login screen with the error wiped. The
  // submit buttons render their own busy state; on success `user` is set and
  // the redirect below kicks in.
  return user ? <Navigate to="/home" replace /> : children;
};

// ==========================================
// GEOFENCING — block web users outside the launch markets (AT/DE/CH/IT).
// Bounding boxes live in utils/regions.js (shared with the create-location
// country restriction).
// ==========================================
// Bump when the launch-market set changes: forces a ONE-TIME re-check of any
// stale 'outside' decision cached under the old (smaller) market set. See the
// self-heal in useGeoFence.
const GEOFENCE_VERSION = '2';

function isInRegion(lat, lng) {
  return REGION_BOUNDS.some(r =>
    lat >= r.latMin && lat <= r.latMax && lng >= r.lngMin && lng <= r.lngMax
  );
}

// Returns 'allowed' | 'outside' | 'unknown'
function useGeoFence() {
  const [region, setRegion] = useState(() => {
    // The native app NEVER geo-blocks: anyone who installed it from the App
    // Store / Play Store is a target user, and Apple/Google reviewers sit
    // outside Austria — a hard OutOfRegion gate on launch reads as "the app is
    // broken" (App Review 2.1(a) rejection 2026-07-02). Returning 'allowed'
    // here also skips the launch-time geolocation prompt below. The Austria-only
    // rule still applies to group/club CREATION (enforced in Create* + server).
    // The web PWA keeps its waitlist gate for non-AT visitors.
    if (isNative()) return 'allowed';
    // Persist the check in localStorage (NOT sessionStorage) so the location
    // prompt fires at most ONCE per install. sessionStorage resets on every
    // relaunch of a standalone/installed PWA, so the old code re-asked for the
    // location on every login — the exact "mach das einmalig" complaint.
    let cached = null;
    try { cached = safeStorage.getItem('jamie_region'); } catch { /* private mode */ }
    // Migrate old 'austria' value to 'allowed'
    if (cached === 'austria') return 'allowed';
    // One-time self-heal after a launch-market expansion (AT → AT/DE/CH/IT/FR/
    // ES): the gate caches the DECISION, not the coordinates, so a pre-expansion
    // 'outside' would stick forever even though the visitor's country is now
    // live — permanently waitlisting real users (Tina reports, Samsung A56,
    // 2026-08-05). On a version bump, drop a stale 'outside' ONCE so it re-checks;
    // a genuinely out-of-region user just gets re-gated + re-cached (no reprompt
    // loop, since the version is then marked seen).
    if (cached === 'outside' && safeStorage.getItem('jamie_geofence_v') !== GEOFENCE_VERSION) {
      safeStorage.removeItem('jamie_region');
      cached = null;
    }
    safeStorage.setItem('jamie_geofence_v', GEOFENCE_VERSION);
    return cached || 'unknown';
  });

  useEffect(() => {
    if (isNative()) return;            // native never geo-blocks (see above)
    if (region !== 'unknown') return; // already checked
    if (!navigator.geolocation) { setRegion('unknown'); return; }

    const persist = (r) => { try { safeStorage.setItem('jamie_region', r); } catch { /* private mode */ } };

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const r = isInRegion(coords.latitude, coords.longitude) ? 'allowed' : 'outside';
        persist(r);
        setRegion(r);
      },
      () => {
        // Permission denied / error — fail open AND remember we asked, so we
        // never re-prompt on the next launch. 'allowed' is non-blocking (only
        // 'outside' gates access), matching the previous "don't block" behaviour.
        persist('allowed');
        setRegion('allowed');
      },
      { timeout: 6000, maximumAge: 60000 }
    );
  }, [region]);

  // "App öffnen" escape hatch (OutOfRegion footer): the visitor asserts they
  // ARE in a launch market. Force 'allowed' in app state (lifts the gate with
  // NO reload — works even where storage is denied) and best-effort persist so
  // the next launch stays in. The old footer button was a dead end: it cleared
  // sessionStorage while the decision lives in localStorage, so the reload just
  // re-read 'outside' and showed the same gate (Tina-user, Samsung A56,
  // 2026-08-05).
  const allow = () => {
    safeStorage.setItem('jamie_region', 'allowed');
    setRegion('allowed');
  };

  return [region, allow];
}

// ==========================================
// HIDE iOS KEYBOARD ACCESSORY BAR
// ==========================================
// iOS WKWebView shows a Done/Previous/Next toolbar above the keyboard for
// every form input. Users read the ✓ as a "submit" button and tap it on the
// search field expecting it to do something — it just dismisses the keyboard,
// which is confusing. Hide it on native iOS; web/Android don't render it.
function useHideKeyboardAccessoryBar() {
  useEffect(() => {
    if (!isNativeIOS()) return;
    import('@capacitor/keyboard').then(({ Keyboard }) => {
      Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
    }).catch(() => {});
  }, []);
}

// ==========================================
// iOS VIEWPORT RESTORE AFTER KEYBOARD
// ==========================================
// On iOS (native WKWebView and standalone PWA alike) the visual viewport can
// stay shifted upward after the keyboard closes: every position:fixed element
// (bottom nav, modal backdrops) then floats ~50pt above the screen bottom with
// a dead background band below. That stale state is the window being scrolled
// BEYOND the document's valid range — clamping it back into range re-anchors
// the viewport. Clamp, never scrollTo(0, 0): pages like ClubDetail/GroupDetail
// scroll the window, and zeroing threw users to the top of the page after
// every keyboard close (tester-reported 2026-06-11).
function useViewportRestore() {
  useEffect(() => {
    const snap = () => {
      const el = document.activeElement;
      // An input still has focus → keyboard is open (or moving to the next
      // field); don't fight it.
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const y = Math.min(window.scrollY, maxScroll);
      if (y === window.scrollY) return; // position is valid — leave it alone
      // Cover every scroll root WebKit might have offset.
      window.scrollTo(0, y);
      document.documentElement.scrollTop = y;
      document.body.scrollTop = y;
    };
    const deferredSnap = () => setTimeout(snap, 60); // let dismiss animations finish
    const onVisible = () => { if (!document.hidden) deferredSnap(); };

    // Keyboard close (web + PWA): viewport resizes back / input blurs.
    window.visualViewport?.addEventListener('resize', snap);
    // Stale state shows up as a stuck visualViewport offset — catch it directly.
    window.visualViewport?.addEventListener('scroll', snap);
    document.addEventListener('focusout', deferredSnap);
    // iOS can RESTORE the PWA already-shifted (relaunch from saved state,
    // app-switcher return) without firing any resize — snap on those too.
    window.addEventListener('pageshow', deferredSnap);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('orientationchange', deferredSnap);
    deferredSnap(); // and once on mount, in case we loaded into a stale state

    // Native shell: Capacitor fires a dedicated event when the keyboard hides.
    let kbListener = null;
    if (isNative()) {
      import('@capacitor/keyboard')
        .then(({ Keyboard }) => Keyboard.addListener('keyboardDidHide', snap))
        .then(l => { kbListener = l; })
        .catch(() => {});
    }

    return () => {
      window.visualViewport?.removeEventListener('resize', snap);
      window.visualViewport?.removeEventListener('scroll', snap);
      document.removeEventListener('focusout', deferredSnap);
      window.removeEventListener('pageshow', deferredSnap);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('orientationchange', deferredSnap);
      kbListener?.remove();
    };
  }, []);
}

// ==========================================
// NATIVE IOS PUSH REGISTRATION + TAP ROUTING
// ==========================================
function useNativePush(user) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const userId = user?.id;
  // iOS notification permission as the plugin reports it:
  // 'unknown' | 'prompt' | 'granted' | 'denied'. Drives NativePushDeniedBanner.
  const [permission, setPermission] = useState('unknown');

  // Keyed on user id, NOT the user object: profile refreshes replace the
  // object every time, and the old cleanup was returned from inside .then()
  // where React never sees it — so each refresh ADDED a listener set and
  // removed none. addListener returns a Promise<handle> in Capacitor 5+, so
  // handles are collected async and removed by the real effect cleanup.
  useEffect(() => {
    if (!userId || !isNativeIOS()) return;

    let cancelled = false;
    const handles = [];
    const listen = (plugin, eventName, cb) => {
      plugin.addListener(eventName, cb)
        .then((h) => { if (cancelled) h.remove(); else handles.push(h); })
        .catch(() => {});
    };

    // Every outcome is reported to the server ([APNs-diag] in Railway logs).
    // Until 2026-09-04 a denied permission, a plugin missing from the binary,
    // a registrationError and a failed token POST were ALL invisible from the
    // backend — "no push" could only be debugged with a Mac and a cable.
    // Deduped per app start so a flapping state can't spam the endpoint.
    const reported = new Set();
    let appVersion = null;
    const versionReady = import('@capacitor/app')
      .then(({ App }) => App.getInfo())
      .then((info) => { appVersion = `${info?.version || '?'} (${info?.build || '?'})`; })
      .catch(() => {});
    const report = (event, extra = {}) => {
      const key = `${event}:${extra.permission || ''}:${extra.detail || ''}`;
      if (reported.has(key)) return;
      reported.add(key);
      versionReady
        .then(() => import('./utils/api.js'))
        .then(({ push }) => push.reportDiagnostics({ platform: 'ios', app_version: appVersion, event, ...extra }))
        .catch(() => {});
    };
    const errText = (e) => String(e?.error || e?.message || e || 'unknown').slice(0, 160);

    let PN = null;
    let registerCalled = false;
    const register = () => {
      if (registerCalled || cancelled || !PN) return;
      registerCalled = true;
      PN.register().catch((e) => { registerCalled = false; report('registration_error', { detail: errText(e) }); });
    };

    // checkPermissions first, requestPermissions only while still
    // undetermined: iOS shows its dialog exactly once per install, so for a
    // previously-denied user the old unconditional requestPermissions() came
    // back 'denied' with no dialog and the hook returned in silence. Now the
    // state is surfaced (banner) and reported.
    const evaluate = () => {
      if (!PN || cancelled) return;
      PN.checkPermissions().then(({ receive }) => {
        if (cancelled) return;
        if (receive === 'granted') { setPermission('granted'); report('permission', { permission: 'granted' }); register(); return; }
        if (receive === 'denied')  { setPermission('denied');  report('permission', { permission: 'denied' });  return; }
        setPermission('prompt');
        return PN.requestPermissions().then(({ receive: r }) => {
          if (cancelled) return;
          if (r !== 'granted') {
            // Fresh in-session "Nicht erlauben": don't nag 3 s later with the
            // Settings banner (the web NotificationPrompt snoozes 14 d on a
            // denial too). Writing the banner's snooze key is the only thing
            // that works here — the system dialog bounces the app through
            // appStateChange, whose re-evaluate lands in the sticky 'denied'
            // branch above within a second. App Reviewers deny first prompts.
            safeStorage.setItem('jamie_native_push_denied_dismissed', String(Date.now()));
          }
          setPermission(r === 'granted' ? 'granted' : 'denied');
          report('permission', { permission: r });
          if (r === 'granted') register();
        });
      }).catch((e) => {
        // Capacitor's proxy throws code 'UNIMPLEMENTED' ("PushNotifications
        // plugin is not implemented on ios") when the package is missing from
        // the binary. Anything else landing here is a real permission error
        // (iOS can reject requestAuthorization) — label it as such, or the
        // log line sends us hunting for a missing pod that is there.
        const unimplemented = e?.code === 'UNIMPLEMENTED' || /not implemented/i.test(String(e?.message || ''));
        report(unimplemented ? 'plugin_unavailable' : 'permission_error', { detail: errText(e) });
      });
    };

    // Dynamic import — only available inside Capacitor native shell
    import('@capacitor/push-notifications').then(({ PushNotifications }) => {
      if (cancelled) return;
      PN = PushNotifications;

      listen(PN, 'registration', ({ value: token }) => {
        import('./utils/api.js').then(({ push }) => {
          push.saveApnsToken(token)
            .then(() => report('registered', { detail: `len ${String(token).length}` }))
            .catch((e) => {
              // Was `.catch(() => {})` — a 401/500 here looked exactly like
              // "the phone never sent anything".
              console.error('[APNs] token save failed:', e?.response?.status, e?.message);
              report('token_save_failed', { detail: `${e?.response?.status || 'net'} ${errText(e?.response?.data?.error || e)}` });
              // Let the next foreground evaluate() re-register: iOS hands the
              // cached token straight back, so this is what turns "offline at
              // launch" into a retry instead of a token lost until cold start.
              registerCalled = false;
            });
        });
      });

      // Permission granted but register() produced NO token — typically the
      // aps-environment entitlement / provisioning profile is missing from
      // the build. Now reported, not just console'd.
      listen(PN, 'registrationError', (err) => {
        console.error('[APNs] registrationError:', err?.error || err);
        report('registration_error', { detail: errText(err) });
        // On iOS register() resolves immediately (the real outcome arrives via
        // this event), so the .catch in register() never fires — reset here or
        // the foreground re-check can never retry.
        registerCalled = false;
      });

      // Tapping a push must open its target. The backend puts the route into
      // the APNs payload ({ url }, pushController) and sw.js routes it for
      // web/TWA — native iOS had NO handler, so the app just foregrounded
      // wherever it last was and the DM/notification never opened.
      listen(PN, 'pushNotificationActionPerformed', (action) => {
        const url = action?.notification?.data?.url;
        navigateRef.current(typeof url === 'string' && url.startsWith('/') ? url : '/notifications');
      });

      evaluate();
    }).catch((e) => report('import_failed', { detail: errText(e) }));

    // Re-evaluate when the app returns to the foreground — i.e. when the user
    // comes back from iOS Settings after enabling notifications via the
    // banner. Registers right away; no force-quit needed (2026-09-04).
    let appStateHandle = null;
    import('@capacitor/app').then(({ App }) => {
      if (cancelled) return;
      App.addListener('appStateChange', ({ isActive }) => { if (isActive) evaluate(); })
        .then((h) => { if (cancelled) h.remove(); else appStateHandle = h; })
        .catch(() => {});
    }).catch(() => {});

    return () => {
      cancelled = true;
      handles.forEach((h) => { try { h.remove(); } catch { /* already gone */ } });
      try { appStateHandle?.remove(); } catch { /* already gone */ }
    };
  }, [userId]);

  return { permission };
}

// ==========================================
// UNIVERSAL LINKS → SPA ROUTES (native iOS)
// ==========================================
// The AASA file routes /reset-password and /verify-email (+ /club, /group,
// /user once the 0cb4a57 file is deployed) into the installed app. Capacitor
// fires appUrlOpen for those — without a global listener the path was simply
// DROPPED: iOS opened the app on its last screen and e.g. a password-reset
// link dead-ended for exactly the user who can't log in. Custom-scheme URLs
// (jamie://spotify-callback) are ignored here — their scoped listener in
// spotifyAuth.js owns them.
function useAppUrlOpen() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!isNativeIOS()) return;
    let cancelled = false;
    let handle = null;

    import('@capacitor/app').then(({ App: CapApp }) =>
      CapApp.addListener('appUrlOpen', ({ url }) => {
        let parsed;
        try { parsed = new URL(url); } catch { return; }
        if (parsed.protocol !== 'https:') return;
        if (parsed.hostname !== 'app.jamie-app.com') return;
        navigateRef.current(parsed.pathname + parsed.search + parsed.hash);
      }).then((h) => { if (cancelled) h.remove(); else handle = h; })
    ).catch(() => {});

    return () => {
      cancelled = true;
      try { handle?.remove(); } catch { /* already gone */ }
    };
  }, []);
}

// Main App Routes
function AppRoutes() {
  const { user } = useContext(AuthContext);
  const { t } = useTranslation();
  const nativePush = useNativePush(user);
  useAppUrlOpen();
  useHideKeyboardAccessoryBar();
  useViewportRestore();
  useAnalytics();
  const [showIntro, setShowIntro] = useState(() => !!user && !user?.isGuest && shouldShowIntro());
  const [showProModal, setShowProModal] = useState(false);
  // Which feature the user bumped into, from the open event's detail — the
  // modal prepends a matching bubble so the first thing they read is the
  // reason they were sent here. null = the generic Pro pitch.
  const [proModalFeature, setProModalFeature] = useState(null);
  const [pendingReviews, setPendingReviews] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAvatarNudge, setShowAvatarNudge] = useState(false);

  // Periodic feedback prompt: first one ~2 weeks in, then every ~3 months.
  // Stores the next-due timestamp in localStorage so it survives reloads and
  // never nags more than once per interval.
  useEffect(() => {
    if (!user || user.isGuest) return;
    const KEY = 'jamie_feedback_next';
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const next = parseInt(safeStorage.getItem(KEY) || '0', 10);
    if (!next) { safeStorage.setItem(KEY, String(now + 14 * DAY)); return; }
    if (now >= next) {
      // Delay so it doesn't stack on top of the intro / review modals.
      const tid = setTimeout(() => setShowFeedback(true), 1500);
      return () => clearTimeout(tid);
    }
  }, [user?.id]);

  const dismissFeedback = () => {
    safeStorage.setItem('jamie_feedback_next', String(Date.now() + 90 * 24 * 60 * 60 * 1000));
    setShowFeedback(false);
  };

  // Soft nudge for members who are still avatar-less — mostly users
  // grandfathered in before the join-time avatar gate (2026-08-04), which no
  // join/create/invite path re-checks retroactively (Tina 2026-08-27). Never a
  // hard block for existing users; dismissible and re-shown after ~7 days until
  // they add a photo. Suppressed on the auth/onboarding routes (the photo step
  // lives there) and while another modal is up. Clears itself the moment
  // avatar_url is set.
  useEffect(() => {
    if (!user || user.isGuest || user.avatar_url) return;
    if (/^\/(onboarding|welcome|login|register)/.test(window.location.pathname)) return;
    const KEY = 'jamie_avatar_nudge_next';
    const now = Date.now();
    const next = parseInt(safeStorage.getItem(KEY) || '0', 10);
    if (next && now < next) return;
    const tid = setTimeout(() => setShowAvatarNudge(true), 1800);
    return () => clearTimeout(tid);
  }, [user?.id, user?.avatar_url]);

  const dismissAvatarNudge = () => {
    // Re-nudge in ~7 days if they still have no photo.
    safeStorage.setItem('jamie_avatar_nudge_next', String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    setShowAvatarNudge(false);
  };

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

  // Global Pro-modal trigger — fired by GroupCard's Pro lock and any other
  // component that needs to surface the upgrade sheet from deep in the tree.
  // Plain window event keeps the contract loose; no provider/context plumbing.
  // NATIVE iOS: never opens (Tobi 2026-08-05, vor dem iOS-1.3-Build). Apple
  // 3.1.1 — die App darf keinen Kauf bewerben, den sie in-app nicht erfüllen
  // kann (Stripe ist auf iOS aus, StoreKit-IAP nicht gebaut). Die sichtbaren
  // Pro-Locks sind auf iOS ebenfalls ausgeblendet; das hier ist die harte
  // Garantie für jeden künftigen Trigger.
  useEffect(() => {
    if (isNativeIOS()) return;
    // CustomEvent detail is optional — a plain Event (every existing caller)
    // just yields the generic pitch.
    const open = (e) => {
      setProModalFeature(e?.detail?.feature ?? null);
      setShowProModal(true);
    };
    window.addEventListener('jamie:open-pro-modal', open);
    return () => window.removeEventListener('jamie:open-pro-modal', open);
  }, []);

  const [region, allowRegion] = useGeoFence();

  if (showIntro) return <AppIntro onDone={() => setShowIntro(false)} />;

  // Block users outside DACH (only when we have a confirmed location)
  if (region === 'outside') {
    return (
      <Suspense fallback={<PageLoader />}>
        <OutOfRegion onEnter={allowRegion} />
      </Suspense>
    );
  }

  return (
    <>
      {!isNative() && <UpdateBanner />}
      {!isNative() && <InstallBanner />}
      <div className="app-viewport">
      <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Auth */}
          <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
          <Route path="/register" element={<AuthRoute><Register /></AuthRoute>} />
          {/* /welcome removed — AppIntro after login covers the same flow.
              Redirect kept so any cached link / external reference still works. */}
          <Route path="/welcome" element={<Navigate to="/onboarding" replace />} />
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
          {/* Groups reuse the ClubMembers page (identical roster UI); it
              detects the /group/ prefix and uses the groups API + Pro gate. */}
          <Route path="/group/:id/members" element={<ProtectedRoute><ClubMembers /></ProtectedRoute>} />
          <Route path="/group/:id/requests" element={<ProtectedRoute><GroupRequests /></ProtectedRoute>} />
          <Route path="/group/:id/edit" element={<ProtectedRoute><GroupEdit /></ProtectedRoute>} />
          <Route path="/create-group" element={<ProtectedRoute><CreateGroup /></ProtectedRoute>} />
          <Route path="/create-club" element={<ProtectedRoute><CreateClub /></ProtectedRoute>} />
          <Route path="/club/:id" element={<ProtectedRoute><ClubDetail /></ProtectedRoute>} />
          <Route path="/club/:id/members" element={<ProtectedRoute><ClubMembers /></ProtectedRoute>} />
          {/* Clubs reuse the GroupEdit component (identical layout); it
              renders club-only fields based on type. URL stays /club/:id/edit. */}
          <Route path="/club/:id/edit" element={<ProtectedRoute><GroupEdit /></ProtectedRoute>} />

          {/* Club events discovery */}
          <Route path="/events" element={<ProtectedRoute><Events /></ProtectedRoute>} />

          {/* Friends */}
          <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />

          {/* Für Dich Deals */}
          <Route path="/deal/:id" element={<ProtectedRoute><DealDetail /></ProtectedRoute>} />
          <Route path="/deal/:id/redeem" element={<ProtectedRoute><DealRedeem /></ProtectedRoute>} />

          {/* User */}
          <Route path="/user/:id" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />

          {/* Notifications */}
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />

          {/* Spotify */}
          {/* PUBLIC on purpose: in the iOS home-screen PWA, Spotify's redirect
              lands in an isolated in-app browser with no auth cookie. Wrapping
              this in ProtectedRoute bounced it to /login. The page completes
              the OAuth exchange via the state nonce (no session needed). */}
          <Route path="/spotify/callback" element={<SpotifyCallback />} />

          {/* Google Sign-In — auth-code redirect landing page (see
              utils/googleAuth.js). AuthRoute: an already-logged-in visitor
              (e.g. hitting Back after a completed login) bounces to /home
              instead of re-running a single-use, now-consumed code. */}
          <Route path="/auth/google/callback" element={<AuthRoute><GoogleCallback /></AuthRoute>} />

          {/* Admin — requires login + is_admin flag in DB */}
          <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />

          {/* Help — requires login */}
          <Route path="/help" element={<ProtectedRoute><Help /></ProtectedRoute>} />
          <Route path="/blocked" element={<ProtectedRoute><BlockedUsers /></ProtectedRoute>} />

          {/* Legal — public, no auth required */}
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/guidelines" element={<CommunityGuidelines />} />
          <Route path="/child-safety" element={<ChildSafety />} />
          <Route path="/impressum" element={<Impressum />} />
          <Route path="/widerruf" element={<Widerruf />} />

          {/* Redirects */}
          <Route path="/" element={<Navigate to={user ? "/home" : "/login"} replace />} />

          {/* 404 */}
          <Route path="*" element={
            <div className="page not-found-page">
              <div className="not-found-icon">🤔</div>
              <h1>{t('app.notFound.title')}</h1>
              <p>{t('app.notFound.text')}</p>
              <Link to="/" className="btn btn-primary">{t('app.notFound.btn')}</Link>
            </div>
          } />
        </Routes>
      </Suspense>
      </ErrorBoundary>
      </div>
      <PullToRefresh />
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
            feature={proModalFeature}
            onClose={() => setShowProModal(false)}
            onSuccess={() => setShowProModal(false)}
          />
        </Suspense>
      )}
      {/* Feedback prompt — suppressed while the intro / review modals are up. */}
      {showFeedback && !pendingReviews && !showIntro && (
        <FeedbackModal onClose={dismissFeedback} />
      )}
      {/* Proactive web-push enable nudge — hidden on native iOS + when a modal
          is up. Self-gates on support / permission / prior dismissal. */}
      {user && !user.isGuest && !showFeedback && !pendingReviews && !showIntro && !showAvatarNudge && (
        <NotificationPrompt />
      )}
      {/* Native-iOS counterpart: the OS permission is DENIED (sticky — iOS
          never re-prompts), so the only way back is Settings. useNativePush
          owns the state and re-checks on return; this is display + snooze.
          Both prompts also yield to the soft avatar-nudge sheet — it's a
          bottom sheet at z 2000, the banners float at 9000 and would sit on
          top of its CTA. */}
      {user && !user.isGuest && !showFeedback && !pendingReviews && !showIntro && !showAvatarNudge && (
        <NativePushDeniedBanner permission={nativePush.permission} />
      )}
      {/* Avatar nudge for grandfathered avatar-less members — soft, dismissible,
          suppressed while other modals are up. */}
      {showAvatarNudge && !showFeedback && !pendingReviews && !showIntro && (
        <AvatarGateModal isOpen soft onClose={dismissAvatarNudge} />
      )}
    </>
  );
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function App() {
  const inner = (
    <ErrorBoundary>
      <BrowserRouter>
        <NetworkProvider>
          <ToastProvider>
            <AuthProvider>
              <SocketProvider>
                <AppRoutes />
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
