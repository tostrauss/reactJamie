import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../utils/api';
import { JamieWordmark } from '../components/JamieWordmark';
import '../styles/auth.css';

const ResetPassword = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Full client-side policy check (mirrors the backend) — without it, every
  // policy violation round-trips to /auth/reset-password, which sits behind the
  // 5/hour strict limiter shared with /forgot-password. A few retries used to
  // 429-lock the user out before the 1h reset token even expired.
  const validatePassword = (pwd) => {
    if (pwd.length < 6)            return t('auth.reset.errorMin');
    if (!/[A-Z]/.test(pwd))        return t('auth.register.validation.passwordUpper');
    if (!/[a-z]/.test(pwd))        return t('auth.register.validation.passwordLower');
    if (!/[0-9]/.test(pwd))        return t('auth.register.validation.passwordDigit');
    if (!/[^A-Za-z0-9]/.test(pwd)) return t('auth.register.validation.passwordSpecial');
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const pwdError = validatePassword(password);
    if (pwdError) return setError(pwdError);
    if (password !== confirmPassword) {
      return setError(t('auth.reset.errorMismatch'));
    }

    setLoading(true);
    try {
      await auth.resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || t('auth.reset.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-content" style={{ textAlign: 'center' }}>
          <div className="auth-logo">
            <JamieWordmark size="splash" />
          </div>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔗</div>
          <h2 style={{ marginBottom: '12px' }}>{t('auth.reset.invalidTitle')}</h2>
          <p style={{ color: 'var(--text-light)', marginBottom: '24px' }}>
            {t('auth.reset.invalidBody')}
          </p>
          <Link to="/forgot-password" className="auth-btn auth-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            {t('auth.reset.invalidCta')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-content">
        <div className="auth-logo">
          <JamieWordmark size="splash" />
        </div>

        {success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
            <h2 style={{ marginBottom: '12px' }}>{t('auth.reset.successTitle')}</h2>
            <p style={{ color: 'var(--text-light)', marginBottom: '24px' }}>
              {t('auth.reset.successBody')}
            </p>
            <Link to="/login" className="auth-btn auth-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              {t('auth.reset.successCta')}
            </Link>
          </div>
        ) : (
          <>
            <p className="auth-subtitle">
              {t('auth.reset.subtitle')}
            </p>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <label>{t('auth.reset.newPasswordLabel')}</label>
                <input
                  type="password"
                  placeholder={t('auth.shared.newPasswordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>{t('auth.reset.confirmLabel')}</label>
                <input
                  type="password"
                  placeholder={t('auth.shared.confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              {error && <p className="error-message">{error}</p>}

              <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
                {loading ? t('auth.reset.saving') : t('auth.reset.submit')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
