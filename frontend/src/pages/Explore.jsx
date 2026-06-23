import { useState, useEffect, useContext, useCallback, useRef, memo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups, deals as dealsApi, upload as uploadApi } from '../utils/api';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { DealCard } from '../components/DealCard';
import { UserName } from '../components/UserName';
import { JamieWordmark } from '../components/JamieWordmark';
import '../styles/explore.css';

const getCategoryIcon = (catName) => {
  if (!catName) return '✨';
  for (const cat of CATEGORY_HIERARCHY) {
    if (cat.label === catName || cat.id === catName) return cat.icon;
    const sub = cat.subs?.find(s => s.name === catName);
    if (sub) return sub.icon;
  }
  return '✨';
};

// i18n-aware: takes the page's `t` so English users don't see German labels
// on Hall of Fame card timestamps. Keys live under explore.timeAgo.* and use
// _one / _other pluralization.
const formatTimeAgo = (dateStr, t) => {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('explore.timeAgo.justNow');
  if (mins < 60) return t('explore.timeAgo.minutesAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('explore.timeAgo.hoursAgo', { count: hrs });
  return t('explore.timeAgo.daysAgo', { count: Math.floor(hrs / 24) });
};

const formatCameraDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const isPast = (dateStr) => !!dateStr && new Date(dateStr) < new Date();

const seedColor = (id, offset = 0) =>
  `hsl(${((id + offset) * 137) % 360}, 55%, 52%)`;

// ─── Hall-of-Fame card ───────────────────────────────────────────────────────
// Read-only "polaroid" of a past event. The outer is a <div> (NOT a <button>)
// for both owners and viewers — nested interactive elements (heart, "Moment"
// upload prompt) inside a <button> is invalid HTML. We give the owner card
// role="button" + keyboard handler so it stays accessible and tappable for
// navigation, while preserving the heart and Moment-upload sub-buttons.
//
// The displayed image is moment_photo_url ?? image_url. When the viewer is
// the owner AND moment_photo_url is null, a BeReal-style upload prompt sits
// over the media. The prompt persists across days — owners can fill it in
// whenever they want.

const HofCard = memo(({ item, isOwner, liked, likeCount, onToggleLike, onUploadMoment, navigate, t }) => {
  const icon = getCategoryIcon(item.category);
  const timeAgo = formatTimeAgo(item.created_at, t);
  const fileInputRef = useRef(null);

  const displayPhoto = item.moment_photo_url || item.image_url;
  const showMomentPrompt = isOwner && !item.moment_photo_url;

  const handleLike = (e) => {
    e.stopPropagation();
    onToggleLike(item);
  };

  const openPicker = (e) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so picking the same file again re-fires onChange
    if (file) onUploadMoment(item, file);
  };

  const handleNavigate = () => {
    if (isOwner) navigate(`/group/${item.id}`);
  };

  const handleKey = (e) => {
    if (!isOwner) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(`/group/${item.id}`);
    }
  };

  return (
    <div
      className={`ef-card ${isOwner ? 'ef-card--owner' : 'ef-card--locked'}`}
      role={isOwner ? 'button' : undefined}
      tabIndex={isOwner ? 0 : undefined}
      onClick={handleNavigate}
      onKeyDown={handleKey}
    >
      {/* Photo */}
      <div className="ef-media">
        {displayPhoto ? (
          <img src={displayPhoto} alt={item.name} loading="lazy" decoding="async" className="ef-media-img" />
        ) : (
          <div className="ef-media-placeholder">
            <span className="ef-ph-icon">{icon}</span>
          </div>
        )}

        {/* Top-right: public like (heart + count). Always interactive. */}
        <button
          type="button"
          className={`ef-heart-btn${liked ? ' is-active' : ''}`}
          onClick={handleLike}
          aria-label={liked ? t('explore.like.remove') : t('explore.like.add')}
          aria-pressed={liked}
        >
          <svg width="20" height="20" viewBox="0 0 24 24"
               fill={liked ? '#FD7666' : 'none'}
               stroke={liked ? '#FD7666' : 'currentColor'}
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          {likeCount > 0 && <span className="ef-like-count">{likeCount}</span>}
        </button>

        {/* Moment upload prompt — owner only, until moment_photo_url is set.
            BeReal-style: full-card frosted overlay with a single CTA. */}
        {showMomentPrompt && (
          <button type="button" className="ef-moment-prompt" onClick={openPicker}>
            <span className="ef-moment-icon" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </span>
            <span className="ef-moment-title">{t('explore.moment.cta')}</span>
            <span className="ef-moment-sub">{t('explore.moment.hint')}</span>
          </button>
        )}

        {/* Hidden file input — driven by the prompt button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />

        {/* Bottom-left: timestamp (the "polaroid" date stamp) */}
        <span className="ef-timestamp">{formatCameraDate(item.date || item.created_at)}</span>

        {/* Bottom-right: stacked member avatars */}
        <div className="ef-avatars">
          <div className="ef-av" style={{ background: seedColor(item.id, 7) }} />
          <div className="ef-av" style={{ background: seedColor(item.id, 3) }} />
          <div className="ef-av ef-av--front">
            {item.owner_avatar
              ? <img src={item.owner_avatar} alt="" loading="lazy" decoding="async" />
              : (item.owner_name || '?')[0].toUpperCase()}
          </div>
        </div>
      </div>

      {/* Footer — the author block is tappable to the poster's profile (works
          for every viewer, not just the owner). stopPropagation so it doesn't
          also trigger the card's group navigation. */}
      <div className="ef-footer">
        <div
          className="ef-user"
          onClick={item.owner_id ? (e) => { e.stopPropagation(); navigate(`/user/${item.owner_id}`); } : undefined}
          onKeyDown={item.owner_id ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); navigate(`/user/${item.owner_id}`); } } : undefined}
          role={item.owner_id ? 'button' : undefined}
          tabIndex={item.owner_id ? 0 : undefined}
          style={item.owner_id ? { cursor: 'pointer' } : undefined}
        >
          <div className="ef-user-av">
            {item.owner_avatar
              ? <img src={item.owner_avatar} alt={item.owner_name} loading="lazy" decoding="async" />
              : <span style={{ background: seedColor(item.id) }}>{(item.owner_name || '?')[0].toUpperCase()}</span>}
          </div>
          <div className="ef-user-meta">
            <p className="ef-user-name">
              <UserName name={item.owner_name || 'Unbekannt'} age={item.owner_age} />
            </p>
            <p className="ef-user-time">{timeAgo}</p>
          </div>
        </div>
        {item.category && <span className="ef-cat">{item.category}</span>}
      </div>
    </div>
  );
});

// ─── Main ────────────────────────────────────────────────────────────────────

const TABS = { hall: 'hall', deals: 'deals' };

export const Explore = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const toast = useToast();

  // Tab held in the URL (?tab=deals) so navigating into a detail page and
  // swiping back restores the tab. replace:true keeps tab switches off the
  // back stack.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === TABS.deals ? TABS.deals : TABS.hall;
  const setTab = (next) => setSearchParams(prev => {
    const sp = new URLSearchParams(prev);
    if (next === TABS.hall) sp.delete('tab');
    else sp.set('tab', next);
    return sp;
  }, { replace: true });
  const [loading, setLoading]         = useState(true);
  const [hallItems, setHallItems]     = useState([]);
  const [dealList, setDealList]       = useState([]);
  const [likedIds, setLikedIds]       = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const isAuthed = user && !user.isGuest;
        const [allRes, dealsRes, likesRes] = await Promise.all([
          groups.getAll({ limit: 50 }).catch(() => ({ data: [] })),
          dealsApi.getAll().catch(() => ({ data: [] })),
          isAuthed ? groups.getMyLikes().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
        ]);
        if (cancelled) return;

        const all = allRes.data || [];
        setHallItems(all.filter(g => isPast(g.date)));
        setDealList(dealsRes.data || []);
        // getMyLikes returns a bare array of group ids the caller has liked.
        setLikedIds(new Set(likesRes.data || []));
      } catch { /* silent */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Upload the JAMIE Moment photo for one of the owner's past events. Two-step:
  //   1. POST /api/upload → returns the public URL for the file
  //   2. PUT /api/groups/:id  with { moment_photo_url } → persists it
  // Optimistic UI: we replace the card image as soon as step 1 returns so the
  // owner doesn't have to wait for the DB roundtrip to see their picture.
  const handleUploadMoment = useCallback(async (item, file) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('explore.moment.tooLarge'));
      return;
    }
    let uploadedUrl;
    try {
      const res = await uploadApi.image(file);
      uploadedUrl = res.data?.url;
      if (!uploadedUrl) throw new Error('no url');
    } catch {
      toast.error(t('explore.moment.uploadError'));
      return;
    }
    // Optimistic state update
    setHallItems(prev => prev.map(g =>
      g.id === item.id ? { ...g, moment_photo_url: uploadedUrl } : g
    ));
    try {
      await groups.update(item.id, { moment_photo_url: uploadedUrl });
      toast.success(t('explore.moment.savedToast'));
    } catch {
      // Revert if persisting failed
      setHallItems(prev => prev.map(g =>
        g.id === item.id ? { ...g, moment_photo_url: item.moment_photo_url ?? null } : g
      ));
      toast.error(t('explore.moment.saveError'));
    }
  }, [toast, t]);

  // Optimistic public-like toggle with rollback. Hall-of-Fame items are all
  // type='group' (clubs have no date), so groups.toggleLike covers every card.
  // The card count updates immediately, then syncs to the server's authoritative
  // count on response.
  const adjustCount = (id, delta) => setHallItems(prev => prev.map(g =>
    g.id === id ? { ...g, like_count: Math.max(0, (g.like_count || 0) + delta) } : g));

  const handleToggleLike = useCallback(async (item) => {
    if (!user || user.isGuest) {
      toast.error(t('explore.loginToLike'));
      return;
    }
    const wasLiked = likedIds.has(item.id);
    setLikedIds(prev => {
      const next = new Set(prev);
      wasLiked ? next.delete(item.id) : next.add(item.id);
      return next;
    });
    adjustCount(item.id, wasLiked ? -1 : 1);
    try {
      const res = await groups.toggleLike(item.id);
      if (res?.data) {
        // Sync to the authoritative count + liked state from the server.
        setHallItems(prev => prev.map(g => g.id === item.id ? { ...g, like_count: res.data.like_count } : g));
        setLikedIds(prev => {
          const next = new Set(prev);
          res.data.liked ? next.add(item.id) : next.delete(item.id);
          return next;
        });
      }
    } catch {
      setLikedIds(prev => {
        const next = new Set(prev);
        wasLiked ? next.add(item.id) : next.delete(item.id);
        return next;
      });
      adjustCount(item.id, wasLiked ? 1 : -1);
      toast.error(t('explore.likeError'));
    }
  }, [user, toast, t, likedIds]);

  return (
    <div className="explore-container">

      {/* ── Scrollable content — JAMIE bar AND the tab strip live inside the
          scroll region so both disappear when the user scrolls down. ───── */}
      <div className="explore-content">

        <div className="ef-top">
          <JamieWordmark size="header" />
        </div>

        <div className="ef-sticky">
          <div className="ef-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === TABS.hall}
              className={`ef-tab${tab === TABS.hall ? ' is-active' : ''}`}
              onClick={() => setTab(TABS.hall)}
            >
              {t('explore.tabs.hallOfFame')}
            </button>
            <button
              role="tab"
              aria-selected={tab === TABS.deals}
              className={`ef-tab${tab === TABS.deals ? ' is-active' : ''}`}
              onClick={() => setTab(TABS.deals)}
            >
              {t('explore.tabs.deals')}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="explore-loading"><div className="explore-spinner" /></div>
        ) : tab === TABS.hall ? (
          hallItems.length === 0 ? (
            <div className="explore-empty">
              <div className="explore-empty-icon">🏆</div>
              <p>{t('explore.empty.hallOfFame')}</p>
            </div>
          ) : (
            <div className="ef-feed">
              {hallItems.map(item => (
                <HofCard
                  key={`hof-${item.id}`}
                  item={item}
                  isOwner={user && !user.isGuest && Number(item.owner_id) === Number(user.id)}
                  liked={likedIds.has(item.id)}
                  likeCount={item.like_count || 0}
                  onToggleLike={handleToggleLike}
                  onUploadMoment={handleUploadMoment}
                  navigate={navigate}
                  t={t}
                />
              ))}
            </div>
          )
        ) : (
          dealList.length === 0 ? (
            <div className="explore-empty">
              <div className="explore-empty-icon">🤝</div>
              <p>{t('explore.empty.deals')}</p>
            </div>
          ) : (
            <div className="ef-deal-feed">
              {dealList.map(deal => (
                <DealCard key={`deal-${deal.id}`} deal={deal} variant="explore" />
              ))}
            </div>
          )
        )}

      </div>
    </div>
  );
};

export default Explore;
