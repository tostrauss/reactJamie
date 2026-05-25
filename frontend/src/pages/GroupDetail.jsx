import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { groups, clubs } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ReportModal } from '../components/ReportModal';
import '../styles/group-detail.css';

const formatHeaderDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const weekday = d.toLocaleDateString('de-AT', { weekday: 'long' });
  const day = d.getDate();
  const month = d.getMonth() + 1;
  return `${weekday} - ${day}.${month}.`;
};

const formatShortDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return `${d.getDate()}.${d.getMonth() + 1}.`;
};

const formatEventDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const day = d.getDate();
  const month = d.toLocaleDateString('de-AT', { month: 'short' });
  const time = d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
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

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [joinRequestStatus, setJoinRequestStatus] = useState(null);
  const [waitlistStatus, setWaitlistStatus] = useState(null);
  const [waitlistPosition, setWaitlistPosition] = useState(null);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

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
        setMembers(membersRes.data || []);

        if (isClubType) {
          setEventsLoading(true);
          clubs.getEvents(id)
            .then(r => { if (!controller.signal.aborted) setEvents(r.data || []); })
            .catch(() => {})
            .finally(() => { if (!controller.signal.aborted) setEventsLoading(false); });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error('Gruppe konnte nicht geladen werden');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    fetchData();
    return () => controller.abort();
  }, [id]);

  const handleFavoriteToggle = async () => {
    const wasFav = isFavorited;
    setIsFavorited(!wasFav);
    try {
      group?.type === 'club' ? await clubs.toggleFavorite(id) : await groups.toggleFavorite(id);
    } catch {
      setIsFavorited(wasFav);
      toast.error('Favorit konnte nicht gespeichert werden');
    }
  };

  const handleJoinToggle = async () => {
    try {
      const isClub = group?.type === 'club';
      if (isJoined) {
        isClub ? await clubs.leave(id) : await groups.leave(id);
        setIsJoined(false);
        setJoinRequestStatus(null);
        setMembers(prev => prev.filter(m => m.id !== user.id));
        const response = isClub ? await clubs.getById(id) : await groups.getById(id);
        setGroup(response.data);
      } else {
        const res = isClub ? await clubs.join(id) : await groups.join(id);
        if (res.data?.status === 'pending') {
          setJoinRequestStatus('pending');
          toast.success('Beitrittsanfrage gesendet');
        } else {
          setIsJoined(true);
          setMembers(prev => [...prev, { id: user.id, name: user.name, avatar_url: user.avatar_url }]);
          const response = isClub ? await clubs.getById(id) : await groups.getById(id);
          setGroup(response.data);
        }
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Fehler beim Beitreten/Verlassen');
    }
  };

  const handleJoinWaitlist = async () => {
    setWaitlistLoading(true);
    try {
      const isClub = group?.type === 'club';
      const res = isClub ? await clubs.joinWaitlist(id) : await groups.joinWaitlist(id);
      setWaitlistStatus('waiting');
      setWaitlistPosition(res.data?.position || null);
      toast.success(`Du stehst auf der Warteliste${res.data?.position ? ` (Position ${res.data.position})` : ''}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler bei der Warteliste');
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
      toast.success('Von der Warteliste entfernt');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler beim Entfernen');
    } finally {
      setWaitlistLoading(false);
    }
  };

  const handleDelete = async () => {
    const label = group?.type === 'club' ? 'Club' : 'Gruppe';
    if (!window.confirm(`${label} wirklich löschen?`)) return;
    try {
      group?.type === 'club' ? await clubs.delete(id) : await groups.delete(id);
      toast.success(`${label} wurde gelöscht.`);
      navigate('/home');
    } catch (error) {
      toast.error(error.response?.data?.error || `${label} konnte nicht gelöscht werden.`);
    }
  };

  const handleJoinEvent = async (eventId) => {
    if (!user) { navigate('/login'); return; }
    setJoiningEventId(eventId);
    try {
      const res = await groups.join(eventId);
      if (res.data?.status === 'pending') {
        toast.success('Anfrage gesendet');
      } else {
        toast.success('Erfolgreich beigetreten!');
        setEvents(prev => prev.map(e =>
          e.id === eventId
            ? { ...e, is_member: true, members_count: (e.members_count || 0) + 1 }
            : e
        ));
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler beim Beitreten');
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
      toast.error(err.response?.data?.error || 'Fehler beim Verlassen');
    } finally {
      setJoiningEventId(null);
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!eventForm.name.trim()) { toast.error('Name ist erforderlich'); return; }
    if (!eventForm.date) { toast.error('Datum ist erforderlich'); return; }
    const eventDateTime = new Date(`${eventForm.date}T${eventForm.time || '00:00'}`);
    if (eventDateTime <= new Date()) { toast.error('Das Datum muss in der Zukunft liegen'); return; }
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
      toast.success('Veranstaltung erstellt!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler beim Erstellen');
    } finally {
      setEventSubmitting(false);
    }
  };

  const handleDeleteEvent = async (eventId) => {
    if (!window.confirm('Veranstaltung wirklich löschen?')) return;
    try {
      await clubs.deleteEvent(id, eventId);
      setEvents(prev => prev.filter(e => e.id !== eventId));
      toast.success('Veranstaltung gelöscht');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler beim Löschen');
    }
  };

  if (loading) return <div className="gd-loading">Laden...</div>;
  if (!group) return <div className="gd-loading">Gruppe nicht gefunden</div>;

  const isClub = group.type === 'club';
  const isEvent = group.type === 'event';
  const isOwner = user && group.owner_id === user.id;
  const isMember = isJoined;
  const canCreateEvent = isClub && user && isMember;
  const maxSlots = Math.min(group.max_members || 4, 4);
  const filledSlots = members.slice(0, maxSlots);
  const emptySlots = Math.max(0, maxSlots - filledSlots.length);
  const headerDate = formatHeaderDate(group.date);
  const shortDate = formatShortDate(group.date);

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
              : (headerDate || (group.category || group.name))
            }
          </h1>
          <button
            className={`gd-fav-top${isFavorited ? ' active' : ''}`}
            onClick={handleFavoriteToggle}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorited ? '#FD7666' : 'none'} stroke={isFavorited ? '#FD7666' : 'currentColor'} strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
        </div>

        {/* "Part of club" chip — shown only for events */}
        {isEvent && group.parent_club_id && (
          <button
            className="gd-club-back-chip"
            onClick={() => navigate(`/group/${group.parent_club_id}`)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Zum Club
          </button>
        )}

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
                  {member.age && <span className="gd-photo-age">{member.age}</span>}
                  <div className="gd-photo-bottom">
                    <span className="gd-photo-name">{(member.name || '').toUpperCase()}</span>
                    {member.is_trusted_user && (
                      <span className="gd-photo-check">✓</span>
                    )}
                  </div>
                </div>
              ))}
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
          if (isJoined) {
            return (
              <div className="gd-anfragen-row">
                <button className="gd-anfragen-btn joined" onClick={() => navigate(`/chat/${group.id}`)}>
                  Chat öffnen
                </button>
              </div>
            );
          }
          if (joinRequestStatus === 'pending') {
            return (
              <div className="gd-anfragen-row">
                <button className="gd-anfragen-btn" disabled style={{ opacity: 0.6, cursor: 'default' }}>
                  Anfrage ausstehend…
                </button>
              </div>
            );
          }
          if (waitlistStatus === 'notified') {
            return (
              <div className="gd-anfragen-row" style={{ flexDirection: 'column', gap: '8px' }}>
                <button className="gd-anfragen-btn" onClick={handleJoinToggle}>
                  🎉 Platz frei – Jetzt beitreten!
                </button>
                <button onClick={handleLeaveWaitlist} disabled={waitlistLoading} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', padding: '4px' }}>
                  Von Warteliste entfernen
                </button>
              </div>
            );
          }
          if (waitlistStatus === 'waiting') {
            return (
              <div className="gd-anfragen-row" style={{ flexDirection: 'column', gap: '8px' }}>
                <button className="gd-anfragen-btn" disabled style={{ opacity: 0.6, cursor: 'default' }}>
                  Warteliste{waitlistPosition ? ` · Position ${waitlistPosition}` : ''}
                </button>
                <button onClick={handleLeaveWaitlist} disabled={waitlistLoading} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', padding: '4px' }}>
                  {waitlistLoading ? 'Laden…' : 'Von Warteliste entfernen'}
                </button>
              </div>
            );
          }
          if (isFull) {
            return (
              <div className="gd-anfragen-row">
                <button className="gd-anfragen-btn" onClick={handleJoinWaitlist} disabled={waitlistLoading}>
                  {waitlistLoading ? 'Laden…' : 'Warteliste beitreten'}
                </button>
              </div>
            );
          }
          return (
            <div className="gd-anfragen-row">
              <button className="gd-anfragen-btn" onClick={handleJoinToggle}>
                {group.is_private ? 'Beitritt anfragen' : 'Anfragen'}
              </button>
            </div>
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
                  Level: {group.skill_level}
                </span>
              )}
              {shortDate && (
                <span className="gd-info-item">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  Wann: {shortDate}
                </span>
              )}
              <span className="gd-info-item">
                Teilnehmer: {group.members_count ?? members.length}/{group.max_members || '∞'}
              </span>
            </div>

            {/* Group title */}
            <h2 className="gd-group-title">{group.category || group.name || group.title}</h2>

            {/* Description */}
            {group.description && (
              <p className="gd-description">{group.description}</p>
            )}

            {/* Owner actions */}
            {isJoined && (
              <div className="gd-owner-actions">
                {isOwner
                  ? <button className="gd-btn-leave" onClick={handleDelete}>{isClub ? 'Club löschen' : isEvent ? 'Veranstaltung löschen' : 'Gruppe löschen'}</button>
                  : <button className="gd-btn-leave" onClick={handleJoinToggle}>Verlassen</button>
                }
              </div>
            )}

            <button className="gd-report-btn" onClick={() => setShowReportModal(true)}>
              {isClub ? 'Club melden' : 'Gruppe melden'}
            </button>
          </div>

          {/* ── Club Events Section ─────────────────────────────────── */}
          {isClub && (
            <div className="gd-events-section">
              <div className="gd-events-header">
                <h3 className="gd-events-title">Veranstaltungen</h3>
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
                    placeholder="Name der Veranstaltung *"
                    value={eventForm.name}
                    onChange={e => setEventForm(f => ({ ...f, name: e.target.value }))}
                    required
                  />
                  <textarea
                    className="gd-event-input gd-event-textarea"
                    placeholder="Beschreibung (optional)"
                    value={eventForm.description}
                    onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                  />
                  <div className="gd-event-row">
                    <input
                      className="gd-event-input"
                      type="date"
                      value={eventForm.date}
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
                      placeholder="Ort (optional)"
                      value={eventForm.location}
                      onChange={e => setEventForm(f => ({ ...f, location: e.target.value }))}
                    />
                    <input
                      className="gd-event-input gd-event-input--sm"
                      type="number"
                      min={2}
                      max={500}
                      placeholder="Max"
                      value={eventForm.max_members}
                      onChange={e => setEventForm(f => ({ ...f, max_members: e.target.value }))}
                    />
                  </div>
                  <button
                    type="submit"
                    className="gd-event-submit-btn"
                    disabled={eventSubmitting}
                  >
                    {eventSubmitting ? 'Wird erstellt…' : 'Veranstaltung erstellen'}
                  </button>
                </form>
              )}

              {/* Event list */}
              {eventsLoading ? (
                <p className="gd-events-empty">Laden…</p>
              ) : events.length === 0 ? (
                <p className="gd-events-empty">Noch keine Veranstaltungen</p>
              ) : (
                <div className="gd-events-list">
                  {events.map(ev => {
                    const dateParts = formatEventDate(ev.date);
                    const evIsOwner = user && ev.owner_id === user.id;
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
                          {dateParts?.time && <p className="gd-event-time">{dateParts.time} Uhr{ev.location ? ` · ${ev.location}` : ''}</p>}
                          <p className="gd-event-meta">{ev.members_count || 0} / {ev.max_members} Teilnehmer</p>
                        </div>
                        <div className="gd-event-actions" onClick={e => e.stopPropagation()}>
                          {evIsOwner ? (
                            <button
                              className="gd-event-join-btn gd-event-join-btn--danger"
                              onClick={() => handleDeleteEvent(ev.id)}
                            >
                              Löschen
                            </button>
                          ) : ev.is_member ? (
                            <button
                              className="gd-event-join-btn gd-event-join-btn--joined"
                              disabled={joiningEventId === ev.id}
                              onClick={() => handleLeaveEvent(ev.id)}
                            >
                              Dabei
                            </button>
                          ) : (
                            <button
                              className="gd-event-join-btn"
                              disabled={joiningEventId === ev.id}
                              onClick={() => handleJoinEvent(ev.id)}
                            >
                              {joiningEventId === ev.id ? '…' : 'Mitmachen'}
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

          {/* Share button */}
          <div className="gd-bottom-actions">
            <button className="gd-action-pill" onClick={() => {
              if (navigator.share) {
                navigator.share({ title: group.category || group.name, url: window.location.href });
              } else {
                navigator.clipboard.writeText(window.location.href);
                toast.success('Link kopiert!');
              }
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              Teilen
            </button>
          </div>
        </div>
      </div>

      {showReportModal && (
        <ReportModal
          type="group"
          id={parseInt(id)}
          name={group.name || group.title}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
};

export default GroupDetail;
