import React, { useState, useEffect } from 'react';
import { notifications } from '../utils/api';

export const Notifications = () => {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

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
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="page" style={{ paddingBottom: '100px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '24px' }}>
        Benachrichtigungen 🔔
      </h1>

      {notifs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🔕</div>
          <h2>Keine Benachrichtigungen</h2>
          <p style={{ color: 'var(--text-muted)' }}>Du bist auf dem neuesten Stand!</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {notifs.map(n => (
            <div key={n.id} style={{
              background: n.is_read ? 'var(--bg-card)' : 'rgba(255,107,107,0.1)',
              padding: '16px',
              borderRadius: '12px',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              borderLeft: n.is_read ? 'none' : '3px solid var(--accent-coral)'
            }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px'
              }}>
                {n.type === 'join_request' ? '👋' : n.type === 'request_accepted' ? '✅' : '📢'}
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>{n.title}</h4>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>{n.message}</p>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {new Date(n.created_at).toLocaleString('de-AT')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
export default Notifications;