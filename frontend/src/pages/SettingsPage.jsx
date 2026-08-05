import { useState, useContext, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { switchLanguage } from '../i18n';
import { AuthContext } from '../context/AuthContext';
import { auth, groups as groupsApi, clubs as clubsApi, subscription as subscriptionApi, boost as boostApi, setMemToken } from '../utils/api';
import { useToast } from '../context/ToastContext';
import {
  isPushSupported,
  getPushPermission,
  isPushSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
} from '../utils/pushNotifications';
import { isNativeIOS, IOS_IAP_ENABLED } from '../utils/platform';
import { restorePurchases } from '../utils/iap';
import { PasswordInput } from '../components/PasswordInput';
import { FeedbackModal } from '../components/FeedbackModal';
import '../styles/profile.css';

export const SettingsPage = () => {
  const { user, logout, refreshProfile } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();
  const { t, i18n } = useTranslation();

  // Pull fresh profile data whenever Settings opens. Server-side flags like
  // is_admin can change while the app is still running (admins are flipped on
  // via SQL/Cloud-console); without this the cached user keeps the stale value
  // and the admin shortcut never appears until the next cold start / re-login.
  useEffect(() => {
    refreshProfile?.();
    // Intentionally only run once on mount — refreshProfile is stable from
    // useCallback in AuthContext, no need to re-fire on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On-demand feedback modal ("Feedback senden" row). Same component the
  // periodic App.jsx prompt uses; closing here does NOT bump the periodic
  // timer — opening it deliberately shouldn't postpone the scheduled ask.
  const [showFeedback, setShowFeedback] = useState(false);

  // Password change
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Data export (DSGVO Art. 15/20)
  const [exportLoading, setExportLoading] = useState(false);

  // Subscription — required to be cancellable from inside the app
  // (EU Consumer Rights Directive 2011/83/EU + App Store auto-renew rules).
  // sub = { is_pro, status, current_period_end } or null while loading.
  const [sub, setSub] = useState(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  // 14-day Widerruf (right of withdrawal) — immediate end + refund. Shown only
  // when the server says withdrawal_eligible (within the window, Stripe-billed).
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);

  // Widerruf-eligible boost purchases (Stripe, ≤14 days, credits unused).
  const [boostPurchases, setBoostPurchases] = useState([]);

  useEffect(() => {
    subscriptionApi.getStatus()
      .then(({ data }) => setSub(data))
      .catch(() => setSub({ is_pro: false, status: 'none', current_period_end: null }));
  }, []);

  useEffect(() => {
    boostApi.getPurchases()
      .then(({ data }) => setBoostPurchases(data || []))
      .catch(() => {});
  }, []);

  const handleCancelSubscription = async () => {
    setCancelLoading(true);
    try {
      await subscriptionApi.cancel();
      const { data } = await subscriptionApi.getStatus();
      setSub(data);
      setShowCancelConfirm(false);
      toast.success(t('settings.subscription.canceledToast'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('settings.subscription.cancelError'));
    } finally {
      setCancelLoading(false);
    }
  };

  const handleWithdraw = async () => {
    setWithdrawLoading(true);
    try {
      const { data } = await subscriptionApi.withdraw();
      const { data: status } = await subscriptionApi.getStatus();
      setSub(status);
      setShowWithdrawConfirm(false);
      toast.success(data?.refunded
        ? t('settings.subscription.withdrawDoneToast')
        : t('settings.subscription.withdrawDoneNoRefundToast'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('settings.subscription.withdrawError'));
    } finally {
      setWithdrawLoading(false);
    }
  };

  // Boost-Kauf Widerruf: build a pre-filled email to office@jamie-app.com with
  // the purchase details (email-request flow — processed manually).
  const boostWithdrawHref = (p) => {
    const date = new Date(p.created_at).toLocaleDateString();
    const amount = (p.amount_cents / 100).toFixed(2);
    const subject = t('settings.boostPurchases.mailSubject');
    const body = t('settings.boostPurchases.mailBody', {
      credits: p.credits,
      amount,
      date,
      paymentId: p.payment_id || '—',
      email: user?.email || '',
    });
    return `mailto:office@jamie-app.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  // Stripe Billing Portal — full self-service subscription management
  // (update card, switch plan, view invoices, cancel). Web + Android only;
  // iOS users manage via the App Store per Apple Guideline 3.1.1.
  const [portalLoading, setPortalLoading] = useState(false);
  const handleOpenPortal = async () => {
    if (portalLoading) return;
    setPortalLoading(true);
    try {
      const { data } = await subscriptionApi.openPortal();
      if (data?.url) {
        // Same-tab redirect: portal will redirect back to /settings on close.
        // window.open in a new tab would be blocked by mobile popup heuristics
        // and would lose the auth cookie scope anyway.
        window.location.href = data.url;
      }
    } catch (err) {
      const apiError = err.response?.data?.error;
      toast.error(apiError || t('settings.subscription.portalError', { defaultValue: 'Portal konnte nicht geöffnet werden' }));
    } finally {
      setPortalLoading(false);
    }
  };

  // App Review 3.1.1 requires a visible "Restore Purchases" entry point for any
  // app with auto-renewable subscriptions on iOS. We expose it whenever the user
  // is on the native iOS build — regardless of Pro state — because the whole
  // point is to recover purchases the server might have lost (new device,
  // reinstall, account migration).
  const [restoreLoading, setRestoreLoading] = useState(false);
  const handleRestorePurchases = async () => {
    setRestoreLoading(true);
    try {
      const { restored } = await restorePurchases();
      if (restored > 0) {
        // Re-fetch sub status so the UI flips to "Pro active" immediately.
        const { data } = await subscriptionApi.getStatus();
        setSub(data);
        toast.success(t('settings.subscription.restoreSuccess', { count: restored, defaultValue: '{{count}} Käufe wiederhergestellt' }));
      } else {
        toast.info?.(t('settings.subscription.restoreNone', { defaultValue: 'Keine Käufe zum Wiederherstellen' }))
          || toast.success(t('settings.subscription.restoreNone', { defaultValue: 'Keine Käufe zum Wiederherstellen' }));
      }
    } catch (err) {
      toast.error(err.message || t('settings.subscription.restoreError', { defaultValue: 'Wiederherstellung fehlgeschlagen' }));
    } finally {
      setRestoreLoading(false);
    }
  };

  const formatPeriodEnd = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(
        currentLang === 'de' ? 'de-DE' : currentLang === 'it' ? 'it-IT' : currentLang === 'fr' ? 'fr-FR' : currentLang === 'es' ? 'es-ES' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch { return ''; }
  };

  // Notification prefs — persisted to localStorage
  const lsGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const lsSet = (key, val) => { try { localStorage.setItem(key, val); } catch { /* private browsing */ } };
  const [notifMessages, setNotifMessages] = useState(() => lsGet('notif_messages') !== 'false');
  const [notifRequests, setNotifRequests] = useState(() => lsGet('notif_requests') !== 'false');
  const [notifGroups, setNotifGroups] = useState(() => lsGet('notif_groups') !== 'false');

  useEffect(() => { lsSet('notif_messages', notifMessages); }, [notifMessages]);
  useEffect(() => { lsSet('notif_requests', notifRequests); }, [notifRequests]);
  useEffect(() => { lsSet('notif_groups', notifGroups); }, [notifGroups]);

  // Favorites
  const [favTab, setFavTab] = useState('groups');
  const [favGroups, setFavGroups] = useState([]);
  const [favClubs, setFavClubs] = useState([]);
  const [favLoading, setFavLoading] = useState(true);

  useEffect(() => {
    Promise.all([groupsApi.getFavorites(), clubsApi.getFavorites()])
      .then(([gRes, cRes]) => {
        setFavGroups(gRes.data || []);
        setFavClubs(cRes.data || []);
      })
      .catch(() => {})
      .finally(() => setFavLoading(false));
  }, []);

  // Push notification subscription state
  const [pushSupported] = useState(() => isPushSupported());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    if (!pushSupported) return;
    isPushSubscribed().then(setPushEnabled);
  }, [pushSupported]);

  const handlePushToggle = async () => {
    if (getPushPermission() === 'denied') {
      toast.error(t('settings.toast.pushBlocked'));
      return;
    }
    setPushLoading(true);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        setPushEnabled(false);
        toast.success(t('settings.toast.pushDisabled'));
      } else {
        const ok = await subscribeToPush();
        setPushEnabled(ok);
        if (ok) toast.success(t('settings.toast.pushEnabled'));
        else toast.error(t('settings.toast.pushPermissionDenied'));
      }
    } finally {
      setPushLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error(t('settings.toast.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('settings.toast.passwordMismatch'));
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await auth.changePassword(currentPassword, newPassword);
      // The server bumped the session watermark (revoking every OTHER token) and
      // returned a fresh one for THIS session — adopt it so native Bearer
      // clients don't 401 on their now-stale in-memory token.
      if (res?.data?.token) setMemToken(res.data.token);
      toast.success(t('settings.toast.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setShowPasswordForm(false), 1500);
    } catch (err) {
      toast.error(err.response?.data?.error || t('settings.toast.passwordChangeError'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleExportData = async () => {
    setExportLoading(true);
    try {
      const { data } = await auth.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jamie-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('settings.toast.exportSuccess'));
    } catch {
      toast.error(t('settings.toast.exportError'));
    } finally {
      setExportLoading(false);
    }
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    if (!deletePassword) {
      toast.error(t('settings.toast.passwordRequired'));
      return;
    }

    setDeleteLoading(true);
    try {
      await auth.deleteAccount(deletePassword);
      logout();
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.error || t('settings.toast.deleteError'));
    } finally {
      setDeleteLoading(false);
    }
  };

  const currentLang = (i18n.resolvedLanguage || i18n.language || 'de').split('-')[0];

  const chevron = (
    <svg className="settings-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6"/>
    </svg>
  );

  return (
    <div className="settings-page">
      {/* Sticky Header */}
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="settings-title">{t('settings.title')}</h1>
      </div>

      <div className="settings-body">
      {/* User Card */}
      <div className="settings-user-card" onClick={() => navigate('/profile')}>
        <div className="settings-user-avatar">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.name} decoding="async" />
          ) : (
            <span>{(user?.name || '?')[0].toUpperCase()}</span>
          )}
        </div>
        <div className="settings-user-info">
          {/* Own profile header — no age superscript. */}
          <div className="settings-user-name">{user?.name || t('settings.user.fallbackName')}</div>
          <div className="settings-user-email">{user?.email || ''}</div>
        </div>
        {chevron}
      </div>

      {/* Konto */}
      <div className="settings-section">
        <h3 className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          {t('settings.sections.account')}
        </h3>

        <div className="settings-row" onClick={() => navigate('/profile/edit')}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <span>{t('settings.account.editProfile')}</span>
          </div>
          {chevron}
        </div>

        {!showPasswordForm ? (
          <div className="settings-row" onClick={() => setShowPasswordForm(true)}>
            <div className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span>{t('settings.account.changePassword')}</span>
            </div>
            {chevron}
          </div>
        ) : (
          <div className="settings-expand">
            <form onSubmit={handleChangePassword} className="settings-form">
              <PasswordInput placeholder={t('settings.account.currentPasswordPlaceholder')} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="settings-input" autoComplete="current-password" />
              <PasswordInput placeholder={t('settings.account.newPasswordPlaceholder')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="settings-input" autoComplete="new-password" />
              <PasswordInput placeholder={t('settings.account.confirmPasswordPlaceholder')} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="settings-input" autoComplete="new-password" />
              <div className="settings-form-actions">
                <button type="submit" className="settings-action-btn primary" disabled={passwordLoading}>
                  {passwordLoading ? t('common.loading') : t('common.save')}
                </button>
                <button type="button" className="settings-action-btn" onClick={() => { setShowPasswordForm(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}>
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="settings-row static">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="M22 7l-10 7L2 7"/>
            </svg>
            <div className="settings-row-stacked">
              <span>{t('settings.account.email')}</span>
              <span className="settings-row-detail">{user?.email || t('settings.user.noEmail')}</span>
            </div>
          </div>
        </div>

        <Link to="/blocked" className="settings-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            <span>{t('settings.account.blockedUsers')}</span>
          </div>
          {chevron}
        </Link>

        {/* Admin shortcut — only rendered when the current user is flagged as
            admin in the DB. No public navigation link otherwise. */}
        {user?.is_admin && (
          <Link
            to="/admin"
            className="settings-row"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-coral)" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="M9 12l2 2 4-4"/>
              </svg>
              <span style={{ color: 'var(--accent-coral)', fontWeight: 600 }}>
                {t('settings.account.adminDashboard')}
              </span>
            </div>
            {chevron}
          </Link>
        )}
      </div>

      {/* Pro-Abonnement — only shown when the user has an active or canceling
          subscription. Required by EU Consumer Rights Directive + App Store
          auto-renew rules: cancellation must be reachable from within the app. */}
      {sub?.is_pro && (
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            {t('settings.sections.subscription')}
          </h3>

          <div className="settings-row static">
            <div className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
              <div className="settings-row-stacked">
                <span>JAMIE Pro · {sub.status === 'canceling'
                  ? t('settings.subscription.statusCanceling')
                  : t('settings.subscription.statusActive')}</span>
                {sub.current_period_end && (
                  <span className="settings-row-detail">
                    {sub.status === 'canceling'
                      ? t('settings.subscription.periodEndCancelingPrefix')
                      : t('settings.subscription.periodEndPrefix')}{' '}
                    {formatPeriodEnd(sub.current_period_end)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Web + Android Pro users: Stripe Billing Portal for self-service
              card update, invoices, plan switch, cancellation. iOS users
              manage via App Store → Subscriptions instead (Apple 3.1.1). */}
          {!isNativeIOS() && (
            <div className="settings-row" onClick={portalLoading ? undefined : handleOpenPortal}>
              <div className="settings-row-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2"/>
                  <line x1="2" y1="10" x2="22" y2="10"/>
                </svg>
                <span>{portalLoading
                  ? t('common.loading')
                  : t('settings.subscription.portalBtn', { defaultValue: 'Abo verwalten (Zahlung, Rechnungen)' })}</span>
              </div>
              {chevron}
            </div>
          )}

          {/* 14-day Widerruf (right of withdrawal) — only within the window and
              only for Stripe-billed subs (server returns withdrawal_eligible).
              Distinct from "kündigen": ends the plan immediately + full refund. */}
          {sub.withdrawal_eligible && !isNativeIOS() && !showWithdrawConfirm && !showCancelConfirm && (
            <div className="settings-row" onClick={() => setShowWithdrawConfirm(true)}>
              <div className="settings-row-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
                <div className="settings-row-stacked">
                  <span style={{ color: 'var(--accent-coral)', fontWeight: 600 }}>{t('settings.subscription.withdrawBtn')}</span>
                  <span className="settings-row-detail">{t('settings.subscription.withdrawHint')}</span>
                </div>
              </div>
              {chevron}
            </div>
          )}

          {showWithdrawConfirm && (
            <div className="settings-expand">
              <p className="delete-warning" style={{ fontWeight: 600, marginBottom: 6 }}>
                {t('settings.subscription.withdrawConfirmTitle')}
              </p>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
                {t('settings.subscription.withdrawConfirmBody')}
              </p>
              <div className="settings-form-actions">
                <button type="button" className="danger-btn" onClick={handleWithdraw} disabled={withdrawLoading}>
                  {withdrawLoading ? t('common.loading') : t('settings.subscription.withdrawConfirmYes')}
                </button>
                <button type="button" className="settings-action-btn" onClick={() => setShowWithdrawConfirm(false)} disabled={withdrawLoading}>
                  {t('settings.subscription.withdrawConfirmNo')}
                </button>
              </div>
            </div>
          )}

          {sub.status !== 'canceling' && !showCancelConfirm && !showWithdrawConfirm && (
            <div className="settings-row" onClick={() => setShowCancelConfirm(true)}>
              <div className="settings-row-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-coral)" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                </svg>
                {/* Prominent, clearly-labeled cancellation entry point (EU
                    Kündigungsbutton intent: easy to find, not buried, not
                    discouraged). Coral accent matches the admin shortcut so it
                    stands out from the neutral rows; the subline clarifies when
                    it takes effect. */}
                <div className="settings-row-stacked">
                  <span style={{ color: 'var(--accent-coral)', fontWeight: 600 }}>{t('settings.subscription.cancelBtn')}</span>
                  <span className="settings-row-detail">{t('settings.subscription.cancelHint')}</span>
                </div>
              </div>
              {chevron}
            </div>
          )}

          {showCancelConfirm && (
            <div className="settings-expand">
              <p className="delete-warning" style={{ fontWeight: 600, marginBottom: 6 }}>
                {t('settings.subscription.cancelConfirmTitle')}
              </p>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
                {t('settings.subscription.cancelConfirmBody')}
              </p>
              <div className="settings-form-actions">
                <button
                  type="button"
                  className="danger-btn"
                  onClick={handleCancelSubscription}
                  disabled={cancelLoading}
                >
                  {cancelLoading ? t('common.loading') : t('settings.subscription.cancelConfirmYes')}
                </button>
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={cancelLoading}
                >
                  {t('settings.subscription.cancelConfirmNo')}
                </button>
              </div>
            </div>
          )}

          {isNativeIOS() && IOS_IAP_ENABLED && (
            <div className="settings-row" onClick={restoreLoading ? undefined : handleRestorePurchases}>
              <div className="settings-row-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
                <span>{restoreLoading
                  ? t('common.loading')
                  : t('settings.subscription.restoreBtn', { defaultValue: 'Käufe wiederherstellen' })}</span>
              </div>
              {chevron}
            </div>
          )}
        </div>
      )}

      {/* Apple Review 3.1.1: "Restore Purchases" must be reachable even when the
          user is not currently Pro — that's the whole point of restore. Shown
          here as a standalone section ONLY in the native iOS build, and only
          once IAP actually ships (nothing to restore otherwise). */}
      {isNativeIOS() && IOS_IAP_ENABLED && !sub?.is_pro && (
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
            {t('settings.sections.iap', { defaultValue: 'Käufe' })}
          </h3>
          <div className="settings-row" onClick={restoreLoading ? undefined : handleRestorePurchases}>
            <div className="settings-row-left">
              <div className="settings-row-stacked">
                <span>{restoreLoading
                  ? t('common.loading')
                  : t('settings.subscription.restoreBtn', { defaultValue: 'Käufe wiederherstellen' })}</span>
                <span className="settings-row-detail">
                  {t('settings.subscription.restoreHelper', { defaultValue: 'Auf neuem Gerät? Stellt aktive Abos und nicht eingelöste Käufe wieder her.' })}
                </span>
              </div>
            </div>
            {chevron}
          </div>
        </div>
      )}

      {/* Boost-Käufe — 14-day Widerruf for unredeemed Stripe boost purchases.
          Only eligible (≤14d, credits unused) purchases are listed; redeemed
          ones never appear (Tina's rule). Email-request flow. */}
      {boostPurchases.length > 0 && (
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            {t('settings.boostPurchases.title')}
          </h3>
          <p style={{ margin: '0 16px 8px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {t('settings.boostPurchases.hint')}
          </p>
          {boostPurchases.map(p => (
            <a key={p.id} href={boostWithdrawHref(p)} className="settings-row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="settings-row-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
                <div className="settings-row-stacked">
                  <span style={{ color: 'var(--accent-coral)', fontWeight: 600 }}>{t('settings.boostPurchases.withdrawBtn')}</span>
                  <span className="settings-row-detail">
                    {t('settings.boostPurchases.itemFmt', { credits: p.credits, amount: (p.amount_cents / 100).toFixed(2), date: new Date(p.created_at).toLocaleDateString() })}
                  </span>
                </div>
              </div>
              {chevron}
            </a>
          ))}
        </div>
      )}

      {/* Favoriten */}
      <div className="settings-section">
        <h3 className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          {t('settings.sections.favorites')}
        </h3>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, margin: '4px 16px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 3 }}>
          {['groups', 'clubs'].map(tab => (
            <button
              key={tab}
              onClick={() => setFavTab(tab)}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
                background: favTab === tab ? 'rgba(253,118,102,0.18)' : 'transparent',
                color: favTab === tab ? '#FD7666' : 'rgba(255,255,255,0.45)',
                transition: 'all 0.15s',
              }}
            >
              {tab === 'groups' ? t('settings.favorites.tabGroups') : t('settings.favorites.tabClubs')}
            </button>
          ))}
        </div>

        {favLoading ? (
          <div style={{ padding: '16px 20px', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>{t('common.loading')}</div>
        ) : (() => {
          const list = favTab === 'groups' ? favGroups : favClubs;
          const path = favTab === 'groups' ? '/group/' : '/group/';
          if (!list.length) {
            return (
              <div style={{ padding: '16px 20px', color: 'rgba(255,255,255,0.3)', fontSize: 14, textAlign: 'center' }}>
                {favTab === 'groups' ? t('settings.favorites.emptyGroups') : t('settings.favorites.emptyClubs')}
              </div>
            );
          }
          return list.map(item => (
            <div
              key={item.id}
              className="settings-row"
              onClick={() => navigate(`${path}${item.id}`)}
            >
              <div className="settings-row-left" style={{ gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  overflow: 'hidden', background: '#2a2e4a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {item.image_url
                    ? <img src={item.image_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 18 }}>{favTab === 'clubs' ? '🏆' : '📅'}</span>
                  }
                </div>
                <div className="settings-row-stacked">
                  <span>{item.name}</span>
                  {item.location && <span className="settings-row-detail">{item.location}</span>}
                </div>
              </div>
              {chevron}
            </div>
          ));
        })()}
      </div>

      {/* Benachrichtigungen */}
      <div className="settings-section">
        <h3 className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {t('settings.sections.notifications')}
        </h3>

        <div className="settings-row">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span>{t('settings.notifications.newMessages')}</span>
          </div>
          <label className="settings-toggle">
            <input type="checkbox" checked={notifMessages} onChange={() => setNotifMessages(!notifMessages)} />
            <span className="settings-toggle-slider" />
          </label>
        </div>

        <div className="settings-row">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="8.5" cy="7" r="4"/>
              <line x1="20" y1="8" x2="20" y2="14"/>
              <line x1="23" y1="11" x2="17" y2="11"/>
            </svg>
            <span>{t('settings.notifications.friendRequests')}</span>
          </div>
          <label className="settings-toggle">
            <input type="checkbox" checked={notifRequests} onChange={() => setNotifRequests(!notifRequests)} />
            <span className="settings-toggle-slider" />
          </label>
        </div>

        <div className="settings-row">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span>{t('settings.notifications.groupActivity')}</span>
          </div>
          <label className="settings-toggle">
            <input type="checkbox" checked={notifGroups} onChange={() => setNotifGroups(!notifGroups)} />
            <span className="settings-toggle-slider" />
          </label>
        </div>

        {pushSupported && (
          <div className="settings-row">
            <div className="settings-row-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                <line x1="12" y1="2" x2="12" y2="4"/>
              </svg>
              <div className="settings-row-stacked">
                <span>{t('settings.notifications.push')}</span>
                <span className="settings-row-detail">{t('settings.notifications.pushHint')}</span>
              </div>
            </div>
            <label className="settings-toggle" style={{ opacity: pushLoading ? 0.5 : 1 }}>
              <input type="checkbox" checked={pushEnabled} onChange={handlePushToggle} disabled={pushLoading} />
              <span className="settings-toggle-slider" />
            </label>
          </div>
        )}
      </div>

      {/* App */}
      <div className="settings-section">
        <h3 className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09c-.658.003-1.25.396-1.51 1z"/>
          </svg>
          {t('settings.sections.app')}
        </h3>

        {/* Language switcher — Phase 1 i18n entry point */}
        <div className="settings-row static" style={{ alignItems: 'center' }}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <span>{t('settings.app.language')}</span>
          </div>
          {/* Dropdown instead of a pill per language — five pills crowded the
              row (Tobi 2026-08-04). Native <select> so phones open the OS
              picker. Endonyms (each language named in itself), so the list is
              readable no matter which language is active. */}
          <select
            value={currentLang}
            onChange={(e) => switchLanguage(e.target.value)}
            aria-label={t('settings.app.language')}
            style={{
              // appearance:none → iOS respektiert width/box sicher (Tobi); eigener
              // Chevron als data:-SVG (CSP imgSrc erlaubt data:, server.js).
              WebkitAppearance: 'none',
              appearance: 'none',
              padding: '8px 30px 8px 12px',
              borderRadius: 10,
              border: '1.5px solid rgba(255,255,255,0.15)',
              background: `rgba(255,255,255,0.06) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center`,
              backgroundSize: '12px',
              color: '#fff',
              fontWeight: 700,
              fontSize: 13,
              fontFamily: 'inherit',
              cursor: 'pointer',
              // Feste Breite + kein Schrumpfen: die Auto-Breite des nativen
              // <select> lief sonst über das „Sprache"-Label (Tobi 2026-08-05).
              flexShrink: 0,
              width: 150,
            }}
          >
            {[
              { code: 'de', label: 'Deutsch' },
              { code: 'en', label: 'English' },
              { code: 'it', label: 'Italiano' },
              { code: 'fr', label: 'Français' },
              { code: 'es', label: 'Español' },
            ].map(({ code, label }) => (
              /* Dark option bg: some desktop browsers render the open list
                 with the page's white-ish default otherwise. */
              <option key={code} value={code} style={{ background: '#2A2150', color: '#fff' }}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-row static">
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <div className="settings-row-stacked">
              <span>{t('settings.app.version')}</span>
              <span className="settings-row-detail">1.0.0</span>
            </div>
          </div>
        </div>
      </div>

      {/* Rechtliches */}
      <div className="settings-section">
        <h3 className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          {t('settings.sections.legal')}
        </h3>

        <Link to="/privacy" className="settings-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>{t('settings.legal.privacy')}</span>
          </div>
          {chevron}
        </Link>

        <Link to="/terms" className="settings-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span>{t('settings.legal.terms')}</span>
          </div>
          {chevron}
        </Link>

        <Link to="/guidelines" className="settings-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span>{t('settings.legal.guidelines')}</span>
          </div>
          {chevron}
        </Link>

        <Link to="/impressum" className="settings-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>{t('settings.legal.imprint')}</span>
          </div>
          {chevron}
        </Link>

        <Link to="/widerruf" className="settings-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            <span>{t('settings.legal.widerruf')}</span>
          </div>
          {chevron}
        </Link>

        <div className="settings-row" onClick={handleExportData} style={{ opacity: exportLoading ? 0.6 : 1 }}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <div className="settings-row-stacked">
              <span>{t('settings.legal.exportData')}</span>
              <span className="settings-row-detail">{t('settings.legal.exportDataHint')}</span>
            </div>
          </div>
          {exportLoading
            ? <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{t('common.loadingShort')}</span>
            : chevron}
        </div>

        {/* In-app feedback — same modal as the periodic prompt, on demand.
            Without this row the feedback form is only reachable when the
            ~3-month timer happens to fire. */}
        <div className="settings-row" onClick={() => setShowFeedback(true)} style={{ cursor: 'pointer' }}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <div className="settings-row-stacked">
              <span>{t('settings.legal.feedback')}</span>
              <span className="settings-row-detail">{t('settings.legal.feedbackHint')}</span>
            </div>
          </div>
          {chevron}
        </div>

        <Link to="/help" className="settings-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="settings-row-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div className="settings-row-stacked">
              <span>{t('settings.legal.help')}</span>
              <span className="settings-row-detail">{t('settings.legal.helpHint')}</span>
            </div>
          </div>
          {chevron}
        </Link>

        <div className="settings-row static">
          <div className="settings-row-left" style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', gap: 6 }}>
            <span>{t('settings.legal.legalContact')}: <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>office@jamie-app.com</a></span>
          </div>
        </div>
      </div>

      {/* Logout */}
      <button className="settings-logout-btn" onClick={handleLogout}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        {t('settings.logout')}
      </button>

      {/* Account löschen — Apple requirement: must be reachable */}

      {!showDeleteConfirm ? (
        <button className="settings-delete-link" onClick={() => setShowDeleteConfirm(true)}>
          {t('settings.deleteAccount')}
        </button>
      ) : (
        <div className="settings-expand" style={{ margin: '0 16px 40px' }}>
          <p className="delete-warning">
            {t('settings.deleteConfirm.warning')}
          </p>
          <form onSubmit={handleDeleteAccount} className="settings-form">
            <PasswordInput placeholder={t('settings.deleteConfirm.passwordPlaceholder')} value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} className="settings-input" autoComplete="current-password" />
            <div className="settings-form-actions">
              <button type="submit" className="danger-btn" disabled={deleteLoading}>
                {deleteLoading ? t('common.loading') : t('settings.deleteConfirm.confirm')}
              </button>
              <button type="button" className="settings-action-btn" onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      </div>{/* settings-body */}

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </div>
  );
};

export default SettingsPage;
