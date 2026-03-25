import React, { useState, useRef, useEffect, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { auth } from '../utils/api';
import '../styles/auth.css';

const OTP_RESEND_SECONDS = 60;

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
  const [otpCode, setOtpCode]               = useState('');
  const [otpLoading, setOtpLoading]         = useState(false);
  const [otpError, setOtpError]             = useState('');
  const [otpResendTimer, setOtpResendTimer] = useState(0);
  const [location, setLocation]             = useState('');
  const [password, setPassword]             = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode]     = useState('');
  const [error, setError]                   = useState('');

  const { register, loading } = useContext(AuthContext);
  const navigate = useNavigate();

  const locationRef     = useRef(null);
  const autocompleteRef = useRef(null);
  const resendIntervalRef = useRef(null);

  // Load Google Maps script on mount
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (apiKey) loadGM(apiKey);
  }, []);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (otpResendTimer <= 0) {
      clearInterval(resendIntervalRef.current);
      return;
    }
    resendIntervalRef.current = setInterval(() => {
      setOtpResendTimer(t => {
        if (t <= 1) { clearInterval(resendIntervalRef.current); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(resendIntervalRef.current);
  }, [otpResendTimer]);

  // Attach autocomplete when step 4 renders
  useEffect(() => {
    if (step !== 4) return;

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

  const handleSendCode = async () => {
    setOtpError('');
    setOtpLoading(true);
    try {
      await auth.sendEmailCode(email, name);
      setStep(3);
      setOtpResendTimer(OTP_RESEND_SECONDS);
    } catch (err) {
      setOtpError(err.response?.data?.error || 'Code konnte nicht gesendet werden');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setOtpError('');
    if (otpCode.length !== 6) { setOtpError('Bitte alle 6 Ziffern eingeben'); return; }
    setOtpLoading(true);
    try {
      await auth.verifyEmailCode(email, otpCode);
      setStep(4);
    } catch (err) {
      setOtpError(err.response?.data?.error || 'Ungültiger Code');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResendCode = async () => {
    setOtpError('');
    setOtpCode('');
    setOtpLoading(true);
    try {
      await auth.sendEmailCode(email, name);
      setOtpResendTimer(OTP_RESEND_SECONDS);
    } catch (err) {
      setOtpError(err.response?.data?.error || 'Code konnte nicht gesendet werden');
    } finally {
      setOtpLoading(false);
    }
  };

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

  // 5 steps: name → email → verify code → location → password
  const TOTAL_STEPS = 5;

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
              <button type="button" className="auth-back-btn" onClick={() => setStep(1)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Zurück
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
                  autoComplete="email"
                />
              </div>
              {otpError && step === 2 && <p className="error-message">{otpError}</p>}
              <button
                type="button"
                className="auth-btn auth-btn-primary"
                onClick={handleSendCode}
                disabled={!email || otpLoading}
              >
                {otpLoading ? 'Wird gesendet...' : 'Code senden'}
              </button>
            </>
          )}

          {/* ── Step 3: E-Mail OTP ───────────────────────────────────── */}
          {step === 3 && (
            <>
              <button type="button" className="auth-back-btn" onClick={() => { setStep(2); setOtpCode(''); setOtpError(''); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Zurück
            </button>
              <div className="form-group">
                <label>Bestätigungscode</label>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginBottom: '14px', marginTop: '-4px' }}>
                  Wir haben einen 6-stelligen Code an <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{email}</strong> gesendet.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="_ _ _ _ _ _"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  style={{ letterSpacing: '8px', fontSize: '24px', textAlign: 'center' }}
                />
              </div>
              {otpError && <p className="error-message">{otpError}</p>}
              <button
                type="button"
                className="auth-btn auth-btn-primary"
                onClick={handleVerifyCode}
                disabled={otpCode.length !== 6 || otpLoading}
              >
                {otpLoading ? 'Prüfe...' : 'Bestätigen'}
              </button>
              <button
                type="button"
                className="auth-btn"
                onClick={handleResendCode}
                disabled={otpResendTimer > 0 || otpLoading}
                style={{ marginTop: '10px', background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: otpResendTimer > 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)' }}
              >
                {otpResendTimer > 0 ? `Code erneut senden (${otpResendTimer}s)` : 'Code erneut senden'}
              </button>
            </>
          )}

          {/* ── Step 4: Standort (Google Maps) ──────────────────────── */}
          {step === 4 && (
            <>
              <button type="button" className="auth-back-btn" onClick={() => setStep(3)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Zurück
            </button>
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
                onClick={() => setStep(5)}
              >
                {location ? 'Weiter' : 'Überspringen'}
              </button>
            </>
          )}

          {/* ── Step 5: Passwort ─────────────────────────────────────── */}
          {step === 5 && (
            <>
              <button type="button" className="auth-back-btn" onClick={() => setStep(4)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Zurück
            </button>
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
