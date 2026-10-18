import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { notifications as notificationsApi } from '../utils/api';
import { SocketContext } from '../context/SocketContext';
import { NOTIFICATIONS_READ_EVENT, badgeLabel } from '../utils/notifications';

/**
 * The bell top right on Home (Robert / Lea, 18.10.2026). Unread count:
 *   - fetched on mount, whenever the app returns to the foreground, and once
 *     the list has marked everything read (NOTIFICATIONS_READ_EVENT)
 *   - +1 per `new_notification` socket event, counted HERE, never re-fetched:
 *     a "News an alle" reaches every open app in the same second, and a
 *     re-fetch per event would turn one admin click into a request storm
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // No destructuring: outside a SocketProvider (tests, a logged-out flash)
  // the context is undefined.
  const socketCtx = useContext(SocketContext);
  const socket = socketCtx ? socketCtx.socket : null;
  const [count, setCount] = useState(0);
  // Last-write-wins: a slow mount fetch must not overwrite the answer of a
  // newer one (e.g. the one the read event triggered).
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const res = await notificationsApi.getUnreadCount();
      const n = Number(res?.data?.count);
      if (seq === seqRef.current && Number.isFinite(n) && n >= 0) setCount(n);
    } catch {
      // Network blip / old server: keep what the badge shows. Zeroing it would
      // hide real unread news; a wrong number corrects itself on the next fetch.
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(NOTIFICATIONS_READ_EVENT, refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!socket) return undefined;
    // The payload (a notifications row) is not needed — every event in the
    // user's own room is one more unread notification.
    const onNew = () => setCount((c) => c + 1);
    socket.on('new_notification', onNew);
    return () => socket.off('new_notification', onNew);
  }, [socket]);

  const label = count > 0
    ? t('notifications.bell.labelUnread', { n: badgeLabel(count) })
    : t('notifications.bell.label');

  return (
    <button
      type="button"
      className="home-bell"
      onClick={() => navigate('/notifications')}
      aria-label={label}
      title={t('notifications.bell.label')}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {count > 0 && (
        <span className="home-bell-badge" aria-hidden="true">{badgeLabel(count)}</span>
      )}
    </button>
  );
}

export default NotificationBell;
