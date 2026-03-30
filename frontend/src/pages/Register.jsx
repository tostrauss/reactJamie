import React, { useState, useRef, useEffect, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { auth } from '../utils/api';
import '../styles/auth.css';

const OTP_RESEND_SECONDS = 60;
const TOTAL_STEPS = 5;

// ── Google Places loader (shared singleton) ──────────────────────────────────
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
  const [step, setStep]                       = useState(1);
  const [name, setName]                       = useState('');
  const [email, setEmail]                     = useState('');
  const [otpCode, setOtpCode]                 = useState('');
  const [otpLoading, setOtpLoading]           = useState(false);
  const [otpError, setOtpError]               = useState('');
  const [otpResendTimer, setOtpResendTimer]   = useState(0);
  const [location, setLocation]               = useState('');
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode]       = useState('');
  const [error, setError]                     = useState('');

  const { register, loading } = useContext(AuthContext);
  const navigate = useNavigate();

  const locationRef     = useRef(null);
  const autocompleteRef = useRef(null);
  const resendIntervalRef = useRef(null);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (apiKey) loadGM(apiKey);
  }, []);

  useEffect(() => {
    if (otpResendTimer <= 0) { clearInterval(resendIntervalRef.current); return; }
    resendIntervalRef.current = setInterval(() => {
      setOtpResendTimer(t => {
        if (t <= 1) { clearInterval(resendIntervalRef.current); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(resendIntervalRef.current);
  }, [otpResendTimer]);

  useEffect(() => {
    if (step !== 4) return;
    const attach = () => {
      if (!window.google?.maps?.places || autocompleteRef.current || !locationRef.current) return;
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
    if (pwd.length < 6)             return 'Mindestens 6 Zeichen erforderlich';
    if (!/[A-Z]/.test(pwd))         return 'Mindestens 1 Großbuchstabe erforderlich';
    if (!/[a-z]/.test(pwd))         return 'Mindestens 1 Kleinbuchstabe erforderlich';
    if (!/[0-9]/.test(pwd))         return 'Mindestens 1 Zahl erforderlich';
    if (!/[^A-Za-z0-9]/.test(pwd))  return 'Mindestens 1 Sonderzeichen erforderlich (!@#$…)';
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
      if (location.trim()) {
        try { await auth.updateProfile({ location: location.trim() }); } catch (_) {}
      }
      localStorage.setItem('jamie_new_registration', '1');
      navigate('/welcome');
    } catch (err) {
      setError(err.response?.data?.error || 'Registrierung fehlgeschlagen');
    }
  };

  const BackBtn = ({ onClick }) => (
    <button type="button" className="auth-back-btn" onClick={onClick}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      Zurück
    </button>
  );

  return (
    <div className="auth-screen auth-screen--scroll">
      {/* Top — logo + progress */}
      <div className="auth-top auth-top--compact">
        <h1 className="auth-wordmark">JAMIE</h1>
        <div className="reg-steps">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`reg-dot ${i + 1 === step ? 'reg-dot--active' : i + 1 < step ? 'reg-dot--done' : ''}`}
            />
          ))}
        </div>
        <p className="reg-step-label">Schritt {step} von {TOTAL_STEPS}</p>
      </div>

      {/* Middle — step content */}
      <div className="auth-mid">
        <form onSubmit={handleSubmit} className="auth-form">

          {/* ── Step 1: Name ─────────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <div className="reg-step-heading">
                <h2 className="reg-title">Wie heißt du?</h2>
                <p className="reg-hint">So wirst du in der App angezeigt</p>
              </div>
              <div className="form-group">
                <label>Dein Name</label>
                <input
                  type="text"
                  placeholder="Dein Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
              <button
                type="button"
                className="auth-btn auth-btn-primary"
                onClick={() => name.trim() && setStep(2)}
                disabled={!name.trim()}
              >
                Weiter
              </button>
            </>
          )}

          {/* ── Step 2: E-Mail ───────────────────────────────────────────── */}
          {step === 2 && (
            <>
              <BackBtn onClick={() => setStep(1)} />
              <div className="reg-step-heading">
                <h2 className="reg-title">Deine E-Mail</h2>
                <p className="reg-hint">Wir schicken dir einen Bestätigungscode</p>
              </div>
              <div className="form-group">
                <label>E-Mail-Adresse</label>
                <input
                  type="email"
                  placeholder="deine@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              {otpError && <p className="error-message">{otpError}</p>}
              <button
                type="button"
                className="auth-btn auth-btn-primary"
                onClick={handleSendCode}
                disabled={!email || otpLoading}
              >
                {otpLoading ? 'Wird gesendet…' : 'Code senden'}
              </button>
            </>
          )}

          {/* ── Step 3: OTP ─────────────────────────────────────────────── */}
          {step === 3 && (
            <>
              <BackBtn onClick={() => { setStep(2); setOtpCode(''); setOtpError(''); }} />
              <div className="reg-step-heading">
                <h2 className="reg-title">Code eingeben</h2>
                <p className="reg-hint">
                  Wir haben einen 6-stelligen Code an{' '}
                  <strong className="reg-hint-em">{email}</strong> gesendet.
                </p>
              </div>
              <div className="form-group">
                <label>Bestätigungscode</label>
                <input
                  className="otp-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="— — — — — —"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoComplete="one-time-code"
                />
              </div>
              {otpError && <p className="error-message">{otpError}</p>}
              <button
                type="button"
                className="auth-btn auth-btn-primary"
                onClick={handleVerifyCode}
                disabled={otpCode.length !== 6 || otpLoading}
              >
                {otpLoading ? 'Prüfe…' : 'Bestätigen'}
              </button>
              <button
                type="button"
                className="auth-btn auth-btn-resend"
                onClick={handleResendCode}
                disabled={otpResendTimer > 0 || otpLoading}
              >
                {otpResendTimer > 0
                  ? `Erneut senden (${otpResendTimer}s)`
                  : 'Code erneut senden'}
              </button>
            </>
          )}

          {/* ── Step 4: Standort ─────────────────────────────────────────── */}
          {step === 4 && (
            <>
              <BackBtn onClick={() => setStep(3)} />
              <div className="reg-step-heading">
                <h2 className="reg-title">Wo bist du?</h2>
                <p className="reg-hint">Hilft dir, Events in deiner Nähe zu finden</p>
              </div>
              <div className="form-group">
                <label>
                  Stadt oder Region
                  <span className="field-optional"> (optional)</span>
                </label>
                <div className="location-field">
                  <input
                    ref={locationRef}
                    type="text"
                    placeholder="z.B. Wien, Österreich"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    autoComplete="off"
                  />
                  {location && (
                    <button
                      type="button"
                      className="location-clear"
                      onClick={() => setLocation('')}
                      aria-label="Ort entfernen"
                    >
                      ×
                    </button>
                  )}
                </div>
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

          {/* ── Step 5: Passwort ─────────────────────────────────────────── */}
          {step === 5 && (
            <>
              <BackBtn onClick={() => setStep(4)} />
              <div className="reg-step-heading">
                <h2 className="reg-title">Passwort wählen</h2>
                <p className="reg-hint">Mind. 6 Zeichen, Groß/Klein, Zahl & Sonderzeichen</p>
              </div>
              <div className="form-group">
                <label>Passwort</label>
                <input
                  type="password"
                  placeholder="Dein Passwort"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
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
                    <span className="strength-label" style={{ color: strength.color }}>
                      {strength.label}
                    </span>
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
              <div className="form-group">
                <label>
                  Einladungscode
                  <span className="field-optional"> (optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="z.B. JAMIE-X7K2"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  className="referral-input"
                  autoComplete="off"
                />
              </div>
              {error && <p className="error-message">{error}</p>}
              <button
                type="submit"
                className="auth-btn auth-btn-primary"
                disabled={loading || !password || !confirmPassword}
              >
                {loading ? 'Wird erstellt…' : 'Konto erstellen'}
              </button>
            </>
          )}

        </form>
      </div>

      {/* Bottom — login link */}
      <div className="auth-bottom">
        <p>
          Bereits ein Konto?{' '}
          <Link to="/login" className="auth-link">Jetzt einloggen</Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
