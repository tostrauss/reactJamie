import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { notifications } from '../utils/api';
import { useToast } from '../context/ToastContext';
import useOnPullRefresh from '../hooks/useOnPullRefresh';
import { NOTIFICATIONS_READ_EVENT, notificationTarget } from '../utils/notifications';

const typeIcon = (type) => {
  if (type === 'news') return '📣';
  if (type === 'hof_like') return '❤️';
  if (type === 'join_request') return '👋';
  if (type === 'request_accepted') return '✅';
  return '📢';
};

// What a row says. Rows are stored with a German title/message (the push is
// what gets localised per recipient), so types whose sentence can be rebuilt
// from data render through i18n; everything else shows what was stored —
// including JAMIE news, which is the admins' own words. `strong` = the bold
// headline of a news post.
function rowText(n, t) {
  if (n.type === 'hof_like' && n.reference_name) {
    const name = n.sender?.name;
    return {
      title: name
        ? t('notifications.hofLike.text', { name, event: n.reference_name })
        : t('notifications.hofLike.textAnonymous', { event: n.reference_name }),
      message: null,
    };
  }
  return { title: n.title, message: n.message, strong: n.type === 'news' };
}

export const Notifications = () => {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it-IT' : ((i18n.resolvedLanguage || i18n.language || 'de').startsWith('fr') ? 'fr-FR' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('es') ? 'es-ES' : 'de-AT');

  useEffect(() => {
    loadNotifications();
  }, []);

  // Pull-to-refresh: re-fetch the notification list.
  useOnPullRefresh(() => loadNotifications());

  const loadNotifications = async () => {
    let rows;
    try {
      const res = await notifications.getAll();
      rows = Array.isArray(res.data) ? res.data : [];
      setNotifs(rows);
    } catch {
      toast.error(t('notifications.loadError'));
      setLoading(false);
      return;
    }
    setLoading(false);
    // Opening the list reads it. Only up to the newest row it SHOWS, so one
    // that arrives meanwhile still lights the bell. Its own catch: a failed
    // mark-read is not a failed load, the list is on screen.
    try {
      const newest = rows.reduce((max, n) => Math.max(max, Number(n.id) || 0), 0);
      await notifications.markRead(newest || undefined);
      window.dispatchEvent(new CustomEvent(NOTIFICATIONS_READ_EVENT));
    } catch { /* the badge stays until the next visit — harmless */ }
  };

  // Usually reached from the bell on Home; a push can also open this page as
  // the first screen (no history entry to go back to) — then go Home.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/home'));

  const header = (
    <div className="notif-header">
      <button type="button" className="notif-back" onClick={goBack} aria-label={t('common.back')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <h1 className="notif-title">{t('notifications.title')}</h1>
    </div>
  );

  if (loading) {
    return (
      <div className="notif-page">
        {header}
        <div className="notif-scroll">
          <div className="notif-loading"><div className="home-spinner" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="notif-page">
      {header}
      <div className="notif-scroll">
        {notifs.length === 0 ? (
          <div className="notif-empty">
            <div className="notif-empty-icon" aria-hidden="true">🔕</div>
            <h2 className="notif-empty-title">{t('notifications.emptyTitle')}</h2>
            <p className="notif-empty-sub">{t('notifications.emptySub')}</p>
          </div>
        ) : (
          <ul className="notif-list">
            {notifs.map(n => {
              const target = notificationTarget(n);
              const { title, message, strong } = rowText(n, t);
              // Spans, not h4/p: a <button> may only contain phrasing content.
              const body = (
                <>
                  <span className="notif-icon" aria-hidden="true">{typeIcon(n.type)}</span>
                  <span className="notif-content">
                    {title && (
                      <span className={`notif-item-title${strong ? ' notif-item-title--news' : ''}`}>{title}</span>
                    )}
                    {message && (
                      <span className={`notif-item-msg${strong ? ' notif-item-msg--news' : ''}`}>{message}</span>
                    )}
                    <time className="notif-item-time" dateTime={n.created_at}>
                      {new Date(n.created_at).toLocaleString(dateLocale, {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </time>
                  </span>
                  {target && (
                    <svg className="notif-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  )}
                </>
              );
              const className = `notif-item${n.is_read ? '' : ' notif-item--unread'}${target ? ' notif-item--link' : ''}`;
              return (
                <li key={n.id}>
                  {target ? (
                    <button type="button" className={className} onClick={() => navigate(target)}>
                      {body}
                    </button>
                  ) : (
                    <div className={className}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Notifications;
