import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { notifications } from '../utils/api';
import { useToast } from '../context/ToastContext';
import useOnPullRefresh from '../hooks/useOnPullRefresh';

const typeIcon = (type) => {
  if (type === 'join_request') return '👋';
  if (type === 'request_accepted') return '✅';
  return '📢';
};

export const Notifications = () => {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it-IT' : 'de-AT';

  useEffect(() => {
    loadNotifications();
  }, []);

  // Pull-to-refresh: re-fetch the notification list.
  useOnPullRefresh(() => loadNotifications());

  const loadNotifications = async () => {
    try {
      const res = await notifications.getAll();
      setNotifs(res.data || []);
      await notifications.markRead();
    } catch (err) {
      toast.error(t('notifications.loadError'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="notif-page">
        <div className="notif-header">
          <h1 className="notif-title">{t('notifications.title')}</h1>
        </div>
        <div className="notif-scroll">
          <div className="notif-loading"><div className="home-spinner" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="notif-page">
      <div className="notif-header">
        <h1 className="notif-title">{t('notifications.title')}</h1>
      </div>
      <div className="notif-scroll">
        {notifs.length === 0 ? (
          <div className="notif-empty">
            <div className="notif-empty-icon">🔕</div>
            <h2 className="notif-empty-title">{t('notifications.emptyTitle')}</h2>
            <p className="notif-empty-sub">{t('notifications.emptySub')}</p>
          </div>
        ) : (
          <div className="notif-list">
            {notifs.map(n => (
              <div key={n.id} className={`notif-item${n.is_read ? '' : ' notif-item--unread'}`}>
                <div className="notif-icon">{typeIcon(n.type)}</div>
                <div className="notif-content">
                  <h4 className="notif-item-title">{n.title}</h4>
                  <p className="notif-item-msg">{n.message}</p>
                  <span className="notif-item-time">
                    {new Date(n.created_at).toLocaleString(dateLocale)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Notifications;
