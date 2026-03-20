import React, { useState, useRef, useEffect, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { auth } from '../utils/api';
import '../styles/auth.css';

// ── Google Places loader (shared singleton) ───────────────────────────────────
let _gmLoading = false;
let _gmLoaded  = false;
const _gmCbs   = [];
function loadGM(apiKey) {
  if (_gmLoaded)  { _gmCbs.forEach(cb => cb()); _gmCbs.length = 0; return; }
  if (_gmLoading) return;
  _gmLoading = true;
  window.__gmReady = () => {
    _gmLoaded = true; _gmLoading = false;
    _gmCbs.forEach(cb => cb()); _gmCbs.length = 0;
  };
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=de&callback=__gmReady`;
  s.async = true;
  document.head.appendChild(s);
}
function onGM(cb) {
  if (_gmLoaded) { cb(); return; }
  _gmCbs.push(cb);
}
// ─────────────────────────────────────────────────────────────────────────────

export const Register = () => {
  // ── State — all declared first ────────────────────────────────────────────
  const [step, setStep]                     = useState(1);
  const [name, setName]                     = useState('');
  const [email, setEmail]                   = useState('');
  const [location, setLocation]             = useState('');
  const [password, setPassword]             = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode]     = useState('');
  const [error, setError]                   = useState('');

  const { register, loading } = useContext(AuthContext);
  const navigate = useNavigate();

  const locationRef     = useRef(null);
  const autocompleteRef = useRef(null);

  // Load Google Maps script on mount
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (apiKey) loadGM(apiKey);
  }, []);

  // Attach autocomplete when step 3 renders
  useEffect(() => {
    if (step !== 3) return;

    const attach = () => {
      if (!window.google?.maps?.places) return;
      if (autocompleteRef.current) return;
      if (!locationRef.current) return;
      const ac = new window.google.maps.places.Autocomplete(locationRef.current, {
        componentRestrictions: { country: ['at', 'de', 'ch'] },
        fields: ['formatted_address', 'name'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const val = place.formatted_address || place.name || '';
        if (val) setLocation(val);
      });
      autocompleteRef.current = ac;
    };

    const timer = setTimeout(() => onGM(attach), 50);
    return () => clearTimeout(timer);
  }, [step]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getPasswordStrength = (pwd) => {
    if (pwd.length === 0) return { score: 0, label: '', color: '' };
    let score = 0;
    if (pwd.length >= 8)          score++;
    if (/[A-Z]/.test(pwd))        score++;
    if (/[0-9]/.test(pwd))        score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    const levels = [
      { label: 'Sehr schwach', color: '#ff4444' },
      { label: 'Schwach',      color: '#ff8800' },
      { label: 'Mittel',       color: '#ffcc00' },
      { label: 'Stark',        color: '#88cc00' },
      { label: 'Sehr stark',   color: '#00cc66' },
    ];
    return { score, ...levels[score] };
  };

  const strength = getPasswordStrength(password);

  const validatePassword = (pwd) => {
    if (pwd.length < 6)               return 'Mindestens 6 Zeichen erforderlich';
    if (!/[A-Z]/.test(pwd))           return 'Mindestens 1 Großbuchstabe erforderlich';
    if (!/[a-z]/.test(pwd))           return 'Mindestens 1 Kleinbuchstabe erforderlich';
    if (!/[0-9]/.test(pwd))           return 'Mindestens 1 Zahl erforderlich';
    if (!/[^A-Za-z0-9]/.test(pwd))   return 'Mindestens 1 Sonderzeichen erforderlich (!@#$…)';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) { setError('Passwörter stimmen nicht überein'); return; }
    const pwdError = validatePassword(password);
    if (pwdError) { setError(pwdError); return; }

    try {
      await register(email, password, name, referralCode.trim() || undefined);
      // Save location if provided
      if (location.trim()) {
        try { await auth.updateProfile({ location: location.trim() }); } catch (_) {}
      }
      localStorage.setItem('jamie_new_registration', '1');
      navigate('/welcome');
    } catch (err) {
      setError(err.response?.data?.error || 'Registrierung fehlgeschlagen');
    }
  };

  // 4 steps: name → email → location → password
  const TOTAL_STEPS = 4;

  return (
    <div className="auth-container">
      <div className="auth-content">
        {/* Logo */}
        <div className="auth-logo">
          <h1 className="logo-text">JAMIE</h1>
        </div>

        {/* Progress dots */}
        <div className="register-steps">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} className={`step-dot ${step > i ? 'active' : ''}`} />
          ))}
        </div>

        <p className="auth-subtitle">
          Erstelle dein Konto und werde Teil der Community
        </p>

        <form onSubmit={handleSubmit} className="auth-form">

          {/* ── Step 1: Name ─────────────────────────────────────────── */}
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
                  autoComplete="name"
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

          {/* ── Step 2: E-Mail ───────────────────────────────────────── */}
          {step === 2 && (
            <>
              <button type="button" className="back-btn" onClick={() => setStep(1)}>← Zurück</button>
              <div className="form-group">
                <label>Deine E-Mail</label>
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

          {/* ── Step 3: Standort (Google Maps) ──────────────────────── */}
          {step === 3 && (
            <>
              <button type="button" className="back-btn" onClick={() => setStep(2)}>← Zurück</button>
              <div className="form-group">
                <label>Wo bist du? <span style={{ opacity: 0.5, fontSize: '13px' }}>(optional)</span></label>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={locationRef}
                    type="text"
                    placeholder="z.B. Wien, Österreich"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    autoComplete="off"
                    autoFocus
                  />
                  {location && (
                    <button
                      type="button"
                      onClick={() => setLocation('')}
                      style={{
                        position: 'absolute', right: '12px', top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none', border: 'none',
                        color: 'rgba(255,255,255,0.4)', fontSize: '18px',
                        cursor: 'pointer', lineHeight: 1,
                      }}
                    >×</button>
                  )}
                </div>
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '6px' }}>
                  Hilft dir, Events in deiner Nähe zu finden
                </p>
              </div>
              <button
                type="button"
                className="auth-btn auth-btn-primary"
                onClick={() => setStep(4)}
              >
                {location ? 'Weiter' : 'Überspringen'}
              </button>
            </>
          )}

          {/* ── Step 4: Passwort ─────────────────────────────────────── */}
          {step === 4 && (
            <>
              <button type="button" className="back-btn" onClick={() => setStep(3)}>← Zurück</button>
              <div className="form-group">
                <label>Wähle ein Passwort</label>
                <input
                  type="password"
                  placeholder="Min. 6 Zeichen, Groß/Klein, Zahl, Sonderzeichen"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  autoComplete="new-password"
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
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group" style={{ marginTop: '8px' }}>
                <label style={{ opacity: 0.7 }}>Einladungscode (optional)</label>
                <input
                  type="text"
                  placeholder="z.B. JAMIE-X7K2"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  style={{ letterSpacing: '1px' }}
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

        <div className="auth-footer">
          <p>
            Bereits ein Konto?{' '}
            <Link to="/login" className="auth-link">Jetzt einloggen</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
