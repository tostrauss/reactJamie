import React, { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { boost as boostApi } from '../utils/api';
import { isNativeIOS } from '../utils/platform';
import { purchaseBoost } from '../utils/iap';
import { useToast } from '../context/ToastContext';

// ==========================================
// STRIPE PAYMENT FORM
// ==========================================
function StripeForm({ clientSecret, onSuccess, onCancel }) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');

    // redirect:'if_required' lets Stripe handle 3D Secure / SCA inline via
    // its modal/iframe — covers the EU SCA mandate without a full redirect.
    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });

    if (stripeError) {
      setError(stripeError.message);
      setLoading(false);
      return;
    }
    // 'succeeded' = charged + credits granted on webhook. 'processing' is
    // safe to optimistically close — the boost webhook will credit shortly.
    // Any other status means we shouldn't claim success.
    const status = paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing') {
      onSuccess();
      return;
    }
    setError(t('boost.stripe.unexpectedStatus', { defaultValue: 'Zahlung konnte nicht abgeschlossen werden. Bitte erneut versuchen.' }));
    setLoading(false);
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
          {t('boost.stripe.back')}
        </button>
        <button
          type="submit"
          disabled={loading || !stripe}
          style={{ flex: 2, padding: '14px', borderRadius: '12px', background: '#6C63FF', border: 'none', color: '#fff', fontWeight: '700', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? t('boost.stripe.processing') : t('boost.stripe.pay')}
        </button>
      </div>
    </form>
  );
}

// ==========================================
// MAIN BOOST MODAL
// ==========================================
const PACKAGES = [
  { id: 'starter', credits: 1,  price: '1,99 €', icon: '⚡', popular: false },
  { id: 'popular', credits: 5,  price: '7,99 €', icon: '🔥', popular: true  },
  { id: 'pro',     credits: 15, price: '19,99 €', icon: '💎', popular: false },
];

export const BoostModal = ({ targetType, targetId, targetName, onClose }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [tab, setTab] = useState('buy'); // 'buy' | 'apply' | 'referral'
  const [credits, setCredits] = useState(0);
  const [referralCode, setReferralCode] = useState('');
  const [referralUsed, setReferralUsed] = useState(0);
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null); // 'stripe'
  const [stripeClientSecret, setStripeClientSecret] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [loading, setLoading] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');

  useEffect(() => {
    boostApi.getCredits().then(res => {
      setCredits(res.data.credits);
      setReferralCode(res.data.referral_code || '');
      setReferralUsed(res.data.referral_used || 0);
    }).catch(() => {});
  }, []);

  const handleApplyBoost = async () => {
    if (credits < 1) {
      toast.error(t('boost.apply.noCreditsToast'));
      setTab('buy');
      return;
    }
    setLoading(true);
    try {
      await boostApi.apply(targetType, targetId);
      toast.success(t('boost.apply.boostedToast', { name: targetName }));
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || t('boost.apply.boostError'));
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
      toast.error(t('boost.buy.stripeError'));
    } finally {
      setLoading(false);
    }
  };

  const handleStripeSuccess = () => {
    toast.success(t('boost.buy.creditsAddedToast', { count: selectedPkg.credits }));
    setCredits(c => c + selectedPkg.credits);
    setPaymentMethod(null);
    setSelectedPkg(null);
    setTab('apply');
  };

  // iOS: route through Apple StoreKit instead of Stripe (App Review 3.1.1).
  const handleIapPurchase = async () => {
    if (!selectedPkg) return;
    setLoading(true);
    try {
      const { new_total } = await purchaseBoost(selectedPkg.id);
      toast.success(t('boost.buy.creditsAddedToast', { count: selectedPkg.credits }));
      setCredits(typeof new_total === 'number' ? new_total : (c => c + selectedPkg.credits));
      setSelectedPkg(null);
      setTab('apply');
    } catch (err) {
      // User-cancelled is silent; everything else surfaces.
      if (!/cancel/i.test(err?.message || '')) {
        toast.error(err.response?.data?.error || err.message || t('boost.buy.stripeError'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRedeemCode = async () => {
    if (!redeemCode.trim()) return;
    setLoading(true);
    try {
      await boostApi.redeemReferral(redeemCode.trim());
      toast.success(t('boost.referral.redeemSuccess'));
      setCredits(c => c + 1);
      setRedeemCode('');
    } catch (err) {
      toast.error(err.response?.data?.error || t('boost.referral.redeemError'));
    } finally {
      setLoading(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(referralCode);
    toast.success(t('boost.referral.codeCopied'));
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
          // Top is a plain 18px (NOT safe-area + 16): maxHeight already caps the
          // sheet top at safe-area + 12px, so adding the inset here too left a
          // big empty gap. Bottom trimmed 90px → safe-area + 24px (the sheet
          // sits above the nav via its own z-index, so it never needed 90px).
          padding: '18px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)',
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 12px)',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>{t('boost.title')}</h2>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              {t('boost.creditsAvailable', { count: credits })}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '22px', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--bg-input, rgba(255,255,255,0.05))', borderRadius: '12px', padding: '4px', marginBottom: '20px' }}>
          {[
            { key: 'apply', tKey: 'apply' },
            { key: 'buy', tKey: 'buy' },
            { key: 'referral', tKey: 'referral' },
          ].map(({ key, tKey }) => (
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
              {t(`boost.tabs.${tKey}`)}
            </button>
          ))}
        </div>

        {/* ---- APPLY TAB ---- */}
        {tab === 'apply' && (
          <div>
            <div style={{ background: 'rgba(253,118,102,0.1)', border: '1px solid rgba(253,118,102,0.3)', borderRadius: '16px', padding: '16px', marginBottom: '20px' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎯</div>
              <h3 style={{ margin: '0 0 6px', fontSize: '18px' }}>{targetName || t('boost.apply.fallbackTarget')}</h3>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                {t('boost.apply.desc')}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-input)', borderRadius: '12px', padding: '14px', marginBottom: '20px' }}>
              <span style={{ fontSize: '28px' }}>⚡</span>
              <div>
                <div style={{ fontWeight: '700' }}>{t('boost.apply.creditsCount', { count: credits })}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('boost.apply.creditEq')}</div>
              </div>
            </div>

            {credits < 1 ? (
              <div style={{ textAlign: 'center', padding: '16px' }}>
                <p style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>{t('boost.apply.noCredits')}</p>
                <button onClick={() => setTab('buy')} style={{ padding: '12px 24px', borderRadius: '12px', background: '#FD7666', border: 'none', color: '#fff', fontWeight: '700', cursor: 'pointer' }}>
                  {t('boost.apply.buyBtn')}
                </button>
              </div>
            ) : (
              <button
                onClick={handleApplyBoost}
                disabled={loading}
                style={{ width: '100%', padding: '16px', borderRadius: '14px', background: '#FD7666', border: 'none', color: '#fff', fontSize: '16px', fontWeight: '700', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
              >
                {loading ? t('boost.apply.boosting') : t('boost.apply.applyBtn')}
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
                        // Ohne explizite Farbe rendert iOS Safari Button-Text
                        // im System-Blau (#007AFF) — Pakettitel wurden blau.
                        color: '#fff',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '28px' }}>{pkg.icon}</span>
                        <div>
                          <div style={{ fontWeight: '700', fontSize: '16px' }}>{t(`boost.buy.packages.${pkg.credits}`)}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('boost.buy.creditsPerPackage', { count: pkg.credits })}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '800', fontSize: '18px', color: '#FD7666' }}>{pkg.price}</div>
                        {pkg.popular && <div style={{ fontSize: '10px', color: '#FD7666', fontWeight: '700' }}>{t('boost.buy.popular')}</div>}
                      </div>
                    </button>
                  ))}
                </div>

                {selectedPkg && (
                  <div>
                    <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>{t('boost.buy.choosePayment')}</p>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                      <button
                        onClick={isNativeIOS() ? handleIapPurchase : handleStripeStart}
                        disabled={loading}
                        style={{ flex: 1, padding: '14px', borderRadius: '14px', background: '#6C63FF', border: 'none', color: '#fff', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: loading ? 0.7 : 1 }}
                      >
                        {t('boost.buy.applePay')}
                      </button>
                    </div>
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
              <h3 style={{ margin: '0 0 6px' }}>{t('boost.referral.title')}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>
                <Trans i18nKey="boost.referral.subtitle" components={{ 1: <strong style={{ color: '#FD7666' }} /> }} />
              </p>
            </div>

            {/* Your code */}
            {referralCode && (
              <div style={{ marginBottom: '24px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>{t('boost.referral.yourCode')}</p>
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
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('boost.referral.copy')}</span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'center' }}>
                  {t('boost.referral.invitedFmt', { count: referralUsed })}
                </p>
              </div>
            )}

            {/* Redeem a code */}
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>{t('boost.referral.redeemLabel')}</p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder={t('boost.referral.redeemPlaceholder')}
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
                  {t('boost.referral.redeemBtn')}
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
