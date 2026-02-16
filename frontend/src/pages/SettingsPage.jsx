import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import '../styles/home.css';

export const SettingsPage = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>Einstellungen</h1>
      </header>

      <div className="settings-content">
        <div className="settings-section">
          <h2>Account</h2>
          <div className="settings-item">
            <span>E-Mail</span>
            <span className="settings-value">{user?.email}</span>
          </div>
          <div className="settings-item clickable" onClick={() => alert('Passwort ändern - noch nicht implementiert')}>
            <span>Passwort ändern</span>
            <span>→</span>
          </div>
        </div>

        <div className="settings-section">
          <h2>Privacy</h2>
          <div className="settings-item">
            <span>Profil Sichtbarkeit</span>
            <span className="settings-value">Öffentlich</span>
          </div>
          <div className="settings-item">
            <span>Online Status anzeigen</span>
            <label className="toggle-switch">
              <input type="checkbox" defaultChecked />
              <span className="slider"></span>
            </label>
          </div>
        </div>

        <div className="settings-section">
          <h2>Benachrichtigungen</h2>
          <div className="settings-item">
            <span>Push Benachrichtigungen</span>
            <label className="toggle-switch">
              <input type="checkbox" defaultChecked />
              <span className="slider"></span>
            </label>
          </div>
          <div className="settings-item">
            <span>E-Mail Benachrichtigungen</span>
            <label className="toggle-switch">
              <input type="checkbox" defaultChecked />
              <span className="slider"></span>
            </label>
          </div>
        </div>

        <div className="settings-section danger">
          <button className="btn-danger" onClick={handleLogout}>
            Abmelden
          </button>
          <button className="btn-danger-outline" onClick={() => alert('Account löschen - noch nicht implementiert')}>
            Account löschen
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
