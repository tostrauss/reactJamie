import { useState, useEffect, useContext, Suspense } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GoogleMap, Marker, useLoadScript } from '@react-google-maps/api';
import { MapErrorBoundary } from '../components/MapErrorBoundary';
import { groups, clubs, reviews } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ReportModal } from '../components/ReportModal';
import { MapsChooser } from '../components/MapsChooser';
import { UserName } from '../components/UserName';
import { EventReviewModal } from '../components/EventReviewModal';
import AvatarGateModal from '../components/AvatarGateModal';
import { nextOccurrence } from '../utils/recurrence';
import { shareLink } from '../utils/share';
import { openCalendar } from '../utils/calendarExport';
import { isNativeIOS } from '../utils/platform';
import '../styles/group-detail.css';

// Lazy-load: pulls Stripe SDK only when the owner opens the modal.
import { lazyWithReload } from '../utils/lazyRetry';
const BoostModal = lazyWithReload(() => import('../components/BoostModal').then(m => ({ default: m.BoostModal })));

// Stable empty libraries array — recreating this triggers a Google Maps reload
const MAP_LIBRARIES = [];

// Returns "{min}-{max}" with 60+ cap, or null if either bound is missing.
function formatAgeRange(min, max) {
  if (min == null || max == null) return null;
  const capped = max >= 60 ? '60+' : String(max);
  return min === max ? String(min) : `${Math.max(18, min)}-${capped}`;
}

// Local YYYY-MM-DD (timezone-safe) — used as the date input `min` so past
// event dates can't be picked (a past date hides the event from the map).
const localTodayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const GROUP_MAP_STYLES = [
  { elementType: 'geometry',           stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.icon',        stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#7b7b9a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road',         elementType: 'geometry.fill', stylers: [{ color: '#2d2d4e' }] },
  { featureType: 'road.highway', elementType: 'geometry',      stylers: [{ color: '#3d3d6b' }] },
  { featureType: 'water',        elementType: 'geometry',      stylers: [{ color: '#0d1b2a' }] },
  { featureType: 'poi.park',     elementType: 'geometry',      stylers: [{ color: '#162030' }] },
];

function GroupMiniMap({ lat, lng }) {
  const { t } = useTranslation();
  const [chooserOpen, setChooserOpen] = useState(false);
  const { isLoaded } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
    libraries: MAP_LIBRARIES,
  });
  if (!isLoaded) return <div className="gd-mini-map gd-mini-map--loading" />;
  const pos = { lat, lng };
  return (
    <>
      <div className="gd-mini-map">
        <GoogleMap
          mapContainerClassName="gd-mini-map-canvas"
          center={pos}
          zoom={14}
          options={{
            styles: GROUP_MAP_STYLES,
            disableDefaultUI: true,
            // Static location preview — the tap layer below opens the directions
            // chooser instead of letting the user pan this tiny map.
            gestureHandling: 'none',
            clickableIcons: false,
          }}
        >
          <Marker position={pos} />
        </GoogleMap>
        {/* Tap anywhere on the map → choose Apple Maps / Google Maps */}
        <button
          type="button"
          className="gd-mini-map-tap"
          onClick={() => setChooserOpen(true)}
          aria-label={t('map.openDirectionsAria')}
        >
          <span className="gd-mini-map-route">🧭 {t('map.routeLabel')}</span>
        </button>
      </div>
      {chooserOpen && (
        <MapsChooser lat={lat} lng={lng} onClose={() => setChooserOpen(false)} />
      )}
    </>
  );
}

// Google Calendar export — see utils/calendarExport.js for the +2h fix.

// "Heute"/"Morgen" instead of the literal date when the event is that close
// (Tina, 2026-06-12) — same behavior the Home cards already have. Reuses the
// groups.card.* keys so card and detail page always say the same word.
const relativeDayLabel = (d, t) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((day - today) / 86400000);
  if (diff === 0) return t('groups.card.dateHeute');
  if (diff === 1) return t('groups.card.dateMorgen');
  return null;
};

const formatHeaderDate = (dateStr, locale, t) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const rel = relativeDayLabel(d, t);
  if (rel) return rel;
  const weekday = d.toLocaleDateString(locale, { weekday: 'long' });
  const day = d.getDate();
  const month = d.getMonth() + 1;
  return `${weekday} - ${day}.${month}.`;
};

const formatShortDate = (dateStr, t) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const rel = relativeDayLabel(d, t);
  if (rel) return rel;
  return `${d.getDate()}.${d.getMonth() + 1}.`;
};

const formatEventDate = (dateStr, locale) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  // Event start times are stored as a naive wall-clock; on the UTC server that
  // value round-trips tagged UTC, so formatting in the device's local zone
  // shifted it +1/+2h (CEST) — same bug as ClubDetail's formatEventDate.
  // Format in UTC so the displayed time equals exactly what was typed.
  const day = d.getUTCDate();
  const month = d.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return { day, month, time };
};

const today = () => {
  const d = new Date();
  return d.toISOString().split('T')[0];
};
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const GroupDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it-IT' : ((i18n.resolvedLanguage || i18n.language || 'de').startsWith('fr') ? 'fr-FR' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('es') ? 'es-ES' : 'de-AT');

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  // Pro gate (parity with the Home card): non-Pro non-members get only the
  // first 3 members + total_count; the next grid slot renders as a locked tile.
  const [membersGated, setMembersGated] = useState(false);
  const [membersTotal, setMembersTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [joinRequestStatus, setJoinRequestStatus] = useState(null);
  const [waitlistStatus, setWaitlistStatus] = useState(null);
  const [waitlistPosition, setWaitlistPosition] = useState(null);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showBoostModal, setShowBoostModal] = useState(false);
  const [showAvatarGate, setShowAvatarGate] = useState(false);
  // Post-event attendance review, re-openable from the event page (the auto-
  // popup is one-shot; this is the way back in after skipping/closing).
  const [reviewPayload, setReviewPayload] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Club events state
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [eventForm, setEventForm] = useState({ name: '', description: '', date: today(), time: nowTime(), location: '', max_members: 20 });
  const [eventSubmitting, setEventSubmitting] = useState(false);
  const [joiningEventId, setJoiningEventId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const fetchData = async () => {
      setLoading(true);
      try {
        let groupRes, membersRes;
        try {
          groupRes = await groups.getById(id);
          membersRes = await groups.getMembers(id).catch(() => ({ data: [] }));
        } catch {
          groupRes = await clubs.getById(id);
          membersRes = await clubs.getMembers(id).catch(() => ({ data: [] }));
        }
        if (controller.signal.aborted) return;
        const entity = groupRes.data;
        const isClubType = entity.type === 'club';
        const favRes = await (isClubType ? clubs.getFavorites() : groups.getFavorites()).catch(() => ({ data: [] }));
        if (controller.signal.aborted) return;
        setIsFavorited((favRes.data || []).some(f => f.id === parseInt(id, 10)));
        setGroup(entity);
        setIsJoined(!!entity.is_member);
        setJoinRequestStatus(entity.join_request_status || null);
        setWaitlistStatus(entity.waitlist_status || null);
        setWaitlistPosition(entity.waitlist_position || null);
        // Groups endpoint returns { members, total_count, gated } for Pro-gating;
        // clubs endpoint still returns a flat array. Normalize to an array.
        const memberData = membersRes.data;
        if (Array.isArray(memberData)) {
          setMembers(memberData);
          setMembersGated(false);
          setMembersTotal(null);
        } else {
          setMembers(memberData?.members || []);
          setMembersGated(!!memberData?.gated);
          setMembersTotal(memberData?.total_count ?? null);
        }

        if (isClubType) {
          setEventsLoading(true);
          clubs.getEvents(id)
            .then(r => { if (!controller.signal.aborted) setEvents(r.data || []); })
            .catch(() => {})
            .finally(() => { if (!controller.signal.aborted) setEventsLoading(false); });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(t('groups.detail.toast.loadError'));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    fetchData();
    return () => controller.abort();
  }, [id]);

  // Am I allowed to (re)open the post-event attendance review for this event?
  // Only for one-off group events I'm a member of that ended 6h+ ago and that I
  // haven't reviewed yet. The endpoint 404s otherwise → button stays hidden.
  useEffect(() => {
    const ended = group?.date && (new Date(group.date).getTime() + 6 * 60 * 60 * 1000 < Date.now());
    if (!group || group.type !== 'group' || !isJoined || group.is_recurring_weekly || !ended) {
      setReviewPayload(null);
      return;
    }
    let cancelled = false;
    reviews.getForGroup(group.id)
      .then(r => { if (!cancelled) setReviewPayload(r.data); })
      .catch(() => { if (!cancelled) setReviewPayload(null); });
    return () => { cancelled = true; };
  }, [group, isJoined]);

  const handleFavoriteToggle = async () => {
    const wasFav = isFavorited;
    setIsFavorited(!wasFav);
    try {
      group?.type === 'club' ? await clubs.toggleFavorite(id) : await groups.toggleFavorite(id);
    } catch {
      setIsFavorited(wasFav);
      toast.error(t('groups.detail.toast.favError'));
    }
  };

  // Re-fetch the roster and re-derive the Pro-gate state. Hand-patching the
  // members array after join/leave left gated/total stale: an ex-member kept
  // seeing the full ungated roster, and a fresh member saw a synthetic self
  // entry without age/trusted fields instead of the real ungated list.
  const refreshMembers = async (isClub) => {
    try {
      const res = isClub ? await clubs.getMembers(id) : await groups.getMembers(id);
      const data = res.data;
      if (Array.isArray(data)) {
        setMembers(data);
        setMembersGated(false);
        setMembersTotal(null);
      } else {
        setMembers(data?.members || []);
        setMembersGated(!!data?.gated);
        setMembersTotal(data?.total_count ?? null);
      }
    } catch { /* keep the optimistic local state */ }
  };

  const handleJoinToggle = async () => {
    // Join gate: no profile photo → prompt to upload first (Tina 2026-08-02).
    if (!isJoined && !user?.avatar_url) { setShowAvatarGate(true); return; }
    try {
      const isClub = group?.type === 'club';
      if (isJoined) {
        isClub ? await clubs.leave(id) : await groups.leave(id);
        setIsJoined(false);
        setJoinRequestStatus(null);
        setMembers(prev => prev.filter(m => m.id !== user.id));
        const response = isClub ? await clubs.getById(id) : await groups.getById(id);
        setGroup(response.data);
        await refreshMembers(isClub);
      } else {
        const res = isClub ? await clubs.join(id) : await groups.join(id);
        if (res.data?.status === 'pending') {
          setJoinRequestStatus('pending');
          toast.success(t('groups.detail.toast.requestSent'));
        } else {
          setIsJoined(true);
          setMembers(prev => [...prev, { id: user.id, name: user.name, avatar_url: user.avatar_url }]);
          const response = isClub ? await clubs.getById(id) : await groups.getById(id);
          setGroup(response.data);
          await refreshMembers(isClub);
        }
      }
    } catch (error) {
      // Server-side avatar gate (2026-08-04): the local pre-check above can
      // miss a stale `user` (avatar removed on another device) — the backend
      // 403s with requiresAvatar, route that into the same prompt.
      if (error.response?.data?.requiresAvatar) { setShowAvatarGate(true); return; }
      toast.error(error.response?.data?.error || t('groups.detail.toast.joinLeaveError'));
    }
  };

  const handleJoinWaitlist = async () => {
    setWaitlistLoading(true);
    try {
      const isClub = group?.type === 'club';
      const res = isClub ? await clubs.joinWaitlist(id) : await groups.joinWaitlist(id);
      setWaitlistStatus('waiting');
      setWaitlistPosition(res.data?.position || null);
      toast.success(res.data?.position
        ? t('groups.detail.toast.waitlistJoinedPos', { position: res.data.position })
        : t('groups.detail.toast.waitlistJoined')
      );
    } catch (err) {
      toast.error(err.response?.data?.error || t('groups.detail.toast.waitlistError'));
    } finally {
      setWaitlistLoading(false);
    }
  };

  const handleLeaveWaitlist = async () => {
    setWaitlistLoading(true);
    try {
      const isClub = group?.type === 'club';
      isClub ? await clubs.leaveWaitlist(id) : await groups.leaveWaitlist(id);
      setWaitlistStatus(null);
      setWaitlistPosition(null);
      toast.success(t('groups.detail.toast.waitlistLeft'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('groups.detail.toast.waitlistLeaveError'));
    } finally {
      setWaitlistLoading(false);
    }
  };

  const handleDelete = async () => {
    const isClubType = group?.type === 'club';
    const isEventType = group?.type === 'event';
    const confirmMsg = isClubType ? t('groups.detail.delete.confirmClub') : t('groups.detail.delete.confirmGroup');
    if (!window.confirm(confirmMsg)) return;
    try {
      if (isClubType) {
        await clubs.delete(id);
      } else if (isEventType && group?.parent_club_id) {
        // Club events: dedicated endpoint so the club owner/manager (not only
        // the creator) may delete, and it busts the clubs/discover/MAP caches
        // — groups.delete is owner-only and would 403 a manager, leaving a
        // ghost pin on the map.
        await clubs.deleteEvent(group.parent_club_id, id);
      } else {
        await groups.delete(id);
      }
      toast.success(isClubType ? t('groups.detail.delete.deletedClub') : t('groups.detail.delete.deletedGroup'));
      navigate('/home');
    } catch (error) {
      toast.error(error.response?.data?.error || (isClubType ? t('groups.detail.delete.errorClub') : t('groups.detail.delete.errorGroup')));
    }
  };

  const handleJoinEvent = async (eventId) => {
    if (!user) { navigate('/login'); return; }
    setJoiningEventId(eventId);
    try {
      const res = await groups.join(eventId);
      if (res.data?.status === 'pending') {
        toast.success(t('groups.detail.events.requestSent'));
      } else {
        toast.success(t('groups.detail.events.joinedToast'));
        setEvents(prev => prev.map(e =>
          e.id === eventId
            ? { ...e, is_member: true, members_count: (e.members_count || 0) + 1 }
            : e
        ));
      }
    } catch (err) {
      toast.error(err.response?.data?.error || t('groups.detail.events.joinError'));
    } finally {
      setJoiningEventId(null);
    }
  };

  const handleLeaveEvent = async (eventId) => {
    setJoiningEventId(eventId);
    try {
      await groups.leave(eventId);
      setEvents(prev => prev.map(e =>
        e.id === eventId
          ? { ...e, is_member: false, members_count: Math.max(0, (e.members_count || 1) - 1) }
          : e
      ));
    } catch (err) {
      toast.error(err.response?.data?.error || t('groups.detail.events.leaveError'));
    } finally {
      setJoiningEventId(null);
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!eventForm.name.trim()) { toast.error(t('groups.detail.events.errorNameRequired')); return; }
    if (!eventForm.date) { toast.error(t('groups.detail.events.errorDateRequired')); return; }
    const eventDateTime = new Date(`${eventForm.date}T${eventForm.time || '00:00'}`);
    if (eventDateTime <= new Date()) { toast.error(t('groups.detail.events.errorDateFuture')); return; }
    setEventSubmitting(true);
    try {
      const res = await clubs.createEvent(id, {
        name: eventForm.name.trim(),
        description: eventForm.description.trim() || undefined,
        date: eventForm.date,
        time: eventForm.time || undefined,
        location: eventForm.location.trim() || undefined,
        max_members: parseInt(eventForm.max_members, 10) || 20,
      });
      const newEvent = res.data;
      newEvent.is_member = true;
      setEvents(prev => [newEvent, ...prev].sort((a, b) => new Date(a.date) - new Date(b.date)));
      setShowCreateEvent(false);
      setEventForm({ name: '', description: '', date: today(), time: nowTime(), location: '', max_members: 20 });
      toast.success(t('groups.detail.events.createdToast'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('groups.detail.events.createError'));
    } finally {
      setEventSubmitting(false);
    }
  };

  const handleDeleteEvent = async (eventId) => {
    if (!window.confirm(t('groups.detail.events.confirmDelete'))) return;
    try {
      await clubs.deleteEvent(id, eventId);
      setEvents(prev => prev.filter(e => e.id !== eventId));
      toast.success(t('groups.detail.events.deletedToast'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('groups.detail.events.deleteError'));
    }
  };

  if (loading) return <div className="gd-loading">{t('groups.detail.loading')}</div>;
  if (!group) return <div className="gd-loading">{t('groups.detail.notFound')}</div>;

  // Clubs use a dedicated detail page — forward existing /group/:id URLs so old
  // navigation, share links, and notifications keep working.
  if (group.type === 'club') return <Navigate to={`/club/${id}`} replace />;

  const isClub = group.type === 'club';
  const isEvent = group.type === 'event';
  const isOwner = user && Number(group.owner_id) === Number(user.id);
  const isMember = isJoined;
  const canCreateEvent = isClub && user && isMember;
  const maxSlots = Math.min(group.max_members || 4, 4);
  const filledSlots = members.slice(0, maxSlots);
  // Locked tile in the next free slot when the roster is Pro-gated and more
  // members exist than were returned — same rule as the Home card's 4th tile.
  // Nie auf nativem iOS: kein Pro-Werbe-Lock ohne Kaufweg (Apple 3.1.1).
  const showGateSlot =
    !isNativeIOS() && membersGated && (membersTotal ?? 0) > filledSlots.length && filledSlots.length < maxSlots;
  const emptySlots = Math.max(0, maxSlots - filledSlots.length - (showGateSlot ? 1 : 0));
  // Recurring events show the *next* occurrence everywhere (header chip,
  // info row) so "Wann?" never reads as a date in the past.
  const displayDateISO = (() => {
    const d = nextOccurrence(group);
    return d ? d.toISOString() : group.date;
  })();
  const headerDate = formatHeaderDate(displayDateISO, dateLocale, t);
  const shortDate = formatShortDate(displayDateISO, t);

  return (
    <div className="gd-page">
      <div className="gd-scroll">
        {/* Top header */}
        <div className="gd-top-bar">
          <button className="gd-back-btn" onClick={() => navigate(-1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <h1 className="gd-top-title">
            {isEvent
              ? (group.name || group.category)
              : (headerDate || group.name || group.category)
            }
          </h1>
          {/* Manage (gear) — opens the edit/verwalten page. Shows for the owner
              AND, for club events, the parent club's owner/managers (backend
              sets group.is_manager). Sits next to the favourite heart. */}
          {(isOwner || group.is_manager) && (
            <button
              className="gd-fav-top"
              onClick={() => navigate(`/group/${group.id}/edit`)}
              aria-label={t('groups.detail.manage')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          )}
          <button
            className={`gd-fav-top${isFavorited ? ' active' : ''}`}
            onClick={handleFavoriteToggle}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorited ? '#FD7666' : 'none'} stroke={isFavorited ? '#FD7666' : 'currentColor'} strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
        </div>

        {/* Photo grid */}
        <div className="gd-photo-grid-wrapper">
          {isClub && group.image_url ? (
            <div className="gd-club-cover">
              <img src={group.image_url} alt={group.name} loading="lazy" />
            </div>
          ) : (
            <div className="gd-photo-grid">
              {filledSlots.map((member) => (
                <div
                  key={member.id}
                  className="gd-photo-slot filled"
                  onClick={() => navigate(`/user/${member.id}`)}
                >
                  {member.avatar_url
                    ? <img src={member.avatar_url} alt={member.name} loading="lazy" />
                    : <div className="gd-photo-placeholder">{(member.name || '?')[0].toUpperCase()}</div>
                  }
                  <div className="gd-photo-bottom">
                    {/* Photo grid: age is shown only as the name-superscript
                        (corner chip removed) — single source of truth. */}
                    <UserName
                      className="gd-photo-name"
                      name={(member.name || '').toUpperCase()}
                      age={member.age}
                    />
                    {member.is_trusted_user && (
                      <span className="gd-photo-check">✓</span>
                    )}
                  </div>
                </div>
              ))}
              {showGateSlot && (
                <button
                  type="button"
                  className="gd-photo-slot gd-pro-gate"
                  onClick={() => window.dispatchEvent(new Event('jamie:open-pro-modal'))}
                  aria-label={t('groups.card.proGateAria')}
                >
                  <span className="gd-pro-gate-blur" aria-hidden="true" />
                  <span className="gd-pro-gate-lock" aria-hidden="true">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="11" width="16" height="10" rx="2.5" />
                      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
                    </svg>
                  </span>
                </button>
              )}
              {[...Array(emptySlots)].map((_, i) => (
                <div key={`empty-${i}`} className="gd-photo-slot empty">
                  <span className="gd-photo-plus">+</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Anfragen / Chat / Waitlist button */}
        {(() => {
          const isFull = group.members_count >= group.max_members;
          // Event owner: render both "Chat öffnen" and "Bearbeiten" side by
          // side. Previously only Bearbeiten showed and the owner had no way
          // to reach their own event chat.
          if (isEvent && isOwner) {
            return (
              <div className="gd-anfragen-row" style={{ gap: 10 }}>
                <button className="gd-anfragen-btn joined" onClick={() => navigate(`/chat/${group.id}`)}>
                  {t('groups.detail.actions.openChat')}
                </button>
                <button className="gd-anfragen-btn joined" onClick={() => navigate(`/group/${group.id}/edit`)}>
                  {t('groups.detail.actions.editEvent')}
                </button>
              </div>
            );
          }
          if (isJoined) {
            return (
              <div className="gd-anfragen-row">
                <button className="gd-anfragen-btn joined" onClick={() => navigate(`/chat/${group.id}`)}>
                  {t('groups.detail.actions.openChat')}
                </button>
              </div>
            );
          }
          if (joinRequestStatus === 'pending') {
            return (
              <div className="gd-anfragen-row">
                <button className="gd-anfragen-btn" disabled style={{ opacity: 0.6, cursor: 'default' }}>
                  {t('groups.detail.actions.requestPending')}
                </button>
              </div>
            );
          }
          if (waitlistStatus === 'notified') {
            return (
              <div className="gd-anfragen-row" style={{ flexDirection: 'column', gap: '8px' }}>
                <button className="gd-anfragen-btn" onClick={handleJoinToggle}>
                  {t('groups.detail.actions.spotFreeJoin')}
                </button>
                <button onClick={handleLeaveWaitlist} disabled={waitlistLoading} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', padding: '4px' }}>
                  {t('groups.detail.actions.leaveWaitlist')}
                </button>
              </div>
            );
          }
          if (waitlistStatus === 'waiting') {
            return (
              <div className="gd-anfragen-row" style={{ flexDirection: 'column', gap: '8px' }}>
                <button className="gd-anfragen-btn" disabled style={{ opacity: 0.6, cursor: 'default' }}>
                  {waitlistPosition
                    ? t('groups.detail.actions.waitlistPositionFmt', { position: waitlistPosition })
                    : t('groups.detail.actions.waitlistGeneric')}
                </button>
                <button onClick={handleLeaveWaitlist} disabled={waitlistLoading} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', padding: '4px' }}>
                  {waitlistLoading ? t('groups.detail.actions.loadingShort') : t('groups.detail.actions.leaveWaitlist')}
                </button>
              </div>
            );
          }
          if (isFull) {
            return (
              <div className="gd-anfragen-row">
                <button className="gd-anfragen-btn" onClick={handleJoinWaitlist} disabled={waitlistLoading}>
                  {waitlistLoading ? t('groups.detail.actions.loadingShort') : t('groups.detail.actions.joinWaitlist')}
                </button>
              </div>
            );
          }
          return (
            <div className="gd-anfragen-row">
              <button className="gd-anfragen-btn cta-pulse" onClick={handleJoinToggle}>
                {group.is_private ? t('groups.detail.actions.joinPrivate') : t('groups.detail.actions.joinPublic')}
              </button>
            </div>
          );
        })()}

        {/* Teilnehmer-Bubbles — small Meetup-style teaser under the action
            button (Tina, 2026-06-12): visible avatars + "+N" + "Alle sehen".
            Gated viewers with hidden members go straight to the ProModal —
            this row is the active Pro tease; everyone else gets the list. */}
        {members.length > 0 && (() => {
          const teaserTotal = membersTotal ?? group.members_count ?? members.length;
          const bubbleMembers = members.slice(0, 3);
          const teaserExtra = Math.max(0, teaserTotal - bubbleMembers.length);
          return (
            <button
              type="button"
              className="gd-members-teaser"
              onClick={() =>
                // iOS: immer zur (server-seitig limitierten) Mitgliederliste
                // statt zum Pro-Modal (Apple 3.1.1).
                membersGated && teaserExtra > 0 && !isNativeIOS()
                  ? window.dispatchEvent(new Event('jamie:open-pro-modal'))
                  : navigate(`/group/${id}/members`)
              }
            >
              <span className="gd-members-teaser-bubbles" aria-hidden="true">
                {bubbleMembers.map(m =>
                  m.avatar_url ? (
                    <img key={m.id} src={m.avatar_url} alt="" className="gd-members-teaser-bubble" loading="lazy" />
                  ) : (
                    <span key={m.id} className="gd-members-teaser-bubble gd-members-teaser-bubble--ph">
                      {(m.name || '?')[0]?.toUpperCase()}
                    </span>
                  )
                )}
                {teaserExtra > 0 && (
                  <span className="gd-members-teaser-bubble gd-members-teaser-bubble--more">+{teaserExtra}</span>
                )}
              </span>
              <span className="gd-members-teaser-label">
                {group.max_members
                  ? t('groups.detail.membersTeaser.countWithMax', { current: teaserTotal, max: group.max_members })
                  : t('groups.detail.membersTeaser.count', { count: teaserTotal })}
              </span>
              <span className="gd-members-teaser-cta">{t('groups.detail.membersTeaser.seeAll')}</span>
            </button>
          );
        })()}

        <div className="gd-body">
          <div className="gd-content-card">
            {/* Info row */}
            <div className="gd-info-row">
              {group.skill_level && group.skill_level !== 'Alle Levels' && (
                <span className="gd-info-item">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="#FD7666" stroke="none">
                    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
                  </svg>
                  {t('groups.detail.info.level', { level: group.skill_level })}
                </span>
              )}
              {shortDate && (
                <span className="gd-info-item">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  {t('groups.detail.info.when', { when: shortDate })}
                </span>
              )}
              {group.is_recurring_weekly && (
                <span className="gd-info-item" style={{ color: '#FD7666' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                  {t('groups.detail.info.weekly', {
                    weekday: new Date(group.date).toLocaleDateString(dateLocale, { weekday: 'long' })
                  })}
                </span>
              )}
              {/* No Teilnehmer item here — the bubbles teaser above the info
                  card is the single participants element (incl. capacity);
                  two of them read as clutter (Tobi, 2026-06-12). */}
              {(() => {
                const ageRange = formatAgeRange(group.age_min, group.age_max);
                return ageRange ? (
                  <span className="gd-info-item">
                    🎂 {t('groups.detail.info.age', { range: ageRange })}
                  </span>
                ) : null;
              })()}
              {group.location && (
                <span className="gd-info-item">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  {t('groups.detail.info.location', { location: group.location })}
                </span>
              )}
            </div>

            {/* Category eyebrow above the title — the title is now the
                user-entered name (see below), so the category is surfaced here
                as its own label (kept visible per product spec, mirrors the map
                popup's category chip). */}
            {group.category && (
              <span className="gd-category-eyebrow">{group.category}</span>
            )}

            {/* Group title — the user-entered title (max 15 chars). Falls back
                to the category only for legacy groups created before titles
                were shown. */}
            <h2 className="gd-group-title">
              {group.name || group.title || group.category || ''}
            </h2>

            {/* Description */}
            {group.description && (
              <p className="gd-description">{group.description}</p>
            )}

            {/* Location mini-map */}
            {group.lat != null && group.lng != null && (
              <div className="gd-map-section">
                <MapErrorBoundary>
                  <GroupMiniMap lat={Number(group.lat)} lng={Number(group.lng)} />
                </MapErrorBoundary>
              </div>
            )}

            {/* Owner actions */}
            {isJoined && (
              <div className="gd-owner-actions">
                {isOwner && !isEvent && (
                  <button className="gd-boost-btn" onClick={() => setShowBoostModal(true)}>
                    {t('groups.detail.actions.boost')}
                  </button>
                )}
                {/* Club events: the parent club's owner/managers may delete too
                    (group.is_manager), not just the creator — mirrors the edit gear. */}
                {(isOwner || (isEvent && group.is_manager))
                  ? <button className="gd-btn-leave" onClick={handleDelete}>{isClub ? t('groups.detail.delete.club') : isEvent ? t('groups.detail.delete.event') : t('groups.detail.delete.group')}</button>
                  : <button className="gd-btn-leave" onClick={handleJoinToggle}>{t('groups.detail.delete.leave')}</button>
                }
              </div>
            )}

            <button className="gd-report-btn" onClick={() => setShowReportModal(true)}>
              {isClub ? t('groups.detail.report.club') : t('groups.detail.report.group')}
            </button>
          </div>

          {/* ── Club Events Section ─────────────────────────────────── */}
          {isClub && (
            <div className="gd-events-section">
              <div className="gd-events-header">
                <h3 className="gd-events-title">{t('groups.detail.events.title')}</h3>
                {canCreateEvent && (
                  <button
                    className="gd-events-add-btn"
                    onClick={() => setShowCreateEvent(v => !v)}
                  >
                    {showCreateEvent ? '✕' : '+'}
                  </button>
                )}
              </div>

              {/* Create event form */}
              {showCreateEvent && (
                <form className="gd-event-form" onSubmit={handleCreateEvent}>
                  <input
                    className="gd-event-input"
                    type="text"
                    placeholder={t('groups.detail.events.formNamePlaceholder')}
                    value={eventForm.name}
                    onChange={e => setEventForm(f => ({ ...f, name: e.target.value }))}
                    required
                  />
                  <textarea
                    className="gd-event-input gd-event-textarea"
                    placeholder={t('groups.detail.events.formDescPlaceholder')}
                    value={eventForm.description}
                    onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                  />
                  <div className="gd-event-row">
                    <input
                      className="gd-event-input"
                      type="date"
                      value={eventForm.date}
                      min={localTodayStr()}
                      onChange={e => setEventForm(f => ({ ...f, date: e.target.value }))}
                      required
                    />
                    <input
                      className="gd-event-input"
                      type="time"
                      value={eventForm.time}
                      onChange={e => setEventForm(f => ({ ...f, time: e.target.value }))}
                    />
                  </div>
                  <div className="gd-event-row">
                    <input
                      className="gd-event-input"
                      type="text"
                      placeholder={t('groups.detail.events.formLocationPlaceholder')}
                      value={eventForm.location}
                      onChange={e => setEventForm(f => ({ ...f, location: e.target.value }))}
                    />
                    <input
                      className="gd-event-input gd-event-input--sm"
                      type="number"
                      min={2}
                      max={500}
                      placeholder={t('groups.detail.events.formMaxPlaceholder')}
                      value={eventForm.max_members}
                      onChange={e => setEventForm(f => ({ ...f, max_members: e.target.value }))}
                    />
                  </div>
                  <button
                    type="submit"
                    className="gd-event-submit-btn"
                    disabled={eventSubmitting}
                  >
                    {eventSubmitting ? t('groups.detail.events.creating') : t('groups.detail.events.create')}
                  </button>
                </form>
              )}

              {/* Event list */}
              {eventsLoading ? (
                <p className="gd-events-empty">{t('groups.detail.events.loading')}</p>
              ) : events.length === 0 ? (
                <p className="gd-events-empty">{t('groups.detail.events.empty')}</p>
              ) : (
                <div className="gd-events-list">
                  {events.map(ev => {
                    const dateParts = formatEventDate(ev.date, dateLocale);
                    const evIsOwner = user && Number(ev.owner_id) === Number(user.id);
                    return (
                      <div key={ev.id} className="gd-event-card" onClick={() => navigate(`/group/${ev.id}`)}>
                        {dateParts ? (
                          <div className="gd-event-date-badge">
                            <span className="gd-event-date-day">{dateParts.day}</span>
                            <span className="gd-event-date-month">{dateParts.month}</span>
                          </div>
                        ) : (
                          <div className="gd-event-date-badge gd-event-date-badge--empty">
                            <span className="gd-event-date-day">?</span>
                          </div>
                        )}
                        <div className="gd-event-info">
                          <p className="gd-event-name">{ev.name}</p>
                          {dateParts?.time && (
                            <p className="gd-event-time">
                              {dateParts.time}{t('groups.detail.events.uhr') ? ` ${t('groups.detail.events.uhr')}` : ''}{ev.location ? ` · ${ev.location}` : ''}
                            </p>
                          )}
                          <p className="gd-event-meta">{t('groups.detail.events.participants', { current: ev.members_count || 0, max: ev.max_members })}</p>
                        </div>
                        <div className="gd-event-actions" onClick={e => e.stopPropagation()}>
                          {ev.date && (
                            <button
                              className="gd-event-cal-btn"
                              title={t('groups.detail.events.calendarAdd')}
                              onClick={() => openCalendar(ev)}
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
                              className="gd-event-join-btn gd-event-join-btn--danger"
                              onClick={() => handleDeleteEvent(ev.id)}
                            >
                              {t('groups.detail.events.delete')}
                            </button>
                          ) : ev.is_member ? (
                            <button
                              className="gd-event-join-btn gd-event-join-btn--joined"
                              disabled={joiningEventId === ev.id}
                              onClick={() => handleLeaveEvent(ev.id)}
                            >
                              {t('groups.detail.events.joined')}
                            </button>
                          ) : (
                            <button
                              className="gd-event-join-btn"
                              disabled={joiningEventId === ev.id}
                              onClick={() => handleJoinEvent(ev.id)}
                            >
                              {joiningEventId === ev.id ? '…' : t('groups.detail.events.join')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Share + Calendar buttons */}
          <div className="gd-bottom-actions">
            <button className="gd-action-pill" onClick={async () => {
              const title = (group.category && group.category.toLowerCase() !== 'sonstiges')
                ? group.category
                : (group.name || group.category);
              const result = await shareLink({ title, url: window.location.href });
              if (result === 'copied') toast.success(t('groups.detail.shareLinkCopied'));
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              {isEvent ? t('groups.detail.shareEvent') : t('groups.detail.share')}
            </button>

            {group.date && isJoined && (
              <button className="gd-action-pill" onClick={() => openCalendar(group)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                {t('groups.detail.calendar')}
              </button>
            )}

            {reviewPayload && reviewPayload.members?.length > 0 && (
              <button className="gd-action-pill" onClick={() => setReviewOpen(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                {t('groups.detail.reviewAttendance')}
              </button>
            )}
          </div>
        </div>
      </div>

      {reviewOpen && reviewPayload && (
        <EventReviewModal
          pendingReviews={[reviewPayload]}
          onDone={() => { setReviewOpen(false); setReviewPayload(null); }}
        />
      )}

      {showReportModal && (
        <ReportModal
          type="group"
          id={parseInt(id)}
          name={group.name || group.title}
          onClose={() => setShowReportModal(false)}
        />
      )}

      {showBoostModal && (
        <Suspense fallback={null}>
          <BoostModal
            targetType={isClub ? 'club' : 'group'}
            targetId={parseInt(id)}
            targetName={group.name || group.category || ''}
            onClose={() => setShowBoostModal(false)}
          />
        </Suspense>
      )}
      <AvatarGateModal isOpen={showAvatarGate} onClose={() => setShowAvatarGate(false)} />
    </div>
  );
};

export default GroupDetail;
