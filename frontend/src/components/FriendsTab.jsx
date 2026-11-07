import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { friends as friendsApi } from '../utils/api';
import { FriendSearch, PersonRow, useFriendActions, statusSetter } from './FriendSearch';

// Explore → Friends, rebuilt to Tina's spec (To-Do-Dokument, 07.11.2026):
//   1. the tab shows FRIENDS — not the memories of events friends were at,
//      whose cards showed strangers next to friends;
//   2. an orange ⊕ beside the heading opens „Friends hinzufügen": name
//      search plus people „Von deinen letzten Events";
//   3. without friends yet: „Hier fehlen noch deine Friends!" with those
//      suggestions right in the empty state.
// The memories feed of friends' events (GET /groups/hall-of-fame/friends)
// stays on the server for older app bundles.

function SuggestionList({ people, setPeople, actions, onMore }) {
  const { t } = useTranslation();
  const setStatus = statusSetter(setPeople);
  if (!people.length && !onMore) return null;
  return (
    <div className="ef-friends-suggest">
      {people.length > 0 && (
        <>
          <h3 className="ef-friends-section-title">{t('explore.friends.suggestionsTitle')}</h3>
          <ul className="ef-friends-list">
            {people.map(u => (
              <PersonRow key={u.id} person={u} sub={u.event_name} action={actions.statusButton(u, setStatus)} />
            ))}
          </ul>
        </>
      )}
      {onMore && (
        <button type="button" className="ef-friends-more" onClick={onMore}>
          {t('explore.friends.discoverMore')}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}
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

export function FriendsTab({ reloadKey = 0 }) {
  const { t } = useTranslation();
  const [friendList, setFriendList] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const loadFriends = useCallback(async () => {
    const res = await friendsApi.getAll().catch(() => ({ data: [] }));
    setFriendList(Array.isArray(res.data) ? res.data : []);
  }, []);
  const loadSuggestions = useCallback(async () => {
    const res = await friendsApi.getSuggestions().catch(() => ({ data: [] }));
    setSuggestions(Array.isArray(res.data) ? res.data : []);
  }, []);

  useEffect(() => {
    loadFriends();
    loadSuggestions();
  }, [loadFriends, loadSuggestions, reloadKey]);

  // Accepting someone (search or suggestion) makes a new friend — the list
  // must show them, and the suggestion that was just answered goes away.
  const onAccepted = useCallback(() => { loadFriends(); loadSuggestions(); }, [loadFriends, loadSuggestions]);
  const actions = useFriendActions({ onAccepted });
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  let body;
  if (friendList === null) {
    body = <div className="explore-loading"><div className="explore-spinner" /></div>;
  } else if (friendList.length === 0) {
    body = (
      <>
        <div className="ef-friends-empty">
          <div className="ef-friends-empty-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="8" r="3.2" /><path d="M2.8 19c.7-3 3.2-4.6 6.2-4.6s5.5 1.6 6.2 4.6" />
              <circle cx="17" cy="9" r="2.4" /><path d="M15.4 14.6c2.6.1 4.8 1.5 5.6 4.1" />
            </svg>
          </div>
          <p className="ef-friends-empty-title">{t('explore.friends.emptyTitle')}</p>
          <p className="ef-friends-empty-text">{t('explore.friends.emptyText')}</p>
        </div>
        <SuggestionList people={suggestions || []} setPeople={setSuggestions} actions={actions} onMore={openSheet} />
      </>
    );
  } else {
    body = (
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
  }

  return (
    <div className="ef-friends">
      <div className="ef-friends-head">
        <h2 className="ef-friends-title">{t('explore.friends.title')}</h2>
        <button type="button" className="ef-friends-add" onClick={openSheet} aria-label={t('explore.friends.addTitle')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
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
