import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { analytics } from '../utils/api';
import { CONSENT_KEY } from '../components/ConsentBanner';

const hasConsent = () => localStorage.getItem(CONSENT_KEY) === 'true';
const track = (type, screen, duration, subjectId) => {
  if (!hasConsent()) return;
  analytics.trackEvent(type, screen, duration, undefined, subjectId).catch(() => {});
};

// Maps route patterns to human-readable screen names + optional subject id
// (the entity the screen is "about" — e.g. the club id under /club/:id).
// The subject id powers the Top Clubs / Top Groups views on the admin
// dashboard: aggregating screen_view rows by subject_id gives per-club
// popularity, not just total ClubDetail views in aggregate.
const ID_RE = /^\d+$/;
const segment = (pathname, idx) => pathname.split('/')[idx];
const numericSegment = (pathname, idx) => {
  const s = segment(pathname, idx);
  return s && ID_RE.test(s) ? Number(s) : null;
};

const resolveScreen = (pathname) => {
  if (pathname === '/home') return { name: 'Home' };
  if (pathname === '/favorites') return { name: 'Favorites' };
  if (pathname === '/profile') return { name: 'Profile' };
  if (pathname === '/profile/edit') return { name: 'ProfileEdit' };
  if (pathname === '/settings') return { name: 'Settings' };
  if (pathname === '/chats') return { name: 'ChatList' };
  if (pathname === '/notifications') return { name: 'Notifications' };
  if (pathname === '/create-group') return { name: 'CreateGroup' };
  if (pathname === '/create-club') return { name: 'CreateClub' };
  if (pathname === '/onboarding') return { name: 'Onboarding' };
  if (pathname === '/privacy') return { name: 'Privacy' };
  if (pathname.startsWith('/group/') && pathname.endsWith('/requests')) return { name: 'GroupRequests', subjectId: numericSegment(pathname, 2) };
  if (pathname.startsWith('/group/') && pathname.endsWith('/members')) return { name: 'GroupMembers', subjectId: numericSegment(pathname, 2) };
  if (pathname.startsWith('/group/')) return { name: 'GroupDetail', subjectId: numericSegment(pathname, 2) };
  if (pathname.startsWith('/club/') && pathname.endsWith('/edit')) return { name: 'ClubEdit', subjectId: numericSegment(pathname, 2) };
  if (pathname.startsWith('/club/') && pathname.endsWith('/members')) return { name: 'ClubMembers', subjectId: numericSegment(pathname, 2) };
  if (pathname.startsWith('/club/')) return { name: 'ClubDetail', subjectId: numericSegment(pathname, 2) };
  if (pathname.startsWith('/chat/')) return { name: 'Chat', subjectId: numericSegment(pathname, 2) };
  if (pathname.startsWith('/dm/')) return { name: 'DirectMessage', subjectId: numericSegment(pathname, 2) };
  if (pathname.startsWith('/user/')) return { name: 'UserProfile', subjectId: numericSegment(pathname, 2) };
  return { name: pathname };
};

export function useAnalytics() {
  const location = useLocation();
  const prevScreen = useRef(null);
  const prevSubject = useRef(null);
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
    const { name: screenName, subjectId } = resolveScreen(location.pathname);
    const now = Date.now();

    if (prevScreen.current && enterTime.current) {
      track('screen_leave', prevScreen.current, now - enterTime.current, prevSubject.current);
    }

    track('screen_view', screenName, undefined, subjectId);

    prevScreen.current = screenName;
    prevSubject.current = subjectId ?? null;
    enterTime.current = now;
  }, [location.pathname]);
}
