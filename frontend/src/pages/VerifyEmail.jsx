import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { auth } from '../utils/api';
import '../styles/auth.css';

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('verifying'); // verifying, success, error
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('Kein Verifizierungs-Token gefunden.');
      return;
    }

    const verify = async () => {
      try {
        await auth.verifyEmail(token);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setError(err.response?.data?.error || 'Verifizierung fehlgeschlagen');
      }
    };

    verify();
  }, [token]);

  return (
    <div className="auth-container">
      <div className="auth-content" style={{ textAlign: 'center' }}>
        <div className="auth-logo">
          <h1 className="logo-text">JAMIE</h1>
        </div>

        {status === 'verifying' && (
          <>
            <div className="loading-spinner" style={{ margin: '40px auto' }} />
            <p style={{ color: 'var(--text-light)' }}>E-Mail wird verifiziert...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
            <h2 style={{ marginBottom: '12px' }}>E-Mail verifiziert!</h2>
            <p style={{ color: 'var(--text-light)', marginBottom: '24px' }}>
              Deine E-Mail-Adresse wurde erfolgreich bestätigt.
            </p>
            <Link to="/home" className="auth-btn auth-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Weiter zur App
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
            <h2 style={{ marginBottom: '12px' }}>Verifizierung fehlgeschlagen</h2>
            <p style={{ color: 'var(--text-light)', marginBottom: '24px' }}>{error}</p>
            <Link to="/login" className="auth-btn auth-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Zum Login
            </Link>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
