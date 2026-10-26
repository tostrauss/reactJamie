import { useState, useEffect, useContext, useCallback, useRef, memo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups, upload as uploadApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { UserName } from '../components/UserName';
import { JamieWordmark } from '../components/JamieWordmark';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { FriendSearch } from '../components/FriendSearch';
import useOnPullRefresh from '../hooks/useOnPullRefresh';
import {
  getCategoryIcon, MAX_MEMORY_BYTES, withAddedPhoto, withoutPhoto, photoErrorText,
} from '../utils/memories';
import '../styles/explore.css';

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


const seedColor = (id, offset = 0) =>
  `hsl(${((id + offset) * 137) % 360}, 55%, 52%)`;

// ─── Memory card ─────────────────────────────────────────────────────────────
// Read-only "polaroid" of a past event. The outer is a <div> (NOT a <button>)
// for both owners and viewers — nested interactive elements (heart, photo
// button) inside a <button> is invalid HTML. We give the owner card
// role="button" + keyboard handler so it stays accessible and tappable for
// navigation, while preserving the heart and photo sub-buttons.
//
// The displayed image is moment_photo_url ?? newest participant photo ??
// image_url. The feeds ask for cards with a picture only (Memories, Tina
// 22.10.2026), so the grey placeholder is just a defensive fallback; the
// owner's moment upload moved to „Warst du dabei..“ (pages/ShareMoments.jsx).
//
// Participants add photos too (Lea, 18.10.2026: „als Teilnehmer nicht"):
// can_add_photo comes from the server (took part + below the limits), the
// „📷 n Fotos" chip opens the gallery of everything shared for the event.

const HofCard = memo(({ item, isOwner, liked, likeCount, onToggleLike, onAddPhoto, onOpenGallery, uploading, navigate, t }) => {
  const icon = getCategoryIcon(item.category);
  const timeAgo = formatTimeAgo(item.created_at, t);
  const photoInputRef = useRef(null);
  // Timestamp of the last picker selection. iOS synthesizes a "ghost" click on
  // whatever sits under the finger after a native picker/sheet dismisses — which
  // lands on the owner card and navigated to the group page right after
  // uploading. Swallow any card navigation fired right after a pick so the
  // user stays on the feed (Tobi, 2026-07-23).
  const lastPickRef = useRef(0);

  const displayPhoto = item.moment_photo_url || item.photos?.[0]?.url || item.image_url;
  const canAddPhoto = !!item.can_add_photo;
  const photoTotal = (item.moment_photo_url ? 1 : 0) + (item.photo_count || 0);

  const handleLike = (e) => {
    e.stopPropagation();
    onToggleLike(item);
  };

  const openPhotoPicker = (e) => {
    e.stopPropagation();
    photoInputRef.current?.click();
  };

  const handlePhotoSelected = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so picking the same file again re-fires onChange
    lastPickRef.current = Date.now();
    if (file) onAddPhoto(item, file);
  };

  const openGallery = (e) => {
    e.stopPropagation();
    onOpenGallery(item);
  };

  const handleNavigate = () => {
    // Ignore the post-picker ghost click so uploading keeps the user on the
    // feed instead of bouncing to the group page.
    if (Date.now() - lastPickRef.current < 1000) return;
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

        {/* Top-left: everything shared for this event → gallery. */}
        {item.photo_count > 0 && (
          <button
            type="button"
            className="ef-photos-chip"
            onClick={openGallery}
            aria-label={t('explore.photos.openGallery')}
          >
            <span aria-hidden="true">📷</span>
            {t('explore.photos.count', { count: photoTotal })}
          </button>
        )}

        {/* Hidden file input — driven by the "Foto teilen" button.
            No `capture` attribute: with just accept="image/*", iOS/Android show
            the full picker (photo library OR camera). `capture="environment"`
            forced the rear camera and hid the gallery entirely (Arno, 2026-07-23).
            stopPropagation on the input's own click: photoInputRef.current.click()
            dispatches a real click on this input that bubbles up to the card's
            onClick and navigated to the group page the instant the picker opened.
            Stop it here so opening the picker keeps the user on the feed
            (Tobi, 2026-07-23). */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onClick={(e) => e.stopPropagation()}
          onChange={handlePhotoSelected}
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
            {/* The meetup itself, more prominent than the small time line
                (Tina, 22.10.2026). */}
            <p className="ef-event-title">{item.name}</p>
            <p className="ef-user-time">{timeAgo}</p>
          </div>
        </div>
        {item.category && <span className="ef-cat">{item.category}</span>}
      </div>

      {canAddPhoto && (
        <button
          type="button"
          className="ef-add-photo"
          onClick={openPhotoPicker}
          disabled={uploading}
          aria-busy={uploading}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          {uploading
            ? t('explore.photos.uploading')
            : (item.my_photo_count > 0 ? t('explore.photos.add') : t('explore.photos.addHint'))}
        </button>
      )}
    </div>
  );
});

// ─── Main ────────────────────────────────────────────────────────────────────

// Memories | Friends (Tina, 22.10.2026) — the deals moved to the club list.
const TABS = { memories: 'memories', friends: 'friends' };

export const Explore = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const isAuthed = !!user && !user.isGuest;

  // Tab held in the URL (?tab=friends) so navigating into a detail page and
  // swiping back restores the tab. replace:true keeps tab switches off the
  // back stack. Anything else — an old ?tab=deals link included — is Memories.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === TABS.friends ? TABS.friends : TABS.memories;
  const setTab = (next) => setSearchParams(prev => {
    const sp = new URLSearchParams(prev);
    if (next === TABS.memories) sp.delete('tab');
    else sp.set('tab', next);
    return sp;
  }, { replace: true });

  // The moment cron's push opens /explore?share=1 — its target is „Warst du
  // dabei..“. Old bundles read only ?tab and keep their own upload card.
  const toShare = searchParams.get('share') === '1';
  useEffect(() => {
    if (toShare) navigate('/explore/share', { replace: true });
  }, [toShare, navigate]);

  const [loading, setLoading]         = useState(true);
  const [hallItems, setHallItems]     = useState([]);
  // The Friends tab's feed; null until its first visit (only who opens the
  // tab pays for the query).
  const [friendItems, setFriendItems] = useState(null);
  const [likedIds, setLikedIds]       = useState(() => new Set());
  const [uploadingId, setUploadingId] = useState(null);
  // Hall-of-Fame gallery: { item, photos: [{ id?, url, user_id?, user_name, can_delete }], index }
  const [gallery, setGallery] = useState(null);
  const friendsAskedRef = useRef(false);

  // Shared by the mount effect and pull-to-refresh (which skips the full-page
  // loading state — the top spinner is the feedback there).
  const loadData = useCallback(async () => {
    const authed = user && !user.isGuest;
    const [hallRes, likesRes] = await Promise.all([
      // Server-side query (finding 22). The old shape — "the 50 newest groups,
      // then keep the past ones" — is an intersection that shrinks as creation
      // rate rises: at 10-50x volume the newest 50 span hours and are all
      // future-dated, so the wall renders its empty state for everyone. The
      // server also excludes weekly-recurring groups, whose stored date is
      // their first occurrence and therefore permanently "past". photosOnly:
      // Memories shows only cards with a picture; uploading for a photoless
      // event happens on „Warst du dabei..“.
      groups.getHallOfFame({ limit: 30, photosOnly: true }).catch(() => ({ data: [] })),
      authed ? groups.getMyLikes().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ]);
    setHallItems(hallRes.data || []);
    // getMyLikes returns a bare array of group ids the caller has liked —
    // over every group, so it serves the friends feed as well.
    setLikedIds(new Set(likesRes.data || []));
  }, [user?.id]);

  const loadFriends = useCallback(async () => {
    const res = await groups.getHallOfFameFriends({ limit: 30 }).catch(() => ({ data: [] }));
    setFriendItems(res.data || []);
  }, []);

  useEffect(() => {
    if (toShare) return undefined;
    let cancelled = false;
    setLoading(true);
    loadData().catch(() => { /* silent */ }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadData, toShare]);

  useEffect(() => {
    if (tab !== TABS.friends || !isAuthed || friendsAskedRef.current) return;
    friendsAskedRef.current = true;
    loadFriends();
  }, [tab, isAuthed, loadFriends]);

  useOnPullRefresh(() => (tab === TABS.friends && isAuthed
    ? Promise.all([loadData(), loadFriends()])
    : loadData()));

  // The same event can sit in both feeds — every card update goes to both
  // lists, or a like or photo count would jump back on a tab switch.
  const patchItem = useCallback((id, fn) => {
    const apply = (list) => (list ? list.map(g => (g.id === id ? fn(g) : g)) : list);
    setHallItems(apply);
    setFriendItems(apply);
  }, []);

  // A participant's photo for an event's card (Lea, 18.10.2026). Two-step
  // upload (the file passes POST /api/upload and its moderation), then the
  // URL is attached; the card updates from the server's row.
  const handleAddPhoto = useCallback(async (item, file) => {
    if (file.size > MAX_MEMORY_BYTES) {
      toast.error(t('explore.moment.tooLarge'));
      return;
    }
    setUploadingId(item.id);
    try {
      const up = await uploadApi.image(file);
      const url = up.data?.url;
      if (!url) throw new Error('no url');
      const res = await groups.addPhoto(item.id, url);
      patchItem(item.id, g => withAddedPhoto(g, res.data));
      toast.success(t('explore.photos.added'));
    } catch (err) {
      toast.error(photoErrorText(err, t));
    } finally {
      setUploadingId(null);
    }
  }, [toast, t, patchItem]);

  // Opens with what the card already has, then swaps in the full list (with
  // per-photo delete rights). The owner's moment photo leads, never deletable
  // here — it belongs to the event, not to the gallery.
  const handleOpenGallery = useCallback(async (item) => {
    const lead = item.moment_photo_url
      ? [{ key: 'moment', url: item.moment_photo_url, user_name: item.owner_name, can_delete: false }]
      : [];
    setGallery({ item, photos: [...lead, ...(item.photos || [])], index: 0 });
    try {
      const res = await groups.getPhotos(item.id);
      const all = Array.isArray(res.data) ? res.data : [];
      setGallery(prev => (prev && prev.item.id === item.id
        ? { ...prev, photos: [...lead, ...all], index: Math.min(prev.index, Math.max(0, lead.length + all.length - 1)) }
        : prev));
    } catch { /* keep the preview */ }
  }, []);

  const handleDeletePhoto = useCallback(async (photo) => {
    if (!gallery || !window.confirm(t('explore.photos.deleteConfirm'))) return;
    const { item } = gallery;
    try {
      await groups.deletePhoto(item.id, photo.id);
      setGallery(prev => {
        if (!prev) return prev;
        const photos = prev.photos.filter(p => p.key === 'moment' || p.id !== photo.id);
        return photos.length ? { ...prev, photos, index: Math.min(prev.index, photos.length - 1) } : null;
      });
      patchItem(item.id, g => withoutPhoto(g, photo, user?.id));
      toast.success(t('explore.photos.deleted'));
    } catch {
      toast.error(t('explore.photos.deleteError'));
    }
  }, [gallery, toast, t, user?.id, patchItem]);

  // Optimistic public-like toggle with rollback. Hall-of-Fame items are all
  // type='group' (clubs have no date), so groups.toggleLike covers every card.
  // The card count updates immediately, then syncs to the server's authoritative
  // count on response.
  const handleToggleLike = useCallback(async (item) => {
    if (!user || user.isGuest) {
      toast.error(t('explore.loginToLike'));
      return;
    }
    const adjustCount = (id, delta) => patchItem(id, g =>
      ({ ...g, like_count: Math.max(0, (g.like_count || 0) + delta) }));
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
        patchItem(item.id, g => ({ ...g, like_count: res.data.like_count }));
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
  }, [user, toast, t, likedIds, patchItem]);

  const spinner = <div className="explore-loading"><div className="explore-spinner" /></div>;

  const renderCards = (items) => (
    <div className="ef-feed">
      {items.map(item => (
        <HofCard
          key={`hof-${item.id}`}
          item={item}
          isOwner={isAuthed && Number(item.owner_id) === Number(user.id)}
          liked={likedIds.has(item.id)}
          likeCount={item.like_count || 0}
          onToggleLike={handleToggleLike}
          onAddPhoto={handleAddPhoto}
          onOpenGallery={handleOpenGallery}
          uploading={uploadingId === item.id}
          navigate={navigate}
          t={t}
        />
      ))}
    </div>
  );

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
              aria-selected={tab === TABS.memories}
              className={`ef-tab${tab === TABS.memories ? ' is-active' : ''}`}
              onClick={() => setTab(TABS.memories)}
            >
              {t('explore.tabs.memories')}
            </button>
            <button
              role="tab"
              aria-selected={tab === TABS.friends}
              className={`ef-tab${tab === TABS.friends ? ' is-active' : ''}`}
              onClick={() => setTab(TABS.friends)}
            >
              {t('explore.tabs.friends')}
            </button>
          </div>
        </div>

        {tab === TABS.friends ? (
          !isAuthed ? (
            <div className="explore-empty">
              <div className="explore-empty-icon">👋</div>
              <p>{t('explore.friends.loginRequired')}</p>
            </div>
          ) : (
            <div className="ef-friends">
              <h2 className="ef-friends-title">{t('explore.friends.title')}</h2>
              {/* The search replaces the feed while a query is typed. Accepting
                  a request makes a new friend — their memories belong here. */}
              <FriendSearch onAccepted={loadFriends}>
                {loading || friendItems === null ? spinner
                  : friendItems.length === 0 ? (
                    <div className="explore-empty">
                      <div className="explore-empty-icon">📸</div>
                      <p>{t('explore.friends.feedEmpty')}</p>
                      <span className="ef-friends-empty-hint">{t('explore.friends.feedEmptyHint')}</span>
                    </div>
                  ) : renderCards(friendItems)}
              </FriendSearch>
            </div>
          )
        ) : loading ? spinner : (
          <>
            {/* „Warst du dabei?" (Tina, 22.10.2026) — the way to share a photo
                of an own past meetup; the feed itself shows pictures only. */}
            {isAuthed && (
              <button type="button" className="ef-share-banner" onClick={() => navigate('/explore/share')}>
                <span className="ef-share-banner-text">
                  <span className="ef-share-banner-title">{t('explore.shareBanner.title')}</span>
                  <span className="ef-share-banner-sub">{t('explore.shareBanner.subtitle')}</span>
                </span>
                <svg className="ef-share-banner-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            )}
            {hallItems.length === 0 ? (
              <div className="explore-empty">
                <div className="explore-empty-icon">🏆</div>
                <p>{t('explore.empty.memories')}</p>
              </div>
            ) : renderCards(hallItems)}
          </>
        )}

      </div>

      {/* Hall-of-Fame gallery: who shared each photo, delete where allowed. */}
      <PhotoLightbox
        photos={gallery ? gallery.photos.map(p => p.url) : []}
        index={gallery ? gallery.index : null}
        onIndex={(i) => setGallery(prev => (prev ? { ...prev, index: i } : prev))}
        onClose={() => setGallery(null)}
        renderCaption={(i) => {
          const photo = gallery?.photos[i];
          // Photos go with their uploader's account (ON DELETE CASCADE), so a
          // name is always there; nothing to caption otherwise.
          if (!photo?.user_name && !photo?.can_delete) return null;
          return (
            <>
              {photo.user_name && (
                <span className="lightbox-caption-text">{t('explore.photos.by', { name: photo.user_name })}</span>
              )}
              {photo.can_delete && (
                <button type="button" className="lightbox-caption-btn" onClick={() => handleDeletePhoto(photo)}>
                  {t('explore.photos.delete')}
                </button>
              )}
            </>
          );
        }}
      />
    </div>
  );
};

export default Explore;
