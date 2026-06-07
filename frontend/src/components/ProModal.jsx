import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { subscription as subscriptionApi } from '../utils/api';
import { useToast } from '../context/ToastContext';

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
function StripeSubscribeForm({ onSuccess, onCancel }) {
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
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (err) { setError(err.message); setLoading(false); }
    else       onSuccess();
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
            ? 'rgba(255,215,0,0.3)'
            : 'linear-gradient(135deg, #FFD700 0%, #FFAA00 100%)',
          color: loading ? 'rgba(255,255,255,0.5)' : '#1a1100',
          fontWeight:'800', fontSize:'15px',
          cursor: loading ? 'not-allowed' : 'pointer',
          boxShadow: loading ? 'none' : '0 6px 20px rgba(255,215,0,0.35)',
        }}>
          {loading
            ? <span style={{ display:'inline-flex', gap:'6px', alignItems:'center' }}>
                <Spinner /> {t('pro.verifying')}
              </span>
            : t('pro.ctaSubscribe')}
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
  { icon:'👥', titleKey:'addFriends',    descKey:'addFriendsDesc' },
  { icon:'💬', titleKey:'dm',            descKey:'dmDesc' },
  { icon:'⚡', titleKey:'boostGroups',   descKey:'boostGroupsDesc' },
  { icon:'🏆', titleKey:'boostClubs',    descKey:'boostClubsDesc' },
  { icon:'🔝', titleKey:'topPlacement', descKey:'topPlacementDesc' },
];

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

// ── Main modal ───────────────────────────────────────────────────────────
export const ProModal = ({ onClose, onSuccess }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [step,          setStep]          = useState('features');
  const [stripePromise, setStripePromise] = useState(null);
  const [clientSecret,  setClientSecret]  = useState(null);
  const [loading,       setLoading]       = useState(false);

  const startPayment = async () => {
    setLoading(true);
    try {
      const res = await subscriptionApi.create();
      const { client_secret, publishable_key } = res.data;
      setStripePromise(loadStripe(publishable_key));
      setClientSecret(client_secret);
      setStep('payment');
    } catch (err) {
      toast.error(err.response?.data?.error || t('pro.startError'));
    } finally {
      setLoading(false);
    }
  };

  const onPaySuccess = () => {
    setStep('success');
    setTimeout(() => { onSuccess?.(); onClose?.(); }, 3000);
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      {/* Backdrop */}
      <div
        onClick={(e) => { if (e.target === e.currentTarget && step !== 'success') onClose?.(); }}
        style={{
          position:'fixed', inset:0, zIndex:10000,
          background:'rgba(0,0,0,0.8)', backdropFilter:'blur(6px)',
          display:'flex', alignItems:'flex-end', justifyContent:'center',
        }}
      >
        {/* Sheet */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position:'relative',
            width:'100%', maxWidth:'500px',
            background:'linear-gradient(175deg, #1c1400 0%, #0d0d22 60%)',
            borderRadius:'28px 28px 0 0',
            border:'1px solid rgba(255,215,0,0.18)',
            borderBottom:'none',
            // Tight bottom padding: just clear the iOS home indicator + minimal
            // breathing room. The previous "+28px" left ~60px of empty space
            // below "Vielleicht später" that read as a gap.
            padding:`24px 22px calc(env(safe-area-inset-bottom,8px) + 8px)`,
            maxHeight:'92vh', overflowY:'auto',
            animation:'pm-slide-up 0.38s cubic-bezier(.25,.8,.25,1) both',
          }}
        >
          {/* Handle bar */}
          <div style={{
            width:'44px', height:'4px',
            background:'rgba(255,255,255,0.13)',
            borderRadius:'2px', margin:'0 auto 20px',
          }} />

          {/* ── SUCCESS ─────────────────────────── */}
          {step === 'success' && (
            <div style={{ textAlign:'center', padding:'30px 0 20px', position:'relative' }}>
              {CONFETTI_CHARS.map((_,i) => <Confetto key={i} i={i} />)}
              <div style={{ position:'relative', display:'inline-block', marginBottom:'20px' }}>
                <div style={{
                  position:'absolute', inset:'-20px', borderRadius:'50%',
                  border:'2px solid #FFD700',
                  animation:'pm-pulse-ring 1.2s ease-out infinite',
                }} />
                <div style={{
                  width:'90px', height:'90px', borderRadius:'50%',
                  background:'linear-gradient(135deg, #FFD70022, #FFD70008)',
                  border:'2px solid #FFD70055',
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
              <h2 style={{ fontSize:'26px', fontWeight:'900', color:'#FFD700', margin:'0 0 10px' }}>
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
                <h2 style={{ fontSize:'28px', fontWeight:'900', color:'#FFD700', margin:'0 0 8px' }}>
                  {t('pro.title')}
                </h2>
                {/* Price pill */}
                <div style={{ display:'inline-flex', alignItems:'baseline', gap:'4px',
                  background:'rgba(255,215,0,0.1)', border:'1px solid rgba(255,215,0,0.28)',
                  borderRadius:'24px', padding:'8px 20px',
                }}>
                  <span style={{ fontSize:'26px', fontWeight:'900', color:'#FFD700' }}>5 €</span>
                  <span style={{ fontSize:'14px', color:'rgba(255,215,0,0.65)', fontWeight:'600' }}>{t('pro.priceMonth')}</span>
                </div>
              </div>

              {/* Feature cards */}
              <div style={{ display:'flex', flexDirection:'column', gap:'10px', marginBottom:'22px' }}>
                {FEATURE_KEYS.map((f, i) => (
                  <div key={i} style={{
                    display:'flex', alignItems:'center', gap:'14px',
                    background:'linear-gradient(135deg, rgba(255,215,0,0.07), rgba(255,165,0,0.03))',
                    border:'1px solid rgba(255,215,0,0.14)',
                    borderRadius:'16px', padding:'14px 16px',
                  }}>
                    <div style={{
                      width:'44px', height:'44px', borderRadius:'12px', flexShrink:0,
                      background:'rgba(255,215,0,0.12)',
                      border:'1px solid rgba(255,215,0,0.2)',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize: f.icon === '∞' ? '22px' : '22px',
                      fontWeight:'900', color:'#FFD700',
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
                      background:'rgba(255,215,0,0.15)', flexShrink:0,
                      display:'flex', alignItems:'center', justifyContent:'center',
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                        stroke="#FFD700" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20,6 9,17 4,12" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <button
                onClick={startPayment}
                disabled={loading}
                style={{
                  width:'100%', padding:'19px', borderRadius:'18px', border:'none',
                  background: loading
                    ? 'rgba(255,215,0,0.25)'
                    : 'linear-gradient(270deg, #FFD700, #FFAA00, #FFD700)',
                  backgroundSize:'200% auto',
                  animation: loading ? 'none' : 'pm-shimmer 2.5s linear infinite',
                  color: loading ? 'rgba(255,255,255,0.4)' : '#1a1100',
                  fontSize:'17px', fontWeight:'900', letterSpacing:'0.2px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  boxShadow: loading ? 'none' : '0 10px 32px rgba(255,215,0,0.4), 0 2px 8px rgba(0,0,0,0.3)',
                  marginBottom:'10px',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:'8px',
                }}
              >
                {loading ? <><Spinner /> {t('pro.loading')}</> : t('pro.ctaActivate')}
              </button>
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

              {/* Amount reminder */}
              <div style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                background:'rgba(255,215,0,0.07)', border:'1px solid rgba(255,215,0,0.18)',
                borderRadius:'14px', padding:'12px 16px', marginBottom:'18px',
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <span style={{ fontSize:'20px' }}>👑</span>
                  <div>
                    <div style={{ color:'#fff', fontWeight:'700', fontSize:'14px' }}>{t('pro.title')}</div>
                    <div style={{ color:'rgba(255,255,255,0.4)', fontSize:'12px' }}>{t('pro.subscriptionLabel')}</div>
                  </div>
                </div>
                <div style={{ color:'#FFD700', fontWeight:'900', fontSize:'18px' }}>5 €</div>
              </div>

              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret,
                  appearance: {
                    theme:'night',
                    variables: {
                      colorPrimary:'#FFD700',
                      colorBackground:'#1c1400',
                      colorText:'#ffffff',
                      colorTextSecondary:'rgba(255,255,255,0.5)',
                      colorDanger:'#ff8a8a',
                      borderRadius:'12px',
                      fontFamily:'inherit',
                      spacingUnit:'4px',
                    },
                    rules: {
                      '.Input': { border:'1px solid rgba(255,215,0,0.2)', boxShadow:'none' },
                      '.Input:focus': { border:'1px solid rgba(255,215,0,0.55)', boxShadow:'0 0 0 3px rgba(255,215,0,0.12)' },
                    },
                  },
                }}
              >
                <StripeSubscribeForm onSuccess={onPaySuccess} onCancel={() => setStep('features')} />
              </Elements>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ProModal;
