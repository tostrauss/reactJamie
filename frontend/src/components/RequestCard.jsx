import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import VerifiedBadge from './VerifiedBadge';
import { AttendanceTierBadge } from './AttendanceTierBadge';
import PartnerBadge from './PartnerBadge';
import { thumbUrl } from '../utils/images';
import { eventDateLocale, formatEventDate } from '../utils/eventDate';
import { nextOccurrence, utcDayStart, viennaTodayUTC } from '../utils/recurrence';

// The card of the Anfragen swipe deck (Chat → Anfragen, ChatList): join
// requests from GET /groups/user/requests and, since 18.10.2026, friend
// requests (kind 'friend', mapped onto the same user_* fields there). The
// overview page /group/:id/requests draws its own rows, not this card.
// Styling lives in chat.css (.request-*), the single source of truth —
// import it wherever this card is used.
//
// Ziel 4 (Tina 16.11.2026): WHAT a card is has to be clear while swiping, so
// the type sits IN the card and moves with it — a band on top and a 2px frame
// in the type's colour: coral for a group or event, the club purple for a
// club or community, the partner yellow for a partner's event, neutral for a
// friend request. A join card's band names the group or event, its type and
// date, with its picture (an event without one shows its club's). A payload
// with neither kind nor group (an old server) gets no band, as before.

// What a join request is for — the server's facts only (getAllJoinRequests):
// a club by its own club_type, an event by its club's (parent_club_type; the
// event row's own club_type is always NULL) and the one partner rule
// (is_partner, backend utils/clubGate.js partnerSql). NULL reads as community.
const joinKindOf = (r) => {
  if (r.group_type === 'club') return r.group_club_type === 'official' ? 'club' : 'community';
  if (r.group_type === 'event') {
    if (r.is_partner) return 'partner';
    if (r.parent_club_type === 'official') return 'clubEvent';
    return r.parent_club_id ? 'communityEvent' : 'event';
  }
  return 'group';
};

const KIND_LABEL = {
  group: 'chat.list.filters.groupOne',
  event: 'chat.list.filters.eventOne',
  clubEvent: 'chat.list.filters.clubEventOne',
  communityEvent: 'chat.list.filters.communityEventOne',
  club: 'chat.list.filters.clubOne',
  community: 'chat.list.filters.communityOne',
};

const toneOf = (kind) => {
  if (kind === 'partner') return 'partner';
  return kind === 'club' || kind === 'community' ? 'club' : 'group';
};

// „Heute“, „Morgen“ or „21. Nov.“ — with the time when one was set
// („21. Nov., 19:00“; meetups carry none since 09.06., they sit at 00:00).
// No weekday: it shares a line with the type chip, also in it/fr/es. The
// stored Vienna wall-clock comes back tagged UTC, so only the UTC reading
// holds what the creator typed (utils/eventDate, recurrence.js); a weekly
// series shows its next date. A club's date is a "next meetup" note and never
// the request's, so clubs get none.
const bandDate = (r, locale, t) => {
  if (r.group_type === 'club') return null;
  const d = nextOccurrence({ date: r.group_date, is_recurring_weekly: r.group_recurring });
  if (!d) return null;
  const days = Math.round((utcDayStart(d) - viennaTodayUTC()) / 86400000);
  const day = days === 0 ? t('groups.card.dateHeute')
    : days === 1 ? t('groups.card.dateMorgen')
    : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (!d.getUTCHours() && !d.getUTCMinutes()) return day;
  return `${day}, ${formatEventDate(d.toISOString(), locale).time}`;
};

export function RequestCard({ request }) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  // Age: the server-computed one only. The payload no longer carries the
  // birth date (an owner is a stranger to the asker — 2026-10), and the old
  // 365.25-day client calc got ages wrong around birthdays anyway.
  const age = request.user_age ?? null;

  let interests = [];
  try {
    interests = request.user_interests
      ? (typeof request.user_interests === 'string' ? JSON.parse(request.user_interests) : request.user_interests)
      : [];
  } catch { /* malformed interests JSON — just show none */ }
  // Parsed-but-not-an-array (object/number from a legacy row) would throw on
  // .slice().map below and take down the whole requests deck.
  if (!Array.isArray(interests)) interests = [];

  const isFriend = request.kind === 'friend';
  const kind = !isFriend && request.group_type ? joinKindOf(request) : null;
  const tone = isFriend ? 'friend' : kind ? toneOf(kind) : null;
  const date = kind ? bandDate(request, eventDateLocale(i18n.resolvedLanguage || i18n.language), t) : null;
  const thumb = request.group_image || request.parent_club_image || null;

  return (
    <div className={`request-card${tone ? ` request-card--typed request-card--${tone}` : ''}`}>
      {/* Three lines for a join request — what it is, for which group or
          event, its type and date — so even the long it/fr/es labels each
          get a line of their own; two for a friend request. */}
      {isFriend && (
        <div className="request-type-band">
          <span className="request-type-band-thumb request-type-band-thumb--emoji" aria-hidden="true">👋</span>
          <span className="request-type-band-text">
            <span className="request-type-band-kind">{t('chat.list.requestsTab.friendLabel')}</span>
            <span className="request-type-band-sub">{t('chat.list.requestsTab.friendSub')}</span>
          </span>
        </div>
      )}
      {kind && (
        <div className="request-type-band">
          <span className="request-type-band-thumb" aria-hidden="true">
            {thumb
              ? <img src={thumbUrl(thumb)} alt="" loading="lazy" decoding="async" />
              : (request.group_name || '?')[0].toUpperCase()}
          </span>
          <span className="request-type-band-text">
            <span className="request-type-band-kind">
              <span aria-hidden="true">🔒 </span>{t('chat.list.requestsTab.joinLabel')}
            </span>
            <span className="request-type-band-name">{request.group_name}</span>
            <span className="request-type-band-meta">
              {kind === 'partner'
                ? <PartnerBadge variant="pill" />
                : <span className={`chat-type-badge ${tone === 'club' ? 'club-badge' : 'group-badge'}`}>{t(KIND_LABEL[kind])}</span>}
              {date && <span className="request-type-band-date">{date}</span>}
            </span>
          </span>
        </div>
      )}

      <div className="request-image-container request-image-tall">
        {request.user_avatar
          ? <img src={request.user_avatar} alt={request.user_name} className="request-user-image" loading="lazy" decoding="async" />
          : <div className="request-avatar-placeholder">{(request.user_name || '?')[0].toUpperCase()}</div>}
        {request.user_trusted && (
          <VerifiedBadge className="request-trusted-badge" size={34} />
        )}
        {/* Abzeichen-Stufe bottom-left, opposite the seal (swipes pass through). */}
        <AttendanceTierBadge tier={request.user_attendance_step} variant="pill" className="request-tier-badge" />
      </div>

      <div className="request-user-info">
        <h2 className="request-name">
          {request.user_name}{age ? `, ${age}` : ''}
        </h2>

        <button
          type="button"
          className="request-profile-link"
          onClick={() => navigate(`/user/${request.user_id}`)}
        >
          {t('common.viewProfile')}
        </button>

        {request.message && (
          <p className="request-bio">{request.message}</p>
        )}

        {interests.length > 0 && (
          <div className="request-interests">
            {interests.slice(0, 5).map((tag, i) => (
              <span key={i} className="request-interest-tag">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default RequestCard;
