import { useState, useEffect, useRef, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clubs, partnerApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ReportModal } from '../components/ReportModal';
import AvatarGateModal from '../components/AvatarGateModal';
import EventDealRow from '../components/EventDealRow';
import ClubEventJoinButton from '../components/ClubEventJoinButton';
import DealForm from '../components/DealForm';
import { PartnerInviteSheet } from '../components/PartnerInviteSheet';
import { nextOccurrence } from '../utils/recurrence';
import { formatEventDate, eventDateLocale } from '../utils/eventDate';
import { shareLink } from '../utils/share';
import { serverErrorMessage } from '../utils/apiError';
import { openCalendar } from '../utils/calendarExport';
import { loadGoogleMaps, onGoogleMapsReady, createPlacesAutocomplete } from '../utils/googleMaps';
import { ALLOWED_COUNTRIES } from '../utils/regions';
import { proUpsellAllowed } from '../utils/platform';
import { usePaymentsConfig } from '../utils/paymentsConfig';
import '../styles/club-detail.css';

const today = () => new Date().toISOString().split('T')[0];
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
// The event form as it opens. with_deal / auto_messages: the two bars of an
// official club's form (Tina 17.11.2026), both unticked.
const emptyEventForm = () => ({
  name: '', description: '', date: today(), time: nowTime(), location: '', max_members: 20,
  is_recurring_weekly: false, is_paid: false, ticket_url: '', is_private: false,
  with_deal: false, auto_messages: false,
});

// formatEventDate (UTC, the stored wall-clock) lives in utils/eventDate.js.

// Google Calendar export — see utils/calendarExport.js for the +2h fix.

export const ClubDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isPro } = useContext(AuthContext);
  const toast = useToast();
  const { t, i18n } = useTranslation();
  usePaymentsConfig(); // re-render when the runtime payments config arrives
  const dateLocale = eventDateLocale(i18n.resolvedLanguage || i18n.language);

  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [joinRequestStatus, setJoinRequestStatus] = useState(null);
  // Two rejections used up. Distinct from the status: after ONE rejection the
  // person may still ask again, so the button stays live.
  const [joinBlocked, setJoinBlocked] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showAvatarGate, setShowAvatarGate] = useState(false);
  // Pro gate: non-member non-Pro viewers get only the first 3 members + this
  // flag from the API — clicking the roster opens the ProModal instead.
  const [membersGated, setMembersGated] = useState(false);

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLocked, setEventsLocked] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [eventSubmitting, setEventSubmitting] = useState(false);
  // The free tier of official clubs (Tina 17.11.2026): where this club stands
  // — GET /clubs/:id/event-quota — or null (a community, not yet loaded, an
  // older server): then nothing is checked here and the server decides.
  const [quota, setQuota] = useState(null);
  // The club id whose quota question is settled — answered, failed or never
  // asked (a community). quota === null alone cannot tell „still asking“ from
  // „unknown“, and ?newEvent=1 must wait for the answer.
  const [quotaReadyFor, setQuotaReadyFor] = useState(null);
  const quotaReq = useRef(0);
  const newEventHandled = useRef(null);
  // Tina's partner letter, open with the reason it came up for.
  const [partnerSheet, setPartnerSheet] = useState(null);
  // What the embedded deal form holds: { payload, missing, uploading }.
  const [dealState, setDealState] = useState(null);
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
      const handle = createPlacesAutocomplete(eventLocationRef.current, {
        // No componentRestrictions: Places accepts at most 5 countries and we sell
        // in 6 (utils/regions.js), so the 6-country list could break the whole
        // dropdown. The country is checked when a place is PICKED instead.
        fields: ['formatted_address', 'name', 'address_components'],
      });
      const ac = handle.autocomplete;
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const val = place.formatted_address || place.name || '';
        const country = (place.address_components || []).find(c => c.types?.includes('country'))?.short_name || '';
        if (val && ALLOWED_COUNTRIES.includes(country)) {
          setEventForm(f => ({ ...f, location: val }));
        } else if (val) {
          toast.error(t('createGroup.step2.locationNotATError'));
          setEventForm(f => ({ ...f, location: '' }));
          if (eventLocationRef.current) eventLocationRef.current.value = '';
        }
      });
      eventAutocompleteRef.current = handle;
    };
    const timer = setTimeout(() => onGoogleMapsReady(attach), 50);
    return () => {
      clearTimeout(timer);
      eventAutocompleteRef.current?.dispose();
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
        setJoinBlocked(!!entity.join_request_blocked);
        setIsFavorited((favRes.data || []).some(f => f.id === parseInt(id, 10)));
        const memberData = membersRes.data;
        setMembers(Array.isArray(memberData) ? memberData : (memberData?.members || []));
        setMembersGated(Array.isArray(memberData) ? false : !!memberData?.gated);
        refreshQuota(entity);

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

  // Where the club stands in the free tier. Only an official club has one,
  // and only its members can put up events; everyone else: nothing to ask.
  // Asked after loading, after joining or leaving, and after every event that
  // is created or deleted. Any failure (an older server answers 404, a test
  // mocks the api without it) reads as „unknown“ — the server decides then.
  // The newest question wins: an answer that arrives after a later one was
  // asked (another club opened meanwhile) is dropped.
  const refreshQuota = async (entity = club) => {
    const req = ++quotaReq.current;
    if (!user || !entity || entity.club_type !== 'official' || !entity.is_member) {
      setQuota(null);
      setQuotaReadyFor(id);
      return;
    }
    let next = null;
    try {
      const res = await partnerApi.getEventQuota(id);
      next = res?.data && typeof res.data === 'object' ? res.data : null;
    } catch {
      next = null;
    }
    if (req !== quotaReq.current) return;
    setQuota(next);
    setQuotaReadyFor(id);
  };

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
    // Same confirm as GroupDetail (2026-09-15). leaveClub posts no system
    // message, so the club wording drops that half and keeps the rejoin cap.
    if (isJoined && !window.confirm(t('clubDetail.confirmLeave'))) return;
    try {
      if (isJoined) {
        await clubs.leave(id);
        setIsJoined(false);
        setJoinRequestStatus(null);
        setJoinBlocked(false);
        setMembers(prev => prev.filter(m => m.id !== user.id));
        const r = await clubs.getById(id);
        setClub(r.data);
        setShowCreateEvent(false);
        refreshQuota(r.data);
        await loadEvents();
      } else {
        const res = await clubs.join(id);
        window.dispatchEvent(new Event('jamie:push-prompt-after-join')); // contextual push ask (NotificationPrompt)
        if (res.data?.status === 'pending') {
          setJoinRequestStatus('pending');
          toast.success(t('clubDetail.toast.requestSent'));
        } else {
          setIsJoined(true);
          const r = await clubs.getById(id);
          setClub(r.data);
          refreshQuota(r.data);
          // Now a member → re-fetch the roster. Membership lifts the Pro gate
          // (members see everyone since 2026-10-22); `gated` still comes from
          // the server as-is — it is the only truth.
          const mres = await clubs.getMembers(id).catch(() => null);
          if (mres) {
            const md = mres.data;
            setMembers(Array.isArray(md) ? md : (md?.members || []));
            setMembersGated(Array.isArray(md) ? false : !!md?.gated);
          } else {
            // Fallback (roster request failed): keep the previous gated state —
            // the conservative choice; the next load gets gated:false.
            setMembers(prev => [...prev, { id: user.id, name: user.name, avatar_url: user.avatar_url }]);
          }
          await loadEvents();
        }
      }
    } catch (e) {
      // Server-side avatar gate (2026-08-04) — mirror of GroupDetail.
      if (e.response?.data?.requiresAvatar) { setShowAvatarGate(true); return; }
      if (e.response?.data?.code === 'JOIN_REQUEST_BLOCKED') setJoinBlocked(true);
      // serverErrorMessage, not the raw string: it resolves data.code through
      // the errors.* namespace, which is the only reason this sentence is not
      // German in the four non-German markets.
      toast.error(serverErrorMessage(e, t, 'clubDetail.toast.joinLeaveError'));
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

  // Joining an event from the list lives in ClubEventJoinButton (V-14): it
  // knows „Beitritt anfragen“ / „Anfrage ausstehend…“ and reports its changes
  // back through onChange.
  const handleLeaveEvent = async (eventId) => {
    if (!window.confirm(t('clubDetail.events.confirmLeave'))) return;
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

  // ── The free tier of official clubs (Tina 17.11.2026) ─────────────────
  // Who runs this club (owner or co-manager) gets Tina's partner letter where
  // the free tier says no; a plain member who may create events gets one
  // sentence — the partnership is not theirs to ask for.
  const isOfficialClub = club?.club_type === 'official';
  const managesClub = !!user && !!club && (Number(club.owner_id) === Number(user.id) || !!club.is_manager);
  const partnerStop = (reason) => {
    if (managesClub) setPartnerSheet({ reason });
    else toast.error(t('partner.memberBlocked'));
  };
  // The bars „Deal anlegen“ and „Automatisierte Nachrichten“ of the event
  // form: an official club that is approved, for the people who run it.
  const showsPartnerBars = isOfficialClub && club?.approval_status === 'approved' && managesClub;

  // „+“ and „Erstes Event erstellen“. A club at its limit (a second event
  // while the first is still ahead; the third event) never sees a form that
  // the server would refuse: the letter comes instead.
  const openCreateEvent = () => {
    if (showCreateEvent) { setShowCreateEvent(false); return; }
    if (quota?.block) { partnerStop(quota.block); return; }
    setShowCreateEvent(true);
  };

  // /club/:id?newEvent=1 — where the community nudge („… hat Potenzial! ✨“,
  // card, push and bell) lands: the event form opens by itself, the same way
  // „+“ opens it, so a club at its limit gets the letter instead. Waits for
  // the club and its quota; once per navigation (location.key) — a rerender
  // must not toggle the form shut again. Who may not create events sees the
  // page as always. The parameter leaves the URL either way, so going back or
  // reloading does not open the form a second time.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('newEvent') !== '1') return;
    if (loading || !club || quotaReadyFor !== id) return;
    if (newEventHandled.current === location.key) return;
    newEventHandled.current = location.key;
    const mayCreate = !!user && isJoined && (!club.events_owner_only || managesClub);
    if (mayCreate && !showCreateEvent) {
      openCreateEvent();
      if (!quota?.block) {
        requestAnimationFrame(() => {
          document.querySelector('.cd-events')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        });
      }
    }
    const rest = new URLSearchParams(location.search);
    rest.delete('newEvent');
    navigate(
      { pathname: location.pathname, search: rest.toString() ? `?${rest}` : '', hash: location.hash },
      { replace: true, state: location.state },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the page or its data arrive, not on every render
  }, [location.key, location.search, loading, club, quotaReadyFor, id]);

  // „Kostenfreies Event“ unticked. In a limited official club a ticket event
  // is a partner's (Tina: „würde immer sofort eine Nachricht zu JAMIE Partner
  // kommen“): the letter opens and the tick stays — the event stays free.
  const togglePaid = (free) => {
    if (free) { setEventForm(f => ({ ...f, is_paid: false, ticket_url: '' })); return; }
    if (isOfficialClub && quota?.limited) { partnerStop('ticket'); return; }
    setEventForm(f => ({ ...f, is_paid: true }));
  };

  // Paid events are a Pro feature where the partnership does not cover them
  // (a community; a club while the free tier is off).
  const askForPaidEventsPro = () => {
    if (!proUpsellAllowed()) {
      // Apple 3.1.1: no purchase entry point in the iOS app while iOS sales
      // are off, so the modal never opens there — without this the button
      // would silently do nothing.
      toast.error(t('clubDetail.events.errorProRequired'));
    } else {
      // detail.feature makes the modal lead with the "Kostenpflichtige
      // Events" bubble instead of the generic pitch.
      window.dispatchEvent(new CustomEvent('jamie:open-pro-modal', {
        detail: { feature: 'paidEvents' },
      }));
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!eventForm.name.trim()) { toast.error(t('clubDetail.events.errorNameRequired')); return; }
    if (!eventForm.date) { toast.error(t('clubDetail.events.errorDateRequired')); return; }
    // Pro gate for paid events, enforced here rather than on the checkbox so
    // the user can fill the whole thing in first (Tina/Tobi 2026-09-03).
    // Checked BEFORE the ticket-link check: nagging a non-Pro user about a link
    // they can't use yet is the wrong message — show them the offer instead.
    // The server re-checks (createClubEvent), this is only the UX path.
    // Not in an official club that is not limited — a paying partner, the
    // JAMIE team: there the partnership covers the ticket link, no Pro needed.
    // (Should the server still ask for Pro, the catch below opens the modal.)
    const partnerCoversTickets = isOfficialClub && !!quota && quota.limited === false;
    if (eventForm.is_paid && !isPro && !partnerCoversTickets) {
      askForPaidEventsPro();
      return;
    }
    // A paid event without a ticket link would leave attendees no way to buy.
    if (eventForm.is_paid && !eventForm.ticket_url.trim()) {
      toast.error(t('clubDetail.events.errorTicketRequired'));
      return;
    }
    // „Deal anlegen“ ticked: the deal's own required fields (name, offer,
    // „Sichtbar bis“) — said in the deal form's words, nothing is sent.
    const sendsDeal = showsPartnerBars && eventForm.with_deal;
    if (sendsDeal && (!dealState || dealState.missing.length)) {
      toast.error(t('groupEdit.deals.toast.requiredFields'));
      return;
    }
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
        ticket_url: eventForm.is_paid ? eventForm.ticket_url.trim() : undefined,
        // Only meaningful in a public club; a private club's events are private anyway.
        is_private: club?.is_private ? undefined : eventForm.is_private,
        // The two bars of an official club's form — sent only where they
        // show; everyone else's request stays exactly as it was.
        deal: sendsDeal ? dealState.payload : undefined,
        auto_messages: showsPartnerBars ? eventForm.auto_messages : undefined,
      });
      // The answer carries the event's deal (res.data.deal): the list shows
      // it under the new card at once.
      const newEvent = res.data;
      newEvent.is_member = true;
      setEvents(prev => [newEvent, ...prev].sort((a, b) => new Date(a.date) - new Date(b.date)));
      setShowCreateEvent(false);
      setEventForm(emptyEventForm());
      setDealState(null);
      toast.success(t('clubDetail.events.createdToast'));
      refreshQuota();
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'PARTNER_REQUIRED') {
        // The free tier said no after all (the quota changed since it was
        // read, or it could not be read): the letter for whoever runs the
        // club, one sentence for a member. A ticket event stays a free one in
        // the form; for the event limit the form closes — it cannot be sent.
        refreshQuota();
        if (data.reason === 'ticket') setEventForm(f => ({ ...f, is_paid: false, ticket_url: '' }));
        else if (data.reason !== 'deal') setShowCreateEvent(false);
        partnerStop(data.reason);
      } else if (data?.code === 'PRO_REQUIRED') {
        askForPaidEventsPro();
      } else {
        toast.error(data?.error || t('clubDetail.events.createError'));
      }
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
      refreshQuota();
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
    // iOS ohne Kaufweg: immer zur (limitierten) Liste statt zum Pro-Modal (Apple 3.1.1).
    if (membersGated && proUpsellAllowed()) window.dispatchEvent(new Event('jamie:open-pro-modal'));
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

          {/* ── Events section (primary content) ─────────────────
              ABOVE „Zum Chat“ and „Club teilen“ since 17.11.2026 (Tina, on her
              screenshots of this page: „Hier sollte ‚Events‘ der ganze
              Abschnitt über ‚zum Chat‘ und ‚Club teilen‘ sein“) — for every
              viewer, so a non-member sees the locked events box above „Club
              beitreten“. The actions follow right after the section. */}
          <section className="cd-events">
            <div className="cd-events-header">
              <h3 className="cd-events-title">
                {t('clubDetail.events.title')}
                {events.length > 0 && <span className="cd-events-count">{events.length}</span>}
              </h3>
              {canCreateEvent && (
                <button
                  className="cd-events-add"
                  onClick={openCreateEvent}
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

                {/* Privates Event (Tina 30.09.2026): only in a PUBLIC club — a
                    private club's events are private anyway. Private = join by
                    request, the host approves (server: usesJoinRequest). */}
                {!club.is_private && (
                  <label className="cd-event-recurring">
                    <input
                      type="checkbox"
                      checked={eventForm.is_private}
                      onChange={e => setEventForm(f => ({ ...f, is_private: e.target.checked }))}
                    />
                    <span className="cd-event-recurring-text">
                      <span className="cd-event-recurring-title">{t('clubDetail.events.privateLabel')}</span>
                      <span className="cd-event-recurring-hint">{t('clubDetail.events.privateHint')}</span>
                    </span>
                  </label>
                )}

                {/* Kostenfrei ⇄ kostenpflichtig (Tina/Tobi 2026-09-03). Checked
                    (default) = free; unchecking reveals the external ticket-link
                    field — JAMIE never takes the money, it only links out to the
                    organiser's shop.
                    The Pro gate deliberately sits on SUBMIT, not here: everyone
                    can untick and fill the link in, and only "Event erstellen"
                    opens the Pro modal. Letting people see and complete the
                    feature first sells it far better than a checkbox that
                    refuses to move (and it kills the dead-control feel).
                    Since 17.11.2026 an official club in the free tier gets
                    Tina's partner letter instead (togglePaid) — there the
                    tick stays and no ticket field opens. */}
                <label className={`cd-event-recurring cd-event-paid${eventForm.is_paid ? ' is-paid' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!eventForm.is_paid}
                    onChange={e => togglePaid(e.target.checked)}
                  />
                  <span className="cd-event-recurring-text">
                    <span className="cd-event-recurring-title">
                      {eventForm.is_paid
                        ? t('clubDetail.events.paidLabel')
                        : t('clubDetail.events.freeLabel')}
                    </span>
                    <span className="cd-event-recurring-hint">
                      {eventForm.is_paid
                        ? t('clubDetail.events.paidHint')
                        : t('clubDetail.events.freeHint')}
                    </span>
                  </span>
                </label>

                {eventForm.is_paid && (
                  <div className="cd-event-ticket-banner">
                    <label className="cd-event-ticket-label" htmlFor="cd-ticket-url">
                      🎟️ {t('clubDetail.events.ticketLinkLabel')}
                    </label>
                    <input
                      id="cd-ticket-url"
                      className="cd-event-input cd-event-ticket-input"
                      // NOT type="url": this input lives inside a <form>, so
                      // native constraint validation would reject a bare
                      // "shop.example.com/tickets" before submit — exactly the
                      // scheme-less paste normalizeTicketUrl deliberately
                      // upgrades to https://. Server-side validation still runs.
                      type="text"
                      inputMode="url"
                      placeholder={t('clubDetail.events.ticketLinkPlaceholder')}
                      value={eventForm.ticket_url}
                      onChange={e => setEventForm(f => ({ ...f, ticket_url: e.target.value }))}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck="false"
                    />
                    <span className="cd-event-ticket-hint">{t('clubDetail.events.ticketLinkHint')}</span>
                  </div>
                )}

                {/* „Deal anlegen“ (Tina 17.11.2026): „Unter ‚Kostenfreies
                    Event‘ noch einen Balken in dem Stil … Normal kein Haken
                    dort voreingestellt. Wenn man den Haken setzt, dann öffnet
                    sich nochmal ein Feld, wo man die Deal Infos reingibt inkl.
                    wann der Deal angezeigt werden soll, eh wie wir es hatten.“
                    One deal per event; it shows at the event, never in the
                    Gruppen feed. „Sichtbar bis“ starts out as the event's date. */}
                {showsPartnerBars && (
                  <label className="cd-event-recurring">
                    <input
                      type="checkbox"
                      checked={eventForm.with_deal}
                      onChange={e => {
                        setEventForm(f => ({ ...f, with_deal: e.target.checked }));
                        if (!e.target.checked) setDealState(null);
                      }}
                    />
                    <span className="cd-event-recurring-text">
                      <span className="cd-event-recurring-title">{t('clubDetail.events.dealLabel')}</span>
                      <span className="cd-event-recurring-hint">{t('clubDetail.events.dealHint')}</span>
                    </span>
                  </label>
                )}
                {showsPartnerBars && eventForm.with_deal && (
                  <DealForm
                    variant="club"
                    look="event"
                    embedded
                    title={t('clubDetail.events.dealPanelTitle')}
                    defaults={{ name: club.name || '', visible_until: eventForm.date }}
                    onChange={setDealState}
                  />
                )}

                {/* „Automatisierte Nachrichten“ (Tina 17.11.2026): „Unter ‚Deal
                    anlegen‘ kommt noch ein Balken … die sind nicht angehakt.“
                    Ticked, the event's chat gets the four messages in the
                    club's name (welcome, the day before, two hours before,
                    the day after). */}
                {showsPartnerBars && (
                  <label className="cd-event-recurring">
                    <input
                      type="checkbox"
                      checked={eventForm.auto_messages}
                      onChange={e => setEventForm(f => ({ ...f, auto_messages: e.target.checked }))}
                    />
                    <span className="cd-event-recurring-text">
                      <span className="cd-event-recurring-title">{t('clubDetail.events.autoMessagesLabel')}</span>
                      <span className="cd-event-recurring-hint">{t('clubDetail.events.autoMessagesHint')}</span>
                    </span>
                  </label>
                )}

                {/* While the deal's photo is still uploading the event waits:
                    it would be saved without the photo otherwise. */}
                <button
                  type="submit"
                  className="cd-event-submit-btn"
                  disabled={eventSubmitting || (showsPartnerBars && eventForm.with_deal && !!dealState?.uploading)}
                >
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
                  <button className="cd-events-empty-cta" onClick={openCreateEvent}>
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
                  // The event's deal sits UNDER its card (Tina 16.11.2026: „Er
                  // wird auch nochmal bei den Clubs unter dem Event
                  // angezeigt“) — the same row as on the event page, a sibling
                  // of the card and not inside its click target: a tap opens
                  // the deal, not the event. An interim layout until Tina's
                  // design for this page is in. The server embeds ev.deal
                  // (getClubEvents); a new event brings it in its answer.
                  return (
                    <div key={ev.id} className="cd-event-item">
                    <div className="cd-event-card" onClick={() => navigate(`/group/${ev.id}`)}>
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
                          <ClubEventJoinButton
                            ev={ev}
                            user={user}
                            onChange={(patch) => setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, ...patch } : e)))}
                            onNeedAvatar={() => setShowAvatarGate(true)}
                            onNeedLogin={() => navigate('/login')}
                          />
                        )}
                      </div>
                    </div>
                    <EventDealRow deal={ev.deal} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Primary action — below the events since 17.11.2026 (see above). */}
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
            ) : joinBlocked ? (
              <button className="cd-btn cd-btn-disabled" disabled>
                {t('clubDetail.actions.rejected')}
              </button>
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

          {/* Owner actions. „Club boosten“ — the gold button that stood here
              for every owner — is gone for good (Tina 17.11.2026: „Club
              boosten ganz weggeben. Allgemein die gelben Balken weg!“, her
              screenshot of this very button). Boosting a club is no part of
              the app any more; the boost on a group's page stays. */}
          {isOwner && (
            <div className="cd-owner-actions">
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
      <AvatarGateModal isOpen={showAvatarGate} onClose={() => setShowAvatarGate(false)} />
      {/* Tina's partner letter with „Ja, meldet euch!“ → „JAMIE Anfrage“. */}
      {partnerSheet && (
        <PartnerInviteSheet
          reason={partnerSheet.reason}
          clubId={id}
          clubName={club.name || ''}
          onClose={() => setPartnerSheet(null)}
        />
      )}
    </div>
  );
};

export default ClubDetail;
