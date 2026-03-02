import React, { useState, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import '../styles/auth.css';

export const Register = () => {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const { register, loading } = useContext(AuthContext);
  const navigate = useNavigate();

  const getPasswordStrength = (pwd) => {
    if (pwd.length === 0) return { score: 0, label: '', color: '' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    const levels = [
      { label: 'Sehr schwach', color: '#ff4444' },
      { label: 'Schwach', color: '#ff8800' },
      { label: 'Mittel', color: '#ffcc00' },
      { label: 'Stark', color: '#88cc00' },
      { label: 'Sehr stark', color: '#00cc66' },
    ];
    return { score, ...levels[score] };
  };

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwörter stimmen nicht überein');
      return;
    }

    if (password.length < 6) {
      setError('Passwort muss mindestens 6 Zeichen haben');
      return;
    }

    try {
      await register(email, password, name);
      navigate('/onboarding');
    } catch (err) {
      setError(err.response?.data?.error || 'Registrierung fehlgeschlagen');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-content">
        {/* Logo */}
        <div className="auth-logo">
          <h1 className="logo-text">JAMIE</h1>
        </div>

        {/* Progress Steps */}
        <div className="register-steps">
          <div className={`step-dot ${step >= 1 ? 'active' : ''}`} />
          <div className={`step-dot ${step >= 2 ? 'active' : ''}`} />
          <div className={`step-dot ${step >= 3 ? 'active' : ''}`} />
        </div>

        <p className="auth-subtitle">
          Erstelle dein Konto und werde Teil der Community
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          {step === 1 && (
            <>
              <div className="form-group">
                <label>Wie heißt du?</label>
                <input
                  type="text"
                  placeholder="Dein Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <button 
                type="button" 
                className="auth-btn auth-btn-primary"
                onClick={() => name && setStep(2)}
                disabled={!name}
              >
                Weiter
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button 
                type="button" 
                className="back-btn"
                onClick={() => setStep(1)}
              >
                ← Zurück
              </button>
              <div className="form-group">
                <label>Deine E-Mail</label>
                <input
                  type="email"
                  placeholder="deine@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <button 
                type="button" 
                className="auth-btn auth-btn-primary"
                onClick={() => email && setStep(3)}
                disabled={!email}
              >
                Weiter
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <button 
                type="button" 
                className="back-btn"
                onClick={() => setStep(2)}
              >
                ← Zurück
              </button>
              <div className="form-group">
                <label>Wähle ein Passwort</label>
                <input
                  type="password"
                  placeholder="Mindestens 6 Zeichen"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
                {password.length > 0 && (
                  <div className="password-strength">
                    <div className="strength-bar">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="strength-segment"
                          style={{ background: i < strength.score ? strength.color : 'rgba(255,255,255,0.1)' }}
                        />
                      ))}
                    </div>
                    <span className="strength-label" style={{ color: strength.color }}>{strength.label}</span>
                  </div>
                )}
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
              <button 
                type="submit" 
                className="auth-btn auth-btn-primary"
                disabled={loading || !password || !confirmPassword}
              >
                {loading ? 'Wird erstellt...' : 'Konto erstellen'}
              </button>
            </>
          )}
        </form>

        {/* Footer */}
        <div className="auth-footer">
          <p>
            Bereits ein Konto?{' '}
            <Link to="/login" className="auth-link">
              Jetzt einloggen
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;