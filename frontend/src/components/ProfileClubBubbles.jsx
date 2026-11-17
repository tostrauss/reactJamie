import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext';
import { clubs as clubsApi, users as usersApi } from '../utils/api';
import { thumbUrl } from '../utils/images';
import { movePhoto as moveItem } from '../utils/photoOrder';
import { profileClubRows, withClubOrder } from '../utils/profileClubs';
import StarIcon from './StarIcon';

const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

// „Clubs & Communities“ — round bubbles in the own profile (Tina 16.11.2026,
// PR2/PR3), in place of the „Meine Gruppen & Clubs“ hub. Own clubs first, with
// the yellow ring and a small coral counter of open requests (its tap is the
// way into the Anfragen deck the hub's chip used to be); then the joined ones.
// ☆ marks a PAYING partner (Tobi 17.11.2026: yellow, ☆ and ✓ only for paying
// partners) — the same star as on its events; any other club has none.
// Which clubs and in which order: utils/profileClubs.js.
//
// „Sortieren“ (from two sortable bubbles on): the row becomes a grid and the
// joined bubbles wiggle like an iPhone home screen; own ones stand still, and
// tapping one says why. Tap to pick, ← / → to move — the ProfileEdit photo
// pattern: HTML5 drag events do not fire for touch in WKWebView and a pointer
// drag would fight the page scroll. Keyboard: ← / → on the focused bubble.
// Only moving, never hiding. Whatever ends the mode — „Fertig“, „Events
// bearbeiten“ below, a tab switch, leaving the page — saves the new order at
// once (PUT /users/me/clubs/order); a failed save puts the old order back.
//
// The mode lives in Profile, ONE for these bubbles and „Demnächst dabei“
// (ProfileUpcomingEvents) under them in the same card, so the two can never
// be on together: `sorting` in, `onSortingChange` out.
export default function ProfileClubBubbles({ sorting = false, onSortingChange }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
  const uid = useId();
  const [rows, setRows] = useState(null);
  // The joined clubs' ids in their new order while sorting, else null.
  const [draft, setDraft] = useState(null);
  const [picked, setPicked] = useState(null);
  // Latest values for the end of a sorting session, which runs in an effect
  // cleanup (possibly on unmount).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveSeq = useRef(0);
  const focusAfterMove = useRef(null);

  useEffect(() => {
    let cancelled = false;
    clubsApi.getJoined()
      .then((res) => { if (!cancelled) setRows(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  // Optimistic: the bubbles keep the new order at once. Only the latest save
  // may answer — an older one finishing late must not undo a newer order.
  const saveOrder = (ids) => {
    const before = rowsRef.current;
    const seq = ++saveSeq.current;
    setRows((prev) => withClubOrder(prev, ids));
    usersApi.setMyClubOrder(ids)
      .then((res) => {
        if (seq === saveSeq.current && Array.isArray(res.data)) setRows(res.data);
      })
      .catch(() => {
        if (seq !== saveSeq.current) return;
        setRows(before);
        toast.error(t('profile.clubs.saveError'));
      });
  };

  // One sorting session: it starts from the order on screen, and whatever
  // ends it saves the order if it changed.
  useEffect(() => {
    if (!sorting) return undefined;
    const start = profileClubRows(rowsRef.current).joined.map((c) => c.id);
    setDraft(start);
    setPicked(null);
    return () => {
      const ids = draftRef.current;
      setDraft(null);
      setPicked(null);
      if (ids && !sameIds(ids, start)) saveOrder(ids);
    };
  }, [sorting]); // eslint-disable-line react-hooks/exhaustive-deps

  // React re-inserts a moved bubble's DOM node, which drops keyboard focus:
  // put it back after a move by arrow key (a tap never focused anything).
  useEffect(() => {
    const id = focusAfterMove.current;
    if (id == null) return;
    focusAfterMove.current = null;
    document.getElementById(`${uid}-club-${id}`)?.focus();
  }, [draft, uid]);

  const { own, joined } = profileClubRows(rows);
  if (own.length + joined.length === 0) return null;

  const byId = new Map(joined.map((c) => [c.id, c]));
  const sortable = sorting && draft ? draft.map((id) => byId.get(id)).filter(Boolean) : joined;
  const pickedIndex = sorting && picked != null ? sortable.findIndex((c) => c.id === picked) : -1;
  const canSort = joined.length >= 2;

  const move = (id, to, byKey = false) => {
    if (!draft || to < 0 || to >= draft.length) return;
    if (byKey) focusAfterMove.current = id;
    setDraft((prev) => (prev ? moveItem(prev, prev.indexOf(id), to) : prev));
    setPicked(id);
  };

  const onArrowKey = (e, index, id) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    move(id, e.key === 'ArrowLeft' ? index - 1 : index + 1, true);
  };

  const onTap = (club) => {
    if (!sorting) {
      navigate(`/club/${club.id}`);
      return;
    }
    if (club.is_own) {
      toast.info(t(club.club_type === 'official' ? 'profile.clubs.ownLockedClub' : 'profile.clubs.ownLockedCommunity'));
      return;
    }
    setPicked((prev) => (prev === club.id ? null : club.id));
  };

  const renderBubble = (club, index) => {
    const isOwn = !!club.is_own;
    const movable = sorting && !isOwn;
    // The star means a paying partner — partnerSql's rule (backend
    // utils/clubGate.js): a live, approved official club with the admin's
    // is_paid_partner flag. A club still in review is no partner yet, an
    // official club that does not pay has no star. An old server without the
    // flag: no star.
    const isPartner = club.club_type === 'official' && club.approval_status === 'approved'
      && club.is_active !== false && club.is_paid_partner === true;
    const inReview = club.approval_status === 'pending';
    const requests = isOwn && !sorting ? (club.pending_request_count || 0) : 0;
    const isPicked = movable && picked === club.id;
    const cls = ['profile-club', isOwn && 'is-own', inReview && 'is-pending', movable && 'is-wiggling', isPicked && 'is-picked']
      .filter(Boolean).join(' ');
    return (
      <li key={club.id} className={cls}>
        <button
          type="button"
          id={`${uid}-club-${club.id}`}
          className="profile-club-open"
          // The name under the bubble is clamped to two lines — the full one
          // on hover.
          title={club.name}
          onClick={() => onTap(club)}
          onKeyDown={movable ? (e) => onArrowKey(e, index, club.id) : undefined}
          aria-pressed={movable ? isPicked : undefined}
          aria-label={movable ? t('profile.clubs.pickAria', { name: club.name }) : undefined}
        >
          <span className="profile-club-avatar">
            <span className="profile-club-bubble">
              {club.image_url
                ? <img src={thumbUrl(club.image_url)} alt="" loading="lazy" decoding="async" draggable={false} />
                : <span aria-hidden="true">{(club.name || '?')[0].toUpperCase()}</span>}
            </span>
            {isPartner && (
              <span className="profile-club-star">
                <StarIcon size={10} strokeWidth="2.6" strokeLinejoin="round" />
              </span>
            )}
          </span>
          <span className="profile-club-name">{club.name}</span>
          {isOwn && <span className="sr-only">{t('profile.clubs.ownAria')}</span>}
          {isPartner && <span className="sr-only">{t('profile.clubs.partnerAria')}</span>}
          {inReview && <span className="sr-only">{t('profile.clubs.pendingAria')}</span>}
        </button>
        {requests > 0 && (
          <button
            type="button"
            className="profile-club-requests"
            onClick={() => navigate('/chats?tab=anfragen')}
            aria-label={t('profile.clubs.requestsAria', { count: requests, name: club.name })}
          >
            {requests > 99 ? '99+' : requests}
          </button>
        )}
      </li>
    );
  };

  const pickedClub = pickedIndex >= 0 ? sortable[pickedIndex] : null;

  return (
    <section className="profile-clubs" aria-labelledby={`${uid}-title`}>
      <div className="profile-section-head">
        <h3 id={`${uid}-title`} className="profile-section-title">{t('profile.clubs.title')}</h3>
        {(canSort || sorting) && (
          <button
            type="button"
            className={`profile-section-action${sorting ? ' is-active' : ''}`}
            onClick={() => onSortingChange?.(!sorting)}
          >
            {sorting ? t('profile.clubs.done') : t('profile.clubs.sort')}
          </button>
        )}
      </div>
      <ul className={`profile-clubs-rail${sorting ? ' is-sorting' : ''}`}>
        {own.map((club) => renderBubble(club, -1))}
        {sortable.map((club, i) => renderBubble(club, i))}
      </ul>
      {sorting && (pickedClub ? (
        <div className="profile-clubs-move" role="group" aria-label={t('profile.clubs.moveAria', { name: pickedClub.name })}>
          {/* At the row's end aria-disabled, not disabled: the arrow keeps the
              focus it has (review 16.11.2026) — move() ignores the tap. */}
          <button
            type="button"
            className="pe-order-btn pe-order-btn--icon"
            onClick={() => move(pickedClub.id, pickedIndex - 1)}
            aria-disabled={pickedIndex === 0}
            aria-label={t('profile.clubs.moveEarlier')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <span className="profile-clubs-move-name" aria-hidden="true">{pickedClub.name}</span>
          <button
            type="button"
            className="pe-order-btn pe-order-btn--icon"
            onClick={() => move(pickedClub.id, pickedIndex + 1)}
            aria-disabled={pickedIndex === sortable.length - 1}
            aria-label={t('profile.clubs.moveLater')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
      ) : (
        <p className="profile-clubs-hint">{t('profile.clubs.sortHint')}</p>
      ))}
      {/* Mounted for as long as the card is: a live region that appears
          together with its text is often not read out — the first pick would
          go unannounced. */}
      <span className="sr-only" aria-live="polite">
        {pickedClub ? t('profile.clubs.positionFmt', { n: pickedIndex + 1, total: sortable.length }) : ''}
      </span>
    </section>
  );
}
