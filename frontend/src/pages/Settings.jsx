import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

export const Settings = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  return (
    <div className="page" style={{ paddingBottom: '100px' }}>
      <button 
        onClick={() => navigate(-1)} 
        style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', marginBottom: '16px', cursor: 'pointer' }}
      >
        ← Zurück
      </button>
      
      <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '24px' }}>
        Einstellungen ⚙️
      </h1>

      {/* Account Section */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px', marginBottom: '16px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '16px' }}>Account</h3>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ color: 'var(--text-muted)', fontSize: '12px' }}>E-Mail</label>
          <p style={{ fontSize: '15px' }}>{user?.email || 'guest@example.com'}</p>
        </div>
        <button className="btn btn-secondary" style={{ width: '100%' }}>
          Passwort ändern
        </button>
      </div>

      {/* App Settings */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px', marginBottom: '16px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '16px' }}>App</h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span>Push Benachrichtigungen</span>
          <input type="checkbox" defaultChecked style={{ accentColor: 'var(--accent-coral)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Dark Mode</span>
          <input type="checkbox" defaultChecked disabled style={{ accentColor: 'var(--accent-coral)' }} />
        </div>
      </div>

      {/* Danger Zone */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '16px', color: 'var(--status-busy)' }}>Gefahrenzone</h3>
        <button 
          onClick={logout} 
          className="btn btn-secondary" 
          style={{ width: '100%', marginBottom: '12px', borderColor: 'var(--accent-coral)', color: 'var(--accent-coral)' }}
        >
          Ausloggen
        </button>
        <button 
          className="btn btn-secondary" 
          style={{ width: '100%', borderColor: 'var(--status-busy)', color: 'var(--status-busy)' }}
        >
          Account löschen
        </button>
      </div>
    </div>
  );
};
export default Settings;