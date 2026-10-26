import { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups, upload as uploadApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import useOnPullRefresh from '../hooks/useOnPullRefresh';
import { getCategoryIcon, dateLocaleFor, MAX_MEMORY_BYTES, photoErrorText } from '../utils/memories';
import '../styles/explore.css';

// „Warst du dabei..“ (Tina, 22.10.2026) — opened from the banner on Explore's
// Memories tab and by the moment cron's push (/explore?share=1). The caller's
// own past meetups of the last three weeks that still lack THEIR photo, as
// owner or as participant (GET /groups/hall-of-fame/prompts). The owner
// uploads the event's moment (its cover), a participant adds a photo to the
// card. Sharing takes the meetup off this list; the photo stays on the
// Memories feed. No tabs, likes or gallery here.
export const ShareMoments = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const dateLocale = dateLocaleFor(i18n.resolvedLanguage || i18n.language);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);
  // ONE hidden input for the page: the event it is picking for, and when the
  // last pick happened. iOS fires a "ghost" click on whatever sits under the
  // finger after the native picker closes — after a success that is the NEXT
  // card's button (the shared one just left the list), which would open the
  // picker again for another meetup. Ignore taps right after a pick.
  const inputRef = useRef(null);
  const pickingRef = useRef(null);
  const lastPickRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await groups.getMemoryPrompts();
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch {
      toast.error(t('explore.share.loadError'));
    }
  }, [toast, t]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Mount only — load's identity follows toast/t, a refetch on every
    // render would undo the optimistic removals below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useOnPullRefresh(load);

  // „zurück": back where the user came from — but a cold start from the push
  // has no in-app history to go back to, so it lands on Explore instead of
  // leaving the app.
  const goBack = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate('/explore', { replace: true });
  };

  const isOwnerOf = (item) => Number(item.owner_id) === Number(user?.id);

  const openPicker = (item) => {
    if (uploadingId || Date.now() - lastPickRef.current < 1000) return;
    pickingRef.current = item;
    inputRef.current?.click();
  };

  // Two-step like everywhere: the file passes POST /api/upload (and its
  // moderation), then the URL is attached — as the owner's moment, or as the
  // participant's photo of the event.
  const share = async (item, file) => {
    if (file.size > MAX_MEMORY_BYTES) {
      toast.error(t('explore.moment.tooLarge'));
      return;
    }
    const owner = isOwnerOf(item);
    setUploadingId(item.id);
    try {
      let url;
      try {
        const up = await uploadApi.image(file);
        url = up.data?.url;
        if (!url) throw new Error('no url');
      } catch (err) {
        toast.error(owner ? t('explore.moment.uploadError') : photoErrorText(err, t));
        return;
      }
      try {
        if (owner) await groups.update(item.id, { moment_photo_url: url });
        else await groups.addPhoto(item.id, url);
      } catch (err) {
        toast.error(owner ? t('explore.moment.saveError') : photoErrorText(err, t));
        return;
      }
      setItems(prev => prev.filter(g => g.id !== item.id));
      toast.success(owner ? t('explore.moment.savedToast') : t('explore.photos.added'));
    } finally {
      setUploadingId(null);
    }
  };

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so picking the same file again re-fires onChange
    lastPickRef.current = Date.now();
    const item = pickingRef.current;
    pickingRef.current = null;
    if (file && item) share(item, file);
  };

  return (
    <div className="explore-container">
      <div className="sm-header">
        <button type="button" className="sm-back" onClick={goBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t('explore.share.back')}
        </button>
        <h1 className="sm-title">{t('explore.share.title')}</h1>
      </div>

      <div className="explore-content">
        {loading ? (
          <div className="explore-loading"><div className="explore-spinner" /></div>
        ) : items.length === 0 ? (
          <div className="explore-empty">
            <div className="explore-empty-icon">📸</div>
            <p>{t('explore.share.empty')}</p>
          </div>
        ) : (
          <div className="ef-feed">
            {items.map(item => {
              const owner = isOwnerOf(item);
              const uploading = uploadingId === item.id;
              return (
                <div key={item.id} className="ef-card sm-card">
                  <div className="ef-media">
                    {item.image_url ? (
                      <img src={item.image_url} alt="" loading="lazy" decoding="async" className="ef-media-img" />
                    ) : (
                      <div className="ef-media-placeholder">
                        <span className="ef-ph-icon">{getCategoryIcon(item.category)}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="ef-moment-prompt"
                      onClick={() => openPicker(item)}
                      disabled={!!uploadingId}
                      aria-busy={uploading}
                    >
                      <span className="sm-cta-icon" aria-hidden="true">
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                      </span>
                      <span className="ef-moment-title">
                        {uploading
                          ? t('explore.photos.uploading')
                          : (owner ? t('explore.moment.cta') : t('explore.share.photoCta'))}
                      </span>
                      {!uploading && (
                        <span className="ef-moment-sub">
                          {owner ? t('explore.moment.hint') : t('explore.share.photoHint')}
                        </span>
                      )}
                    </button>
                  </div>
                  <div className="sm-meta">
                    <p className="sm-name">{item.name}</p>
                    <p className="sm-when">
                      {item.date && new Date(item.date).toLocaleDateString(dateLocale, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                      {item.location ? ` · ${item.location}` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* No `capture`: accept="image/*" alone offers library AND camera
          (Arno, 2026-07-23). stopPropagation keeps the programmatic click
          from bubbling into anything around it (Tobi, 2026-07-23). */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onClick={(e) => e.stopPropagation()}
        onChange={handleFileSelected}
      />
    </div>
  );
};

export default ShareMoments;
