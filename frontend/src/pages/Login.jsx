import React, { useState, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import '../styles/auth.css';

export const Login = () => {
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, loading, loginAsGuest } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/home');
    } catch (err) {
      setError(err.response?.data?.error || 'Login fehlgeschlagen');
    }
  };

  const handleGuestLogin = () => {
    loginAsGuest();
    navigate('/home');
  };

  const handleSocialLogin = (provider) => {
    // Social login not yet implemented — show info, do NOT fall back to guest
    alert(`${provider} Login kommt bald! Bitte nutze E-Mail Login.`);
  };

  return (
    <div className="auth-container">
      <div className="auth-content">
        <div className="auth-logo">
          <h1 className="logo-text">JAMIE</h1>
        </div>
        <p className="auth-subtitle">
          Login ist nervig, aber wir versuchen es so kurz wie möglich zu halten. Bussis
        </p>

        {!showEmailForm ? (
          <div className="auth-options">
            <button 
              className="auth-btn auth-btn-primary"
              onClick={() => setShowEmailForm(true)}
            >
              <span className="auth-btn-icon">✉️</span>
              Mit E-Mail fortfahren
            </button>

            <button 
              className="auth-btn auth-btn-apple"
              onClick={() => handleSocialLogin('Apple')}
            >
              <span className="auth-btn-icon"></span>
              Mit Apple fortfahren
            </button>

            <button 
              className="auth-btn auth-btn-google"
              onClick={() => handleSocialLogin('Google')}
            >
              <span className="auth-btn-icon">G</span>
              Mit Google fortfahren
            </button>
            <button 
              className="auth-btn auth-btn-dev"
              onClick={handleGuestLogin}
            >
              🚀 Demo-Modus (Ohne Login)
            </button>
          </div>
        ) : (
          <form onSubmit={handleEmailLogin} className="auth-form">
            <button
              type="button"
              className="auth-back-btn"
              onClick={() => setShowEmailForm(false)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Zurück
            </button>

            <div className="form-group">
              <label>E-Mail</label>
              <input
                type="email"
                placeholder="deine@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label>Passwort</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && <p className="error-message">{error}</p>}

            <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
              {loading ? 'Laden...' : 'Einloggen'}
            </button>

            <Link to="/forgot-password" className="forgot-link">
              Passwort vergessen?
            </Link>
          </form>
        )}

        {/* Footer */}
        <div className="auth-footer">
          <p>
            Noch kein Konto?{' '}
            <Link to="/register" className="auth-link">
              Jetzt registrieren
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;