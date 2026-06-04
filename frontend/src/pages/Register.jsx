import React, { useState, useRef, useEffect, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { auth } from '../utils/api';
import '../styles/auth.css';

const OTP_RESEND_SECONDS = 60;
const TOTAL_STEPS = 6;

async function fetchLocationSuggestions(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1&countrycodes=at,de,ch&accept-language=de`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
  const data = await res.json();
  return data.map(item => {
    const a = item.address || {};
    const place = a.city || a.town || a.village || a.municipality || item.name;
    const country = a.country;
    return place && country ? `${place}, ${country}` : item.display_name;
  });
}

export const Register = () => {
  const { t } = useTranslation();
  const [step, setStep]                       = useState(1);
  const [name, setName]                       = useState('');
  const [email, setEmail]                     = useState('');
  const [otpCode, setOtpCode]                 = useState('');
  const [otpLoading, setOtpLoading]           = useState(false);
  const [otpError, setOtpError]               = useState('');
  const [otpResendTimer, setOtpResendTimer]   = useState(0);
  const [location, setLocation]               = useState('');
  const [dateOfBirth, setDateOfBirth]         = useState('');
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode]       = useState('');
  const [consentGiven, setConsentGiven]       = useState(false);
  const [error, setError]                     = useState('');

  const { register, loading } = useContext(AuthContext);
  const navigate = useNavigate();

  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const locationDebounceRef = useRef(null);
  const resendIntervalRef = useRef(null);

  const handleLocationInput = (value) => {
    setLocation(value);
    setLocationSuggestions([]);
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    if (!value.trim() || value.length < 2) return;
    locationDebounceRef.current = setTimeout(async () => {
      try {
        const suggestions = await fetchLocationSuggestions(value);
        setLocationSuggestions(suggestions);
      } catch (_) {}
    }, 350);
  };

  const selectLocationSuggestion = (suggestion) => {
    setLocation(suggestion);
    setLocationSuggestions([]);
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
  };

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

  const handleSendCode = async () => {
    setOtpError('');
    setOtpLoading(true);
    try {
      const res = await auth.sendEmailCode(email, name);
      if (res.data?.devCode) {
        // Dev mode: auto-verify and skip the OTP step
        await auth.verifyEmailCode(email, res.data.devCode);
        setStep(4);
      } else {
        setStep(3);
        setOtpResendTimer(OTP_RESEND_SECONDS);
      }
    } catch (err) {
      setOtpError(err.response?.data?.error || t('auth.register.step3.errorSendFailed'));
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setOtpError('');
    if (otpCode.length !== 6) { setOtpError(t('auth.register.step3.errorMissing')); return; }
    setOtpLoading(true);
    try {
      await auth.verifyEmailCode(email, otpCode);
      setStep(4);
    } catch (err) {
      setOtpError(err.response?.data?.error || t('auth.register.step3.errorInvalid'));
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResendCode = async () => {
    setOtpError('');
    setOtpCode('');
    setOtpLoading(true);
    try {
      const res = await auth.sendEmailCode(email, name);
      if (res.data?.devCode) {
        await auth.verifyEmailCode(email, res.data.devCode);
        setStep(4);
      } else {
        setOtpResendTimer(OTP_RESEND_SECONDS);
      }
    } catch (err) {
      setOtpError(err.response?.data?.error || t('auth.register.step3.errorSendFailed'));
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
      { label: t('auth.register.strength.veryWeak'), color: '#ff4444' },
      { label: t('auth.register.strength.weak'),     color: '#ff8800' },
      { label: t('auth.register.strength.medium'),   color: '#ffcc00' },
      { label: t('auth.register.strength.strong'),   color: '#88cc00' },
      { label: t('auth.register.strength.veryStrong'), color: '#00cc66' },
    ];
    return { score, ...levels[score] };
  };

  const strength = getPasswordStrength(password);

  const validatePassword = (pwd) => {
    if (pwd.length < 6)             return t('auth.register.validation.passwordMinLength');
    if (!/[A-Z]/.test(pwd))         return t('auth.register.validation.passwordUpper');
    if (!/[a-z]/.test(pwd))         return t('auth.register.validation.passwordLower');
    if (!/[0-9]/.test(pwd))         return t('auth.register.validation.passwordDigit');
    if (!/[^A-Za-z0-9]/.test(pwd))  return t('auth.register.validation.passwordSpecial');
    return null;
  };

  const maxDOB = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().split('T')[0];
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!dateOfBirth) { setError(t('auth.register.validation.dobRequired')); return; }
    if (dateOfBirth > maxDOB) { setError(t('auth.register.validation.ageMin')); return; }
    if (password !== confirmPassword) { setError(t('auth.register.validation.passwordMismatch')); return; }
    const pwdError = validatePassword(password);
    if (pwdError) { setError(pwdError); return; }
    try {
      await register(email, password, name, referralCode.trim() || undefined, dateOfBirth);
      if (location.trim()) {
        try { await auth.updateProfile({ location: location.trim() }); } catch (_) {}
      }
      localStorage.setItem('jamie_new_registration', '1');
      navigate('/welcome');
    } catch (err) {
      setError(err.response?.data?.error || t('auth.register.validation.registerFailed'));
    }
  };

  const BackBtn = ({ onClick }) => (
    <button type="button" className="auth-back-btn" onClick={onClick}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      {t('common.back')}
    </button>
  );

  return (
    <div className="auth-screen auth-screen--scroll">
      {/* Top — logo + progress */}
      <div className="auth-top auth-top--compact">
        <h1 className="auth-wordmark">{t('auth.appName')}</h1>
        <div className="reg-steps">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`reg-dot ${i + 1 === step ? 'reg-dot--active' : i + 1 < step ? 'reg-dot--done' : ''}`}
            />
          ))}
        </div>
        <p className="reg-step-label">{t('auth.register.stepLabel', { current: step, total: TOTAL_STEPS })}</p>
      </div>

      {/* Middle — step content */}
      <div className="auth-mid">
        <form onSubmit={handleSubmit} className="auth-form">

          {/* ── Step 1: Name ─────────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <div className="reg-step-heading">
                <h2 className="reg-title">{t('auth.register.step1.title')}</h2>
                <p className="reg-hint">{t('auth.register.step1.hint')}</p>
              </div>
              <div className="form-group">
                <label>{t('auth.register.step1.label')}</label>
                <input
                  type="text"
                  placeholder={t('auth.register.step1.placeholder')}
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
                {t('common.continue')}
              </button>
            </>
          )}

          {/* ── Step 2: E-Mail ───────────────────────────────────────────── */}
          {step === 2 && (
            <>
              <BackBtn onClick={() => setStep(1)} />
              <div className="reg-step-heading">
                <h2 className="reg-title">{t('auth.register.step2.title')}</h2>
                <p className="reg-hint">{t('auth.register.step2.hint')}</p>
              </div>
              <div className="form-group">
                <label>{t('auth.register.step2.label')}</label>
                <input
                  type="email"
                  placeholder={t('auth.register.step2.placeholder')}
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
                {otpLoading ? t('common.sending') : t('auth.register.step2.sendCode')}
              </button>
            </>
          )}

          {/* ── Step 3: OTP ─────────────────────────────────────────────── */}
          {step === 3 && (
            <>
              <BackBtn onClick={() => { setStep(2); setOtpCode(''); setOtpError(''); }} />
              <div className="reg-step-heading">
                <h2 className="reg-title">{t('auth.register.step3.title')}</h2>
                <p className="reg-hint">
                  {t('auth.register.step3.hintPrefix')}{' '}
                  <strong className="reg-hint-em">{email}</strong>
                  {t('auth.register.step3.hintSuffix')}
                </p>
              </div>
              <div className="form-group">
                <label>{t('auth.register.step3.label')}</label>
                <input
                  className="otp-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder={t('auth.register.step3.placeholder')}
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
                {otpLoading ? t('auth.register.step3.checking') : t('auth.register.step3.confirm')}
              </button>
              <button
                type="button"
                className="auth-btn auth-btn-resend"
                onClick={handleResendCode}
                disabled={otpResendTimer > 0 || otpLoading}
              >
                {otpResendTimer > 0
                  ? t('auth.register.step3.resendIn', { seconds: otpResendTimer })
                  : t('auth.register.step3.resend')}
              </button>
            </>
          )}

          {/* ── Step 4: Geburtsdatum ─────────────────────────────────────── */}
          {step === 4 && (
            <>
              <BackBtn onClick={() => setStep(3)} />
              <div className="reg-step-heading">
                <h2 className="reg-title">{t('auth.register.step4.title')}</h2>
                <p className="reg-hint">{t('auth.register.step4.hint')}</p>
              </div>
              <div className="form-group">
                <label>{t('auth.register.step4.label')}</label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  max={maxDOB}
                  required
                  style={{ colorScheme: 'dark' }}
                />
                {dateOfBirth && dateOfBirth > maxDOB && (
                  <p className="error-message" style={{ marginTop: 6 }}>
                    {t('auth.register.step4.errorAge')}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="auth-btn auth-btn-primary"
                onClick={() => setStep(5)}
                disabled={!dateOfBirth || dateOfBirth > maxDOB}
              >
                {t('common.continue')}
              </button>
            </>
          )}

          {/* ── Step 5: Standort ─────────────────────────────────────────── */}
          {step === 5 && (
            <>
              <BackBtn onClick={() => setStep(4)} />
              <div className="reg-step-heading">
                <h2 className="reg-title">{t('auth.register.step5.title')}</h2>
                <p className="reg-hint">{t('auth.register.step5.hint')}</p>
              </div>
              <div className="form-group">
                <label>
                  {t('auth.register.step5.label')}
                  <span className="field-optional"> {t('auth.shared.fieldOptional')}</span>
                </label>
                <div className="location-field">
                  <input
                    type="text"
                    placeholder={t('auth.register.step5.placeholder')}
                    value={location}
                    onChange={(e) => handleLocationInput(e.target.value)}
                    autoComplete="off"
                  />
                  {locationSuggestions.length > 0 && (
                    <ul className="location-suggestions">
                      {locationSuggestions.map((s, i) => (
                        <li key={i} onMouseDown={() => selectLocationSuggestion(s)}>{s}</li>
                      ))}
                    </ul>
                  )}
                  {location && (
                    <button
                      type="button"
                      className="location-clear"
                      onClick={() => { setLocation(''); setLocationSuggestions([]); }}
                      aria-label={t('auth.register.step5.removeLocation')}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="auth-btn auth-btn-primary"
                onClick={() => setStep(6)}
              >
                {t('common.continue')}
              </button>
            </>
          )}

          {/* ── Step 6: Passwort ─────────────────────────────────────────── */}
          {step === 6 && (
            <>
              <BackBtn onClick={() => setStep(5)} />
              <div className="reg-step-heading">
                <h2 className="reg-title">{t('auth.register.step6.title')}</h2>
                <p className="reg-hint">{t('auth.register.step6.hint')}</p>
              </div>
              <div className="form-group">
                <label>{t('auth.register.step6.label')}</label>
                <input
                  type="password"
                  placeholder={t('auth.register.step6.placeholder')}
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
                <label>{t('auth.register.step6.confirmLabel')}</label>
                <input
                  type="password"
                  placeholder={t('auth.shared.confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label>
                  {t('auth.register.step6.referralLabel')}
                  <span className="field-optional"> {t('auth.shared.fieldOptional')}</span>
                </label>
                <input
                  type="text"
                  placeholder={t('auth.register.step6.referralPlaceholder')}
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  className="referral-input"
                  autoComplete="off"
                />
              </div>
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                width: '100%', textAlign: 'left',
                fontSize: 13, color: 'rgba(255,255,255,0.65)',
                lineHeight: 1.5, cursor: 'pointer', marginTop: 4,
              }}>
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  style={{ marginTop: 2, flexShrink: 0, accentColor: 'var(--coral)' }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <Trans
                    i18nKey="auth.shared.consentText"
                    components={{
                      1: <Link to="/privacy" target="_blank" style={{ color: 'var(--coral)' }} />,
                      2: <Link to="/terms" target="_blank" style={{ color: 'var(--coral)' }} />,
                    }}
                  />
                </span>
              </label>
              {error && <p className="error-message">{error}</p>}
              <button
                type="submit"
                className="auth-btn auth-btn-primary"
                disabled={loading || !password || !confirmPassword || !consentGiven}
              >
                {loading ? t('auth.register.step6.creating') : t('auth.register.step6.submit')}
              </button>
            </>
          )}

        </form>
      </div>

      {/* Bottom — login link */}
      <div className="auth-bottom">
        <p>
          {t('auth.register.alreadyAccount')}{' '}
          <Link to="/login" className="auth-link">{t('auth.register.loginLink')}</Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
