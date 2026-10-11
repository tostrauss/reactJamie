import { useState, useRef, useEffect, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { serverErrorMessage } from '../utils/apiError';
import { AuthContext } from '../context/AuthContext';
import { auth } from '../utils/api';
import { safeStorage, safeSession } from '../utils/safeStorage';
import { PasswordInput } from '../components/PasswordInput';
import { FlowHeader } from '../components/FlowHeader';
import { StepTitle } from '../components/StepTitle';
import '../styles/auth.css';

const OTP_RESEND_SECONDS = 60;

// Four pages since the 11.10.2026 rework (Tina's checklist: „Name, Email;
// Geburtsdatum, Geschlecht? (Bubbles) eigene Vorderseite"). The Wohnort step
// is gone: onboarding asks it with Google Places and the server geocodes it,
// so it was asked twice (here through a browser-side Nominatim lookup limited
// to at/de/ch). Ids instead of numbers — the i18n keys stay step1…step6 and
// their labels, placeholders and errors are reused below.
const STEPS = ['identity', 'code', 'about', 'password'];

// AppIntro's trigger (shouldShowIntro); cleared by AppIntro when it finishes
// and by Onboarding on mount.
const NEW_REG_KEY = 'jamie_new_registration';

// value: backend enum — must match GENDER_VALUES (utils/profileCompleteness.js).
// The trailing U+FE0E (text variation selector) keeps ⚧ from rendering as a
// colour emoji on iOS, so all three glyphs stay monochrome (as in onboarding).
const GENDER_OPTIONS = [
  { value: 'male',    labelKey: 'onboarding.gender.male',    icon: '♂︎' },
  { value: 'female',  labelKey: 'onboarding.gender.female',  icon: '♀︎' },
  { value: 'diverse', labelKey: 'onboarding.gender.diverse', icon: '⚧︎' },
];

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const Register = () => {
  const { t } = useTranslation();
  const [step, setStep]                       = useState('identity');
  const [name, setName]                       = useState('');
  const [email, setEmail]                     = useState('');
  const [otpCode, setOtpCode]                 = useState('');
  const [otpLoading, setOtpLoading]           = useState(false);
  const [otpError, setOtpError]               = useState('');
  const [otpResendTimer, setOtpResendTimer]   = useState(0);
  const [dateOfBirth, setDateOfBirth]         = useState('');
  const [gender, setGender]                   = useState('');
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode]       = useState('');
  const [consentGiven, setConsentGiven]       = useState(false);
  const [error, setError]                     = useState('');
  // Set by the API layer when a guest is bounced here from an account-only
  // action (create club, upload, …). One-shot: read then clear.
  const [guestBlocked, setGuestBlocked]       = useState(false);
  useEffect(() => {
    if (safeSession.getItem('jamie_guest_blocked')) {
      setGuestBlocked(true);
      safeSession.removeItem('jamie_guest_blocked');
    }
  }, []);

  const { register, loading } = useContext(AuthContext);
  const navigate = useNavigate();

  const resendIntervalRef = useRef(null);

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
        // Dev mode: auto-verify and skip the code page
        await auth.verifyEmailCode(email, res.data.devCode);
        setStep('about');
      } else {
        setStep('code');
        setOtpResendTimer(OTP_RESEND_SECONDS);
      }
    } catch (err) {
      setOtpError(serverErrorMessage(err, t, 'auth.register.step3.errorSendFailed'));
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
      setStep('about');
    } catch (err) {
      setOtpError(serverErrorMessage(err, t, 'auth.register.step3.errorInvalid'));
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
        setStep('about');
      } else {
        setOtpResendTimer(OTP_RESEND_SECONDS);
      }
    } catch (err) {
      setOtpError(serverErrorMessage(err, t, 'auth.register.step3.errorSendFailed'));
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
  const dobTooYoung = !!dateOfBirth && dateOfBirth > maxDOB;

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Pressing Enter in any earlier page's input submits the form and used to
    // fire the final registration prematurely (with errors that page doesn't
    // render). Only the last page performs the actual submit; the visible
    // per-page buttons drive navigation.
    if (step !== 'password') return;
    setError('');
    if (!dateOfBirth) { setError(t('auth.register.validation.dobRequired')); return; }
    if (dateOfBirth > maxDOB) { setError(t('auth.register.validation.ageMin')); return; }
    if (password !== confirmPassword) { setError(t('auth.register.validation.passwordMismatch')); return; }
    const pwdError = validatePassword(password);
    if (pwdError) { setError(pwdError); return; }
    // The intro flag goes up BEFORE register(): App shows AppIntro from its
    // [user] effect, i.e. on the very render that stores the new account. Set
    // afterwards (and, until 11.10.2026, only after an awaited Wohnort save),
    // the intro either opened on that render or missed it and replayed later
    // over the finished onboarding — now it is always right after sign-up,
    // before onboarding step 1.
    safeStorage.setItem(NEW_REG_KEY, '1');
    try {
      await register(email, password, name, referralCode.trim() || undefined, dateOfBirth, gender || undefined);
    } catch (err) {
      // No account → no intro: a leftover flag would open it on a later login.
      safeStorage.removeItem(NEW_REG_KEY);
      setError(serverErrorMessage(err, t, 'auth.register.validation.registerFailed'));
      return;
    }
    // Nothing may be awaited between register() and this navigate: AuthRoute
    // redirects on the same setUser, and both must land on /onboarding
    // (utils/authRedirect.js). replace: the registration wizard must not stay
    // in history — back from onboarding should not re-enter the (now
    // consumed) signup form.
    navigate('/onboarding', { replace: true });
  };

  // Back from the code page AND from the about page goes to identity — not
  // to the code page: the code was already consumed when it was verified, so
  // returning there would dead-end on a verify screen. Re-sending from
  // identity issues a fresh code.
  const backTo = { code: 'identity', about: 'identity', password: 'about' }[step];
  const goBack = backTo
    ? () => { setStep(backTo); setOtpCode(''); setOtpError(''); setError(''); }
    : undefined;

  return (
    <div className="auth-screen auth-screen--scroll reg-screen">
      <FlowHeader onBack={goBack} current={STEPS.indexOf(step) + 1} total={STEPS.length} />

      {guestBlocked && (
        <div className="reg-guest-banner">
          {t('auth.register.guestBlocked')}
        </div>
      )}

      <div className="auth-mid reg-mid">
        <form onSubmit={handleSubmit} className="auth-form reg-form">
          {/* key → each page mounts fresh and plays the enter animation */}
          <div className="reg-page" key={step}>

            {/* ── 1 · Name + E-Mail ─────────────────────────────────────── */}
            {step === 'identity' && (
              <>
                <div className="reg-step-heading">
                  <StepTitle line1={t('auth.register.identity.titleLine1')} line2={t('auth.register.identity.titleLine2')} />
                  <p className="reg-hint">{t('auth.register.identity.hint')}</p>
                </div>
                <div className="form-group">
                  <label htmlFor="reg-name">{t('auth.register.step1.label')}</label>
                  <input
                    id="reg-name"
                    type="text"
                    placeholder={t('auth.register.step1.placeholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="reg-email">{t('auth.register.step2.label')}</label>
                  <input
                    id="reg-email"
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
                  disabled={!name.trim() || !email.trim() || otpLoading}
                >
                  {otpLoading ? t('common.sending') : t('auth.register.step2.sendCode')}
                </button>
              </>
            )}

            {/* ── 2 · Code ──────────────────────────────────────────────── */}
            {step === 'code' && (
              <>
                <div className="reg-step-heading">
                  <StepTitle line1={t('auth.register.code.titleLine1')} line2={t('auth.register.code.titleLine2')} />
                  {/* One sentence with the address inside: the old prefix/
                      address/suffix split lost the space before „gesendet."
                      („…@example.comgesendet."). */}
                  <p className="reg-hint">
                    <Trans
                      i18nKey="auth.register.code.hint"
                      values={{ email: email.trim() }}
                      components={{ 1: <strong className="reg-hint-em" /> }}
                    />
                  </p>
                </div>
                <div className="form-group">
                  <label htmlFor="reg-otp">{t('auth.register.step3.label')}</label>
                  <input
                    id="reg-otp"
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

            {/* ── 3 · Geburtsdatum + Geschlecht ─────────────────────────── */}
            {step === 'about' && (
              <>
                <div className="reg-step-heading">
                  <StepTitle line1={t('auth.register.about.titleLine1')} line2={t('auth.register.about.titleLine2')} />
                  <p className="reg-hint">{t('auth.register.about.hint')}</p>
                </div>
                <div className="form-group">
                  <label htmlFor="reg-dob">{t('auth.register.about.dobLabel')}</label>
                  <input
                    id="reg-dob"
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    max={maxDOB}
                    required
                    style={{ colorScheme: 'dark' }}
                  />
                  {dobTooYoung && (
                    <p className="error-message">{t('auth.register.step4.errorAge')}</p>
                  )}
                </div>
                {/* Gender as bubbles (Tina's checklist). Asked here so an
                    e-mail account is never created without one; onboarding
                    only asks when the server still has none (Google sign-in,
                    or an older server that ignored the field). */}
                <div className="form-group">
                  <span className="reg-label" id="reg-gender-label">{t('auth.register.about.genderLabel')}</span>
                  <div className="reg-bubbles" role="radiogroup" aria-labelledby="reg-gender-label">
                    {GENDER_OPTIONS.map(({ value, labelKey, icon }) => {
                      const selected = gender === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`reg-bubble${selected ? ' selected' : ''}`}
                          onClick={() => setGender(value)}
                        >
                          {/* The tick takes the glyph's place: the bubble
                              keeps its width, so the row never re-wraps. */}
                          <span className="reg-bubble-icon" aria-hidden="true">
                            {selected ? <CheckIcon /> : icon}
                          </span>
                          {t(labelKey)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  className="auth-btn auth-btn-primary"
                  onClick={() => setStep('password')}
                  disabled={!dateOfBirth || dobTooYoung || !gender}
                >
                  {t('common.continue')}
                </button>
              </>
            )}

            {/* ── 4 · Passwort ──────────────────────────────────────────── */}
            {step === 'password' && (
              <>
                <div className="reg-step-heading">
                  <StepTitle line1={t('auth.register.password.titleLine1')} line2={t('auth.register.password.titleLine2')} />
                  <p className="reg-hint">{t('auth.register.step6.hint')}</p>
                </div>
                <div className="form-group">
                  <label htmlFor="reg-password">{t('auth.register.step6.label')}</label>
                  <PasswordInput
                    id="reg-password"
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
                  <label htmlFor="reg-password-confirm">{t('auth.register.step6.confirmLabel')}</label>
                  <PasswordInput
                    id="reg-password-confirm"
                    placeholder={t('auth.shared.confirmPasswordPlaceholder')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="reg-referral">
                    {t('auth.register.step6.referralLabel')}
                    <span className="field-optional"> {t('auth.shared.fieldOptional')}</span>
                  </label>
                  <input
                    id="reg-referral"
                    type="text"
                    placeholder={t('auth.register.step6.referralPlaceholder')}
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                    className="referral-input"
                    autoComplete="off"
                  />
                </div>
                <label className="reg-consent">
                  <input
                    type="checkbox"
                    checked={consentGiven}
                    onChange={(e) => setConsentGiven(e.target.checked)}
                  />
                  <span>
                    <Trans
                      i18nKey="auth.shared.consentText"
                      components={{
                        1: <Link to="/privacy" target="_blank" />,
                        2: <Link to="/terms" target="_blank" />,
                        3: <Link to="/guidelines" target="_blank" />,
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

          </div>
        </form>
      </div>

      {/* Bottom — login link */}
      <div className="auth-bottom reg-bottom">
        <p>
          {t('auth.register.alreadyAccount')}{' '}
          <Link to="/login" className="auth-link">{t('auth.register.loginLink')}</Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
