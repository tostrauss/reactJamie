import React, { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { boost as boostApi } from '../utils/api';
import { useToast } from '../context/ToastContext';

// ==========================================
// STRIPE PAYMENT FORM
// ==========================================
function StripeForm({ clientSecret, onSuccess, onCancel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });

    if (stripeError) {
      setError(stripeError.message);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
      <PaymentElement />
      {error && <p style={{ color: '#ff6b6b', fontSize: '13px', marginTop: '8px' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{ flex: 1, padding: '14px', borderRadius: '12px', background: 'var(--bg-input)', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: '600' }}
        >
          Zurück
        </button>
        <button
          type="submit"
          disabled={loading || !stripe}
          style={{ flex: 2, padding: '14px', borderRadius: '12px', background: '#6C63FF', border: 'none', color: '#fff', fontWeight: '700', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Verarbeite...' : 'Jetzt bezahlen'}
        </button>
      </div>
    </form>
  );
}

// ==========================================
// MAIN BOOST MODAL
// ==========================================
const PACKAGES = [
  { id: 'starter', credits: 1,  price: '1,99 €', label: '1 Boost',  icon: '⚡', popular: false },
  { id: 'popular', credits: 5,  price: '7,99 €', label: '5 Boost',  icon: '🔥', popular: true  },
  { id: 'pro',     credits: 15, price: '19,99 €', label: '15 Boost', icon: '💎', popular: false },
];

export const BoostModal = ({ targetType, targetId, targetName, onClose }) => {
  const toast = useToast();
  const [tab, setTab] = useState('buy'); // 'buy' | 'apply' | 'referral'
  const [credits, setCredits] = useState(0);
  const [referralCode, setReferralCode] = useState('');
  const [referralUsed, setReferralUsed] = useState(0);
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null); // 'stripe' | 'paypal'
  const [stripeClientSecret, setStripeClientSecret] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [paypalClientId, setPaypalClientId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');

  useEffect(() => {
    boostApi.getCredits().then(res => {
      setCredits(res.data.credits);
      setReferralCode(res.data.referral_code || '');
      setReferralUsed(res.data.referral_used || 0);
    }).catch(() => {});

    // Load PayPal client ID from backend if needed
    boostApi.getPaypalClientId().then(res => {
      if (res.data?.client_id) setPaypalClientId(res.data.client_id);
    }).catch(() => {});
  }, []);

  const handleApplyBoost = async () => {
    if (credits < 1) {
      toast.error('Nicht genug Credits — kaufe zuerst Boost-Credits!');
      setTab('buy');
      return;
    }
    setLoading(true);
    try {
      await boostApi.apply(targetType, targetId);
      toast.success(`🚀 ${targetName} wird jetzt 24h geboosted!`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Boost fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPackage = async (pkg) => {
    setSelectedPkg(pkg);
    setPaymentMethod(null);
    setStripeClientSecret(null);
  };

  const handleStripeStart = async () => {
    if (!selectedPkg) return;
    setLoading(true);
    try {
      const res = await boostApi.createStripeIntent(selectedPkg.id);
      const { client_secret, publishable_key } = res.data;
      setStripeClientSecret(client_secret);
      setStripePromise(loadStripe(publishable_key));
      setPaymentMethod('stripe');
    } catch {
      toast.error('Stripe konnte nicht gestartet werden');
    } finally {
      setLoading(false);
    }
  };

  const handleStripeSuccess = () => {
    toast.success(`+${selectedPkg.credits} Boost-Credits gutgeschrieben!`);
    setCredits(c => c + selectedPkg.credits);
    setPaymentMethod(null);
    setSelectedPkg(null);
    setTab('apply');
  };

  const handleRedeemCode = async () => {
    if (!redeemCode.trim()) return;
    setLoading(true);
    try {
      await boostApi.redeemReferral(redeemCode.trim());
      toast.success('+1 Boost-Credit für dich und deinen Freund!');
      setCredits(c => c + 1);
      setRedeemCode('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Code ungültig');
    } finally {
      setLoading(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(referralCode);
    toast.success('Code kopiert!');
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #1e1e35)',
          borderRadius: '24px 24px 0 0',
          width: '100%', maxWidth: '480px',
          padding: '24px 20px calc(env(safe-area-inset-bottom, 0px) + 90px)',
          maxHeight: 'calc(90vh - 70px)',
          overflowY: 'auto',
        }}
      >
        {/* Handle */}
        <div style={{ width: '40px', height: '4px', background: 'rgba(255,255,255,0.2)', borderRadius: '2px', margin: '0 auto 20px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>🚀 Boost</h2>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              {credits} Credit{credits !== 1 ? 's' : ''} verfügbar
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '22px', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--bg-input, rgba(255,255,255,0.05))', borderRadius: '12px', padding: '4px', marginBottom: '20px' }}>
          {[
            { key: 'apply', label: 'Boost anwenden' },
            { key: 'buy', label: 'Credits kaufen' },
            { key: 'referral', label: 'Freunde einladen' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1, padding: '10px 6px', borderRadius: '10px', border: 'none',
                background: tab === key ? '#FD7666' : 'transparent',
                color: tab === key ? '#fff' : 'var(--text-muted)',
                fontWeight: '600', fontSize: '12px', cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ---- APPLY TAB ---- */}
        {tab === 'apply' && (
          <div>
            <div style={{ background: 'rgba(253,118,102,0.1)', border: '1px solid rgba(253,118,102,0.3)', borderRadius: '16px', padding: '16px', marginBottom: '20px' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎯</div>
              <h3 style={{ margin: '0 0 6px', fontSize: '18px' }}>{targetName || 'Diese Gruppe/Club'}</h3>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                Wird für 24h oben in der Entdecken-Liste angezeigt
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-input)', borderRadius: '12px', padding: '14px', marginBottom: '20px' }}>
              <span style={{ fontSize: '28px' }}>⚡</span>
              <div>
                <div style={{ fontWeight: '700' }}>{credits} Boost-Credits</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>1 Credit = 24h Boost</div>
              </div>
            </div>

            {credits < 1 ? (
              <div style={{ textAlign: 'center', padding: '16px' }}>
                <p style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>Keine Credits. Kaufe welche oder lade Freunde ein!</p>
                <button onClick={() => setTab('buy')} style={{ padding: '12px 24px', borderRadius: '12px', background: '#FD7666', border: 'none', color: '#fff', fontWeight: '700', cursor: 'pointer' }}>
                  Credits kaufen
                </button>
              </div>
            ) : (
              <button
                onClick={handleApplyBoost}
                disabled={loading}
                style={{ width: '100%', padding: '16px', borderRadius: '14px', background: '#FD7666', border: 'none', color: '#fff', fontSize: '16px', fontWeight: '700', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
              >
                {loading ? 'Wird geboostet...' : '🚀 Jetzt boosten (1 Credit)'}
              </button>
            )}
          </div>
        )}

        {/* ---- BUY TAB ---- */}
        {tab === 'buy' && (
          <div>
            {/* Package selection */}
            {!paymentMethod && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                  {PACKAGES.map(pkg => (
                    <button
                      key={pkg.id}
                      onClick={() => handleSelectPackage(pkg)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '16px', borderRadius: '14px',
                        border: `2px solid ${selectedPkg?.id === pkg.id ? '#FD7666' : 'transparent'}`,
                        background: pkg.popular ? 'rgba(253,118,102,0.1)' : 'var(--bg-input)',
                        cursor: 'pointer', position: 'relative', textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '28px' }}>{pkg.icon}</span>
                        <div>
                          <div style={{ fontWeight: '700', fontSize: '16px' }}>{pkg.label}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{pkg.credits} × 24h Boost</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '800', fontSize: '18px', color: '#FD7666' }}>{pkg.price}</div>
                        {pkg.popular && <div style={{ fontSize: '10px', color: '#FD7666', fontWeight: '700' }}>BELIEBT</div>}
                      </div>
                    </button>
                  ))}
                </div>

                {selectedPkg && (
                  <div>
                    <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>Zahlungsmethode wählen</p>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                      <button
                        onClick={handleStripeStart}
                        disabled={loading}
                        style={{ flex: 1, padding: '14px', borderRadius: '14px', background: '#6C63FF', border: 'none', color: '#fff', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: loading ? 0.7 : 1 }}
                      >
                        🍎 Apple Pay / Karte
                      </button>
                    </div>

                    {/* PayPal button */}
                    {paypalClientId && (
                      <PayPalScriptProvider options={{ 'client-id': paypalClientId, currency: 'EUR' }}>
                        <PayPalButtons
                          style={{ layout: 'horizontal', color: 'gold', shape: 'rect', label: 'pay', height: 48 }}
                          createOrder={() =>
                            boostApi.createPaypalOrder(selectedPkg.id).then(r => r.data.order_id)
                          }
                          onApprove={async (data) => {
                            try {
                              await boostApi.capturePaypalOrder(data.orderID);
                              toast.success(`+${selectedPkg.credits} Boost-Credits gutgeschrieben!`);
                              setCredits(c => c + selectedPkg.credits);
                              setSelectedPkg(null);
                              setTab('apply');
                            } catch {
                              toast.error('Zahlung konnte nicht abgeschlossen werden');
                            }
                          }}
                          onError={() => toast.error('PayPal-Fehler. Bitte erneut versuchen.')}
                        />
                      </PayPalScriptProvider>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Stripe Payment Element */}
            {paymentMethod === 'stripe' && stripeClientSecret && stripePromise && (
              <Elements stripe={stripePromise} options={{ clientSecret: stripeClientSecret, appearance: { theme: 'night' } }}>
                <StripeForm
                  clientSecret={stripeClientSecret}
                  onSuccess={handleStripeSuccess}
                  onCancel={() => setPaymentMethod(null)}
                />
              </Elements>
            )}
          </div>
        )}

        {/* ---- REFERRAL TAB ---- */}
        {tab === 'referral' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ fontSize: '48px', marginBottom: '8px' }}>🎁</div>
              <h3 style={{ margin: '0 0 6px' }}>Lade Freunde ein</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>
                Teile deinen Code und erhalte <strong style={{ color: '#FD7666' }}>1 gratis Boost-Credit</strong> für jeden neuen Freund!
              </p>
            </div>

            {/* Your code */}
            {referralCode && (
              <div style={{ marginBottom: '24px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Dein Einladungscode</p>
                <div
                  onClick={copyCode}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', borderRadius: '14px',
                    border: '2px dashed rgba(253,118,102,0.4)',
                    background: 'rgba(253,118,102,0.08)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: '800', fontSize: '20px', letterSpacing: '2px', color: '#FD7666' }}>
                    {referralCode}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>KOPIEREN</span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'center' }}>
                  {referralUsed} Freund{referralUsed !== 1 ? 'e' : ''} eingeladen
                </p>
              </div>
            )}

            {/* Redeem a code */}
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Code eines Freundes einlösen</p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="JAMIE-XXXX"
                  value={redeemCode}
                  onChange={e => setRedeemCode(e.target.value.toUpperCase())}
                  style={{
                    flex: 1, padding: '14px', borderRadius: '12px',
                    background: 'var(--bg-input)', border: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff', fontSize: '15px', fontWeight: '700', letterSpacing: '1px',
                  }}
                />
                <button
                  onClick={handleRedeemCode}
                  disabled={loading || !redeemCode.trim()}
                  style={{
                    padding: '14px 20px', borderRadius: '12px',
                    background: '#FD7666', border: 'none', color: '#fff',
                    fontWeight: '700', cursor: 'pointer',
                    opacity: (loading || !redeemCode.trim()) ? 0.5 : 1,
                  }}
                >
                  Einlösen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BoostModal;
