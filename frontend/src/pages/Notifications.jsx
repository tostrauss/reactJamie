import React, { useState, useEffect, useContext } from 'react';
import { api } from '../utils/api';
import { SocketContext } from '../context/SocketContext';
import '../styles/home.css';

export const Notifications = () => {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const socket = useContext(SocketContext);

  useEffect(() => {
    loadNotifications();
    if (socket) {
      socket.on('new_notification', (newNotif) => {
        setNotifs(prev => [newNotif, ...prev]);
      });
    }
    return () => socket?.off('new_notification');
  }, [socket]);

  const loadNotifications = async () => {
    try {
      const res = await api.get('/notifications');
      setNotifs(res.data);
      await api.post('/notifications/mark-read');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="home" style={{ paddingBottom: '100px' }}>
      <div className="home-header">
        <h1>Notifications 🔔</h1>
      </div>

      <div className="notifications-list">
        {notifs.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#666', marginTop: '50px' }}>No new notifications</p>
        ) : (
          notifs.map(n => (
            <div key={n.id} style={{
              background: n.is_read ? 'rgba(255,255,255,0.02)' : 'rgba(255,107,107,0.1)',
              padding: '15px',
              borderRadius: '12px',
              marginBottom: '10px',
              display: 'flex',
              gap: '15px',
              alignItems: 'center',
              borderLeft: n.is_read ? 'none' : '3px solid #ff6b6b'
            }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%',
                background: '#444', overflow: 'hidden'
              }}>
                {n.sender_avatar ? (
                  <img src={n.sender_avatar} alt="" style={{ width: '100%', height: '100%' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    📢
                  </div>
                )}
              </div>
              <div>
                <h4 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>{n.title}</h4>
                <p style={{ margin: 0, fontSize: '12px', color: '#bbb' }}>{n.message}</p>
                <span style={{ fontSize: '10px', color: '#666' }}>
                  {new Date(n.created_at).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};