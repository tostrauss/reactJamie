import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { analytics } from '../utils/api';
import { CONSENT_KEY } from '../components/ConsentBanner';

const hasConsent = () => localStorage.getItem(CONSENT_KEY) === 'true';
const track = (type, screen, duration) => {
  if (!hasConsent()) return;
  analytics.trackEvent(type, screen, duration).catch(() => {});
};

// Maps route patterns to human-readable screen names
const getScreenName = (pathname) => {
  if (pathname === '/home') return 'Home';
  if (pathname === '/favorites') return 'Favorites';
  if (pathname === '/profile') return 'Profile';
  if (pathname === '/profile/edit') return 'ProfileEdit';
  if (pathname === '/settings') return 'Settings';
  if (pathname === '/chats') return 'ChatList';
  if (pathname === '/notifications') return 'Notifications';
  if (pathname === '/create-group') return 'CreateGroup';
  if (pathname === '/create-club') return 'CreateClub';
  if (pathname === '/onboarding') return 'Onboarding';
  if (pathname === '/privacy') return 'Privacy';
  if (pathname.startsWith('/group/') && pathname.endsWith('/requests')) return 'GroupRequests';
  if (pathname.startsWith('/group/')) return 'GroupDetail';
  if (pathname.startsWith('/club/')) return 'ClubEdit';
  if (pathname.startsWith('/chat/')) return 'Chat';
  if (pathname.startsWith('/dm/')) return 'DirectMessage';
  if (pathname.startsWith('/user/')) return 'UserProfile';
  return pathname;
};

export function useAnalytics() {
  const location = useLocation();
  const prevScreen = useRef(null);
  const enterTime = useRef(null);

  // Track app open/close via visibility change
  useEffect(() => {
    const handleVisibility = () => {
      track(document.hidden ? 'app_close' : 'app_open');
    };
    document.addEventListener('visibilitychange', handleVisibility);
    track('app_open');
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Track screen views + durations on route change
  useEffect(() => {
    const screenName = getScreenName(location.pathname);
    const now = Date.now();

    if (prevScreen.current && enterTime.current) {
      track('screen_leave', prevScreen.current, now - enterTime.current);
    }

    track('screen_view', screenName);

    prevScreen.current = screenName;
    enterTime.current = now;
  }, [location.pathname]);
}
