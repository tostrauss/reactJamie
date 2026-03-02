import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { auth } from '../utils/api';
import { useToast } from '../context/ToastContext';
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

  // Notification prefs (local for now)
  const [notifMessages, setNotifMessages] = useState(true);
  const [notifRequests, setNotifRequests] = useState(true);
  const [notifGroups, setNotifGroups] = useState(true);

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
    <div className="settings-page page">
      {/* Header */}
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="settings-title">Einstellungen</h1>
      </div>

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
    </div>
  );
};

export default SettingsPage;
