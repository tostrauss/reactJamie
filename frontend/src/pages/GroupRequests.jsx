import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { RequestCard } from '../components/RequestCard';
import '../styles/chat.css';

export const GroupRequests = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();

  const [requests, setRequests] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadRequests = async () => {
      setLoading(true);
      try {
        const res = await groups.getRequests(id);
        if (!cancelled) setRequests(res.data || []);
      } catch (err) {
        if (!cancelled) {
          const status = err.response?.status;
          if (status === 403) {
            toast.error(t('groupRequests.errorPermission'));
          } else {
            toast.error(t('groupRequests.errorLoad'));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadRequests();
    return () => { cancelled = true; };
  }, [id]);

  const handleAccept = async () => {
    if (processing) return;
    const request = requests[currentIndex];
    setProcessing(true);
    try {
      await groups.handleRequest(id, request.id, 'accept');
      toast.success(t('groupRequests.acceptedToast', { name: request.user_name }));
      goToNext();
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupRequests.acceptError'));
    } finally {
      setProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (processing) return;
    const request = requests[currentIndex];
    const rejectedIndex = currentIndex;
    setProcessing(true);
    try {
      await groups.handleRequest(id, request.id, 'reject');
      // Undoable toast — a mis-tapped reject can be reverted (Tobi 2026-07-31).
      toast.showUndo(
        t('groupRequests.declinedToast', { name: request.user_name }),
        async () => {
          try {
            await groups.handleRequest(id, request.id, 'undo');
            setCurrentIndex(rejectedIndex); // bring the card back into view
            toast.success(t('common.restored'));
          } catch {
            toast.error(t('groupRequests.declineError'));
          }
        },
        t('common.undo')
      );
      goToNext();
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupRequests.declineError'));
    } finally {
      setProcessing(false);
    }
  };

  const goToNext = () => {
    setCurrentIndex(prev => prev + 1);
  };

  const currentRequest = requests[currentIndex];

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

  return (
    <div className="page requests-page">
      <div className="requests-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="requests-title">
          {requests.length - currentIndex > 0
            ? t('groupRequests.countFmt', { count: requests.length - currentIndex })
            : t('groupRequests.empty')}
        </h1>
        <div style={{ width: 40 }} />
      </div>

      <div className="requests-content">
        {currentIndex >= requests.length ? (
          <div className="empty-state">
            <div className="empty-state-icon">✅</div>
            <h2 className="empty-state-title">{t('groupRequests.allDoneTitle')}</h2>
            <p className="empty-state-text">{t('groupRequests.allDoneText')}</p>
            <button className="btn btn-primary" onClick={() => navigate(-1)}>
              {t('groupRequests.backToGroup')}
            </button>
          </div>
        ) : currentRequest ? (
          <div className="request-card-wrapper">
            <RequestCard request={currentRequest} />

            {currentIndex < requests.length - 1 && (
              <div className="next-card-preview">
                {requests[currentIndex + 1].user_avatar ? (
                  <img src={requests[currentIndex + 1].user_avatar} alt="" loading="lazy" decoding="async" />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: 'var(--coral)' }}>
                    {(requests[currentIndex + 1].user_name || '?')[0].toUpperCase()}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {currentIndex < requests.length && (
        <div className="requests-actions">
          <button className="action-btn decline" onClick={handleDecline} disabled={processing}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
          <button className="action-btn accept" onClick={handleAccept} disabled={processing}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20,6 9,17 4,12"/>
            </svg>
          </button>
        </div>
      )}

      <style>{`
        /* Page layout only — the card + ✓/✗ actions now come from chat.css's
           .request-*/.requests-actions/.action-btn, shared 1:1 with the chat-list
           requests modal via <RequestCard> so both look identical (Tobi 2026-07-31).
           padding-top:0 — the .page base class already adds safe-area top, and
           .requests-header below adds it again; without this the header double-
           stacked the inset and sat too low on iOS. */
        .requests-page { display: flex; flex-direction: column; height: 100vh; padding-top: 0; padding-bottom: 0; }
        .requests-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; padding-top: calc(env(safe-area-inset-top, 20px) + 16px); }
        .back-btn { background: none; border: none; color: var(--text-white); cursor: pointer; padding: 8px; }
        .requests-title { font-size: 18px; font-weight: 600; color: var(--text-white); }
        .requests-content { flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px; overflow: hidden; }
        .empty-state { text-align: center; padding: 40px 20px; }
        .empty-state-icon { font-size: 64px; margin-bottom: 16px; }
        .empty-state-title { font-size: 20px; font-weight: 600; color: var(--text-white); margin-bottom: 8px; }
        .empty-state-text { font-size: 14px; color: var(--text-muted); margin-bottom: 24px; }
      `}</style>
    </div>
  );
};
export default GroupRequests;
