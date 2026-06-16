import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../utils/api';
import { JamieWordmark } from '../components/JamieWordmark';
import '../styles/auth.css';

const VerifyEmail = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('verifying'); // verifying, success, error
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError(t('auth.verify.errorMissingToken'));
      return;
    }

    const verify = async () => {
      try {
        await auth.verifyEmail(token);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setError(err.response?.data?.error || t('auth.verify.errorGeneric'));
      }
    };

    verify();
  }, [token, t]);

  return (
    <div className="auth-container">
      <div className="auth-content" style={{ textAlign: 'center' }}>
        <div className="auth-logo">
          <JamieWordmark size="splash" />
        </div>

        {status === 'verifying' && (
          <>
            <div className="loading-spinner" style={{ margin: '40px auto' }} />
            <p style={{ color: 'var(--text-light)' }}>{t('auth.verify.verifying')}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
            <h2 style={{ marginBottom: '12px' }}>{t('auth.verify.successTitle')}</h2>
            <p style={{ color: 'var(--text-light)', marginBottom: '24px' }}>
              {t('auth.verify.successBody')}
            </p>
            <Link to="/home" className="auth-btn auth-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              {t('auth.verify.successCta')}
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
            <h2 style={{ marginBottom: '12px' }}>{t('auth.verify.errorTitle')}</h2>
            <p style={{ color: 'var(--text-light)', marginBottom: '24px' }}>{error}</p>
            <Link to="/login" className="auth-btn auth-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              {t('auth.verify.errorCta')}
            </Link>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
