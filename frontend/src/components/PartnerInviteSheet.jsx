import { useContext, useEffect, useId, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { partnerApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { serverErrorMessage } from '../utils/apiError';
import StarIcon from './StarIcon';

// The partner message of a club at its free limit — Tina's two letters
// (17.11.2026), word for word, in the sheet of „Tageslimit erreicht“ („Ähnlich
// wie in dem Stil“, her image 13 = DailyLimitModal: X top right, the icon
// square, title, a bold line, the card with three round bullets, the coral
// button, an underlined line below).
//
//   reason 'concurrent'  a second event while the first is still ahead:
//                        „Hey [Betrieb], ihr seid ja schnell! 🙌“, with „Noch
//                        nicht bereit? …“ below the button
//   reason 'third'       the third event: „… schön, dass ihr wieder ein Event
//                        plant! 🙌“ — no line below, only the X (Tina: „Und
//                        ein X im rechten oberen Eck, damit man es wegklicken
//                        kann“)
//   reason 'ticket'      „Kostenfreies Event“ unticked: the first letter
//                        without „Noch nicht bereit? …“ (a ticket event does
//                        not become free by waiting)
//   reason 'deal'        a deal from the third event on: the second letter
//
// No prices anywhere, on any platform (Tobi 17.11.2026): the two price
// sentences of Tina's letters are left out, everything else is hers.
//
// „Ja, meldet euch!“ turns the same sheet into the form „JAMIE Anfrage“:
// name, company (optional), e-mail, phone, a switch preset to „ich möchte
// lieber per Mail kontaktiert werden“ that turns to „… per Anruf …“, and the
// privacy tick. The server checks everything again (partnerController).
//
// z-index 10000 like DailyLimitModal — above the status scrim (150) and every
// sheet below; the bottom padding clears the bottom nav (--nav-safe-bottom).

const CORAL = '#FD7666';
const PUBLIC_WEB_ORIGIN = 'https://app.jamie-app.com';
// The same shapes the server checks (partnerController.parsePartnerLead).
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_SHAPE = /^[+0-9 ()/-]{6,40}$/;
const REASONS = ['concurrent', 'third', 'ticket', 'deal'];
// The three benefits' emojis are Tina's; the texts are translated.
const BENEFITS = [['📅', 'b1'], ['🎁', 'b2'], ['⭐', 'b3']];

const muted = { color: 'rgba(255,255,255,0.65)' };
const FIELD_BORDER = 'rgba(255,255,255,0.12)';
const FIELD_BORDER_ERROR = 'rgba(255,138,138,0.7)';
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: '14px',
  background: 'rgba(255,255,255,0.05)', borderWidth: '1px', borderStyle: 'solid', borderColor: FIELD_BORDER,
  color: '#fff', fontSize: '16px', fontFamily: 'inherit', outline: 'none', // 16px: no iOS zoom on focus
};
const labelStyle = { display: 'block', margin: '0 0 6px', color: 'rgba(255,255,255,0.75)', fontSize: '13px', fontWeight: 700 };
const errorStyle = { margin: '6px 0 0', color: '#ff8a8a', fontSize: '12.5px', lineHeight: 1.4 };
const ctaStyle = {
  width: '100%', padding: '17px', borderRadius: '18px', border: 'none',
  background: CORAL, color: '#fff', fontFamily: 'inherit',
  fontSize: '16px', fontWeight: '900', letterSpacing: '0.2px', cursor: 'pointer',
  boxShadow: '0 10px 32px rgba(253,118,102,0.4), 0 2px 8px rgba(0,0,0,0.3)',
};

function PartnerIcon() {
  return (
    <div aria-hidden="true" style={{
      width: '64px', height: '64px', borderRadius: '18px', margin: '0 auto 14px',
      background: 'rgba(253,118,102,0.10)', border: '1px solid rgba(253,118,102,0.25)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: CORAL,
    }}>
      <StarIcon size={30} strokeLinecap="round" strokeLinejoin="round" />
    </div>
  );
}

export const PartnerInviteSheet = ({ reason = 'concurrent', clubId, clubName = '', onClose }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useContext(AuthContext) || {};
  const uid = useId();
  const titleId = `${uid}-title`;

  const source = REASONS.includes(reason) ? reason : 'concurrent';
  // Which of Tina's two letters: the „third event“ one also answers a deal.
  const v = source === 'third' || source === 'deal' ? 'third' : 'concurrent';

  const [step, setStep] = useState('pitch');            // 'pitch' | 'form'
  const [form, setForm] = useState(() => ({
    name: user?.name || '', company: '', email: user?.email || '', phone: '',
  }));
  const [byCall, setByCall] = useState(false);           // off = by mail (Tina's preset)
  const [privacy, setPrivacy] = useState(false);
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);

  // Esc closes, like the X.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key) => (e) => {
    const { value } = e.target;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  // What must hold before anything is sent — shown under the field, no toast.
  const check = () => {
    const found = {};
    if (!form.name.trim()) found.name = t('partner.request.errors.name');
    const email = form.email.trim();
    if (email ? !EMAIL_SHAPE.test(email) : !byCall) found.email = t('partner.request.errors.email');
    const phone = form.phone.trim();
    if (phone ? !PHONE_SHAPE.test(phone) : byCall) found.phone = t('partner.request.errors.phone');
    if (!privacy) found.privacy = t('partner.request.errors.privacy');
    return found;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (sending) return;
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) return;
    setSending(true);
    try {
      await partnerApi.requestPartner(clubId, {
        name: form.name.trim(),
        company: form.company.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        contact: byCall ? 'call' : 'mail',
        privacy: true,
        reason: source,
      });
      // A second request within a day answers like the first (duplicate).
      toast.success(t('partner.request.sent'));
      onClose?.();
    } catch (err) {
      const data = err?.response?.data;
      const field = data?.code === 'LEAD_INVALID' ? data.field : null;
      if (field && ['name', 'email', 'phone', 'privacy'].includes(field)) {
        setErrors({ [field]: t(`partner.request.errors.${field}`) });
      } else {
        toast.error(serverErrorMessage(err, t, 'partner.request.error'));
      }
      setSending(false);
    }
  };

  const field = (key, { type = 'text', inputMode, autoComplete, placeholder, maxLength } = {}) => (
    <div style={{ marginBottom: '14px' }}>
      <label htmlFor={`${uid}-${key}`} style={labelStyle}>{t(`partner.request.${key}`)}</label>
      <input
        id={`${uid}-${key}`}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={maxLength}
        value={form[key]}
        onChange={set(key)}
        aria-invalid={errors[key] ? 'true' : undefined}
        aria-describedby={errors[key] ? `${uid}-${key}-error` : undefined}
        style={{ ...inputStyle, borderColor: errors[key] ? FIELD_BORDER_ERROR : FIELD_BORDER }}
      />
      {errors[key] && <p id={`${uid}-${key}-error`} role="alert" style={errorStyle}>{errors[key]}</p>}
    </div>
  );

  return (
    <div
      className="partner-sheet-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        className="partner-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          position: 'relative', width: '100%', maxWidth: '500px', boxSizing: 'border-box',
          background: 'linear-gradient(175deg, #2E2455 0%, #1A1433 60%)',
          borderRadius: '28px 28px 0 0',
          border: '1px solid rgba(253,118,102,0.22)', borderBottom: 'none',
          // Same nav clearance as DailyLimitModal: the sheet is fixed to the
          // viewport bottom while .bottom-nav owns that edge.
          padding: '22px 22px calc(60px + var(--nav-safe-bottom) + 16px)',
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 12px)',
          overflowY: 'auto', overflowX: 'hidden',
        }}
      >
        <button type="button" onClick={onClose} aria-label={t('partner.close')} style={{
          position: 'absolute', top: '18px', right: '18px',
          width: '32px', height: '32px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '16px', lineHeight: 1, padding: 0,
        }}>
          ✕
        </button>

        {step === 'pitch' ? (
          <>
            <div style={{ textAlign: 'center', marginTop: '8px' }}>
              <PartnerIcon />
              <h2 id={titleId} style={{
                margin: '0 auto 12px', maxWidth: '340px', fontSize: '24px', fontWeight: '900', lineHeight: 1.2,
                color: '#fff', overflowWrap: 'anywhere',
              }}>
                {t(`partner.${v}.title`, { name: clubName })}
              </h2>
              <p style={{ margin: '0 auto 18px', maxWidth: '340px', ...muted, fontSize: '14.5px', lineHeight: 1.55 }}>
                {t(`partner.${v}.intro`)}
              </p>
            </div>

            <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: '800', lineHeight: 1.35, color: '#fff' }}>
              {t(`partner.${v}.lead`)}
            </h3>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '14px',
              background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '18px', padding: '16px', marginBottom: '18px',
            }}>
              {BENEFITS.map(([emoji, key]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '13px' }}>
                  <div aria-hidden="true" style={{
                    width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
                    background: 'rgba(253,118,102,0.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '19px', lineHeight: 1,
                  }}>
                    {emoji}
                  </div>
                  <div style={{ color: '#fff', fontWeight: '800', fontSize: '14.5px', lineHeight: 1.3, minWidth: 0 }}>
                    {t(`partner.${v}.${key}`)}
                  </div>
                </div>
              ))}
            </div>

            <p style={{ margin: '0 auto 12px', maxWidth: '340px', textAlign: 'center', ...muted, fontSize: '13.5px', lineHeight: 1.55 }}>
              {t(`partner.${v}.outro`)}
            </p>
            {v === 'third' && (
              <p style={{ margin: '0 auto 12px', maxWidth: '340px', textAlign: 'center', ...muted, fontSize: '13.5px', lineHeight: 1.55 }}>
                {t('partner.third.outro2')}
              </p>
            )}

            <button type="button" onClick={() => setStep('form')} style={{ ...ctaStyle, marginTop: '6px', marginBottom: '14px' }}>
              {t('partner.cta')}
            </button>

            {source === 'concurrent' && (
              <button type="button" onClick={onClose} style={{
                display: 'block', margin: '0 auto', padding: '8px 12px', maxWidth: '100%',
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                color: 'rgba(255,255,255,0.6)', fontSize: '14px', fontWeight: '600', lineHeight: 1.45,
                textDecoration: 'underline', textUnderlineOffset: '3px',
              }}>
                {t('partner.concurrent.notReady')}
              </button>
            )}
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <h2 id={titleId} style={{ margin: '8px 44px 18px 0', fontSize: '24px', fontWeight: '900', lineHeight: 1.2, color: '#fff' }}>
              {t('partner.request.title')}
            </h2>

            {field('name', { autoComplete: 'name', maxLength: 100 })}
            {field('company', { autoComplete: 'organization', maxLength: 150, placeholder: t('partner.request.companyPlaceholder') })}
            {field('email', { type: 'email', inputMode: 'email', autoComplete: 'email', maxLength: 254 })}
            {field('phone', { type: 'tel', inputMode: 'tel', autoComplete: 'tel', maxLength: 40 })}

            {/* Tina: „so ein Schaltknopf der voreingestellt ist auf ‚ich möchte
                lieber per Mail kontaktiert werden‘ und zum rüberschalten auf
                ‚ich möchte lieber per Anruf kontaktiert werden‘“ — off = mail.
                The sentence is the switch's label and changes with it. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '2px 0 16px' }}>
              <button
                type="button"
                role="switch"
                aria-checked={byCall}
                aria-labelledby={`${uid}-contact`}
                onClick={() => setByCall((on) => !on)}
                style={{
                  position: 'relative', flexShrink: 0, width: '50px', height: '30px', borderRadius: '15px', padding: 0,
                  border: 'none', cursor: 'pointer', transition: 'background 0.2s',
                  background: byCall ? CORAL : 'rgba(255,255,255,0.18)',
                }}
              >
                <span style={{
                  position: 'absolute', top: '3px', left: byCall ? '23px' : '3px', width: '24px', height: '24px',
                  borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </button>
              <span id={`${uid}-contact`} style={{ color: '#fff', fontSize: '14px', lineHeight: 1.4, minWidth: 0 }}>
                {byCall ? t('partner.request.contactCall') : t('partner.request.contactMail')}
              </span>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }}>
                {/* A real checkbox, drawn like the app's own (the event form's
                    coral tick box): the native one sits invisibly on top and
                    takes the tap, the keyboard and the screen reader. */}
                <span style={{ position: 'relative', width: '22px', height: '22px', flexShrink: 0, marginTop: '1px' }}>
                  <input
                    type="checkbox"
                    checked={privacy}
                    onChange={(e) => {
                      setPrivacy(e.target.checked);
                      setErrors((prev) => (prev.privacy ? { ...prev, privacy: undefined } : prev));
                    }}
                    aria-invalid={errors.privacy ? 'true' : undefined}
                    aria-describedby={errors.privacy ? `${uid}-privacy-error` : undefined}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'pointer' }}
                  />
                  <span aria-hidden="true" style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '22px', height: '22px', boxSizing: 'border-box', borderRadius: '7px',
                    borderWidth: '2px', borderStyle: 'solid',
                    borderColor: privacy ? CORAL : (errors.privacy ? FIELD_BORDER_ERROR : 'rgba(255,255,255,0.35)'),
                    background: privacy ? CORAL : 'transparent',
                  }}>
                    {privacy && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    )}
                  </span>
                </span>
                <span style={{ ...muted, fontSize: '13.5px', lineHeight: 1.5, minWidth: 0 }}>
                  <Trans
                    i18nKey="partner.request.privacy"
                    components={{
                      1: <a href={`${PUBLIC_WEB_ORIGIN}/privacy`} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: CORAL, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: '3px' }} />,
                    }}
                  />
                </span>
              </label>
              {errors.privacy && <p id={`${uid}-privacy-error`} role="alert" style={errorStyle}>{errors.privacy}</p>}
            </div>

            <button type="submit" disabled={sending} style={{ ...ctaStyle, opacity: sending ? 0.6 : 1, cursor: sending ? 'default' : 'pointer' }}>
              {sending ? t('partner.request.sending') : t('partner.request.submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default PartnerInviteSheet;
