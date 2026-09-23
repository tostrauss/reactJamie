import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { boost as boostApi, subscription as subscriptionApi } from '../utils/api';
import { isNativeIOS, purchasesEnabled, paymentsComingSoon } from '../utils/platform';
import { usePaymentsConfig } from '../utils/paymentsConfig';
import { PRO_MODAL_EVENT } from './GroupCard';
import { useToast } from '../context/ToastContext';
import { InterestButton } from './InterestButton';

// ==========================================
// BOOST MODAL — Boosten ist ein Pro-Feature
// ==========================================
// Product decision (Tina + Tobi, Meeting 21.09.2026): „Boosts bleiben, nur
// keine Einzelkäufe". The former „Credits kaufen"-Tab (Stripe Payment Element,
// Apple-Consumables, Pakete 1/5/15) is GONE — on every platform. What is left:
//   • Pro users boost for free (server: applyBoost charges 0 credits when Pro).
//   • Non-Pro users with LEFTOVER credits from earlier purchases can still
//     spend them (the wallet stays valid, nothing is taken away).
//   • Non-Pro users without credits see „Boosts sind Teil von JAMIE Pro" and a
//     button that opens the Pro sheet — or, while purchases are off, the
//     Pro-coming-soon teaser. On iOS (no IAP yet) a neutral sentence, no CTA
//     (App Review 3.1.1: no purchase hints without StoreKit).
// Backend mirror: features.js BOOST_SINGLE_PURCHASES_ENABLED = false
// (createStripeIntent → 410, verifyApple knows no boost_* products).

export const BoostModal = ({ targetType, targetId, targetName, onClose }) => {
  const { t } = useTranslation();
  usePaymentsConfig(); // re-render when the runtime payments config arrives
  const toast = useToast();
  const [credits, setCredits] = useState(0);
  // null = unknown (loading) → the CTA shows the neutral spinner state, never
  // a wrong „du brauchst Pro" for someone who IS Pro.
  const [isPro, setIsPro] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    boostApi.getCredits()
      .then(res => { if (!cancelled) setCredits(res.data.credits || 0); })
      .catch(() => {});
    subscriptionApi.getStatus()
      .then(res => { if (!cancelled) setIsPro(!!res.data?.is_pro); })
      .catch(() => { if (!cancelled) setIsPro(false); });
    return () => { cancelled = true; };
  }, []);

  const canBoost = isPro === true || credits > 0;

  const handleApplyBoost = async () => {
    if (!canBoost) return;
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

  // Same window event GroupCard / GroupRequests use, so the Pro sheet opens
  // above this modal without threading a setter through context. App.jsx
  // ignores the event on iOS (deliberately — no purchase path there).
  const openPro = () => {
    window.dispatchEvent(new CustomEvent(PRO_MODAL_EVENT, { detail: { feature: 'boosts' } }));
    onClose();
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
          // big empty gap.
          //
          // BOTTOM = nav clearance, NOT the bare safe-area inset. .bottom-nav is
          // a flex child at the end of the dvh-bounded #root column (60px strip +
          // --nav-safe-bottom), so it owns the bottom of the screen — while this
          // fixed sheet is taken out of that flow and would otherwise sit under
          // the nav. See project_nav_safe_bottom: every fixed element above the
          // nav uses the same var.
          padding: '18px 20px calc(60px + var(--nav-safe-bottom) + 16px)',
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 12px)',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>{t('boost.title')}</h2>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              {isPro
                ? t('boost.pro.included')
                : t('boost.creditsAvailable', { count: credits })}
            </p>
          </div>
          {/* .modal-close = the app-wide 32px circular close target. */}
          <button onClick={onClose} className="modal-close">✕</button>
        </div>

        <div style={{ background: 'rgba(253,118,102,0.1)', border: '1px solid rgba(253,118,102,0.3)', borderRadius: '16px', padding: '16px', marginBottom: '20px' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎯</div>
          <h3 style={{ margin: '0 0 6px', fontSize: '18px' }}>{targetName || t('boost.apply.fallbackTarget')}</h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
            {t('boost.apply.desc')}
          </p>
        </div>

        {isPro === null ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>{t('common.loading')}</p>
        ) : canBoost ? (
          <>
            {!isPro && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-input)', borderRadius: '12px', padding: '14px', marginBottom: '20px' }}>
                <span style={{ fontSize: '28px' }}>⚡</span>
                <div>
                  <div style={{ fontWeight: '700' }}>{t('boost.apply.creditsCount', { count: credits })}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('boost.apply.creditEq')}</div>
                </div>
              </div>
            )}
            <button
              onClick={handleApplyBoost}
              disabled={loading}
              style={{ width: '100%', padding: '16px', borderRadius: '14px', background: '#FD7666', border: 'none', color: '#fff', fontSize: '16px', fontWeight: '700', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
            >
              {loading
                ? t('boost.apply.boosting')
                : isPro ? t('boost.apply.applyBtnPro') : t('boost.apply.applyBtn')}
            </button>
          </>
        ) : (
          /* Not Pro, no credits → Boosts are a Pro feature. */
          <div style={{
            textAlign: 'center', padding: '24px 16px',
            background: 'rgba(253,118,102,0.08)', border: '1px solid rgba(253,118,102,0.25)',
            borderRadius: '16px',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>👑</div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: '#fff', marginBottom: '6px' }}>
              {t('boost.pro.title')}
            </div>
            <p style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--text-muted)', margin: '0 0 14px' }}>
              {t('boost.pro.body')}
            </p>
            {purchasesEnabled() ? (
              <button onClick={openPro} style={{ padding: '12px 24px', borderRadius: '12px', background: '#FD7666', border: 'none', color: '#fff', fontWeight: '700', cursor: 'pointer' }}>
                {t('boost.pro.cta')}
              </button>
            ) : paymentsComingSoon() ? (
              <>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px' }}>
                  {t('payments.comingSoon.body')}
                </p>
                <InterestButton feature="pro" />
              </>
            ) : (
              /* iOS without IAP: neutral, no purchase hint (3.1.1). */
              isNativeIOS() && null
            )}
          </div>
        )}
      </div>
    </div>
  );
};
