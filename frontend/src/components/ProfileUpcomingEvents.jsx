import { useEffect, useId, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext';
import { groups as groupsApi } from '../utils/api';
import { eventDateLocale, formatEventDate } from '../utils/eventDate';
import { utcDayStart, viennaTodayUTC } from '../utils/recurrence';
import PartnerBadge from './PartnerBadge';

// Rows in view before „Alle anzeigen (N)“ — the server sends at most 30.
const FIRST_ROWS = 3;

// The subline's type is the server's (kind); a server without it gets the
// same rule here (groupController upcomingKind): the partner flag, else an
// event of an official club is a Club's, any other club event a Community's.
const kindOf = (row) => row.kind || (row.is_partner ? 'partner'
  : row.type === 'event' ? (row.parent_club_type === 'official' ? 'club' : 'community') : 'group');

// The word before „· 8/20“ where there is no ☆ Partner badge.
const TYPE_LABEL = {
  club: 'profile.upcoming.typeClub',
  community: 'profile.upcoming.typeCommunity',
};

// „Demnächst dabei“ in the own profile (Tina 16.11.2026, PR4/PR5), under the
// „Clubs & Communities“ bubbles in the same card: every meetup and club event
// the user created or was let into, next one first. What still counts is the
// server's call (GET /groups/user/upcoming): until the end of its Vienna day,
// weekly series on their next date, cancelled ones gone.
//
// A row: the date tile (UTC — the stored Vienna wall-clock, utils/eventDate),
// „Heute“ beside the title in coral, „☆ Partner · 8/20“ / „Club · 8/20“ (an
// official club's event that is no partner event) / „Community · 8/20“ /
// „Gruppe · 8/20“ under it. Own entries are framed in the partner yellow and
// carry the coral counter of open requests the old hub's chip used to show.
// „Zum Chat“ on every row; the chat's back button then leads to the profile
// again, on the tab it was on (state.from, see ChatPage). A tap on the row
// opens the event.
//
// „Events bearbeiten“ — only when at least one entry may be edited (can_edit,
// the edit endpoints' own rule): those rows wiggle and a tap opens their edit
// page; the others are dimmed and say why. Nothing moves, nothing is saved —
// the wiggle only shows the mode. The mode lives in Profile, ONE for the card
// (see ProfileClubBubbles): `editing` in, `onEditingChange` out.
export default function ProfileUpcomingEvents({ editing = false, onEditingChange }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const uid = useId();
  const [rows, setRows] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    groupsApi.getUpcoming()
      .then((res) => { if (!cancelled) setRows(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  if (!rows || rows.length === 0) return null;

  const canEdit = rows.some((row) => row.can_edit);
  // In the mode every row is in view — an editable one may sit further down.
  const shown = showAll || editing ? rows : rows.slice(0, FIRST_ROWS);
  const locale = eventDateLocale(i18n.resolvedLanguage || i18n.language);
  const today = viennaTodayUTC();

  const onOpen = (row) => {
    if (!editing) navigate(`/group/${row.id}`);
    else if (row.can_edit) navigate(`/group/${row.id}/edit`);
    else toast.info(t('profile.upcoming.locked'));
  };

  const renderRow = (row) => {
    const when = row.next_at || row.date;
    const date = formatEventDate(when, locale);
    const isToday = !!date && utcDayStart(new Date(when)) === today;
    const kind = kindOf(row);
    const editable = editing && !!row.can_edit;
    const locked = editing && !row.can_edit;
    const requests = row.is_own && !editing ? (row.pending_request_count || 0) : 0;
    const current = row.members_count || 0;
    const cls = ['profile-upcoming-row', row.is_own && 'is-own', isToday && 'is-today', editable && 'is-wiggling', locked && 'is-locked']
      .filter(Boolean).join(' ');
    return (
      <li key={row.id} className={cls}>
        <button
          type="button"
          className="profile-upcoming-open"
          onClick={() => onOpen(row)}
          aria-label={editable ? t('profile.upcoming.editAria', { name: row.name }) : undefined}
          aria-disabled={locked || undefined}
        >
          <span className={`profile-upcoming-tile${date ? '' : ' is-empty'}`}>
            <span className="profile-upcoming-day">{date ? date.day : '?'}</span>
            {date && <span className="profile-upcoming-month">{date.month}</span>}
          </span>
          <span className="profile-upcoming-text">
            <span className="profile-upcoming-head">
              <span className="profile-upcoming-name">{row.name}</span>
              {isToday && <span className="profile-upcoming-today">{t('groups.card.dateHeute')}</span>}
            </span>
            <span className="profile-upcoming-sub">
              {kind === 'partner' ? (
                <PartnerBadge variant="inline" />
              ) : (
                <span>{t(TYPE_LABEL[kind] || 'profile.upcoming.typeGroup')}</span>
              )}
              {/* „8/20“ as in Tina's mock; screen readers get the app's
                  participants phrase instead. */}
              <span aria-hidden="true">· {row.max_members ? `${current}/${row.max_members}` : current}</span>
              <span className="sr-only">
                {row.max_members
                  ? t('clubDetail.events.participants', { current, max: row.max_members })
                  : t('groups.detail.membersTeaser.count', { count: current })}
              </span>
            </span>
          </span>
          {row.is_own && <span className="sr-only">{t('profile.clubs.ownAria')}</span>}
        </button>
        {requests > 0 && (
          <button
            type="button"
            className="profile-upcoming-requests"
            onClick={() => navigate('/chats?tab=anfragen')}
            aria-label={t('profile.clubs.requestsAria', { count: requests, name: row.name })}
          >
            {requests > 99 ? '99+' : requests}
          </button>
        )}
        {!editing && (
          <button
            type="button"
            className="profile-upcoming-chat"
            // The card shows on both profile tabs — back to the one it was on.
            onClick={() => navigate(`/chat/${row.id}`, { state: { from: location.pathname + location.search } })}
            aria-label={t('profile.upcoming.chatAria', { name: row.name })}
          >
            {t('profile.upcoming.toChat')}
          </button>
        )}
        {/* In the mode the edit glyph stands where „Zum Chat“ was — the sign
            that does not move (prefers-reduced-motion stops the wiggle). */}
        {editable && (
          <span className="profile-upcoming-pencil" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </span>
        )}
      </li>
    );
  };

  return (
    <section className="profile-upcoming" aria-labelledby={`${uid}-title`}>
      <div className="profile-section-head">
        <h3 id={`${uid}-title`} className="profile-section-title">{t('profile.upcoming.title')}</h3>
        {(canEdit || editing) && (
          <button
            type="button"
            className={`profile-section-action${editing ? ' is-active' : ''}`}
            onClick={() => onEditingChange?.(!editing)}
          >
            {editing ? t('profile.upcoming.done') : t('profile.upcoming.edit')}
          </button>
        )}
      </div>
      {editing && <p className="profile-upcoming-hint">{t('profile.upcoming.editHint')}</p>}
      <ul className="profile-upcoming-list">
        {shown.map(renderRow)}
      </ul>
      {shown.length < rows.length && (
        <button type="button" className="profile-upcoming-more" onClick={() => setShowAll(true)}>
          {t('profile.upcoming.showAll', { count: rows.length })}
        </button>
      )}
    </section>
  );
}
