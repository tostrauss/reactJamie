import { useState, useEffect, useRef, useContext, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clubs } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ReportModal } from '../components/ReportModal';
import AvatarGateModal from '../components/AvatarGateModal';
import { nextOccurrence } from '../utils/recurrence';
import { shareLink } from '../utils/share';
import { openCalendar } from '../utils/calendarExport';
import { loadGoogleMaps, onGoogleMapsReady } from '../utils/googleMaps';
import { ALLOWED_COUNTRIES_LOWER } from '../utils/regions';
import { isNativeIOS } from '../utils/platform';
import '../styles/club-detail.css';

const BoostModal = lazy(() => import('../components/BoostModal').then(m => ({ default: m.BoostModal })));

const today = () => new Date().toISOString().split('T')[0];
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const formatEventDate = (dateStr, locale) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  // Event start times are stored as a naive wall-clock (`${date}T${time}`, e.g.
  // 10:00). On a UTC server that value round-trips to the client tagged UTC, so
  // formatting in the device's local zone shifted it +1/+2h (CEST) — "10 Uhr"
  // showed as "12 Uhr" after saving. Format in UTC so the displayed time/day
  // equals exactly what the creator typed.
  return {
    day: d.getUTCDate(),
    month: d.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }),
    time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
  };
};

// Google Calendar export — see utils/calendarExport.js for the +2h fix.

export const ClubDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it-IT' : ((i18n.resolvedLanguage || i18n.language || 'de').startsWith('fr') ? 'fr-FR' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('es') ? 'es-ES' : 'de-AT');

  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [joinRequestStatus, setJoinRequestStatus] = useState(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showBoostModal, setShowBoostModal] = useState(false);
  const [showAvatarGate, setShowAvatarGate] = useState(false);
  // Pro gate: non-member non-Pro viewers get only the first 3 members + this
  // flag from the API — clicking the roster opens the ProModal instead.
  const [membersGated, setMembersGated] = useState(false);

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLocked, setEventsLocked] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [eventForm, setEventForm] = useState({ name: '', description: '', date: today(), time: nowTime(), location: '', max_members: 20, is_recurring_weekly: false });
  const [eventSubmitting, setEventSubmitting] = useState(false);
  const [joiningEventId, setJoiningEventId] = useState(null);
  const eventLocationRef = useRef(null);
  const eventAutocompleteRef = useRef(null);

  // Google Places autocomplete for the event "Ort" field — same as the location
  // field on group/club creation, so typing an address suggests real places and
  // the backend geocodes the picked value into a map pin (createClubEvent).
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (apiKey) loadGoogleMaps(apiKey);
  }, []);

  // Attach the autocomplete once the create-event form (and its input) is
  // mounted; tear it down when the form closes so it re-binds to the fresh
  // input next time.
  useEffect(() => {
    if (!showCreateEvent) return;
    const attach = () => {
      if (!window.google?.maps?.places) return;
      if (eventAutocompleteRef.current) return;
      if (!eventLocationRef.current) return;
      const ac = new window.google.maps.places.Autocomplete(eventLocationRef.current, {
        componentRestrictions: { country: ALLOWED_COUNTRIES_LOWER },
        fields: ['formatted_address', 'name'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const val = place.formatted_address || place.name || '';
        if (val) setEventForm(f => ({ ...f, location: val }));
      });
      eventAutocompleteRef.current = ac;
    };
    const timer = setTimeout(() => onGoogleMapsReady(attach), 50);
    return () => {
      clearTimeout(timer);
      if (eventAutocompleteRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(eventAutocompleteRef.current);
      }
      eventAutocompleteRef.current = null;
    };
  }, [showCreateEvent]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const [clubRes, membersRes, favRes] = await Promise.all([
          clubs.getById(id),
          clubs.getMembers(id).catch(() => ({ data: [] })),
          clubs.getFavorites().catch(() => ({ data: [] })),
        ]);
        if (controller.signal.aborted) return;
        const entity = clubRes.data;
        setClub(entity);
        setIsJoined(!!entity.is_member);
        setJoinRequestStatus(entity.join_request_status || null);
        setIsFavorited((favRes.data || []).some(f => f.id === parseInt(id, 10)));
        const memberData = membersRes.data;
        setMembers(Array.isArray(memberData) ? memberData : (memberData?.members || []));
        setMembersGated(Array.isArray(memberData) ? false : !!memberData?.gated);

        setEventsLoading(true);
        setEventsLocked(false);
        clubs.getEvents(id)
          .then(r => { if (!controller.signal.aborted) { setEvents(r.data || []); setEventsLocked(false); } })
          .catch(err => {
            if (controller.signal.aborted) return;
            // 403 → user is not a member; backend gates events for members-only.
            if (err?.response?.status === 403) setEventsLocked(true);
          })
          .finally(() => { if (!controller.signal.aborted) setEventsLoading(false); });
      } catch {
        if (!controller.signal.aborted) toast.error(t('clubDetail.toast.loadError'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [id]);

  const handleFavoriteToggle = async () => {
    const wasFav = isFavorited;
    setIsFavorited(!wasFav);
    try { await clubs.toggleFavorite(id); }
    catch { setIsFavorited(wasFav); toast.error(t('clubDetail.toast.favError')); }
  };

  // Share the club via its deep link (/club/:id). Native share sheet where
  // available, clipboard fallback otherwise. The link opens straight on this
  // club — e.g. to drop into an Instagram bio.
  const handleShare = async () => {
    const url = window.location.href;
    const title = club?.name || club?.title || 'JAMIE Club';
    const result = await shareLink({ title, url });
    if (result === 'copied') toast.success(t('clubDetail.shareLinkCopied'));
  };

  // Events are members-only (backend 403s non-members). Re-run after join/leave
  // so the section unlocks immediately instead of staying locked until reload.
  const loadEvents = async () => {
    setEventsLoading(true);
    try {
      const r = await clubs.getEvents(id);
      setEvents(r.data || []);
      setEventsLocked(false);
    } catch (err) {
      if (err?.response?.status === 403) setEventsLocked(true);
    } finally {
      setEventsLoading(false);
    }
  };

  const handleJoinToggle = async () => {
    // Join gate: no profile photo → prompt to upload first (Tina 2026-08-02).
    if (!isJoined && !user?.avatar_url) { setShowAvatarGate(true); return; }
    try {
      if (isJoined) {
        await clubs.leave(id);
        setIsJoined(false);
        setJoinRequestStatus(null);
        setMembers(prev => prev.filter(m => m.id !== user.id));
        const r = await clubs.getById(id);
        setClub(r.data);
        await loadEvents();
      } else {
        const res = await clubs.join(id);
        if (res.data?.status === 'pending') {
          setJoinRequestStatus('pending');
          toast.success(t('clubDetail.toast.requestSent'));
        } else {
          setIsJoined(true);
          const r = await clubs.getById(id);
          setClub(r.data);
          // Now a member → the gate lifts; re-fetch the full (ungated) roster.
          const mres = await clubs.getMembers(id).catch(() => null);
          if (mres) {
            const md = mres.data;
            setMembers(Array.isArray(md) ? md : (md?.members || []));
            setMembersGated(Array.isArray(md) ? false : !!md?.gated);
          } else {
            setMembers(prev => [...prev, { id: user.id, name: user.name, avatar_url: user.avatar_url }]);
            setMembersGated(false);
          }
          await loadEvents();
        }
      }
    } catch (e) {
      // Server-side avatar gate (2026-08-04) — mirror of GroupDetail.
      if (e.response?.data?.requiresAvatar) { setShowAvatarGate(true); return; }
      toast.error(e.response?.data?.error || t('clubDetail.toast.joinLeaveError'));
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('clubDetail.delete.confirm'))) return;
    try {
      await clubs.delete(id);
      toast.success(t('clubDetail.delete.deleted'));
      navigate('/home');
    } catch (e) {
      toast.error(e.response?.data?.error || t('clubDetail.delete.error'));
    }
  };

  const handleJoinEvent = async (eventId) => {
    if (!user) { navigate('/login'); return; }
    setJoiningEventId(eventId);
    try {
      // Events are stored as groups under the hood — use groups join endpoint
      const { groups } = await import('../utils/api');
      const res = await groups.join(eventId);
      if (res.data?.status === 'pending') {
        toast.success(t('clubDetail.events.requestSent'));
      } else {
        toast.success(t('clubDetail.events.joinedToast'));
        setEvents(prev => prev.map(e => e.id === eventId
          ? { ...e, is_member: true, members_count: (e.members_count || 0) + 1 }
          : e));
      }
    } catch (err) {
      if (err.response?.data?.requiresAvatar) { setShowAvatarGate(true); return; }
      toast.error(err.response?.data?.error || t('clubDetail.events.joinError'));
    } finally {
      setJoiningEventId(null);
    }
  };

  const handleLeaveEvent = async (eventId) => {
    setJoiningEventId(eventId);
    try {
      const { groups } = await import('../utils/api');
      await groups.leave(eventId);
      setEvents(prev => prev.map(e => e.id === eventId
        ? { ...e, is_member: false, members_count: Math.max(0, (e.members_count || 1) - 1) }
        : e));
    } catch (err) {
      toast.error(err.response?.data?.error || t('clubDetail.events.leaveError'));
    } finally {
      setJoiningEventId(null);
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!eventForm.name.trim()) { toast.error(t('clubDetail.events.errorNameRequired')); return; }
    if (!eventForm.date) { toast.error(t('clubDetail.events.errorDateRequired')); return; }
    // Recurring events legitimately start "now/in the past" — they roll forward
    // each week — so only enforce the future check on one-off events.
    if (!eventForm.is_recurring_weekly) {
      const eventDateTime = new Date(`${eventForm.date}T${eventForm.time || '00:00'}`);
      if (eventDateTime <= new Date()) { toast.error(t('clubDetail.events.errorDateFuture')); return; }
    }
    setEventSubmitting(true);
    try {
      const res = await clubs.createEvent(id, {
        name: eventForm.name.trim(),
        description: eventForm.description.trim() || undefined,
        date: eventForm.date,
        time: eventForm.time || undefined,
        location: eventForm.location.trim() || undefined,
        max_members: parseInt(eventForm.max_members, 10) || 20,
        is_recurring_weekly: eventForm.is_recurring_weekly,
      });
      const newEvent = res.data;
      newEvent.is_member = true;
      setEvents(prev => [newEvent, ...prev].sort((a, b) => new Date(a.date) - new Date(b.date)));
      setShowCreateEvent(false);
      setEventForm({ name: '', description: '', date: today(), time: nowTime(), location: '', max_members: 20, is_recurring_weekly: false });
      toast.success(t('clubDetail.events.createdToast'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('clubDetail.events.createError'));
    } finally {
      setEventSubmitting(false);
    }
  };

  const handleDeleteEvent = async (eventId) => {
    if (!window.confirm(t('clubDetail.events.confirmDelete'))) return;
    try {
      await clubs.deleteEvent(id, eventId);
      setEvents(prev => prev.filter(e => e.id !== eventId));
      toast.success(t('clubDetail.events.deletedToast'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('clubDetail.events.deleteError'));
    }
  };

  if (loading) return <div className="cd-loading">{t('clubDetail.loading')}</div>;
  if (!club) return <div className="cd-loading">{t('clubDetail.notFound')}</div>;

  const isOwner = user && Number(club.owner_id) === Number(user.id);
  // Co-manager (paid managed clubs): owner OR a member promoted to role='admin'.
  // Managers get the manage gear + can edit/create events like the owner.
  const canManage = isOwner || !!club.is_manager;
  const isMember = isJoined;
  // Owner-only setting (from the founder's club settings) restricts event
  // creation to the owner — but a co-manager may always create events.
  const canCreateEvent = user && isMember && (!club.events_owner_only || canManage);
  const membersCount = club.members_count || members.length || 0;
  const visibleMembers = members.slice(0, 20);
  const overflowMembers = Math.max(0, membersCount - visibleMembers.length);

  // Gated viewers can't open the full roster — tap routes them to the ProModal
  // (same global event the /members page uses); everyone else goes to the
  // dedicated members page. Was a bottom-sheet modal (cd-members-modal) —
  // matched a recurring "sheet won't scroll" bug class (missing min-height:0
  // on a max-height-capped flex column) and kept resurfacing across screens
  // this week; GroupDetail already used a dedicated page for this with no
  // such issue, so Clubs now does the same instead of re-patching the sheet
  // yet again (Tina, 2026-07-22: "mache überall die Mitglieder liste wie bei
  // den Gruppen").
  const openMembers = () => {
    // iOS: immer zur (limitierten) Liste statt zum Pro-Modal (Apple 3.1.1).
    if (membersGated && !isNativeIOS()) window.dispatchEvent(new Event('jamie:open-pro-modal'));
    else navigate(`/club/${id}/members`);
  };

  return (
    <div className="cd-page">
      <div className="cd-scroll">

        {/* ── Top bar ───────────────────────────────────────────── */}
        <div className="cd-top-bar">
          <button className="cd-back-btn" onClick={() => navigate(-1)} aria-label={t('clubDetail.back')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <h1 className="cd-top-title">{club.name || club.title}</h1>
          {/* Manage (gear) — owner OR co-manager, opens club verwalten. Share
              moved into the body so every visitor still has it (Robert 2026-06-16). */}
          {canManage && (
            <button
              className="cd-fav-btn"
              onClick={() => navigate(`/club/${id}/edit`)}
              aria-label={t('clubDetail.manage')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          )}
          <button
            className={`cd-fav-btn${isFavorited ? ' active' : ''}`}
            onClick={handleFavoriteToggle}
            aria-label={t('clubDetail.favorite')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24"
              fill={isFavorited ? '#FD7666' : 'none'}
              stroke={isFavorited ? '#FD7666' : 'currentColor'}
              strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
        </div>

        {/* ── Cover image ──────────────────────────────────────── */}
        <div className="cd-cover">
          {club.image_url ? (
            <img src={club.image_url} alt={club.name || ''} loading="eager" decoding="async" />
          ) : (
            <div className="cd-cover-placeholder">
              <span>{(club.name || club.category || 'C')[0]?.toUpperCase()}</span>
            </div>
          )}
          <div className="cd-cover-gradient" />
          <div className="cd-cover-meta">
            <span className="cd-cover-pill cd-cover-pill--members">
              {membersCount} {t('clubDetail.membersLabel')}
            </span>
            {club.location && (
              <span className="cd-cover-pill cd-cover-pill--location">
                {club.location}
              </span>
            )}
          </div>
        </div>

        {/* ── Member strip ─────────────────────────────────────── */}
        {visibleMembers.length > 0 && (
          <div className="cd-member-strip-wrap">
            <div className="cd-member-strip">
              {visibleMembers.map(m => (
                <button
                  key={m.id}
                  className="cd-member-chip"
                  onClick={openMembers}
                  aria-label={t('clubDetail.members.openListAria')}
                >
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={m.name || ''} loading="lazy" decoding="async" />
                  ) : (
                    <div className="cd-member-placeholder">
                      {(m.name || '?')[0]?.toUpperCase()}
                    </div>
                  )}
                </button>
              ))}
              {overflowMembers > 0 && (
                <button
                  className="cd-member-more"
                  onClick={openMembers}
                  aria-label={t('clubDetail.members.openListAria')}
                >
                  +{overflowMembers}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="cd-body">
          <div className="cd-title-row">
            <h2 className="cd-title">{club.name || club.title}</h2>
            {/* Multi-category: one chip per category (falls back to the single
                primary `category`), wrapped so they sit in a row. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(Array.isArray(club.categories) && club.categories.length
                ? club.categories
                : (club.category ? [club.category] : [])
              ).map(cat => (
                <span key={cat} className="cd-category">{cat}</span>
              ))}
            </div>
          </div>
          {club.description && (
            <p className="cd-description">{club.description}</p>
          )}

          {/* Primary action */}
          <div className="cd-actions">
            {isMember ? (
              <>
                <button className="cd-btn cd-btn-primary" onClick={() => navigate(`/chat/${id}`)}>
                  💬 {t('clubDetail.actions.openChat')}
                </button>
                {/* Owner can't leave their own club (backend rejects it) — they
                    have Löschen in the owner actions instead. */}
                {!isOwner && (
                  <button className="cd-btn cd-btn-ghost" onClick={handleJoinToggle}>
                    {t('clubDetail.actions.leave')}
                  </button>
                )}
              </>
            ) : joinRequestStatus === 'pending' ? (
              <button className="cd-btn cd-btn-disabled" disabled>
                {t('clubDetail.actions.pending')}
              </button>
            ) : (
              <button className="cd-btn cd-btn-primary" onClick={handleJoinToggle}>
                {club.is_private ? t('clubDetail.actions.requestJoin') : t('clubDetail.actions.join')}
              </button>
            )}
            {/* Share — moved down from the top bar; available to everyone. */}
            <button className="cd-btn cd-btn-ghost" onClick={handleShare}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: '-3px' }}>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              {t('clubDetail.share')}
            </button>
          </div>

          {/* ── Events section (primary content) ───────────────── */}
          <section className="cd-events">
            <div className="cd-events-header">
              <h3 className="cd-events-title">
                {t('clubDetail.events.title')}
                {events.length > 0 && <span className="cd-events-count">{events.length}</span>}
              </h3>
              {canCreateEvent && (
                <button
                  className="cd-events-add"
                  onClick={() => setShowCreateEvent(v => !v)}
                  aria-label={t('clubDetail.events.createAria')}
                >
                  {showCreateEvent ? '✕' : '+'}
                </button>
              )}
            </div>

            {showCreateEvent && (
              <form className="cd-event-form" onSubmit={handleCreateEvent}>
                <input
                  className="cd-event-input"
                  type="text"
                  placeholder={t('clubDetail.events.formNamePlaceholder')}
                  value={eventForm.name}
                  onChange={e => setEventForm(f => ({ ...f, name: e.target.value }))}
                  required
                />
                <textarea
                  className="cd-event-input cd-event-textarea"
                  placeholder={t('clubDetail.events.formDescPlaceholder')}
                  value={eventForm.description}
                  onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                />
                <div className="cd-event-row">
                  <input
                    className="cd-event-input"
                    type="date"
                    value={eventForm.date}
                    onChange={e => setEventForm(f => ({ ...f, date: e.target.value }))}
                    required
                  />
                  <input
                    className="cd-event-input"
                    type="time"
                    value={eventForm.time}
                    onChange={e => setEventForm(f => ({ ...f, time: e.target.value }))}
                  />
                </div>
                <div className="cd-event-row">
                  <input
                    ref={eventLocationRef}
                    className="cd-event-input"
                    type="text"
                    placeholder={t('clubDetail.events.formLocationPlaceholder')}
                    value={eventForm.location}
                    onChange={e => setEventForm(f => ({ ...f, location: e.target.value }))}
                    autoComplete="off"
                  />
                  <input
                    className="cd-event-input cd-event-input--sm"
                    type="number"
                    min={2}
                    max={500}
                    placeholder={t('clubDetail.events.formMaxPlaceholder')}
                    value={eventForm.max_members}
                    onChange={e => setEventForm(f => ({ ...f, max_members: e.target.value }))}
                  />
                </div>
                {/* Wöchentlich wiederholen — same weekday every week. */}
                <label className="cd-event-recurring">
                  <input
                    type="checkbox"
                    checked={eventForm.is_recurring_weekly}
                    onChange={e => setEventForm(f => ({ ...f, is_recurring_weekly: e.target.checked }))}
                  />
                  <span className="cd-event-recurring-text">
                    <span className="cd-event-recurring-title">{t('clubDetail.events.weeklyLabel')}</span>
                    <span className="cd-event-recurring-hint">{t('clubDetail.events.weeklyHint')}</span>
                  </span>
                </label>
                <button type="submit" className="cd-event-submit-btn" disabled={eventSubmitting}>
                  {eventSubmitting ? t('clubDetail.events.creating') : t('clubDetail.events.create')}
                </button>
              </form>
            )}

            {eventsLoading ? (
              <p className="cd-events-empty">{t('clubDetail.events.loading')}</p>
            ) : eventsLocked ? (
              <div className="cd-events-empty-state">
                <div className="cd-events-empty-icon">🔒</div>
                <p>{t('clubDetail.events.membersOnly')}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {t('clubDetail.events.membersOnlyHint')}
                </p>
              </div>
            ) : events.length === 0 ? (
              <div className="cd-events-empty-state">
                <div className="cd-events-empty-icon">📅</div>
                <p>{t('clubDetail.events.empty')}</p>
                {canCreateEvent && !showCreateEvent && (
                  <button className="cd-events-empty-cta" onClick={() => setShowCreateEvent(true)}>
                    {t('clubDetail.events.firstEventCta')}
                  </button>
                )}
              </div>
            ) : (
              <div className="cd-events-list">
                {events.map(ev => {
                  // Recurring events show the next occurrence so the badge never
                  // shows a past date once the first week has passed.
                  // isNaN guard: a date-less/unparseable event made
                  // .toISOString() throw DURING RENDER → whole club page
                  // "Hoppla!" (GroupDetail's twin list survives via
                  // formatEventDate's own guard — this line bypassed it).
                  const rawDate = nextOccurrence(ev) || new Date(ev.date);
                  const dateParts = isNaN(rawDate) ? null : formatEventDate(rawDate.toISOString(), dateLocale);
                  const evIsOwner = user && Number(ev.owner_id) === Number(user.id);
                  return (
                    <div key={ev.id} className="cd-event-card" onClick={() => navigate(`/group/${ev.id}`)}>
                      {dateParts ? (
                        <div className="cd-event-date-badge">
                          <span className="cd-event-date-day">{dateParts.day}</span>
                          <span className="cd-event-date-month">{dateParts.month}</span>
                        </div>
                      ) : (
                        <div className="cd-event-date-badge cd-event-date-badge--empty">
                          <span className="cd-event-date-day">?</span>
                        </div>
                      )}
                      <div className="cd-event-info">
                        <p className="cd-event-name">
                          {ev.name}
                          {ev.is_recurring_weekly && (
                            <span className="cd-event-recurring-badge" title={t('clubDetail.events.weeklyBadgeTitle')}>🔁</span>
                          )}
                        </p>
                        {dateParts?.time && (
                          <p className="cd-event-time">
                            {dateParts.time}
                            {ev.location ? ` · ${ev.location}` : ''}
                          </p>
                        )}
                        <p className="cd-event-meta">
                          {t('clubDetail.events.participants', { current: ev.members_count || 0, max: ev.max_members })}
                        </p>
                      </div>
                      <div className="cd-event-actions" onClick={e => e.stopPropagation()}>
                        {ev.date && (
                          <button
                            className="cd-event-cal-btn"
                            title={t('clubDetail.events.calendarAdd')}
                            onClick={() => openCalendar(ev)}
                            aria-label={t('clubDetail.events.calendarAdd')}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                              <line x1="16" y1="2" x2="16" y2="6"/>
                              <line x1="8" y1="2" x2="8" y2="6"/>
                              <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                          </button>
                        )}
                        {evIsOwner ? (
                          <button
                            className="cd-event-join-btn cd-event-join-btn--danger"
                            onClick={() => handleDeleteEvent(ev.id)}
                          >
                            {t('clubDetail.events.delete')}
                          </button>
                        ) : ev.is_member ? (
                          <button
                            className="cd-event-join-btn cd-event-join-btn--joined"
                            disabled={joiningEventId === ev.id}
                            onClick={() => handleLeaveEvent(ev.id)}
                          >
                            {t('clubDetail.events.joined')}
                          </button>
                        ) : (
                          <button
                            className="cd-event-join-btn"
                            disabled={joiningEventId === ev.id}
                            onClick={() => handleJoinEvent(ev.id)}
                          >
                            {joiningEventId === ev.id ? '…' : t('clubDetail.events.join')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Owner actions */}
          {isOwner && (
            <div className="cd-owner-actions">
              <button className="cd-boost-btn" onClick={() => setShowBoostModal(true)}>
                🚀 {t('clubDetail.actions.boost')}
              </button>
              <button className="cd-btn cd-btn-danger" onClick={handleDelete}>
                {t('clubDetail.actions.delete')}
              </button>
            </div>
          )}

          {/* Report */}
          <button className="cd-report-link" onClick={() => setShowReportModal(true)}>
            {t('clubDetail.actions.report')}
          </button>
        </div>
      </div>

      {showReportModal && (
        <ReportModal
          type="group"
          id={parseInt(id, 10)}
          name={club.name}
          onClose={() => setShowReportModal(false)}
        />
      )}
      {showBoostModal && (
        <Suspense fallback={null}>
          <BoostModal
            targetType="club"
            targetId={parseInt(id, 10)}
            targetName={club.name}
            onClose={() => setShowBoostModal(false)}
          />
        </Suspense>
      )}
      <AvatarGateModal isOpen={showAvatarGate} onClose={() => setShowAvatarGate(false)} />
    </div>
  );
};

export default ClubDetail;
