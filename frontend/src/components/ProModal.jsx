import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { subscription as subscriptionApi } from '../utils/api';
import { PRO_PLANS, DEFAULT_PLAN_KEY, BASELINE_WEEKLY } from '../utils/proPlans';
import { isNativeIOS, IOS_IAP_ENABLED, purchasesEnabled, paymentsComingSoon } from '../utils/platform';
import { subscribePro, restorePurchases } from '../utils/iap';
import { useToast } from '../context/ToastContext';
import { InterestButton } from './InterestButton';

// ── Keyframes injected once ──────────────────────────────────────────────
const STYLE = `
@keyframes pm-slide-up {
  from { transform: translateY(100%); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@keyframes pm-crown {
  0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
  60%  { transform: scale(1.2) rotate(4deg);  opacity: 1; }
  100% { transform: scale(1)   rotate(0deg);  opacity: 1; }
}
@keyframes pm-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
@keyframes pm-check {
  from { stroke-dashoffset: 50; }
  to   { stroke-dashoffset: 0;  }
}
@keyframes pm-confetti {
  0%   { transform: translate(0,0) rotate(0deg);   opacity:1; }
  100% { transform: translate(var(--cx),var(--cy)) rotate(var(--cr)); opacity:0; }
}
@keyframes pm-pulse-ring {
  0%   { transform: scale(.9); opacity:.7; }
  100% { transform: scale(1.6); opacity:0; }
}
`;

const CONFETTI_CHARS = ['🎊','✨','⭐','💛','🌟','🎉','👑'];

// ── Stripe form ──────────────────────────────────────────────────────────
function StripeSubscribeForm({ onSuccess, onCancel, mode = 'payment' }) {
  const { t } = useTranslation();
  const stripe   = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');
    // redirect:'if_required' lets Stripe handle 3D Secure / SCA challenges
    // via its in-page modal for cards that support iframe 3DS (most EU
    // cards). Only the rare full-page-redirect 3DS will navigate away.
    //
    // Free trial (mode==='setup') → there is NO charge now, so we confirm a
    // SetupIntent to store the card; Stripe auto-charges when the 14-day trial
    // ends. Paid (mode==='payment') → confirm the PaymentIntent immediately.
    if (mode === 'setup') {
      const { error: err, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (err) { setError(err.message); setLoading(false); return; }
      if (setupIntent?.status === 'succeeded') { onSuccess(); return; }
      setError(t('pro.unexpectedStatus', { defaultValue: 'Es hat nicht geklappt. Bitte erneut versuchen.' }));
      setLoading(false);
      return;
    }
    const { error: err, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    // 'succeeded' = charged, Pro active. 'processing' = bank still working,
    // webhook will flip the row to active within a few seconds — close the
    // modal optimistically since the user can't do anything useful here.
    // Any other status (requires_action, requires_payment_method) means we
    // shouldn't claim success; surface it so the user can retry.
    const status = paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing') {
      onSuccess();
      return;
    }
    setError(t('pro.unexpectedStatus', { defaultValue: 'Zahlung konnte nicht abgeschlossen werden. Bitte erneut versuchen.' }));
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && (
        <div style={{
          marginTop:'12px', padding:'12px 14px',
          background:'rgba(255,107,107,0.1)', border:'1px solid rgba(255,107,107,0.3)',
          borderRadius:'10px', color:'#ff8a8a', fontSize:'13px',
        }}>
          {error}
        </div>
      )}
      <div style={{ display:'flex', gap:'10px', marginTop:'20px' }}>
        <button type="button" onClick={onCancel} style={{
          flex:1, padding:'15px', borderRadius:'14px',
          background:'rgba(255,255,255,0.06)',
          border:'1px solid rgba(255,255,255,0.1)',
          color:'rgba(255,255,255,0.55)',
          cursor:'pointer', fontWeight:'600', fontSize:'14px',
        }}>
          {t('pro.back')}
        </button>
        <button type="submit" disabled={loading || !stripe} style={{
          flex:2, padding:'15px', borderRadius:'14px', border:'none',
          background: loading
            ? 'rgba(253,118,102,0.3)'
            : 'linear-gradient(135deg, #FD7666 0%, #e5574a 100%)',
          color: loading ? 'rgba(255,255,255,0.5)' : '#fff',
          fontWeight:'800', fontSize:'15px',
          cursor: loading ? 'not-allowed' : 'pointer',
          boxShadow: loading ? 'none' : '0 6px 20px rgba(253,118,102,0.35)',
        }}>
          {loading
            ? <span style={{ display:'inline-flex', gap:'6px', alignItems:'center' }}>
                <Spinner /> {t('pro.verifying')}
              </span>
            : (mode === 'setup' ? t('pro.ctaTrialStart') : t('pro.ctaSubscribe'))}
        </button>
      </div>
      <p style={{
        textAlign:'center', color:'rgba(255,255,255,0.28)',
        fontSize:'11px', marginTop:'14px', letterSpacing:'0.3px',
      }}>
        {t('pro.secure')}
      </p>
    </form>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ animation:'spin 0.8s linear infinite' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  );
}

// ── Feature rows ─────────────────────────────────────────────────────────
const FEATURE_KEYS = [
  { icon:'⚡', titleKey:'boostGroups',   descKey:'boostGroupsDesc' },
  { icon:'🏆', titleKey:'boostClubs',    descKey:'boostClubsDesc' },
  { icon:'👥', titleKey:'seeMembers',    descKey:'seeMembersDesc' },
  { icon:'🔝', titleKey:'topPlacement', descKey:'topPlacementDesc' },
  { icon:'⭐', titleKey:'deals',         descKey:'dealsDesc' },
];

// Context-specific rows, prepended when the modal is opened from the feature
// the user just bumped into — so the first bubble answers "why am I seeing
// this?" instead of making them hunt for it in the generic list.
// Keyed by the `feature` in the jamie:open-pro-modal event detail.
const CONTEXT_FEATURE = {
  paidEvents: { icon:'🎟️', titleKey:'paidEvents', descKey:'paidEventsDesc' },
};

// ── Confetti piece ───────────────────────────────────────────────────────
function Confetto({ i }) {
  const angle = (i / CONFETTI_CHARS.length) * 360;
  const dist  = 70 + Math.random() * 50;
  const cx    = Math.round(Math.cos((angle * Math.PI) / 180) * dist);
  const cy    = Math.round(Math.sin((angle * Math.PI) / 180) * dist - 30);
  return (
    <span style={{
      position:'absolute', left:'50%', top:'50%',
      fontSize:'20px', pointerEvents:'none',
      '--cx': `${cx}px`, '--cy': `${cy}px`,
      '--cr': `${-60 + Math.random() * 120}deg`,
      animation:`pm-confetti 1.4s ease-out ${i * 0.09}s forwards`,
    }}>
      {CONFETTI_CHARS[i % CONFETTI_CHARS.length]}
    </span>
  );
}

// ── Plan tile ──────────────────────────────────────────────────────────────
// One selectable row in the Hinge-style pricing grid. Per-week price is the
// headline; the struck-through baseline + green "X% sparen" chip drive the
// "Sparfaktor". Selected tile gets a coral border + check.
// Palette (Tina, 2026-06-12): brand tones — purple base, coral accents,
// white headlines. Yellow only as a rare highlight (crown emoji, confetti);
// the old all-gold look read as "Burger King".
function PlanTile({ plan, selected, onSelect, t }) {
  const badge = plan.badgeKey ? t(`pro.plans.badges.${plan.badgeKey}`) : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(plan.key)}
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        textAlign: 'left',
        padding: badge ? '16px 16px 14px' : '14px 16px',
        marginTop: badge ? '10px' : 0,
        borderRadius: '16px',
        cursor: 'pointer',
        background: selected
          ? 'linear-gradient(135deg, rgba(253,118,102,0.14), rgba(253,118,102,0.05))'
          : 'rgba(255,255,255,0.04)',
        border: selected ? '1.5px solid #FD7666' : '1.5px solid rgba(255,255,255,0.1)',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {/* Badge */}
      {badge && (
        <span style={{
          position: 'absolute', top: '-10px', left: '14px',
          padding: '3px 10px', borderRadius: '20px',
          background: 'linear-gradient(135deg, #FD7666, #e5574a)',
          color: '#fff', fontSize: '11px', fontWeight: '800',
          letterSpacing: '0.2px', whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(253,118,102,0.4)',
        }}>
          {badge}
        </span>
      )}

      {/* Left: radio + term + billed */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <span style={{
          flexShrink: 0, width: '22px', height: '22px', borderRadius: '50%',
          border: selected ? 'none' : '2px solid rgba(255,255,255,0.25)',
          background: selected ? '#FD7666' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {selected && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20,6 9,17 4,12" />
            </svg>
          )}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#fff', fontWeight: '700', fontSize: '15px', lineHeight: 1.2 }}>
            {t(`pro.plans.terms.${plan.termKey}`)}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginTop: '2px' }}>
            {t(`pro.plans.${plan.billedKey}`)}
          </div>
        </div>
      </div>

      {/* Right: per-week price + struck baseline + savings chip */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', justifyContent: 'flex-end' }}>
          {plan.strikethrough && (
            <span style={{
              color: 'rgba(255,255,255,0.35)', fontSize: '13px',
              textDecoration: 'line-through', textDecorationColor: 'rgba(255,120,120,0.8)',
            }}>
              {BASELINE_WEEKLY} €
            </span>
          )}
          <span style={{ color: '#fff', fontWeight: '900', fontSize: '19px', lineHeight: 1 }}>
            {plan.perWeek} €
          </span>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '11px', marginTop: '3px' }}>
          {t('pro.plans.perWeek')}
        </div>
        {plan.savings != null && (
          <span style={{
            display: 'inline-block', marginTop: '5px',
            padding: '2px 8px', borderRadius: '20px',
            background: 'rgba(34,197,94,0.18)', color: '#4ade80',
            fontSize: '11px', fontWeight: '800',
          }}>
            {t('pro.plans.savePct', { pct: plan.savings })}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Main modal ───────────────────────────────────────────────────────────
export const ProModal = ({ onClose, onSuccess, feature = null }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [step,          setStep]          = useState('features');
  const [selectedPlan,  setSelectedPlan]  = useState(DEFAULT_PLAN_KEY);
  const [stripePromise, setStripePromise] = useState(null);
  const [clientSecret,  setClientSecret]  = useState(null);
  // 'setup' = 14-day free trial (SetupIntent, no charge now); 'payment' = charge
  // immediately (returning subscribers). The server decides based on history.
  const [paymentMode,   setPaymentMode]   = useState('payment');
  const [trialDays,     setTrialDays]     = useState(0);
  const [loading,       setLoading]       = useState(false);
  // §18 FAGG: the consumer must actively consent to immediate performance and
  // the resulting loss of the 14-day withdrawal right BEFORE purchase.
  const [consented,     setConsented]     = useState(false);
  // Whether THIS user still gets the 14-day trial. Asked up front, because the
  // trial is first-subscription-only (anti-farming) — advertising "14 Tage
  // kostenlos" to a returning subscriber who is then charged immediately is a
  // false promise, and in AT/DE a consumer-law problem (Tobi hit it on
  // 2026-09-03). null = not yet known: until the answer arrives we show the
  // NEUTRAL copy, never the trial claim, so a slow request can't over-promise.
  const [trialEligible, setTrialEligible] = useState(null);

  useEffect(() => {
    let cancelled = false;
    subscriptionApi.getStatus()
      .then(res => { if (!cancelled) setTrialEligible(res.data?.trial_eligible !== false); })
      // On error assume NO trial — the safe direction: understating the offer is
      // recoverable, promising a trial that doesn't materialise is not.
      .catch(() => { if (!cancelled) setTrialEligible(false); });
    return () => { cancelled = true; };
  }, []);
  const showTrialOffer = trialEligible === true;

  const maxSavings = Math.max(...PRO_PLANS.map(p => p.savings || 0));

  const startPayment = async () => {
    // Safety net: iOS purchases are hidden until StoreKit IAP ships. The CTA
    // shouldn't render in that state, but never start a purchase if it somehow does.
    if (!purchasesEnabled()) return;
    setLoading(true);
    try {
      // iOS native build → StoreKit subscription (App Review 3.1.1).
      // Goes straight to success on Apple's approval; no Stripe sheet.
      if (isNativeIOS()) {
        await subscribePro(selectedPlan);
        setStep('success');
        setTimeout(() => { onSuccess?.(); onClose?.(); }, 3000);
        return;
      }
      const res = await subscriptionApi.create(selectedPlan);
      const { client_secret, publishable_key, mode, trial_days } = res.data;
      setPaymentMode(mode || 'payment');
      setTrialDays(trial_days || 0);
      setStripePromise(loadStripe(publishable_key));
      setClientSecret(client_secret);
      setStep('payment');
    } catch (err) {
      if (!/cancel/i.test(err?.message || '')) {
        toast.error(err.response?.data?.error || err.message || t('pro.startError'));
      }
    } finally {
      setLoading(false);
    }
  };

  const onPaySuccess = () => {
    setStep('success');
    setTimeout(() => { onSuccess?.(); onClose?.(); }, 3000);
  };

  const [restoreLoading, setRestoreLoading] = useState(false);
  const handleRestore = async () => {
    setRestoreLoading(true);
    try {
      const { restored } = await restorePurchases();
      if (restored > 0) {
        setStep('success');
        setTimeout(() => { onSuccess?.(); onClose?.(); }, 3000);
      } else {
        toast.info?.(t('pro.restoreNone', { defaultValue: 'Keine Käufe zum Wiederherstellen gefunden' }))
          || toast.success(t('pro.restoreNone', { defaultValue: 'Keine Käufe zum Wiederherstellen gefunden' }));
      }
    } catch (err) {
      if (!/cancel/i.test(err?.message || '')) {
        toast.error(err.message || t('pro.restoreError', { defaultValue: 'Wiederherstellung fehlgeschlagen' }));
      }
    } finally {
      setRestoreLoading(false);
    }
  };

  // Success is a full-screen celebration (crown + confetti fill the page);
  // the plan/payment steps stay a bottom half-sheet.
  const isSuccess = step === 'success';

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      {/* Backdrop */}
      <div
        onClick={(e) => { if (e.target === e.currentTarget && step !== 'success') onClose?.(); }}
        style={{
          position:'fixed', inset:0, zIndex:10000,
          background:'rgba(0,0,0,0.8)', backdropFilter:'blur(6px)',
          display:'flex', alignItems: isSuccess ? 'center' : 'flex-end', justifyContent:'center',
        }}
      >
        {/* Sheet */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position:'relative',
            width:'100%',
            maxWidth: isSuccess ? '100%' : '500px',
            // Success: transparent + full-screen so the crown/confetti sit on the
            // dark blurred backdrop and cover the whole page. Other steps: the
            // coral-bordered bottom sheet.
            background: isSuccess ? 'transparent' : 'linear-gradient(175deg, #2E2455 0%, #1A1433 60%)',
            borderRadius: isSuccess ? 0 : '28px 28px 0 0',
            border: isSuccess ? 'none' : '1px solid rgba(253,118,102,0.22)',
            borderBottom:'none',
            // Top padding is a plain 18px (NOT safe-area + 16): maxHeight below
            // already caps the sheet's top edge at safe-area + 12px, so adding
            // the inset here too double-counted it and left a big empty gap.
            //
            // BOTTOM = nav clearance, not the bare home-indicator inset.
            // .bottom-nav is a flex child at the end of the dvh-bounded #root
            // column (60px strip + --nav-safe-bottom) and owns the bottom of the
            // screen, while this sheet is position:fixed flush to the VIEWPORT
            // bottom — so a bare inset leaves the last row (here: the plan CTA)
            // sitting behind the nav. Same fix + invariant as BoostModal
            // (Tina 2026-09-03). Success is full-screen and centered, so it only
            // needs the plain inset.
            padding: isSuccess
              ? `env(safe-area-inset-top, 0px) 22px calc(env(safe-area-inset-bottom, 0px) + 12px)`
              : `18px 22px calc(60px + var(--nav-safe-bottom) + 16px)`,
            // Full height on success so the celebration owns the screen; capped
            // half-sheet otherwise (top edge 12px below the status bar).
            height: isSuccess ? '100dvh' : 'auto',
            maxHeight: isSuccess ? '100dvh' : 'calc(100dvh - env(safe-area-inset-top, 0px) - 12px)',
            // Center the celebration; block flow for the sheet steps.
            display: isSuccess ? 'flex' : 'block',
            flexDirection: isSuccess ? 'column' : undefined,
            alignItems: isSuccess ? 'center' : undefined,
            justifyContent: isSuccess ? 'center' : undefined,
            overflowY:'auto',
            animation: isSuccess ? 'none' : 'pm-slide-up 0.38s cubic-bezier(.25,.8,.25,1) both',
          }}
        >
          {/* ── SUCCESS ─────────────────────────── */}
          {step === 'success' && (
            <div style={{ textAlign:'center', padding:'30px 0 20px', position:'relative' }}>
              {CONFETTI_CHARS.map((_,i) => <Confetto key={i} i={i} />)}
              <div style={{ position:'relative', display:'inline-block', marginBottom:'20px' }}>
                <div style={{
                  position:'absolute', inset:'-20px', borderRadius:'50%',
                  border:'2px solid #FD7666',
                  animation:'pm-pulse-ring 1.2s ease-out infinite',
                }} />
                <div style={{
                  width:'90px', height:'90px', borderRadius:'50%',
                  background:'linear-gradient(135deg, #FD766622, #FD766608)',
                  border:'2px solid #FD766655',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:'44px',
                  animation:'pm-crown 0.6s cubic-bezier(.34,1.56,.64,1) both',
                }}>
                  👑
                </div>
                {/* Checkmark circle */}
                <div style={{
                  position:'absolute', bottom:'-4px', right:'-4px',
                  width:'30px', height:'30px', borderRadius:'50%',
                  background:'#22c55e',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20,6 9,17 4,12"
                      style={{ strokeDasharray:50, strokeDashoffset:0, animation:'pm-check .4s .4s ease both' }} />
                  </svg>
                </div>
              </div>
              <h2 style={{ fontSize:'26px', fontWeight:'900', color:'#fff', margin:'0 0 10px' }}>
                {t('pro.successTitle')}
              </h2>
              <p style={{ color:'rgba(255,255,255,0.6)', fontSize:'15px', lineHeight:1.7, maxWidth:'280px', margin:'0 auto' }}>
                {t('pro.successBody')}
              </p>
            </div>
          )}

          {/* ── FEATURES ────────────────────────── */}
          {step === 'features' && (
            <>
              {/* Close */}
              <button onClick={onClose} style={{
                position:'absolute', top:'20px', right:'20px',
                width:'32px', height:'32px', borderRadius:'50%',
                background:'rgba(255,255,255,0.07)',
                border:'1px solid rgba(255,255,255,0.1)',
                color:'rgba(255,255,255,0.5)', cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:'16px', lineHeight:1,
              }}>
                ✕
              </button>

              {/* Header */}
              <div style={{ textAlign:'center', marginBottom:'22px' }}>
                <div style={{
                  fontSize:'52px', marginBottom:'12px',
                  animation:'pm-crown 0.5s cubic-bezier(.34,1.56,.64,1) both',
                  display:'inline-block',
                }}>
                  👑
                </div>
                <h2 style={{ fontSize:'28px', fontWeight:'900', color:'#fff', margin:'0 0 8px' }}>
                  {t('pro.title')}
                </h2>
                {/* Context call-out: when the modal was opened from a specific
                    locked feature, name that feature right under the title in
                    coral so it reads as "this is what you came for", not a
                    generic upsell. Pairs with the matching first feature bubble
                    below (Tina/Tobi 2026-09-03). */}
                {CONTEXT_FEATURE[feature] && (
                  <p style={{ margin:'0 0 10px', fontSize:'13.5px', fontWeight:'800', color:'#FD7666' }}>
                    {t(`pro.contextCta.${feature}`)}
                  </p>
                )}
                {/* "NEU – Spare bis zu XX%" pill — nur wenn auch wirklich kaufbar.
                    Im "Bald verfügbar"-Zustand wäre ein Spar-Versprechen irreführend. */}
                {purchasesEnabled() && (
                  <div style={{ display:'inline-flex', alignItems:'center', gap:'6px',
                    background:'rgba(34,197,94,0.14)', border:'1px solid rgba(34,197,94,0.35)',
                    borderRadius:'24px', padding:'7px 16px',
                  }}>
                    <span style={{ fontSize:'13px', fontWeight:'900', color:'#4ade80', letterSpacing:'0.3px' }}>
                      {t('pro.newSaveBadge', { pct: maxSavings })}
                    </span>
                  </div>
                )}
                {purchasesEnabled() && showTrialOffer && (
                  <p style={{ margin:'12px 0 0', fontSize:'13.5px', fontWeight:'800', color:'#4ade80' }}>
                    {t('pro.trialHeadline')}
                  </p>
                )}
              </div>

              {/* Plan tiles — weekly first, monthly default ("Beliebt"), 6mo "Bestes Angebot".
                  Nur zeigen, wenn Käufe möglich sind: im Coming-Soon-Zustand sind die
                  Preise nicht kaufbar (und machten das Sheet unnötig lang → unten
                  abgeschnitten). Stattdessen unten die "Bald verfügbar"-Box + Interesse-Button. */}
              {purchasesEnabled() && (
                <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginBottom:'20px' }}>
                  {PRO_PLANS.map(plan => (
                    <PlanTile
                      key={plan.key}
                      plan={plan}
                      selected={selectedPlan === plan.key}
                      onSelect={setSelectedPlan}
                      t={t}
                    />
                  ))}
                </div>
              )}

              {/* Feature cards */}
              <div style={{ display:'flex', flexDirection:'column', gap:'10px', marginBottom:'22px' }}>
                {[...(CONTEXT_FEATURE[feature] ? [CONTEXT_FEATURE[feature]] : []), ...FEATURE_KEYS].map((f, i) => (
                  <div key={i} style={{
                    display:'flex', alignItems:'center', gap:'14px',
                    background:'rgba(255,255,255,0.04)',
                    border:'1px solid rgba(255,255,255,0.09)',
                    borderRadius:'16px', padding:'14px 16px',
                  }}>
                    <div style={{
                      width:'44px', height:'44px', borderRadius:'12px', flexShrink:0,
                      background:'rgba(253,118,102,0.12)',
                      border:'1px solid rgba(253,118,102,0.22)',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize: f.icon === '∞' ? '22px' : '22px',
                      fontWeight:'900', color:'#FD7666',
                    }}>
                      {f.icon}
                    </div>
                    <div>
                      <div style={{ color:'#fff', fontWeight:'700', fontSize:'15px', lineHeight:1.2, marginBottom:'3px' }}>
                        {t(`pro.features.${f.titleKey}`)}
                      </div>
                      <div style={{ color:'rgba(255,255,255,0.45)', fontSize:'12px', lineHeight:1.4 }}>
                        {t(`pro.features.${f.descKey}`)}
                      </div>
                    </div>
                    {/* Checkmark */}
                    <div style={{
                      marginLeft:'auto', width:'22px', height:'22px', borderRadius:'50%',
                      background:'rgba(253,118,102,0.15)', flexShrink:0,
                      display:'flex', alignItems:'center', justifyContent:'center',
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                        stroke="#FD7666" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20,6 9,17 4,12" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>

              {/* Kauf-Flow nur zeigen, wenn Käufe verfügbar sind. Auf iOS ohne
                  fertiges StoreKit-IAP zeigen wir stattdessen eine neutrale Info
                  (KEIN Hinweis auf Web/Android-Kauf — Apple-Anti-Steering 3.1.1). */}
              {purchasesEnabled() ? (
                <>
                  {/* §18 FAGG consent — must be actively ticked before purchase */}
                  <label style={{
                    display:'flex', alignItems:'flex-start', gap:'10px',
                    margin:'0 0 12px', cursor:'pointer',
                  }}>
                    <input
                      type="checkbox"
                      checked={consented}
                      onChange={e => setConsented(e.target.checked)}
                      style={{ marginTop:'2px', width:'18px', height:'18px', accentColor:'#FD7666', flexShrink:0 }}
                    />
                    <span style={{ fontSize:'11.5px', lineHeight:1.45, color:'rgba(255,255,255,0.6)', textAlign:'left' }}>
                      {t('pro.withdrawalConsent')}
                    </span>
                  </label>

                  {/* CTA */}
                  <button
                    onClick={startPayment}
                    disabled={loading || !consented}
                    style={{
                      width:'100%', padding:'19px', borderRadius:'18px', border:'none',
                      background: (loading || !consented)
                        ? 'rgba(253,118,102,0.25)'
                        : 'linear-gradient(270deg, #FD7666, #e5574a, #FD7666)',
                      backgroundSize:'200% auto',
                      animation: (loading || !consented) ? 'none' : 'pm-shimmer 2.5s linear infinite',
                      color: (loading || !consented) ? 'rgba(255,255,255,0.4)' : '#fff',
                      fontSize:'17px', fontWeight:'900', letterSpacing:'0.2px',
                      cursor: (loading || !consented) ? 'not-allowed' : 'pointer',
                      boxShadow: (loading || !consented) ? 'none' : '0 10px 32px rgba(253,118,102,0.4), 0 2px 8px rgba(0,0,0,0.3)',
                      marginBottom:'10px',
                      display:'flex', alignItems:'center', justifyContent:'center', gap:'8px',
                    }}
                  >
                    {loading
                      ? <><Spinner /> {t('pro.loading')}</>
                      : showTrialOffer ? t('pro.ctaTrialStart') : t('pro.ctaSubscribe')}
                  </button>
                </>
              ) : paymentsComingSoon() ? (
                <div style={{
                  textAlign:'center', margin:'4px 0 14px', padding:'18px 16px',
                  background:'rgba(253,118,102,0.08)', border:'1px solid rgba(253,118,102,0.25)',
                  borderRadius:'16px',
                }}>
                  <div style={{ fontSize:'15px', fontWeight:'800', color:'#fff', marginBottom:'4px' }}>
                    {t('payments.comingSoon.proTitle')}
                  </div>
                  <div style={{ fontSize:'13px', lineHeight:1.5, color:'rgba(255,255,255,0.6)', marginBottom:'14px' }}>
                    {t('payments.comingSoon.body')}
                  </div>
                  <InterestButton feature="pro" />
                </div>
              ) : (
                <p style={{
                  fontSize:'13px', lineHeight:1.5, textAlign:'center',
                  color:'rgba(255,255,255,0.6)', margin:'4px 0 14px', padding:'0 4px',
                }}>
                  {t('pro.iosUnavailable', { defaultValue: 'JAMIE Pro ist auf dem iPhone derzeit nicht verfügbar.' })}
                </p>
              )}

              {/* iOS-only: Apple Review 3.1.1 wants Restore Purchases visible
                  during the purchase flow itself, not buried in Settings.
                  Only relevant once IAP ships — nothing to restore otherwise. */}
              {isNativeIOS() && IOS_IAP_ENABLED && (
                <button
                  onClick={restoreLoading ? undefined : handleRestore}
                  disabled={restoreLoading || loading}
                  style={{
                    width:'100%', padding:'12px', borderRadius:'14px',
                    background:'rgba(255,255,255,0.04)',
                    border:'1px solid rgba(255,255,255,0.08)',
                    color:'rgba(255,255,255,0.7)', fontSize:'13px', fontWeight:'600',
                    cursor: restoreLoading ? 'not-allowed' : 'pointer',
                    marginBottom:'10px',
                  }}
                >
                  {restoreLoading
                    ? t('common.loading')
                    : t('pro.restoreBtn', { defaultValue: 'Käufe wiederherstellen' })}
                </button>
              )}

              {/* Apple Guideline 3.1.2 (a): on iOS, the subscription terms —
                  length, auto-renewal, cancellation — must be visible at the
                  point of purchase. Only shown when IAP is actually live. */}
              {isNativeIOS() && IOS_IAP_ENABLED && (
                <p style={{
                  fontSize:'11px', lineHeight:1.45,
                  color:'rgba(255,255,255,0.4)',
                  margin:'0 0 10px', textAlign:'center',
                  padding:'0 4px',
                }}>
                  {t('pro.iosTerms', { defaultValue:
                    'JAMIE Pro verlängert sich automatisch zum gewählten Preis am Ende jeder Laufzeit. Kündbar jederzeit über iOS-Einstellungen → Apple-ID → Abos, mindestens 24 Std. vor Ablauf.' })}
                  {' '}
                  <a href="/terms" target="_blank" rel="noopener" style={{ color:'#FD7666', textDecoration:'underline' }}>
                    {t('pro.terms', { defaultValue: 'AGB' })}
                  </a>
                  {' · '}
                  <a href="/privacy" target="_blank" rel="noopener" style={{ color:'#FD7666', textDecoration:'underline' }}>
                    {t('pro.privacy', { defaultValue: 'Datenschutz' })}
                  </a>
                </p>
              )}

              <button onClick={onClose} style={{
                width:'100%', padding:'13px', borderRadius:'14px',
                background:'none', border:'none',
                color:'rgba(255,255,255,0.3)', fontSize:'13px', cursor:'pointer',
              }}>
                {t('pro.later')}
              </button>
            </>
          )}

          {/* ── PAYMENT ─────────────────────────── */}
          {step === 'payment' && clientSecret && stripePromise && (
            <>
              {/* Step back */}
              <button onClick={() => setStep('features')} style={{
                position:'absolute', top:'20px', left:'22px',
                background:'none', border:'none',
                color:'rgba(255,255,255,0.45)', fontSize:'14px',
                cursor:'pointer', padding:0, fontWeight:'600',
              }}>
                {t('pro.back')}
              </button>

              <div style={{ textAlign:'center', marginBottom:'22px' }}>
                <div style={{ fontSize:'36px', marginBottom:'10px' }}>💳</div>
                <h2 style={{ fontSize:'22px', fontWeight:'900', color:'#fff', margin:'0 0 4px' }}>
                  {t('pro.paymentTitle')}
                </h2>
                <p style={{ color:'rgba(255,255,255,0.4)', fontSize:'13px', margin:0 }}>
                  {t('pro.paymentSub')}
                </p>
              </div>

              {/* Amount reminder — reflects the plan the user picked */}
              {(() => {
                const sel = PRO_PLANS.find(p => p.key === selectedPlan) || PRO_PLANS[0];
                return (
                  <div style={{
                    display:'flex', alignItems:'center', justifyContent:'space-between',
                    background:'rgba(253,118,102,0.08)', border:'1px solid rgba(253,118,102,0.22)',
                    borderRadius:'14px', padding:'12px 16px', marginBottom:'18px',
                  }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                      <span style={{ fontSize:'20px' }}>👑</span>
                      <div>
                        <div style={{ color:'#fff', fontWeight:'700', fontSize:'14px' }}>
                          {t('pro.title')} · {t(`pro.plans.terms.${sel.termKey}`)}
                        </div>
                        <div style={{ color:'rgba(255,255,255,0.4)', fontSize:'12px' }}>
                          {t(`pro.plans.${sel.billedKey}`)}
                        </div>
                      </div>
                    </div>
                    <div style={{ color:'#fff', fontWeight:'900', fontSize:'18px', whiteSpace:'nowrap' }}>
                      {sel.perWeek} €<span style={{ fontSize:'11px', fontWeight:'600', color:'rgba(255,255,255,0.5)' }}>/{t('pro.plans.wkShort')}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Trial disclosure at the point of sale — required to be clear
                  and up front. Only shown when the server granted the trial. */}
              {paymentMode === 'setup' && (
                <div style={{
                  display:'flex', gap:'10px', alignItems:'flex-start',
                  background:'rgba(34,197,94,0.10)', border:'1px solid rgba(34,197,94,0.28)',
                  borderRadius:'14px', padding:'12px 14px', marginBottom:'18px',
                }}>
                  <span style={{ fontSize:'18px', lineHeight:1.2 }}>🎁</span>
                  <p style={{ margin:0, fontSize:'12.5px', lineHeight:1.5, color:'rgba(255,255,255,0.75)' }}>
                    {t('pro.trialDisclosure', { days: trialDays || 14 })}
                  </p>
                </div>
              )}

              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret,
                  appearance: {
                    theme:'night',
                    variables: {
                      colorPrimary:'#FD7666',
                      colorBackground:'#2A2150',
                      colorText:'#ffffff',
                      colorTextSecondary:'rgba(255,255,255,0.5)',
                      colorDanger:'#ff8a8a',
                      borderRadius:'12px',
                      fontFamily:'inherit',
                      spacingUnit:'4px',
                    },
                    rules: {
                      '.Input': { border:'1px solid rgba(253,118,102,0.22)', boxShadow:'none' },
                      '.Input:focus': { border:'1px solid rgba(253,118,102,0.6)', boxShadow:'0 0 0 3px rgba(253,118,102,0.12)' },
                    },
                  },
                }}
              >
                <StripeSubscribeForm mode={paymentMode} onSuccess={onPaySuccess} onCancel={() => setStep('features')} />
              </Elements>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ProModal;
