import React, { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import '../styles/home.css';

export const Settings = () => {
  const { logout, user } = useContext(AuthContext);
  const navigate = useNavigate();

  return (
    <div className="home" style={{ paddingBottom: '100px' }}>
      <div className="home-header">
        <button onClick={() => navigate(-1)} className="back-btn" style={{ fontSize: '20px', marginBottom: '10px' }}>← Back</button>
        <h1>Settings ⚙️</h1>
      </div>

      <div className="card-content" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '15px', padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '15px' }}>Account</h3>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ color: '#999', fontSize: '12px' }}>Email</label>
          <p>{user?.email}</p>
        </div>
        <button className="btn-secondary" style={{ width: '100%' }}>Change Password</button>
      </div>

      <div className="card-content" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '15px', padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '15px' }}>App Settings</h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <span>Push Notifications</span>
          <input type="checkbox" defaultChecked />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Dark Mode</span>
          <input type="checkbox" defaultChecked disabled />
        </div>
      </div>

      <div className="card-content" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '15px', padding: '20px' }}>
        <h3 style={{ marginBottom: '15px', color: '#ff6b6b' }}>Danger Zone</h3>
        <button 
          onClick={logout} 
          className="btn-secondary" 
          style={{ width: '100%', marginBottom: '10px', borderColor: '#ff6b6b', color: '#ff6b6b' }}
        >
          Log Out
        </button>
        <button 
          className="btn-secondary" 
          style={{ width: '100%', borderColor: 'red', color: 'red', background: 'rgba(255,0,0,0.1)' }}
        >
          Delete Account
        </button>
      </div>
    </div>
  );
};