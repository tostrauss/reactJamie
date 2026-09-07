import { useState, useEffect, useMemo, useContext, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import VerifiedBadge from '../components/VerifiedBadge';
import { isNativeIOS } from '../utils/platform';
import '../styles/chat.css';

// Per-group "Anfragen-Übersicht" (review-all overview). Product call 2026-09-07
// (Tina): a private-group owner must be able to look through ALL pending join
// requests at once and decide calmly — the aggregated chat-list deck only shows
// one at a time. The read-all list + per-request accept/decline is FREE for
// every owner; the power-tools (Alle annehmen · sortieren · filtern) are the
// JAMIE-Pro layer. While payments are off the tools open the coming-soon Pro
// modal (same pattern as paidEvents); admins get them for real.

const parseInterests = (raw) => {
  let list = [];
  try {
    list = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
  } catch { /* malformed JSON — show none */ }
  return Array.isArray(list) ? list : [];
};

const ageOf = (r) => (r.user_dob
  ? Math.floor((Date.now() - new Date(r.user_dob)) / 31557600000)
  : (r.user_age ?? null));

export const GroupRequests = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
  const { user, isPro } = useContext(AuthContext);
  const isAdmin = !!user?.is_admin;

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  // Pro power-tools state (client-side over the already-fetched list).
  const [sortMode, setSortMode] = useState('newest'); // newest | oldest | verified
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  // Who may actually USE the Pro tools. Non-Pro non-admins get the locked
  // upsell (web) or nothing (native iOS — Apple 3.1.1: no external-purchase
  // teasing, same rule the roster gate follows).
  const canUseTools = isPro || isAdmin;
  const showToolsBar = canUseTools || !isNativeIOS();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await groups.getRequests(id);
        if (!cancelled) setRequests(res.data || []);
      } catch (err) {
        if (!cancelled) {
          toast.error(err.response?.status === 403
            ? t('groupRequests.errorPermission')
            : t('groupRequests.errorLoad'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const openProModal = useCallback(() => {
    window.dispatchEvent(new CustomEvent('jamie:open-pro-modal', { detail: { feature: 'reviewRequests' } }));
  }, []);

  // Reset the "Alle annehmen?" confirm whenever the pool shifts under it.
  useEffect(() => { setConfirmAll(false); }, [requests.length, verifiedOnly, sortMode]);

  const visible = useMemo(() => {
    let list = requests;
    if (verifiedOnly) list = list.filter(r => r.user_trusted);
    const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
    if (sortMode === 'oldest') list = [...list].sort((a, b) => -byNewest(a, b));
    else if (sortMode === 'verified') list = [...list].sort((a, b) => (b.user_trusted ? 1 : 0) - (a.user_trusted ? 1 : 0) || byNewest(a, b));
    else list = [...list].sort(byNewest);
    return list;
  }, [requests, sortMode, verifiedOnly]);

  const accept = async (req) => {
    if (processingId || bulkBusy) return;
    setProcessingId(req.id);
    try {
      await groups.handleRequest(id, req.id, 'accept');
      setRequests(prev => prev.filter(r => r.id !== req.id));
      toast.success(t('groupRequests.acceptedToast', { name: req.user_name }));
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupRequests.acceptError'));
    } finally {
      setProcessingId(null);
    }
  };

  const decline = async (req) => {
    if (processingId || bulkBusy) return;
    setProcessingId(req.id);
    try {
      await groups.handleRequest(id, req.id, 'reject');
      setRequests(prev => prev.filter(r => r.id !== req.id));
      // Undoable — a mis-tapped reject can be reverted (has no side effects).
      toast.showUndo(
        t('groupRequests.declinedToast', { name: req.user_name }),
        async () => {
          try {
            await groups.handleRequest(id, req.id, 'undo');
            setRequests(prev => (prev.some(r => r.id === req.id) ? prev : [...prev, req]));
            toast.success(t('common.restored'));
          } catch {
            toast.error(t('groupRequests.declineError'));
          }
        },
        t('common.undo')
      );
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupRequests.declineError'));
    } finally {
      setProcessingId(null);
    }
  };

  // ── Pro: accept every request in the current (filtered) view ──────────────
  // One server round trip (transactional, capacity-safe) rather than N calls.
  const acceptAll = async () => {
    if (!canUseTools) { openProModal(); return; }
    if (!confirmAll) { setConfirmAll(true); return; }
    setConfirmAll(false);
    setBulkBusy(true);
    const ids = visible.map(r => r.id);
    try {
      const res = await groups.acceptAllRequests(id, ids);
      const acceptedIds = res.data?.acceptedIds || [];
      const skipped = (res.data?.skippedNoAvatar || 0) + (res.data?.skippedFull || 0);
      if (acceptedIds.length) {
        const done = new Set(acceptedIds);
        setRequests(prev => prev.filter(r => !done.has(r.id)));
        toast.success(t('groupRequests.acceptedAllToast', { count: acceptedIds.length }));
      }
      // Some couldn't be taken (no photo, or the group filled up mid-batch) —
      // they stay in the list, pending.
      if (skipped > 0) toast.error(t('groupRequests.acceptAllError'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupRequests.acceptAllError'));
    } finally {
      setBulkBusy(false);
    }
  };

  const onToolClick = (fn) => (canUseTools ? fn : openProModal);

  if (loading) {
    return (
      <div className="page">
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>{t('groupRequests.loading')}</p>
        </div>
      </div>
    );
  }

  const total = requests.length;

  return (
    <div className="page reqov-page">
      <div className="reqov-header">
        <button className="back-btn" onClick={() => navigate(-1)} aria-label={t('common.back', { defaultValue: 'Zurück' })}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="reqov-title">
          {total > 0 ? t('groupRequests.countFmt', { count: total }) : t('groupRequests.title')}
        </h1>
        <div style={{ width: 40 }} />
      </div>

      {total === 0 ? (
        <div className="reqov-empty">
          <div className="reqov-empty-icon">✅</div>
          <h2 className="reqov-empty-title">{t('groupRequests.allDoneTitle')}</h2>
          <p className="reqov-empty-text">{t('groupRequests.allDoneText')}</p>
          <button className="btn btn-primary" onClick={() => navigate(-1)}>
            {t('groupRequests.backToGroup')}
          </button>
        </div>
      ) : (
        <>
          <p className="reqov-hint">{t('groupRequests.reviewAllHint')}</p>

          {showToolsBar && (
            <div className={`reqov-tools${canUseTools ? '' : ' locked'}`}>
              <div className="reqov-tools-head">
                <span className="reqov-tools-label">
                  {t('groupRequests.proTools')}
                  {!canUseTools && <span className="reqov-pro-pill">👑 {t('groupRequests.proBadge')}</span>}
                </span>
              </div>
              <div className="reqov-tools-row">
                <button
                  type="button"
                  className={`reqov-chip accept-all${confirmAll ? ' confirm' : ''}`}
                  onClick={onToolClick(acceptAll)}
                  disabled={bulkBusy || processingId != null}
                >
                  {confirmAll
                    ? t('groupRequests.acceptAllConfirm', { count: visible.length })
                    : `✓ ${t('groupRequests.acceptAll')}`}
                </button>

                <button
                  type="button"
                  className={`reqov-chip${verifiedOnly ? ' on' : ''}`}
                  onClick={onToolClick(() => setVerifiedOnly(v => !v))}
                >
                  {t('groupRequests.filterVerifiedOnly')}
                </button>

                <select
                  className="reqov-select"
                  value={sortMode}
                  onChange={canUseTools ? (e) => setSortMode(e.target.value) : undefined}
                  onMouseDown={canUseTools ? undefined : (e) => { e.preventDefault(); openProModal(); }}
                  aria-label={t('groupRequests.sortLabel')}
                >
                  <option value="newest">{t('groupRequests.sortNewest')}</option>
                  <option value="oldest">{t('groupRequests.sortOldest')}</option>
                  <option value="verified">{t('groupRequests.sortVerified')}</option>
                </select>
              </div>
            </div>
          )}

          {visible.length === 0 ? (
            <p className="reqov-filter-empty">{t('groupRequests.emptyFiltered')}</p>
          ) : (
            <div className="reqov-list">
              {visible.map(req => {
                const age = ageOf(req);
                const interests = parseInterests(req.user_interests).slice(0, 4);
                const busy = processingId === req.id || bulkBusy;
                return (
                  <div className="reqov-item" key={req.id}>
                    <button
                      type="button"
                      className="reqov-avatar-wrap"
                      onClick={() => navigate(`/user/${req.user_id}`)}
                      aria-label={t('common.viewProfile')}
                    >
                      {req.user_avatar
                        ? <img className="reqov-avatar" src={req.user_avatar} alt={req.user_name} loading="lazy" decoding="async" />
                        : <span className="reqov-avatar reqov-avatar-ph">{(req.user_name || '?')[0].toUpperCase()}</span>}
                      {req.user_trusted && <VerifiedBadge className="reqov-badge" size={20} />}
                    </button>

                    <div className="reqov-info">
                      <button type="button" className="reqov-name" onClick={() => navigate(`/user/${req.user_id}`)}>
                        {req.user_name}{age ? `, ${age}` : ''}
                      </button>
                      {req.message && <p className="reqov-msg">{req.message}</p>}
                      {interests.length > 0 && (
                        <div className="reqov-interests">
                          {interests.map((tag, i) => <span key={i} className="reqov-tag">{tag}</span>)}
                        </div>
                      )}
                    </div>

                    <div className="reqov-actions">
                      <button className="reqov-act decline" onClick={() => decline(req)} disabled={busy} aria-label={t('groupRequests.decline')}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                      <button className="reqov-act accept" onClick={() => accept(req)} disabled={busy} aria-label={t('groupRequests.accept')}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20,6 9,17 4,12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <style>{`
        .reqov-page { display: flex; flex-direction: column; min-height: 100vh; padding-top: 0; padding-bottom: calc(60px + var(--nav-safe-bottom) + 16px); }
        .reqov-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; padding-top: calc(env(safe-area-inset-top, 20px) + 16px); position: sticky; top: 0; z-index: 5; background: var(--bg-dark, #14101f); }
        .back-btn { background: none; border: none; color: var(--text-white); cursor: pointer; padding: 8px; }
        .reqov-title { font-size: 18px; font-weight: 700; color: var(--text-white); }
        .reqov-hint { color: var(--text-muted); font-size: 13px; line-height: 1.4; margin: 0 16px 12px; text-align: center; }

        .reqov-tools { margin: 0 16px 14px; padding: 12px; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid rgba(253,118,102,0.18); }
        .reqov-tools.locked { opacity: 0.92; }
        .reqov-tools-head { margin-bottom: 10px; }
        .reqov-tools-label { font-size: 12px; font-weight: 700; letter-spacing: 0.3px; color: var(--accent-coral); text-transform: uppercase; display: inline-flex; align-items: center; gap: 8px; }
        .reqov-pro-pill { background: rgba(253,118,102,0.15); color: var(--accent-coral); border-radius: 20px; padding: 2px 9px; font-size: 11px; font-weight: 800; letter-spacing: 0; text-transform: none; }
        .reqov-tools-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .reqov-chip { border: 1px solid rgba(255,255,255,0.14); background: var(--bg-input); color: var(--text-light); font-size: 13px; font-weight: 600; padding: 9px 14px; border-radius: 999px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .reqov-chip.on { background: rgba(253,118,102,0.16); border-color: var(--accent-coral); color: var(--accent-coral); }
        .reqov-chip.accept-all { color: var(--accent-green); border-color: rgba(76,217,100,0.4); }
        .reqov-chip.accept-all.confirm { background: var(--accent-green); color: #fff; border-color: var(--accent-green); }
        .reqov-chip:disabled { opacity: 0.5; cursor: not-allowed; }
        .reqov-select { border: 1px solid rgba(255,255,255,0.14); background: var(--bg-input); color: var(--text-light); font-size: 13px; font-weight: 600; padding: 9px 12px; border-radius: 999px; cursor: pointer; margin-left: auto; }

        .reqov-list { padding: 0 16px; display: flex; flex-direction: column; gap: 10px; }
        .reqov-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px; background: var(--bg-card); border-radius: var(--radius-lg); }
        .reqov-avatar-wrap { position: relative; flex-shrink: 0; width: 60px; height: 60px; border: none; background: none; padding: 0; cursor: pointer; }
        .reqov-avatar { width: 60px; height: 60px; border-radius: 50%; object-fit: cover; display: flex; align-items: center; justify-content: center; }
        .reqov-avatar-ph { background: var(--bg-input); color: var(--accent-coral); font-size: 24px; font-weight: 700; }
        .reqov-badge { position: absolute; bottom: -2px; right: -2px; }
        .reqov-info { flex: 1; min-width: 0; }
        .reqov-name { background: none; border: none; padding: 0; text-align: left; font-size: 16px; font-weight: 700; color: var(--text-white); cursor: pointer; }
        .reqov-msg { font-size: 13px; color: var(--text-muted); line-height: 1.4; margin: 4px 0 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
        .reqov-interests { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .reqov-tag { font-size: 11px; font-weight: 600; color: var(--accent-coral); background: rgba(253,118,102,0.12); border-radius: 999px; padding: 3px 9px; }
        .reqov-actions { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
        .reqov-act { width: 44px; height: 44px; border: none; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; transition: transform var(--transition-fast); }
        .reqov-act:disabled { opacity: 0.5; cursor: not-allowed; }
        .reqov-act:not(:disabled):active { transform: scale(0.92); }
        .reqov-act.accept { background: var(--accent-green); color: #fff; }
        .reqov-act.decline { background: var(--bg-input); color: var(--text-muted); }

        .reqov-filter-empty { text-align: center; color: var(--text-muted); font-size: 14px; padding: 30px 16px; }
        .reqov-empty { text-align: center; padding: 60px 20px; }
        .reqov-empty-icon { font-size: 64px; margin-bottom: 16px; }
        .reqov-empty-title { font-size: 20px; font-weight: 700; color: var(--text-white); margin-bottom: 8px; }
        .reqov-empty-text { font-size: 14px; color: var(--text-muted); margin-bottom: 24px; }
      `}</style>
    </div>
  );
};
export default GroupRequests;
