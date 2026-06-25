import { useState, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { JamieWordmark } from '../components/JamieWordmark';
import { PasswordInput } from '../components/PasswordInput';
import { isNativeIOS } from '../utils/platform';
import '../styles/auth.css';

// Read from env only. App.jsx skips wrapping in GoogleOAuthProvider when this
// is absent, so we must skip the button here too — otherwise useGoogleLogin
// throws when invoked outside the provider.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Apple Sign-In is intentionally removed for the iOS v1 build: the
// @capacitor-community/apple-sign-in plugin has no Capacitor 8 release — its
// capacitor-swift-pm pin (7.x) conflicts with the Cap 8 core plugins and
// breaks the Xcode archive. iOS v1 is email-only; native social logins return
// in a fast-follow update (e.g. via @capgo/capacitor-social-login). The web
// build never rendered an Apple button here (it was gated on isNativeIOS).

const GoogleLoginButton = ({ onError }) => {
  const { t } = useTranslation();
  const { loginWithGoogle } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        await loginWithGoogle(tokenResponse.access_token);
        navigate('/home');
      } catch {
        onError(t('auth.login.errorGoogle'));
      }
    },
    onError: () => onError(t('auth.login.errorGoogle')),
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
  const { t } = useTranslation();
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
      setError(err.response?.data?.error || t('auth.login.errorGeneric'));
    }
  };

  const handleGuestLogin = () => {
    loginAsGuest();
    navigate('/home');
  };


  return (
    <div className="auth-screen">
      {/* Top — logo + tagline */}
      <div className="auth-top">
        <JamieWordmark size="splash" />
        <p className="auth-tagline">
          {t('auth.tagline')}
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
              {t('auth.login.continueWithEmail')}
            </button>

            {/* iOS v1 = email-only. Google OAuth is also hidden on native iOS:
                Google blocks its OAuth flow inside embedded WebViews. */}
            {GOOGLE_CLIENT_ID && !isNativeIOS() && <GoogleLoginButton onError={setError} />}

            <div className="auth-divider"><span>{t('common.or')}</span></div>

            <button
              className="auth-btn auth-btn-ghost"
              onClick={handleGuestLogin}
            >
              {t('auth.login.demoMode')}
            </button>

            {/* Social-login failures set `error` but the only renderer used to
                live inside the email form — a failed Google/Apple sign-in gave
                zero feedback. Render it here too. */}
            {error && <p className="error-message">{error}</p>}
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
              {t('common.back')}
            </button>

            <div className="form-group">
              <label>{t('auth.login.emailLabel')}</label>
              <input
                type="email"
                placeholder={t('auth.login.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label>{t('auth.login.passwordLabel')}</label>
              <PasswordInput
                placeholder={t('auth.login.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && <p className="error-message">{error}</p>}

            <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
              {loading ? t('common.loading') : t('auth.login.signIn')}
            </button>

            <Link to="/forgot-password" className="forgot-link">
              {t('auth.login.forgotPassword')}
            </Link>
          </form>
        )}
      </div>

      {/* Bottom — register */}
      <div className="auth-bottom">
        <p>
          {t('auth.login.noAccount')}{' '}
          <Link to="/register" className="auth-link">
            {t('auth.login.signUp')}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
