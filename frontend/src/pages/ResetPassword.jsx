import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { auth } from '../utils/api';
import '../styles/auth.css';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      return setError('Passwort muss mindestens 6 Zeichen lang sein');
    }
    if (password !== confirmPassword) {
      return setError('Passwörter stimmen nicht überein');
    }

    setLoading(true);
    try {
      await auth.resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Zurücksetzen');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-content" style={{ textAlign: 'center' }}>
          <div className="auth-logo">
            <h1 className="logo-text">JAMIE</h1>
          </div>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔗</div>
          <h2 style={{ marginBottom: '12px' }}>Ungültiger Link</h2>
          <p style={{ color: 'var(--text-light)', marginBottom: '24px' }}>
            Dieser Link ist ungültig oder abgelaufen.
          </p>
          <Link to="/forgot-password" className="auth-btn auth-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Neuen Link anfordern
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-content">
        <div className="auth-logo">
          <h1 className="logo-text">JAMIE</h1>
        </div>

        {success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
            <h2 style={{ marginBottom: '12px' }}>Passwort zurückgesetzt!</h2>
            <p style={{ color: 'var(--text-light)', marginBottom: '24px' }}>
              Dein Passwort wurde erfolgreich geändert. Du kannst dich jetzt einloggen.
            </p>
            <Link to="/login" className="auth-btn auth-btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Zum Login
            </Link>
          </div>
        ) : (
          <>
            <p className="auth-subtitle">
              Wähle ein neues Passwort für dein Konto.
            </p>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <label>Neues Passwort</label>
                <input
                  type="password"
                  placeholder="Mindestens 6 Zeichen"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Passwort bestätigen</label>
                <input
                  type="password"
                  placeholder="Passwort wiederholen"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              {error && <p className="error-message">{error}</p>}

              <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
                {loading ? 'Wird gespeichert...' : 'Passwort speichern'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
