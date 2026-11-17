import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { postEventApi } from '../utils/api';
import { eventDateLocale } from '../utils/eventDate';
import { thumbUrl } from '../utils/images';
import { useFriendActions } from './FriendSearch';
import { UserName } from './UserName';
import '../styles/post-event.css';

// „Aus Fremden können Freundschaften werden! Mach den ersten Schritt und
// schicke eine Freundschaftsanfrage !“ — the friends list everybody but the
// creator gets after an event (Tina 17.11.2026, her Bild 8): everyone who was
// in the group, each with „Freundschaftsanfrage senden“ — or „✓ Befreundet“.
//
// `items` is what GET /reviews/connect/pending answers (connectController):
// one entry per event, shown one after the other. The X, Escape and „Fertig“
// close the event on screen for good (POST /reviews/connect/dismiss) and move
// on; after the last one `onDone` runs. A tap on the dimmed background does
// nothing — the list is too easy to lose that way.
//
// The buttons are the app's one friendship flow (useFriendActions): optimistic
// „Angefragt“, the daily limit of five opens the „Tageslimit erreicht“ sheet
// above this one. A person's state belongs to the person, not the event — it
// carries over to the next event's list.
//
// The people are NOT links: this sheet lies over every screen, a navigation
// would leave it open on top of the profile.

// Without a photo: the outline of a person, as in Tina's mock.
function PersonGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4" />
    </svg>
  );
}

export default function ConnectSheet({ items, onDone }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const sheetRef = useRef(null);
  const { request, accept, busyId, limitModal } = useFriendActions();
  // Events closed in this sitting, and friendship states that changed in it.
  const [closed, setClosed] = useState(() => new Set());
  const [statuses, setStatuses] = useState({});

  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const current = list.find((e) => !closed.has(e.group_id)) || null;
  const currentId = current?.group_id ?? null;

  const close = useCallback(() => {
    if (currentId == null) return;
    // Fire and forget: closing must never wait for, or fail on, the network.
    Promise.resolve().then(() => postEventApi.dismissConnect(currentId)).catch(() => {});
    const left = list.some((e) => e.group_id !== currentId && !closed.has(e.group_id));
    setClosed((prev) => new Set(prev).add(currentId));
    if (!left) onDone?.();
  }, [currentId, list, closed, onDone]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Keyboard and screen readers start inside the dialog, at each new event.
  useEffect(() => { sheetRef.current?.focus(); }, [currentId]);

  if (!current) return null;

  const setStatus = (id, friend_status) => setStatuses((prev) => ({ ...prev, [id]: friend_status }));
  const locale = eventDateLocale(i18n.resolvedLanguage || i18n.language);
  // The stored date is Vienna wall-clock tagged UTC — read it in UTC, so a
  // late-evening event stays on its own day.
  const when = current.event_date ? new Date(current.event_date) : null;
  const dateLabel = when && !Number.isNaN(when.getTime())
    ? when.toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' })
    : null;

  const renderAction = (person) => {
    const status = statuses[person.id] ?? person.friend_status;
    const busy = busyId === person.id;
    if (status === 'accepted') {
      return (
        <span className="pe-friend-btn pe-friend-btn--friends">
          <span aria-hidden="true">✓</span> {t('explore.friends.btnFriends')}
        </span>
      );
    }
    if (status === 'pending_out') {
      return (
        <span className="pe-friend-btn pe-friend-btn--done">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
          {t('explore.friends.btnRequested')}
        </span>
      );
    }
    if (status === 'pending_in' && person.friendship_id) {
      return (
        <button type="button" className="pe-friend-btn pe-friend-btn--primary" disabled={busy}
                onClick={() => accept(person, setStatus)}>
          {t('explore.friends.btnAccept')}
        </button>
      );
    }
    return (
      <button type="button" className="pe-friend-btn pe-friend-btn--primary" disabled={busy}
              onClick={() => request(person, setStatus)}>
        {t('connect.sendRequest')}
      </button>
    );
  };

  return (
    <div className="pe-backdrop" role="presentation">
      <div
        ref={sheetRef}
        className="pe-sheet pe-connect"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="pe-head">
          <div className="pe-head-text">
            <p className="pe-head-name">{current.group_name}</p>
            {dateLabel && <p className="pe-head-date">{dateLabel}</p>}
          </div>
          <button type="button" className="pe-close" onClick={close} aria-label={t('connect.close')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <h2 id={titleId} className="pe-title">{t('connect.title')}</h2>
        <p className="pe-text">{t('connect.text')}</p>

        <ul className="pe-people" aria-label={t('connect.listAria', { name: current.group_name })}>
          {(current.members || []).map((person) => (
            <li key={person.id} className="pe-person">
              <span className="pe-person-av">
                {person.avatar_url
                  ? <img src={thumbUrl(person.avatar_url)} alt="" loading="lazy" decoding="async" />
                  : <PersonGlyph />}
              </span>
              <UserName className="pe-person-name" name={person.name} age={person.age} />
              {renderAction(person)}
            </li>
          ))}
        </ul>

        <button type="button" className="pe-primary" onClick={close}>
          {t('eventReview.done')}
        </button>
      </div>
      {limitModal}
    </div>
  );
}
