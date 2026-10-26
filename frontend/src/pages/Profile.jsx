import { useState, useContext, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { auth, subscription as subscriptionApi, groups as groupsApi, clubs as clubsApi, friends as friendsApi, reviews as reviewsApi, users as usersApi, upload as uploadApi } from '../utils/api';
import SpotifySongPicker from '../components/SpotifySongPicker';
import { shareLink } from '../utils/share';
import { MAX_MEMORY_BYTES, photoErrorText } from '../utils/memories';
import { thumbUrl } from '../utils/images';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { ProfilePhotoCarousel } from '../components/ProfilePhotoCarousel';
import { PinnwandMasonry } from '../components/PinnwandMasonry';
import { HallOfFameGrid } from '../components/HallOfFameGrid';
import VerifiedBadge from '../components/VerifiedBadge';
import { AttendanceTierBadge } from '../components/AttendanceTierBadge';
import { AttendanceTiersCard } from '../components/AttendanceTiersCard';
import { tierEmoji, tierMinEvents } from '../utils/attendanceTiers';
import { safeStorage } from '../utils/safeStorage';
import '../styles/home.css';
import '../styles/profile.css';

const INTEREST_DE = {
  'Sports': 'Sport', 'Sport': 'Sport',
  'Music': 'Musik', 'Musik': 'Musik',
  'Tech': 'Technik', 'Technology': 'Technik', 'Technik': 'Technik',
  'Art': 'Kunst', 'Kunst': 'Kunst',
  'Gaming': 'Gaming',
  'Fitness': 'Fitness',
  'Travel': 'Reisen', 'Reisen': 'Reisen',
  'Food': 'Essen', 'Essen': 'Essen',
  'Movies': 'Filme', 'Filme': 'Filme',
  'Reading': 'Lesen', 'Lesen': 'Lesen',
  'Photography': 'Fotografie', 'Fotografie': 'Fotografie',
  'Hiking': 'Wandern', 'Wandern': 'Wandern',
  'Yoga': 'Yoga',
  'Dancing': 'Tanzen', 'Tanzen': 'Tanzen',
  'Cooking': 'Kochen', 'Kochen': 'Kochen',
  'Fashion': 'Mode', 'Mode': 'Mode',
  'Nature': 'Natur', 'Natur': 'Natur',
  'Clubbing': 'Clubbing',
  'Social': 'Soziales', 'Soziales': 'Soziales',
  'Tennis': 'Tennis', 'Golf': 'Golf',
  'Volleyball': 'Volleyball', 'Swimming': 'Schwimmen', 'Schwimmen': 'Schwimmen',
  'Board Games': 'Brettspiele', 'Brettspiele': 'Brettspiele',
};

const translateInterest = (i) => INTEREST_DE[i] ?? i;

// „Warst du dabei?" above the own Memories (Tina asked, Tobi 26.10.2026: yes).
// It reads the same prompts as /explore/share and leads there — one rule
// source. One switch, so a "no" later is a one-line change.
const SHOW_MEMORY_PROMPT_BANNER = true;

// „Meine Gruppen & Clubs" (Tina 22.10.2026: management was „sehr versteckt").
// Exactly the set of Chats → Verwalten — what the user OWNS, without club
// events (those are managed on their own page) — open join requests first.
const manageableEntities = (rows) => (Array.isArray(rows) ? rows : [])
  .filter((g) => g.role === 'owner' && g.type !== 'event')
  .sort((a, b) => (b.pending_request_count || 0) - (a.pending_request_count || 0));

export const Profile = () => {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
  // Tab held in the URL (?tab=halloffame) so opening a past event from Hall of
  // Fame and swiping back restores the tab. replace:true so tab clicks don't
  // pile up history entries.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'halloffame' ? 'halloffame' : 'pinnwand';
  const setActiveTab = (tab) => setSearchParams(prev => {
    const sp = new URLSearchParams(prev);
    if (tab === 'pinnwand') sp.delete('tab');
    else sp.set('tab', tab);
    return sp;
  }, { replace: true });
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [pinnwandLightboxIndex, setPinnwandLightboxIndex] = useState(null);
  const [savingSong, setSavingSong] = useState(false);
  // Only for the 👑 next to the name — a status badge for paying users, not
  // an upsell. The profile has no Pro card any more (Tina, 22.10.2026).
  const [isPro, setIsPro] = useState(false);
  const [pastEvents, setPastEvents] = useState([]);
  const [hofLoading, setHofLoading] = useState(false);
  const [favItems, setFavItems] = useState([]);
  const [pendingFriends, setPendingFriends] = useState(0);
  // Abzeichen-Stufen (B2): the own numbers come from their own endpoint, so
  // SAFE_USER_COLS / login / getProfile stay untouched. null = unknown → the
  // pill and the card simply do not render.
  const [attendance, setAttendance] = useState(null);
  const [scrollToBadges, setScrollToBadges] = useState(false);
  const badgeCardRef = useRef(null);
  // Stats row „Meet-ups | Friends | Memories" (Tina 22.10.2026). null =
  // unknown or unavailable → no row at all, never a row of frustrating zeros.
  const [profileStats, setProfileStats] = useState(null);
  const [ownedEntities, setOwnedEntities] = useState([]);
  const [memoryPrompts, setMemoryPrompts] = useState([]);
  // Memories edit mode. Every change is saved the moment it happens; „Fertig"
  // only ends the mode (and says so, loudly — Tina).
  const [editMode, setEditMode] = useState(false);
  const [busyMemoryId, setBusyMemoryId] = useState(null);
  const [doneFlash, setDoneFlash] = useState(false);
  const imageInputRef = useRef(null);
  const imageTargetRef = useRef(null);
  const lastPickRef = useRef(0);

  const handleShareProfile = async () => {
    if (!user?.id) return;
    const url = `${window.location.origin}/user/${user.id}`;
    const title = user.name ? t('profile.share.titleFmt', { name: user.name }) : t('profile.share.titleFallback');
    const text = t('profile.share.text');
    const result = await shareLink({ title, text, url });
    if (result === 'copied') toast.success(t('profile.share.linkCopied'));
    else if (result === 'failed') toast.error(t('profile.share.error'));
  };

  useEffect(() => {
    subscriptionApi.getStatus()
      .then(res => setIsPro(res.data?.is_pro || false))
      .catch(() => {});
  }, []);

  // Incoming friend-request count — drives the badge on the Freunde shortcut so
  // requests are discoverable without opening the Friends page.
  useEffect(() => {
    friendsApi.getPending()
      .then(res => setPendingFriends((res.data || []).length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      groupsApi.getFavorites().catch(() => ({ data: [] })),
      clubsApi.getFavorites().catch(() => ({ data: [] })),
    ]).then(([gRes, cRes]) => {
      setFavItems([...(gRes.data || []), ...(cRes.data || [])]);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    reviewsApi.getMyAttendance()
      .then(res => { if (!cancelled) setAttendance(res.data?.available ? res.data : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // One-time "Neues Abzeichen" toast when the step went UP since this device
  // last saw it. Only toasts when the seen-step could actually be stored —
  // with storage denied it would otherwise repeat on every visit. The stored
  // step only ever moves up: a dip (an owner's late „nicht stattgefunden“, a
  // confirmer deleting their account) must not re-arm the toast for a badge
  // this device already celebrated.
  //
  // The seen step lives under a new key since the ladder grew to five steps
  // (Lea, 18.10.2026): level 3 was 🎆 and is 🌟 now. The old key is read on
  // the old ladder (its 3 = 🎆 = 5), or everyone who already had 🎆 would be
  // congratulated on it a second time.
  useEffect(() => {
    if (!attendance || !user?.id) return;
    const step = attendance.step;
    const key = `jamie_seen_attendance_step_${user.id}`;
    const oldSeen = [0, 1, 2, 5][Number(safeStorage.getItem(`jamie_seen_attendance_tier_${user.id}`) || 0)] || 0;
    const seen = Number(safeStorage.getItem(key) || oldSeen);
    if (!(step > seen)) return;
    safeStorage.setItem(key, String(step));
    if (safeStorage.getItem(key) === String(step)) {
      toast.success(t('attendance.newTierToastFmt', { emoji: tierEmoji(step), n: tierMinEvents(step) }));
    }
  }, [attendance, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pill tap → Hall-of-Fame tab, scrolled to the Abzeichen card; focus follows
  // to the card heading (the pill has scrolled away). The wrapper's
  // scroll-margin keeps the heading clear of the iOS status bar.
  const openBadges = () => { setActiveTab('halloffame'); setScrollToBadges(true); };
  useEffect(() => {
    if (!scrollToBadges || activeTab !== 'halloffame' || !badgeCardRef.current) return;
    const el = badgeCardRef.current;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    el.querySelector('.attend-card-title')?.focus?.({ preventScroll: true });
    setScrollToBadges(false);
  }, [scrollToBadges, activeTab, attendance]);

  // Its own server read since 18.10.2026 (Lea): it used to be the chat list
  // filtered to past dates, so leaving a chat — or its owner deleting it
  // afterwards — erased the event from here too.
  useEffect(() => {
    if (activeTab !== 'halloffame' || pastEvents.length > 0) return;
    setHofLoading(true);
    usersApi.getHallOfFame('me')
      .then(res => setPastEvents(Array.isArray(res.data) ? res.data : []))
      .catch(() => {})
      .finally(() => setHofLoading(false));
  }, [activeTab]);

  // Stats row: its own me-only endpoint, re-read after a memory is removed or
  // restored so the Memories number never disagrees with the grid.
  const loadProfileStats = useCallback(() => {
    usersApi.getProfileStats()
      .then(res => setProfileStats(res.data?.available ? res.data : null))
      .catch(() => setProfileStats(null));
  }, []);
  useEffect(() => { loadProfileStats(); }, [loadProfileStats]);

  // „Meine Gruppen & Clubs": the chat list's own read (role +
  // pending_request_count included), no extra endpoint.
  useEffect(() => {
    let cancelled = false;
    groupsApi.getJoined()
      .then(res => { if (!cancelled) setOwnedEntities(manageableEntities(res.data)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // „Warst du dabei?": S2's prompts (21 days, an owner's moment counts as
  // their photo) — read when the Memories tab opens, never re-derived here.
  useEffect(() => {
    if (!SHOW_MEMORY_PROMPT_BANNER || activeTab !== 'halloffame') return undefined;
    let cancelled = false;
    groupsApi.getMemoryPrompts()
      .then(res => { if (!cancelled) setMemoryPrompts(Array.isArray(res.data) ? res.data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeTab]);

  // Leaving the Memories tab ends the edit mode.
  useEffect(() => { if (activeTab !== 'halloffame') setEditMode(false); }, [activeTab]);

  // „Fertig" has to be impossible to miss (Tina): a toast plus a short check
  // pop on the button (no motion under prefers-reduced-motion, see CSS).
  useEffect(() => {
    if (!doneFlash) return undefined;
    const timer = setTimeout(() => setDoneFlash(false), 900);
    return () => clearTimeout(timer);
  }, [doneFlash]);

  const toggleEditMode = () => {
    if (!editMode) { setEditMode(true); return; }
    setEditMode(false);
    setDoneFlash(true);
    toast.success(t('profile.memories.doneToast'));
  };

  const restoreMemory = async (event, index) => {
    try {
      await usersApi.unhideMemory(event.id);
      setPastEvents(prev => {
        if (prev.some(e => e.id === event.id)) return prev;
        const next = [...prev];
        next.splice(Math.min(Math.max(index, 0), next.length), 0, event);
        return next;
      });
      loadProfileStats();
    } catch {
      toast.error(t('profile.memories.undoError'));
    }
  };

  // „Entfernen" / the coral X: out of the own grid only — the event and its
  // photos stay in Explore (Tobi 26.10.2026), hence the confirm names that.
  const removeMemory = async (event) => {
    if (busyMemoryId) return;
    if (!window.confirm(t('profile.memories.removeConfirm', { name: event.name }))) return;
    const index = pastEvents.findIndex(e => e.id === event.id);
    setBusyMemoryId(event.id);
    try {
      await usersApi.hideMemory(event.id);
      setPastEvents(prev => prev.filter(e => e.id !== event.id));
      loadProfileStats();
      toast.showUndo(t('profile.memories.removed'), () => restoreMemory(event, index), t('common.undo'));
    } catch {
      toast.error(t('profile.memories.removeError'));
    } finally {
      setBusyMemoryId(null);
    }
  };

  // „Bild ändern": one hidden file input; the tile it is for rides along in a
  // ref. A second tap within a second is the iOS ghost click (ShareMoments).
  const pickNewImage = (event) => {
    if (busyMemoryId || Date.now() - lastPickRef.current < 1000) return;
    imageTargetRef.current = event;
    imageInputRef.current?.click();
  };

  const handleImagePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same file again must fire onChange again
    lastPickRef.current = Date.now();
    const event = imageTargetRef.current;
    imageTargetRef.current = null;
    if (!file || !event) return;
    if (file.size > MAX_MEMORY_BYTES) {
      toast.error(t('explore.moment.tooLarge'));
      return;
    }
    setBusyMemoryId(event.id);
    let replaced = false;
    try {
      const up = await uploadApi.image(file);
      const url = up.data?.url;
      if (!url) throw new Error('no url');
      // Swap, not add: the photo behind the cover goes first, so the
      // 5-photos-per-person cap can never block its replacement.
      if (event.own_photo_id) {
        await groupsApi.deletePhoto(event.id, event.own_photo_id);
        replaced = true;
      }
      const added = await groupsApi.addPhoto(event.id, url);
      setPastEvents(prev => prev.map(ev => (ev.id === event.id
        ? { ...ev, cover_url: added.data?.url || url, own_photo_id: added.data?.id ?? null }
        : ev)));
      toast.success(t('profile.memories.imageChanged'));
    } catch (err) {
      toast.error(photoErrorText(err, t));
      // The old photo may already be gone (deleted, then the add failed):
      // read the list again rather than show a cover that no longer exists.
      if (replaced) {
        usersApi.getHallOfFame('me')
          .then(res => { if (Array.isArray(res.data)) setPastEvents(res.data); })
          .catch(() => {});
      }
    } finally {
      setBusyMemoryId(null);
    }
  };

  const handleSongSelect = async (song) => {
    setSavingSong(true);
    try {
      const res = await auth.updateProfile({ favorite_song: song });
      setUser(res.data);
    } catch (err) {
      console.error('Song select failed:', err);
    } finally {
      setSavingSong(false);
    }
  };

  const handleSongRemove = async () => {
    setSavingSong(true);
    try {
      const res = await auth.updateProfile({ favorite_song: null });
      setUser(res.data);
    } catch (err) {
      console.error('Song remove failed:', err);
    } finally {
      setSavingSong(false);
    }
  };

  const profilePhotos = user?.photos || [];
  const pinnwandPhotos = user?.pinnwand || [];
  const interests     = user?.interests || [];
  // Unified header gallery — profile picture (avatar) first, then wall photos.
  // Dedupe so a user whose avatar is also saved as photos[0] (new model) doesn't
  // see it twice; works for both old (avatar separate) and new data.
  const galleryPhotos = [...new Set([user?.avatar_url, ...profilePhotos].filter(Boolean))];
  const coverFallback = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800';
  const completion    = user?.profile_completion || 0;

  return (
    <>
      <div className="profile-page">

        {/* ── Cover image / swipeable photo gallery ─────────────────── */}
        <div className="profile-header-image">
          {galleryPhotos.length > 0 ? (
            <ProfilePhotoCarousel
              photos={galleryPhotos}
              imgClassName="profile-cover"
              onPhotoTap={(i) => setLightboxIndex(i)}
            />
          ) : (
            <img src={coverFallback} alt={user?.name} className="profile-cover" loading="lazy" />
          )}
          <div className="profile-cover-gradient" />
          <div className="profile-cover-top-gradient" />

          {/* Back arrow removed (Robert 2026-06-16): it led to the chat page and
              wasn't needed — Profile is reached via the bottom nav. Settings
              gear stays top-right. */}
          <div className="profile-header-actions profile-header-actions--end">
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="profile-action-btn" onClick={() => navigate('/settings')} aria-label={t('profile.header.settingsAria')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09c-.658.003-1.25.396-1.51 1z"/>
                </svg>
              </button>
              {/* "Profil bearbeiten" pencil removed — same destination is
                  reachable via the settings gear above. */}
            </div>
          </div>

          {/* Trusted / verified badge bottom-right — scalloped verified seal */}
          {user?.is_trusted_user && (
            <VerifiedBadge className="profile-verified-cover" size={38} />
          )}
        </div>

        {/* ── Progress bar ──────────────────────────────────────────── */}
        {completion < 100 && (
          <div className="profile-progress-bar-wrap">
            <div className="profile-progress-bar">
              <div className="profile-progress-fill" style={{ width: `${completion}%` }} />
            </div>
            <span className="profile-progress-label">{t('profile.progressFmt', { percent: completion })}</span>
          </div>
        )}

        {/* ── Info section ──────────────────────────────────────────── */}
        <div className="profile-info-section">

          {/* Location left — Name + Age right */}
          <div className="profile-identity-row">
            {user?.location ? (
              <div className="profile-location-left">{user.location}</div>
            ) : <div />}
            <div className="profile-name-col">
              <div className="profile-name-age">
                {/* Own profile: no age superscript (you know your own age). */}
                <span className="profile-name-cap">{(user?.name || t('profile.fallbackName')).toUpperCase()}</span>
                {isPro && <span className="pro-name-badge">👑</span>}
              </div>
              {user?.is_pioneer && <span className="pioneer-tag">{t('common.pioneerBadge')}</span>}
              <AttendanceTierBadge tier={attendance?.step} variant="pill" onClick={openBadges} />
            </div>
          </div>

          {/* Stats row (Tina 22.10.2026) — the labels stay English in every
              language on purpose. Only with real numbers: no row at all when
              they could not be had. */}
          {profileStats && (
            <div className="profile-stats-row">
              <button type="button" className="profile-stat" onClick={openBadges}>
                <span className="profile-stat-value">{profileStats.meetups}</span>
                <span className="profile-stat-label">{t('profile.stats.meetups')}</span>
              </button>
              <button type="button" className="profile-stat" onClick={() => navigate('/friends')}>
                <span className="profile-stat-value">{profileStats.friends}</span>
                <span className="profile-stat-label">{t('profile.stats.friends')}</span>
              </button>
              <button type="button" className="profile-stat" onClick={() => setActiveTab('halloffame')}>
                <span className="profile-stat-value">{profileStats.memories}</span>
                <span className="profile-stat-label">{t('profile.stats.memories')}</span>
              </button>
            </div>
          )}

          {/* Interests */}
          {interests.length > 0 && (
            <div className="profile-interests">
              {interests.map((interest, i) => (
                <span key={i} className="interest-chip">{translateInterest(interest)}</span>
              ))}
            </div>
          )}

          {/* Bio card */}
          {user?.bio && (
            <div className="profile-bio-card">
              <p className="profile-bio-card-title">{t('profile.bioCardTitle')}</p>
              <p className="profile-bio">{user.bio}</p>
            </div>
          )}

          {/* Friends shortcut */}
          <button className="profile-friends-btn" onClick={() => navigate('/friends?tab=pending')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            {t('profile.friendsBtn')}
            {pendingFriends > 0 && (
              <span className="profile-friends-badge">{pendingFriends}</span>
            )}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 'auto' }}>
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>

          {/* Meine Gruppen & Clubs — management one tap from the profile. */}
          {ownedEntities.length > 0 && (
            <section className="profile-manage" aria-labelledby="profile-manage-title">
              <div className="profile-manage-head">
                <h3 id="profile-manage-title" className="profile-manage-title">{t('profile.manage.title')}</h3>
                <button type="button" className="profile-manage-all" onClick={() => navigate('/chats?tab=verwalten')}>
                  {t('profile.manage.all')}
                </button>
              </div>
              <div className="profile-manage-rail">
                {ownedEntities.map((g) => {
                  const isClub = g.type === 'club';
                  const base = isClub ? `/club/${g.id}` : `/group/${g.id}`;
                  const pending = g.pending_request_count || 0;
                  return (
                    <div key={g.id} className="profile-manage-card">
                      <button type="button" className="profile-manage-open" onClick={() => navigate(base)}>
                        <span className="profile-manage-img">
                          {g.image_url
                            ? <img src={thumbUrl(g.image_url)} alt="" loading="lazy" decoding="async" />
                            : <span aria-hidden="true">{(g.name || '?')[0].toUpperCase()}</span>}
                        </span>
                        <span className="profile-manage-name">{g.name}</span>
                        <span className="profile-manage-type">
                          {isClub ? t('profile.manage.typeClub') : t('profile.manage.typeGroup')}
                        </span>
                      </button>
                      <button type="button" className="profile-manage-chip" onClick={() => navigate(`${base}/edit`)}>
                        {t('profile.manage.edit')}
                      </button>
                      {pending > 0 && (
                        <button type="button" className="profile-manage-requests" onClick={() => navigate('/chats?tab=anfragen')}>
                          {t('profile.manage.requests', { count: pending })}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Favoriten */}
          {favItems.length > 0 && (
            <div className="profile-favs">
              <div className="profile-favs-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#FD7666" stroke="none">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
                {t('profile.favoritesTitle')}
              </div>
              <div className="profile-favs-grid">
                {favItems.map(item => (
                  <button
                    key={`${item.type || 'group'}-${item.id}`}
                    className="profile-fav-card"
                    onClick={() => navigate(item.type === 'club' ? `/club/${item.id}` : `/group/${item.id}`)}
                  >
                    <div className="profile-fav-img-wrap">
                      {item.image_url
                        ? <img src={item.image_url} alt={item.name || item.title} className="profile-fav-img" loading="lazy" />
                        : <div className="profile-fav-placeholder">{(item.category || item.name || '?')[0]}</div>
                      }
                      {item.type === 'club' && <span className="profile-fav-type-badge">{t('profile.clubBadge')}</span>}
                    </div>
                    <span className="profile-fav-label">{item.name || item.title || item.category}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="profile-tabs">
            <button
              className={`profile-tab ${activeTab === 'pinnwand' ? 'active' : ''}`}
              onClick={() => setActiveTab('pinnwand')}
            >
              {t('profile.tabs.pinnwand')}
            </button>
            <button
              className={`profile-tab ${activeTab === 'halloffame' ? 'active' : ''}`}
              onClick={() => setActiveTab('halloffame')}
            >
              {t('profile.tabs.halloffame')}
            </button>
          </div>

          {/* Tab content */}
          <div className="profile-tab-content">
            {activeTab === 'pinnwand' ? (
              <>
                {/* Pinnwand = Pinterest-style masonry (separate from the
                    Profilfoto-Carousel above), in the order set in ProfileEdit. */}
                <PinnwandMasonry
                  photos={pinnwandPhotos}
                  onOpen={setPinnwandLightboxIndex}
                  itemAriaLabel={t('userProfile.viewPhotoAria')}
                  addTile={
                    <button
                      type="button"
                      className="pinnwand-masonry-add"
                      onClick={() => navigate('/profile/edit')}
                      aria-label={t('profile.addPhoto')}
                    >
                      <span>+</span>
                      <p>{t('profile.addPhoto')}</p>
                    </button>
                  }
                />

                {/* Lieblingssong below pinnwand */}
                <div className="profile-song-section">
                  {savingSong ? (
                    <div className="empty-music"><p>{t('profile.savingSong')}</p></div>
                  ) : (
                    <SpotifySongPicker
                      currentSong={user?.favorite_song}
                      onSelect={handleSongSelect}
                      onRemove={handleSongRemove}
                    />
                  )}
                </div>

                {/* Share own profile */}
                <button
                  className="profile-share-btn"
                  onClick={handleShareProfile}
                  type="button"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                    <polyline points="16 6 12 2 8 6"/>
                    <line x1="12" y1="2" x2="12" y2="15"/>
                  </svg>
                  {t('profile.share.btn')}
                </button>
              </>
            ) : (
              <div className="halloffame-section">
                {attendance && (
                  <div className="profile-attend-wrap" ref={badgeCardRef}>
                    <AttendanceTiersCard
                      own
                      tier={attendance.step}
                      confirmedEvents={attendance.confirmed_events}
                      confirmers={attendance.confirmers}
                      next={attendance.next_step}
                      windowDays={attendance.window_days}
                    />
                  </div>
                )}
                {SHOW_MEMORY_PROMPT_BANNER && memoryPrompts.length > 0 && !editMode && (
                  <button type="button" className="profile-memory-prompt" onClick={() => navigate('/explore/share')}>
                    <span className="profile-memory-prompt-text">
                      <strong>{t('profile.memories.promptTitle')}</strong>
                      <span>
                        {memoryPrompts.length === 1
                          ? t('profile.memories.promptOne', { name: memoryPrompts[0].name })
                          : t('profile.memories.promptMany', { count: memoryPrompts.length })}
                      </span>
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </button>
                )}
                {hofLoading ? (
                  <div className="home-loading"><div className="home-spinner" /></div>
                ) : pastEvents.length === 0 ? (
                  <div className="halloffame-empty">
                    <span className="halloffame-icon">🏆</span>
                    <p>{t('profile.hof.title')}</p>
                    <span>{t('profile.hof.hint')}</span>
                  </div>
                ) : (
                  <>
                    <div className="profile-memories-toolbar">
                      <button
                        type="button"
                        className={`profile-memories-edit${editMode ? ' is-active' : ''}${doneFlash ? ' is-done' : ''}`}
                        onClick={toggleEditMode}
                        aria-pressed={editMode}
                      >
                        {doneFlash && (
                          <svg className="profile-memories-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                        {editMode ? t('profile.memories.done') : t('profile.memories.edit')}
                      </button>
                    </div>
                    <HallOfFameGrid
                      events={pastEvents}
                      onOpen={(event) => navigate(`/group/${event.id}`)}
                      editMode={editMode}
                      onRemove={removeMemory}
                      onChangeImage={pickNewImage}
                      busyId={busyMemoryId}
                    />
                  </>
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleImagePicked}
                  data-testid="memory-image-input"
                />
              </div>
            )}
          </div>

        </div>
      </div>

      <PhotoLightbox
        photos={galleryPhotos}
        index={lightboxIndex}
        onIndex={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
      <PhotoLightbox
        photos={pinnwandPhotos}
        index={pinnwandLightboxIndex}
        onIndex={setPinnwandLightboxIndex}
        onClose={() => setPinnwandLightboxIndex(null)}
      />
    </>
  );
};

export default Profile;
