import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { friends as friendsApi } from '../utils/api';
import { thumbUrl } from '../utils/images';
import { pickRandom } from '../utils/friendsHub';
import { FriendSearch, PersonRow, useFriendActions, statusSetter } from './FriendSearch';
import { FriendsGoing } from './FriendsGoing';
import { PeopleYouMayKnow } from './PeopleYouMayKnow';
import { UserName } from './UserName';
import '../styles/friends-hub.css';

// Explore → Friends. Tina's „Neue Friends Seite“ (17.11.2026), top to bottom:
//   1. heading „Friends“ with the coral button — now a person with a plus, so
//      nobody takes it for the big plus of the bottom bar — and the name
//      search, both as before;
//   2. the bar „👋 3 neue Freundschaftsanfragen“, only while there are
//      incoming requests; it leads to where they are answered (Chat →
//      Anfragen → Freunde);
//   3. „Wo gehen deine Freunde hin? 🎉“ (FriendsGoing);
//   4. „Deine Freunde“: three random friends, drawn anew every time the page
//      opens, and „Alle ansehen“;
//   5. „Leute, die du kennen könntest“ (PeopleYouMayKnow).
//
// „Alle ansehen“ opens the whole friends list — the page as it was since
// 07.11.2026. It is a real history entry (?view=all), so Android's back key
// and the swipe back lead to the new page again; an arrow before the heading
// does the same.
//
// The ⊕ sheet „Friends hinzufügen“ with „Von deinen letzten Events“ stays as
// it was; its suggestions now load when it opens. The memories feed of
// friends' events (GET /groups/hall-of-fame/friends) stays on the server for
// older app bundles.

/** Friends shown in „Deine Freunde“ before „Alle ansehen“. */
export const FRIENDS_SHOWN = 3;

function SuggestionList({ people, setPeople, actions }) {
  const { t } = useTranslation();
  const setStatus = statusSetter(setPeople);
  if (!people.length) return null;
  return (
    <div className="ef-friends-suggest">
      <h3 className="ef-friends-section-title">{t('explore.friends.suggestionsTitle')}</h3>
      <ul className="ef-friends-list">
        {people.map(u => (
          <PersonRow key={u.id} person={u} sub={u.event_name} action={actions.statusButton(u, setStatus)} />
        ))}
      </ul>
    </div>
  );
}

function AddFriendsSheet({ suggestions, setSuggestions, onAccepted, onClose }) {
  const { t } = useTranslation();
  const actions = useFriendActions({ onAccepted });
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="afs-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="afs-sheet" role="dialog" aria-modal="true" aria-label={t('explore.friends.addTitle')}>
        <div className="afs-handle" aria-hidden="true" />
        <div className="afs-head">
          <h2 className="afs-title">{t('explore.friends.addTitle')}</h2>
          <button type="button" className="afs-close" onClick={onClose} aria-label={t('explore.friends.close')}>✕</button>
        </div>
        <FriendSearch onAccepted={onAccepted}>
          <p className="afs-hint">{t('explore.friends.addHint')}</p>
          <div className="afs-divider" />
          {suggestions === null
            ? <div className="explore-loading"><div className="explore-spinner" /></div>
            : suggestions.length === 0
              ? <p className="afs-hint afs-hint--empty">{t('explore.friends.suggestionsEmpty')}</p>
              : <SuggestionList people={suggestions} setPeople={setSuggestions} actions={actions} />}
        </FriendSearch>
        {actions.limitModal}
      </div>
    </div>
  );
}

const Chevron = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

// `withText` false drops the second line („Ihr wart schon gemeinsam unterwegs.
// Zeit, euch zu vernetzen!“): on the new page it would stand right above
// „Nimm bei deinem ersten Treffen oder Event teil …“ for somebody who has not
// been out with anybody yet — two sentences that contradict each other.
function EmptyFriends({ withText = true }) {
  const { t } = useTranslation();
  return (
    <div className="ef-friends-empty">
      <div className="ef-friends-empty-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3.2" /><path d="M2.8 19c.7-3 3.2-4.6 6.2-4.6s5.5 1.6 6.2 4.6" />
          <circle cx="17" cy="9" r="2.4" /><path d="M15.4 14.6c2.6.1 4.8 1.5 5.6 4.1" />
        </svg>
      </div>
      <p className="ef-friends-empty-title">{t('explore.friends.emptyTitle')}</p>
      {withText && <p className="ef-friends-empty-text">{t('explore.friends.emptyText')}</p>}
    </div>
  );
}

export function FriendsTab({ reloadKey = 0 }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const showAll = searchParams.get('view') === 'all';

  const [friendList, setFriendList] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [going, setGoing] = useState(null);
  const [people, setPeople] = useState(null);         // { people, has_shared }
  const [suggestions, setSuggestions] = useState(null); // the ⊕ sheet's own list
  const [sheetOpen, setSheetOpen] = useState(false);

  const loadFriends = useCallback(async () => {
    const res = await friendsApi.getAll().catch(() => ({ data: [] }));
    setFriendList(Array.isArray(res.data) ? res.data : []);
  }, []);
  // The number in the bar is the Anfragen deck's own list — one source, so the
  // bar never announces a request the deck does not show.
  const loadPending = useCallback(async () => {
    const res = await friendsApi.getPending().catch(() => ({ data: [] }));
    setPendingCount(Array.isArray(res.data) ? res.data.length : 0);
  }, []);
  const loadGoing = useCallback(async () => {
    const res = await friendsApi.getGoing().catch(() => ({ data: [] }));
    setGoing(Array.isArray(res.data) ? res.data : []);
  }, []);
  // A failed load leaves has_shared unknown (null): the section then shows
  // nothing — never the sentence for „no shared meetup“, which may be wrong.
  const loadPeople = useCallback(async () => {
    const res = await friendsApi.getPeople().catch(() => ({ data: null }));
    const data = res.data && typeof res.data === 'object' ? res.data : {};
    setPeople({
      people: Array.isArray(data.people) ? data.people : [],
      has_shared: typeof data.has_shared === 'boolean' ? data.has_shared : null,
    });
  }, []);
  const loadSuggestions = useCallback(async () => {
    const res = await friendsApi.getSuggestions().catch(() => ({ data: [] }));
    setSuggestions(Array.isArray(res.data) ? res.data : []);
  }, []);

  useEffect(() => {
    loadFriends();
    loadPending();
    loadGoing();
    loadPeople();
  }, [loadFriends, loadPending, loadGoing, loadPeople, reloadKey]);

  // The sheet's suggestions are its own; nobody pays for them before it opens.
  useEffect(() => {
    if (sheetOpen) loadSuggestions();
  }, [sheetOpen, loadSuggestions]);

  // Accepting someone (search or suggestion) makes a new friend — the list
  // must show them, the request is answered, and that person is no stranger
  // to suggest any more.
  const onAccepted = useCallback(() => {
    loadFriends();
    loadPending();
    loadPeople();
    if (sheetOpen) loadSuggestions();
  }, [loadFriends, loadPending, loadPeople, loadSuggestions, sheetOpen]);
  const actions = useFriendActions({ onAccepted });
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // „bei jedem Öffnen neu gemischt“: drawn once per loaded list — every mount
  // and every refresh loads a new one — and stable while the page is in view.
  const preview = useMemo(() => pickRandom(friendList || [], FRIENDS_SHOWN), [friendList]);

  // A real history entry: back (Android's key, the swipe, the arrow) returns
  // to the page with the sections.
  const openAll = () => {
    const sp = new URLSearchParams(searchParams);
    sp.set('view', 'all');
    navigate({ pathname: location.pathname, search: `?${sp.toString()}` }, { state: { fromFriendsHub: true } });
  };
  // Opened by a link or a reload there is no entry of ours to go back to —
  // then the view is simply dropped from the URL.
  const closeAll = () => {
    if (location.state?.fromFriendsHub) { navigate(-1); return; }
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      sp.delete('view');
      return sp;
    }, { replace: true });
  };

  let body;
  if (friendList === null) {
    body = <div className="explore-loading"><div className="explore-spinner" /></div>;
  } else if (showAll) {
    // The whole list — the page as it was before 17.11.2026.
    body = friendList.length === 0 ? <EmptyFriends /> : (
      <ul className="ef-friends-list">
        {friendList.map(f => (
          <PersonRow
            key={f.friend_id}
            person={{ id: f.friend_id, name: f.name, age: f.age, avatar_url: f.avatar_url }}
            sub={f.location}
          />
        ))}
      </ul>
    );
  } else {
    body = (
      <div className="fh">
        {pendingCount > 0 && (
          <button type="button" className="fh-requests" onClick={() => navigate('/chats?tab=anfragen&kind=freunde')}>
            <span className="fh-requests-text">{t('explore.friends.requestsBar', { count: pendingCount })}</span>
            <Chevron />
          </button>
        )}

        <FriendsGoing cards={going} setCards={setGoing} />

        <section className="fh-section" aria-labelledby="fh-friends-title">
          <div className="fh-head">
            <h3 className="fh-title" id="fh-friends-title">{t('explore.friends.yourFriends')}</h3>
            {friendList.length > 0 && (
              <button type="button" className="fh-see-all" onClick={openAll}>{t('explore.friends.seeAll')}</button>
            )}
          </div>
          {friendList.length === 0 ? <EmptyFriends withText={people?.has_shared !== false} /> : (
            <ul className="fh-friends">
              {preview.map(f => (
                <li key={f.friend_id}>
                  <button type="button" className="fh-friend" onClick={() => navigate(`/user/${f.friend_id}`)}>
                    <span className="fh-friend-av">
                      {f.avatar_url
                        ? <img src={thumbUrl(f.avatar_url)} alt="" loading="lazy" decoding="async" />
                        : <span>{(f.name || '?')[0].toUpperCase()}</span>}
                    </span>
                    <span className="fh-friend-main">
                      <UserName className="fh-friend-name" name={f.name} age={f.age} />
                      <span className="fh-friend-chevron"><Chevron /></span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <PeopleYouMayKnow data={people} setData={setPeople} actions={actions} />
      </div>
    );
  }

  return (
    <div className="ef-friends">
      <div className="ef-friends-head">
        <div className="fh-heading">
          {showAll && (
            <button type="button" className="fh-back" onClick={closeAll} aria-label={t('common.back')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <h2 className="ef-friends-title">{t('explore.friends.title')}</h2>
        </div>
        {/* A person with a plus (Tina 17.11.2026): „damit man ihn nicht mit dem
            großen Plus unten verwechselt“. Opens the same sheet as before. */}
        <button type="button" className="ef-friends-add" onClick={openSheet} aria-label={t('explore.friends.addTitle')}>
          <svg className="fh-add-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9.5" cy="8" r="3.4" />
            <path d="M3 19.2c.6-3.3 3.1-5.1 6.5-5.1 1.5 0 2.8.35 3.9 1" />
            <path d="M18.2 13.6v6.2M15.1 16.7h6.2" />
          </svg>
        </button>
      </div>
      <FriendSearch onAccepted={onAccepted}>{body}</FriendSearch>
      {actions.limitModal}
      {sheetOpen && (
        <AddFriendsSheet
          suggestions={suggestions}
          setSuggestions={setSuggestions}
          onAccepted={onAccepted}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}

export default FriendsTab;
