import { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { auth, groups as groupsApi, clubs as clubsApi } from '../utils/api';
import { useToast } from '../context/ToastContext';
import {
  isPushSupported,
  getPushPermission,
  isPushSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
} from '../utils/pushNotifications';
import '../styles/profile.css';

export const SettingsPage = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();

  // Password change
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Notification prefs — persisted to localStorage
  const [notifMessages, setNotifMessages] = useState(() => localStorage.getItem('notif_messages') !== 'false');
  const [notifRequests, setNotifRequests] = useState(() => localStorage.getItem('notif_requests') !== 'false');
  const [notifGroups, setNotifGroups] = useState(() => localStorage.getItem('notif_groups') !== 'false');

  useEffect(() => { localStorage.setItem('notif_messages', notifMessages); }, [notifMessages]);
  useEffect(() => { localStorage.setItem('notif_requests', notifRequests); }, [notifRequests]);
  useEffect(() => { localStorage.setItem('notif_groups', notifGroups); }, [notifGroups]);

  // Favorites
  const [favTab, setFavTab] = useState('groups');
  const [favGroups, setFavGroups] = useState([]);
  const [favClubs, setFavClubs] = useState([]);
  const [favLoading, setFavLoading] = useState(true);

  useEffect(() => {
    Promise.all([groupsApi.getFavorites(), clubsApi.getFavorites()])
      .then(([gRes, cRes]) => {
        setFavGroups(gRes.data || []);
        setFavClubs(cRes.data || []);
      })
      .catch(() => {})
      .finally(() => setFavLoading(false));
  }, []);

  // Push notification subscription state
  const [pushSupported] = useState(() => isPushSupported());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    if (!pushSupported) return;
    isPushSubscribed().then(setPushEnabled);
  }, [pushSupported]);

  const handlePushToggle = async () => {
    if (getPushPermission() === 'denied') {
      toast.error('Benachrichtigungen sind im Browser blockiert. Bitte in den Browser-Einstellungen freigeben.');
      return;
    }
    setPushLoading(true);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        setPushEnabled(false);
        toast.success('Push-Benachrichtigungen deaktiviert');
      } else {
        const ok = await subscribeToPush();
        setPushEnabled(ok);
        if (ok) toast.success('Push-Benachrichtigungen aktiviert!');
        else toast.error('Berechtigung verweigert oder Fehler beim Aktivieren');
      }
    } finally {
      setPushLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error('Neues Passwort muss mindestens 6 Zeichen haben');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passw\u00f6rter stimmen nicht \u00fcberein');
      return;
    }

    setPasswordLoading(true);
    try {
      await auth.changePassword(currentPassword, newPassword);
      toast.success('Passwort erfolgreich ge\u00e4ndert!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setShowPasswordForm(false), 1500);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler beim \u00c4ndern');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    if (!deletePassword) {
      toast.error('Passwort erforderlich');
      return;
    }

    setDeleteLoading(true);
    try {
      await auth.deleteAccount(deletePassword);
      logout();
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler beim L\u00f6schen');
    } finally {
      setDeleteLoading(false);
    }
  };

  const chevron = (
    <svg className="settings-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6"/>
    </svg>
  );

  return (
    <div className="settings-page">
      {/* Sticky Header */}
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate(-1)} aria-label="Zurück">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="settings-title">Einstellungen</h1>
      </div>

      <div className="settings-body">
      {/* User Card */}
      <div className="settings-user-card" onClick={() => navigate('/profile')}>
        <div className="settings-user-avatar">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.name} />
          ) : (
            <span>{(user?.name || '?')[0].toUpperCase()}</span>
          )}
        </div>
        <div className="settings-user-info">
          <div className="settings-user-name">{user?.name || 'Nutzer'}</div>
          <div className="settings-user-email">{user?.email || ''}</div>
        </div>
        {chevron}
      </div>

      {/* Konto */}
      <div className="settings-section">
        <h3 className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          Konto
        </h3>

        <div className="settings-row" onClick={() => navigate('/profile/edit')}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <span>Profil bearbeiten</span>
          </div>
          {chevron}
        </div>

        {!showPasswordForm ? (
          <div className="settings-row" onClick={() => setShowPasswordForm(true)}>
            <div className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span>Passwort ändern</span>
            </div>
            {chevron}
          </div>
        ) : (
          <div className="settings-expand">
            <form onSubmit={handleChangePassword} className="settings-form">
              <input type="password" placeholder="Aktuelles Passwort" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="settings-input" />
              <input type="password" placeholder="Neues Passwort (min. 6 Zeichen)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="settings-input" />
              <input type="password" placeholder="Neues Passwort best\u00e4tigen" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="settings-input" />
              <div className="settings-form-actions">
                <button type="submit" className="settings-action-btn primary" disabled={passwordLoading}>
                  {passwordLoading ? 'Laden...' : 'Speichern'}
                </button>
                <button type="button" className="settings-action-btn" onClick={() => { setShowPasswordForm(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}>
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="settings-row static">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="M22 7l-10 7L2 7"/>
            </svg>
            <div className="settings-row-stacked">
              <span>E-Mail</span>
              <span className="settings-row-detail">{user?.email || 'keine E-Mail'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Favoriten */}
      <div className="settings-section">
        <h3 className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          Favoriten
        </h3>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, margin: '4px 16px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 3 }}>
          {['groups', 'clubs'].map(tab => (
            <button
              key={tab}
              onClick={() => setFavTab(tab)}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
                background: favTab === tab ? 'rgba(253,118,102,0.18)' : 'transparent',
                color: favTab === tab ? '#FD7666' : 'rgba(255,255,255,0.45)',
                transition: 'all 0.15s',
              }}
            >
              {tab === 'groups' ? 'Gruppen' : 'Clubs'}
            </button>
          ))}
        </div>

        {favLoading ? (
          <div style={{ padding: '16px 20px', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Laden...</div>
        ) : (() => {
          const list = favTab === 'groups' ? favGroups : favClubs;
          const path = favTab === 'groups' ? '/group/' : '/group/';
          if (!list.length) {
            return (
              <div style={{ padding: '16px 20px', color: 'rgba(255,255,255,0.3)', fontSize: 14, textAlign: 'center' }}>
                {favTab === 'groups' ? 'Keine Gruppen-Favoriten' : 'Keine Club-Favoriten'}
              </div>
            );
          }
          return list.map(item => (
            <div
              key={item.id}
              className="settings-row"
              onClick={() => navigate(`${path}${item.id}`)}
            >
              <div className="settings-row-left" style={{ gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  overflow: 'hidden', background: '#2a2e4a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {item.image_url
                    ? <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 18 }}>⭐</span>
                  }
                </div>
                <div className="settings-row-stacked">
                  <span>{item.name}</span>
                  {item.location && <span className="settings-row-detail">{item.location}</span>}
                </div>
              </div>
              {chevron}
            </div>
          ));
        })()}
      </div>

      {/* Benachrichtigungen */}
      <div className="settings-section">
        <h3 className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          Benachrichtigungen
        </h3>

        <div className="settings-row">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span>Neue Nachrichten</span>
          </div>
          <label className="settings-toggle">
            <input type="checkbox" checked={notifMessages} onChange={() => setNotifMessages(!notifMessages)} />
            <span className="settings-toggle-slider" />
          </label>
        </div>

        <div className="settings-row">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="8.5" cy="7" r="4"/>
              <line x1="20" y1="8" x2="20" y2="14"/>
              <line x1="23" y1="11" x2="17" y2="11"/>
            </svg>
            <span>Freundschaftsanfragen</span>
          </div>
          <label className="settings-toggle">
            <input type="checkbox" checked={notifRequests} onChange={() => setNotifRequests(!notifRequests)} />
            <span className="settings-toggle-slider" />
          </label>
        </div>

        <div className="settings-row">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span>Gruppenaktivitäten</span>
          </div>
          <label className="settings-toggle">
            <input type="checkbox" checked={notifGroups} onChange={() => setNotifGroups(!notifGroups)} />
            <span className="settings-toggle-slider" />
          </label>
        </div>

        {pushSupported && (
          <div className="settings-row">
            <div className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                <line x1="12" y1="2" x2="12" y2="4"/>
              </svg>
              <div className="settings-row-stacked">
                <span>Push-Benachrichtigungen</span>
                <span className="settings-row-detail">Benachrichtigungen auch wenn App geschlossen</span>
              </div>
            </div>
            <label className="settings-toggle" style={{ opacity: pushLoading ? 0.5 : 1 }}>
              <input type="checkbox" checked={pushEnabled} onChange={handlePushToggle} disabled={pushLoading} />
              <span className="settings-toggle-slider" />
            </label>
          </div>
        )}
      </div>

      {/* App */}
      <div className="settings-section">
        <h3 className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09c-.658.003-1.25.396-1.51 1z"/>
          </svg>
          App
        </h3>

        <div className="settings-row static">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            <div className="settings-row-stacked">
              <span>Design</span>
              <span className="settings-row-detail">Dunkel</span>
            </div>
          </div>
        </div>

        <div className="settings-row static">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <div className="settings-row-stacked">
              <span>Sprache</span>
              <span className="settings-row-detail">Deutsch</span>
            </div>
          </div>
        </div>

        <div className="settings-row static">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <div className="settings-row-stacked">
              <span>Version</span>
              <span className="settings-row-detail">1.0.0</span>
            </div>
          </div>
        </div>
      </div>

      {/* Logout - separate from danger zone */}
      <button className="settings-logout-btn" onClick={handleLogout}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Ausloggen
      </button>

      {/* Gefahrenzone */}
      <div className="settings-section danger-section">
        <h3 className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Gefahrenzone
        </h3>

        {!showDeleteConfirm ? (
          <button className="danger-btn" onClick={() => setShowDeleteConfirm(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Account löschen
          </button>
        ) : (
          <div className="settings-expand">
            <p className="delete-warning">
              Diese Aktion kann nicht r\u00fcckg\u00e4ngig gemacht werden. Alle deine Daten, Gruppen und Nachrichten werden unwiderruflich gel\u00f6scht.
            </p>
            <form onSubmit={handleDeleteAccount} className="settings-form">
              <input type="password" placeholder="Passwort zur Best\u00e4tigung" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} className="settings-input" />
              <div className="settings-form-actions">
                <button type="submit" className="danger-btn" disabled={deleteLoading}>
                  {deleteLoading ? 'Laden...' : 'Endg\u00fcltig l\u00f6schen'}
                </button>
                <button type="button" className="settings-action-btn" onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); }}>
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
      </div>{/* settings-body */}
    </div>
  );
};

export default SettingsPage;
