import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { analytics } from '../utils/api';

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
      const event_type = document.hidden ? 'app_close' : 'app_open';
      analytics.trackEvent(event_type).catch(() => {});
    };
    document.addEventListener('visibilitychange', handleVisibility);
    // Log initial app_open
    analytics.trackEvent('app_open').catch(() => {});
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Track screen views + durations on route change
  useEffect(() => {
    const screenName = getScreenName(location.pathname);
    const now = Date.now();

    // Log leave event for previous screen with duration
    if (prevScreen.current && enterTime.current) {
      const duration_ms = now - enterTime.current;
      analytics.trackEvent('screen_leave', prevScreen.current, duration_ms).catch(() => {});
    }

    // Log view event for new screen
    analytics.trackEvent('screen_view', screenName).catch(() => {});

    prevScreen.current = screenName;
    enterTime.current = now;
  }, [location.pathname]);
}
