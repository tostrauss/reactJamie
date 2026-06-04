import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../utils/api';
import '../styles/auth.css';

const ForgotPassword = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await auth.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || t('auth.forgot.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-content">
        <div className="auth-logo">
          <h1 className="logo-text">{t('auth.appName')}</h1>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📧</div>
            <h2 style={{ marginBottom: '12px' }}>{t('auth.forgot.sentTitle')}</h2>
            <p style={{ color: 'var(--text-light)', lineHeight: 1.6, marginBottom: '24px' }}>
              {t('auth.forgot.sentBodyPrefix')} <strong>{email}</strong> {t('auth.forgot.sentBodySuffix')}
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '24px' }}>
              {t('auth.forgot.sentSpam')}
            </p>
            <Link to="/login" className="auth-btn auth-btn-primary" style={{ textDecoration: 'none' }}>
              {t('auth.forgot.sentCta')}
            </Link>
          </div>
        ) : (
          <>
            <p className="auth-subtitle">
              {t('auth.forgot.subtitle')}
            </p>

            <form onSubmit={handleSubmit} className="auth-form">
              <Link to="/login" className="back-btn">
                {t('auth.forgot.backToLogin')}
              </Link>

              <div className="form-group">
                <label>{t('auth.login.emailLabel')}</label>
                <input
                  type="email"
                  placeholder={t('auth.login.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              {error && <p className="error-message">{error}</p>}

              <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
                {loading ? t('common.sending') : t('auth.forgot.submit')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
