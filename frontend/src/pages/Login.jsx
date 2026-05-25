import React, { useState, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { AuthContext } from '../context/AuthContext';
import '../styles/auth.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const GoogleLoginButton = ({ onError }) => {
  const { loginWithGoogle } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        await loginWithGoogle(tokenResponse.access_token);
        navigate('/home');
      } catch {
        onError('Google Login fehlgeschlagen');
      }
    },
    onError: () => onError('Google Login fehlgeschlagen'),
  });

  return (
    <button
      className="auth-btn auth-btn-secondary"
      onClick={() => handleGoogleLogin()}
    >
      <svg className="auth-btn-icon" width="20" height="20" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Google
    </button>
  );
};

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
    setError(`${provider}-Login ist in Kürze verfügbar. Bitte nutze E-Mail-Login.`);
  };


  return (
    <div className="auth-screen">
      {/* Top — logo + tagline */}
      <div className="auth-top">
        <h1 className="auth-wordmark">JAMIE</h1>
        <p className="auth-tagline">
          Finde Leute für Aktivitäten in deiner Nähe.
        </p>
      </div>

      {/* Middle — action buttons or form */}
      <div className="auth-mid">
        {!showEmailForm ? (
          <div className="auth-options">
            <button
              className="auth-btn auth-btn-primary"
              onClick={() => setShowEmailForm(true)}
            >
              <svg className="auth-btn-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="3"/>
                <path d="m22 7-10 7L2 7"/>
              </svg>
              Mit E-Mail fortfahren
            </button>

            <button
              className="auth-btn auth-btn-secondary"
              disabled
              style={{ opacity: 0.4, cursor: 'not-allowed' }}
              title="Demnächst verfügbar"
            >
              <svg className="auth-btn-icon" width="17" height="20" viewBox="0 0 814 1000" fill="currentColor">
                <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.5-155.5-127.4C46 790.7 0 663 0 541.8c0-207.9 135.5-317.9 269-317.9 70.9 0 130 46.4 174.4 46.4 42.7 0 109.2-49 192.5-49 33.5.2 124.6 4.8 185 57zM549.8 0c1 0 2.1 0 3.1.1v.1c0 30.1-11.2 67.1-33.5 97.5-23.8 33.1-62.5 57.2-104.8 53.8-1.2-3.4-1.8-7.1-1.8-10.8 0-28.7 12.4-60.7 34.2-89.5C468.5 20.9 511 0 549.8 0z"/>
              </svg>
              Apple <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>(Demnächst)</span>
            </button>

            {GOOGLE_CLIENT_ID && <GoogleLoginButton onError={setError} />}

            <div className="auth-divider"><span>oder</span></div>

            <button
              className="auth-btn auth-btn-ghost"
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
              onClick={() => { setShowEmailForm(false); setError(''); }}
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
      </div>

      {/* Bottom — register */}
      <div className="auth-bottom">
        <p>
          Noch kein Konto?{' '}
          <Link to="/register" className="auth-link">
            Jetzt registrieren
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
