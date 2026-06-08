import React, { useState, useEffect, useContext, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clubs } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ReportModal } from '../components/ReportModal';
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
  return {
    day: d.getDate(),
    month: d.toLocaleDateString(locale, { month: 'short' }),
    time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
  };
};

const toCalDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const openCalendar = (ev) => {
  const start = new Date(ev.date);
  if (isNaN(start)) return;
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const title = encodeURIComponent(ev.name || 'JAMIE Event');
  const details = encodeURIComponent(ev.description || '');
  const loc = encodeURIComponent(ev.location || '');
  const startStr = toCalDate(start);
  const endStr = toCalDate(end);

  if (isNativeIOS()) {
    const icalEscape = (s) => String(s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JAMIE//JAMIE App//DE', 'BEGIN:VEVENT',
      `DTSTART:${startStr}`, `DTEND:${endStr}`,
      `SUMMARY:${icalEscape(ev.name || 'JAMIE Event')}`,
      ev.description ? `DESCRIPTION:${icalEscape(ev.description)}` : '',
      ev.location ? `LOCATION:${icalEscape(ev.location)}` : '',
      `URL:${icalEscape(window.location.href)}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jamie-event.ics';
    a.click();
    URL.revokeObjectURL(url);
  } else {
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startStr}/${endStr}&details=${details}&location=${loc}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

export const ClubDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-AT';

  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [joinRequestStatus, setJoinRequestStatus] = useState(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showBoostModal, setShowBoostModal] = useState(false);

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLocked, setEventsLocked] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [eventForm, setEventForm] = useState({ name: '', description: '', date: today(), time: nowTime(), location: '', max_members: 20 });
  const [eventSubmitting, setEventSubmitting] = useState(false);
  const [joiningEventId, setJoiningEventId] = useState(null);

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

  const handleJoinToggle = async () => {
    try {
      if (isJoined) {
        await clubs.leave(id);
        setIsJoined(false);
        setJoinRequestStatus(null);
        setMembers(prev => prev.filter(m => m.id !== user.id));
        const r = await clubs.getById(id);
        setClub(r.data);
      } else {
        const res = await clubs.join(id);
        if (res.data?.status === 'pending') {
          setJoinRequestStatus('pending');
          toast.success(t('clubDetail.toast.requestSent'));
        } else {
          setIsJoined(true);
          setMembers(prev => [...prev, { id: user.id, name: user.name, avatar_url: user.avatar_url }]);
          const r = await clubs.getById(id);
          setClub(r.data);
        }
      }
    } catch (e) {
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
    const eventDateTime = new Date(`${eventForm.date}T${eventForm.time || '00:00'}`);
    if (eventDateTime <= new Date()) { toast.error(t('clubDetail.events.errorDateFuture')); return; }
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

  const isOwner = user && club.owner_id === user.id;
  const isMember = isJoined;
  // Owner-only setting (from the founder's club settings) restricts event
  // creation to the owner. Members can still see the events list.
  const canCreateEvent = user && isMember && (!club.events_owner_only || isOwner);
  const membersCount = club.members_count || members.length || 0;
  const visibleMembers = members.slice(0, 20);
  const overflowMembers = Math.max(0, membersCount - visibleMembers.length);

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
                  onClick={() => navigate(`/user/${m.id}`)}
                  aria-label={m.name || 'Mitglied'}
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
                <div className="cd-member-more">+{overflowMembers}</div>
              )}
            </div>
          </div>
        )}

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="cd-body">
          <div className="cd-title-row">
            <h2 className="cd-title">{club.name || club.title}</h2>
            {club.category && <span className="cd-category">{club.category}</span>}
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
                <button className="cd-btn cd-btn-ghost" onClick={handleJoinToggle}>
                  {t('clubDetail.actions.leave')}
                </button>
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
          </div>

          {/* ── Members section ────────────────────────────────── */}
          {members.length > 0 && (
            <section className="cd-members-section">
              <div className="cd-section-header">
                <h3 className="cd-section-title">
                  {t('clubDetail.members.title')}
                  <span className="cd-section-count">{membersCount}</span>
                </h3>
                {membersCount > 10 && (
                  <button
                    className="cd-section-link"
                    onClick={() => navigate(`/club/${id}/members`)}
                  >
                    {t('clubDetail.members.seeAll')}
                  </button>
                )}
              </div>
              <div className="cd-members-list">
                {members.slice(0, 10).map(m => (
                  <button
                    key={m.id}
                    className="cd-member-row"
                    onClick={() => navigate(`/user/${m.id}`)}
                  >
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt={m.name || ''} className="cd-member-row-avatar" loading="lazy" decoding="async" />
                    ) : (
                      <div className="cd-member-row-avatar cd-member-row-avatar--placeholder">
                        {(m.name || '?')[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="cd-member-row-info">
                      <span className="cd-member-row-name">{m.name || t('clubDetail.members.unknownName')}</span>
                      {club.owner_id === m.id && (
                        <span className="cd-member-row-tag">{t('clubDetail.members.ownerTag')}</span>
                      )}
                    </div>
                    {m.is_trusted_user && (
                      <span className="cd-member-row-trusted" aria-label={t('clubDetail.members.trusted')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20,6 9,17 4,12"/>
                        </svg>
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {membersCount > 10 && (
                <button
                  className="cd-members-see-all-btn"
                  onClick={() => navigate(`/club/${id}/members`)}
                >
                  {t('clubDetail.members.seeAllFull', { count: membersCount })}
                </button>
              )}
            </section>
          )}

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
                    className="cd-event-input"
                    type="text"
                    placeholder={t('clubDetail.events.formLocationPlaceholder')}
                    value={eventForm.location}
                    onChange={e => setEventForm(f => ({ ...f, location: e.target.value }))}
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
                  const dateParts = formatEventDate(ev.date, dateLocale);
                  const evIsOwner = user && ev.owner_id === user.id;
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
                        <p className="cd-event-name">{ev.name}</p>
                        {dateParts?.time && (
                          <p className="cd-event-time">
                            {dateParts.time} {t('clubDetail.events.uhr')}
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
            groupId={parseInt(id, 10)}
            groupName={club.name}
            onClose={() => setShowBoostModal(false)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default ClubDetail;
