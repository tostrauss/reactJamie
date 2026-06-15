import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { UserName } from '../components/UserName';

export const GroupRequests = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-DE';

  const [requests, setRequests] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swipeDirection, setSwipeDirection] = useState(null);
  const [startX, setStartX] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [processing, setProcessing] = useState(false);
  const cardRef = useRef(null);

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

  const handleTouchStart = (e) => {
    setStartX(e.touches[0].clientX);
  };

  const handleTouchMove = (e) => {
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;
    setOffsetX(diff);
    if (diff > 50) setSwipeDirection('right');
    else if (diff < -50) setSwipeDirection('left');
    else setSwipeDirection(null);
  };

  const handleTouchEnd = () => {
    if (offsetX > 100) handleAccept();
    else if (offsetX < -100) handleDecline();
    else { setOffsetX(0); setSwipeDirection(null); }
  };

  const handleAccept = async () => {
    if (processing) return;
    const request = requests[currentIndex];
    setProcessing(true);
    try {
      await groups.handleRequest(id, request.id, 'accept');
      toast.success(t('groupRequests.acceptedToast', { name: request.user_name }));
      setSwipeDirection('right');
      setOffsetX(300);
      setTimeout(() => { goToNext(); setProcessing(false); }, 300);
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupRequests.acceptError'));
      setOffsetX(0); setSwipeDirection(null); setProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (processing) return;
    const request = requests[currentIndex];
    setProcessing(true);
    try {
      await groups.handleRequest(id, request.id, 'reject');
      toast.info(t('groupRequests.declinedToast', { name: request.user_name }));
      setSwipeDirection('left');
      setOffsetX(-300);
      setTimeout(() => { goToNext(); setProcessing(false); }, 300);
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupRequests.declineError'));
      setOffsetX(0); setSwipeDirection(null); setProcessing(false);
    }
  };

  const goToNext = () => {
    setOffsetX(0);
    setSwipeDirection(null);
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
          <div
            className="request-card-wrapper"
            ref={cardRef}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{
              transform: `translateX(${offsetX}px) rotate(${offsetX * 0.05}deg)`,
              transition: Math.abs(offsetX) > 100 ? 'transform 0.3s ease' : 'none'
            }}
          >
            <div className={`swipe-indicator swipe-accept ${swipeDirection === 'right' ? 'visible' : ''}`}>
              <span>✓</span>
              <span>{t('groupRequests.accept')}</span>
            </div>
            <div className={`swipe-indicator swipe-decline ${swipeDirection === 'left' ? 'visible' : ''}`}>
              <span>✕</span>
              <span>{t('groupRequests.decline')}</span>
            </div>

            <div className="request-card">
              <div className="request-image-container">
                {currentRequest.user_avatar ? (
                  <img src={currentRequest.user_avatar} alt={currentRequest.user_name} className="request-user-image" decoding="async" fetchpriority="high" />
                ) : (
                  <div className="request-avatar-placeholder">
                    {(currentRequest.user_name || '?')[0].toUpperCase()}
                  </div>
                )}
              </div>

              <div className="request-user-info">
                <h2 className="request-name">
                  <UserName name={currentRequest.user_name} age={currentRequest.user_age} />
                </h2>

                {currentRequest.user_bio && (
                  <p className="request-bio">{currentRequest.user_bio}</p>
                )}

                {currentRequest.message && (
                  <div className="request-message-box">
                    <p className="request-message">"{currentRequest.message}"</p>
                  </div>
                )}

                <p className="request-date">
                  {t('groupRequests.requestedOnFmt', { date: new Date(currentRequest.created_at).toLocaleDateString(dateLocale) })}
                </p>
              </div>
            </div>

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
        /* padding-top:0 — the .page base class already adds safe-area top, and
           .requests-header below adds it again; without this the header double-
           stacked the inset and sat too low on iOS. */
        .requests-page { display: flex; flex-direction: column; height: 100vh; padding-top: 0; padding-bottom: 0; }
        .requests-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; padding-top: calc(env(safe-area-inset-top, 20px) + 16px); }
        .back-btn { background: none; border: none; color: var(--text-white); cursor: pointer; padding: 8px; }
        .requests-title { font-size: 18px; font-weight: 600; color: var(--text-white); }
        .requests-content { flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px; overflow: hidden; }
        .request-card-wrapper { position: relative; width: 100%; max-width: 340px; user-select: none; }
        .swipe-indicator { position: absolute; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; opacity: 0; transition: opacity 0.2s; z-index: 10; }
        .swipe-indicator span:first-child { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; }
        .swipe-accept { right: -20px; color: var(--accent-green); }
        .swipe-accept span:first-child { background: var(--accent-green); color: white; }
        .swipe-decline { left: -20px; color: var(--status-busy); }
        .swipe-decline span:first-child { background: var(--status-busy); color: white; }
        .swipe-indicator.visible { opacity: 1; }
        .request-card { background: var(--bg-card); border-radius: 20px; overflow: hidden; box-shadow: var(--shadow-lg); }
        .request-image-container { position: relative; width: 100%; aspect-ratio: 4/3; background: var(--bg-input); }
        .request-user-image { width: 100%; height: 100%; object-fit: cover; }
        .request-avatar-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 64px; font-weight: 700; color: var(--coral); background: var(--bg-input); }
        .request-user-info { padding: 20px; text-align: center; }
        .request-name { font-size: 24px; font-weight: 700; color: var(--text-white); margin-bottom: 8px; }
        .request-bio { font-size: 13px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4; }
        .request-message-box { background: var(--bg-input); border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; }
        .request-message { font-size: 14px; color: var(--text-light); font-style: italic; line-height: 1.4; }
        .request-date { font-size: 12px; color: var(--text-muted); }
        .next-card-preview { position: absolute; bottom: -60px; left: 50%; transform: translateX(-50%); width: 80%; height: 60px; border-radius: 20px 20px 0 0; overflow: hidden; opacity: 0.5; z-index: -1; }
        .next-card-preview img { width: 100%; height: 100%; object-fit: cover; filter: blur(2px); }
        /* 92px = 24px gap + 68px nav clearance (flush 48px strip + 11px "+"
           protrusion, NO safe-area — see .bottom-nav). The old env()-based
           value left the buttons' lower halves under the nav on 0-inset devices. */
        .requests-actions { display: flex; justify-content: center; gap: 40px; padding: 24px; padding-bottom: 92px; }
        .action-btn { width: 70px; height: 70px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
        .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .action-btn:not(:disabled):hover { transform: scale(1.1); }
        .action-btn:not(:disabled):active { transform: scale(0.95); }
        .action-btn.decline { background: var(--bg-input); color: var(--text-muted); }
        .action-btn.decline:not(:disabled):hover { background: var(--status-busy); color: white; box-shadow: 0 4px 20px rgba(255,59,48,0.4); }
        .action-btn.accept { background: var(--accent-green); color: white; box-shadow: 0 4px 20px rgba(76,217,100,0.4); }
        .action-btn.accept:not(:disabled):hover { box-shadow: 0 6px 25px rgba(76,217,100,0.5); }
        .empty-state { text-align: center; padding: 40px 20px; }
        .empty-state-icon { font-size: 64px; margin-bottom: 16px; }
        .empty-state-title { font-size: 20px; font-weight: 600; color: var(--text-white); margin-bottom: 8px; }
        .empty-state-text { font-size: 14px; color: var(--text-muted); margin-bottom: 24px; }
      `}</style>
    </div>
  );
};
export default GroupRequests;
