import { useState, useContext, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { auth, subscription as subscriptionApi, groups as groupsApi, clubs as clubsApi } from '../utils/api';
import SpotifySongPicker from '../components/SpotifySongPicker';
import { ProModal } from '../components/ProModal';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { ProfilePhotoCarousel } from '../components/ProfilePhotoCarousel';
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

export const Profile = () => {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-AT';
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
  const [savingSong, setSavingSong] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [showProModal, setShowProModal] = useState(false);
  const [pastEvents, setPastEvents] = useState([]);
  const [hofLoading, setHofLoading] = useState(false);
  const [favItems, setFavItems] = useState([]);

  const handleShareProfile = async () => {
    if (!user?.id) return;
    const url = `${window.location.origin}/user/${user.id}`;
    const title = user.name ? t('profile.share.titleFmt', { name: user.name }) : t('profile.share.titleFallback');
    const text = t('profile.share.text');
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success(t('profile.share.linkCopied'));
      }
    } catch (err) {
      // AbortError = user cancelled the native share sheet — silent
      if (err?.name !== 'AbortError') {
        toast.error(t('profile.share.error'));
      }
    }
  };

  useEffect(() => {
    subscriptionApi.getStatus()
      .then(res => setIsPro(res.data?.is_pro || false))
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
    if (activeTab !== 'halloffame' || pastEvents.length > 0) return;
    setHofLoading(true);
    Promise.all([
      groupsApi.getJoined().catch(() => ({ data: [] })),
      clubsApi.getJoined().catch(() => ({ data: [] })),
    ]).then(([gRes, cRes]) => {
      const now = new Date();
      const past = [...(gRes.data || []), ...(cRes.data || [])]
        .filter(g => g.date && new Date(g.date) < now)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      setPastEvents(past);
    }).finally(() => setHofLoading(false));
  }, [activeTab]);

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

          <div className="profile-header-actions">
            <button className="profile-action-btn" onClick={() => navigate(-1)} aria-label={t('profile.header.backAria')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>
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

          {/* Trusted / verified badge bottom-right */}
          {user?.is_trusted_user && (
            <div className="profile-verified-cover">✓</div>
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
            <div className="profile-name-age">
              {/* Own profile: no age superscript (you know your own age). */}
              <span className="profile-name-cap">{(user?.name || t('profile.fallbackName')).toUpperCase()}</span>
              {isPro && <span className="pro-name-badge">👑</span>}
            </div>
          </div>

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

          {/* Pro CTA */}
          {!isPro && (
            <button className="pro-cta-card" onClick={() => setShowProModal(true)}>
              <div className="pro-card-icon">👑</div>
              <div className="pro-card-body">
                <div className="pro-card-title">{t('profile.proCardTitle')}</div>
                <div className="pro-card-sub">{t('profile.proCardSub')}</div>
              </div>
              <div className="pro-card-arrow">→</div>
            </button>
          )}

          {/* Friends shortcut */}
          <button className="profile-friends-btn" onClick={() => navigate('/friends')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            {t('profile.friendsBtn')}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>

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
                    onClick={() => navigate(`/group/${item.id}`)}
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
                <div className="pinnwand-grid">
                  {profilePhotos.map((photo, i) => (
                    <button
                      key={photo}
                      type="button"
                      className={`pinnwand-item${i === 0 ? ' pinnwand-item--large' : ''}`}
                      onClick={() => setLightboxIndex(galleryPhotos.indexOf(photo))}
                      aria-label={t('userProfile.viewPhotoAria')}
                    >
                      <img src={photo} alt={`Foto ${i + 1}`} loading="lazy" />
                    </button>
                  ))}
                  <button className="pinnwand-item add-photo" onClick={() => navigate('/profile/edit')}>
                    <span>+</span>
                    <p>{t('profile.addPhoto')}</p>
                  </button>
                </div>

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
                {hofLoading ? (
                  <div className="home-loading"><div className="home-spinner" /></div>
                ) : pastEvents.length === 0 ? (
                  <div className="halloffame-empty">
                    <span className="halloffame-icon">🏆</span>
                    <p>{t('profile.hof.title')}</p>
                    <span>{t('profile.hof.hint')}</span>
                  </div>
                ) : (
                  <div className="hof-grid">
                    {pastEvents.map(event => (
                      <button
                        key={`${event.type || 'group'}-${event.id}`}
                        className="hof-card"
                        onClick={() => navigate(`/group/${event.id}`)}
                      >
                        <div className="hof-card-img">
                          {event.image_url
                            ? <img src={event.image_url} alt={event.name} loading="lazy" />
                            : <div className="hof-card-placeholder">🏆</div>
                          }
                          <div className="hof-card-overlay" />
                        </div>
                        <div className="hof-card-body">
                          <p className="hof-card-name">{event.name || event.title}</p>
                          <p className="hof-card-date">
                            {new Date(event.date).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' })}
                          </p>
                          {event.location && <p className="hof-card-loc">📍 {event.location}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

      {showProModal && (
        <ProModal
          onClose={() => setShowProModal(false)}
          onSuccess={() => { setIsPro(true); setShowProModal(false); }}
        />
      )}

      <PhotoLightbox
        photos={galleryPhotos}
        index={lightboxIndex}
        onIndex={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </>
  );
};

export default Profile;
