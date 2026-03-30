import { useState, useEffect } from 'react';
import { notifications } from '../utils/api';
import { useToast } from '../context/ToastContext';

const typeIcon = (type) => {
  if (type === 'join_request') return '👋';
  if (type === 'request_accepted') return '✅';
  return '📢';
};

export const Notifications = () => {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    try {
      const res = await notifications.getAll();
      setNotifs(res.data || []);
      await notifications.markRead();
    } catch (err) {
      console.error(err);
      toast.error('Benachrichtigungen konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="notif-page">
        <div className="notif-header">
          <h1 className="notif-title">Benachrichtigungen</h1>
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
        <h1 className="notif-title">Benachrichtigungen</h1>
      </div>
      <div className="notif-scroll">
        {notifs.length === 0 ? (
          <div className="notif-empty">
            <div className="notif-empty-icon">🔕</div>
            <h2 className="notif-empty-title">Keine Benachrichtigungen</h2>
            <p className="notif-empty-sub">Du bist auf dem neuesten Stand!</p>
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
                    {new Date(n.created_at).toLocaleString('de-AT')}
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
