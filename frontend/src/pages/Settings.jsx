import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import '../styles/home.css';

export const Settings = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="settings-page page">
      {/* Header */}
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate(-1)}>
          ←
        </button>
        <h1 className="settings-title">Einstellungen</h1>
      </div>

      {/* Account Section */}
      <div className="settings-section">
        <h3>Konto</h3>
        <div className="settings-item">
          <label>E-Mail</label>
          <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            {user?.email || 'demo@jamie.app'}
          </span>
        </div>
        <button className="btn btn-secondary" style={{ width: '100%', marginTop: '12px' }}>
          Passwort ändern
        </button>
      </div>

      {/* Notifications Section */}
      <div className="settings-section">
        <h3>Benachrichtigungen</h3>
        <div className="settings-item">
          <label>Push Benachrichtigungen</label>
          <input type="checkbox" defaultChecked />
        </div>
        <div className="settings-item">
          <label>Chat Nachrichten</label>
          <input type="checkbox" defaultChecked />
        </div>
        <div className="settings-item">
          <label>Gruppen Aktivitäten</label>
          <input type="checkbox" defaultChecked />
        </div>
        <div className="settings-item">
          <label>Neue Mitglieder Anfragen</label>
          <input type="checkbox" defaultChecked />
        </div>
      </div>

      {/* Privacy Section */}
      <div className="settings-section">
        <h3>Privatsphäre</h3>
        <div className="settings-item">
          <label>Profil öffentlich</label>
          <input type="checkbox" defaultChecked />
        </div>
        <div className="settings-item">
          <label>Online Status anzeigen</label>
          <input type="checkbox" defaultChecked />
        </div>
        <div className="settings-item">
          <label>Standort teilen</label>
          <input type="checkbox" />
        </div>
      </div>

      {/* App Section */}
      <div className="settings-section">
        <h3>App</h3>
        <div className="settings-item">
          <label>Dunkelmodus</label>
          <input type="checkbox" defaultChecked disabled />
        </div>
        <div className="settings-item">
          <label>Sprache</label>
          <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Deutsch</span>
        </div>
        <div className="settings-item">
          <label>App-Version</label>
          <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>1.0.0</span>
        </div>
      </div>

      {/* Support Section */}
      <div className="settings-section">
        <h3>Hilfe</h3>
        <button className="btn btn-secondary" style={{ width: '100%', marginBottom: '8px' }}>
          Hilfe & FAQ
        </button>
        <button className="btn btn-secondary" style={{ width: '100%', marginBottom: '8px' }}>
          Feedback senden
        </button>
        <button className="btn btn-secondary" style={{ width: '100%' }}>
          Datenschutzrichtlinie
        </button>
      </div>

      {/* Danger Zone */}
      <div className="settings-section danger-section">
        <h3>Gefahrenzone</h3>
        <button className="danger-btn" onClick={handleLogout}>
          Ausloggen
        </button>
        <button className="danger-btn" style={{ marginTop: '8px' }}>
          Account löschen
        </button>
      </div>
    </div>
  );
};

export default Settings;