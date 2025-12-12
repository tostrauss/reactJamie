import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import '../styles/auth.css';

export const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, loading, loginAsGuest} = useContext(AuthContext);
  
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(email, password);
      navigate('/home');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    }
  };

  const handleGuestLogin = () => {
    loginAsGuest();
    navigate('/home');
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1 className="logo">JAMIE</h1>
        <p className="subtitle">Meet people. Share activities. Moin</p>
        
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <button 
          type="button" 
          onClick={handleGuestLogin}
          className="btn-secondary"
          style={{ 
            marginTop: '15px', 
            width: '100%', 
            fontSize: '13px',
            opacity: 0.8
          }}
        >
          Continue without login (Dev)
        </button>

        <p className="toggle-auth">
          No account? <a href="/register">Register here</a>
        </p>
      </div>
    </div>
  );
};
