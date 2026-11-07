import { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { users as usersApi, friends as friendsApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { UserName } from './UserName';
import { DailyLimitModal } from './DailyLimitModal';
import { thumbUrl } from '../utils/images';

// People search of Explore's Friends tab (Tina, 22.10.2026): a name gives
// avatar, name, a line of bio and the friendship button right in the row —
// anfragen / angefragt / befreundet, and „Annehmen" when that person already
// asked (Tobi, 26.10.2026). While fewer than two characters are typed the
// children show instead.
//
// The request is the existing flow: sendFriendRequest pushes the addressee
// and pings their Anfragen deck, accepting notifies the requester — nothing
// new to notify here. friend_status comes from GET /users/search and
// GET /friends/suggestions alike.

/**
 * The friendship button and its two actions, shared by the search results and
 * the „Von deinen letzten Events" suggestions (Tina, 07.11.2026). `setStatus`
 * is the caller's (id, status) updater for whichever list the row lives in.
 * A DAILY_FRIEND_LIMIT refusal (5 per day, free) opens the „Tageslimit
 * erreicht" sheet first — never the Pro sheet directly.
 */
export function useFriendActions({ onAccepted } = {}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  const [limitOpen, setLimitOpen] = useState(false);

  // Optimistic: the row says „Angefragt" at once and only falls back on a
  // real failure. The two 400s mean the state was simply stale.
  const request = useCallback(async (u, setStatus) => {
    setBusyId(u.id);
    setStatus(u.id, 'pending_out');
    try {
      await friendsApi.sendRequest(u.id);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === 'DAILY_FRIEND_LIMIT') {
        setStatus(u.id, 'none');
        setLimitOpen(true);
      } else if (data?.error === 'Already friends') setStatus(u.id, 'accepted');
      else if (data?.error !== 'Friend request already pending') {
        setStatus(u.id, 'none');
        toast.error(t('explore.friends.requestError'));
      }
    } finally {
      setBusyId(null);
    }
  }, [t, toast]);

  const accept = useCallback(async (u, setStatus) => {
    setBusyId(u.id);
    try {
      await friendsApi.respondRequest(u.friendship_id, 'accept');
      setStatus(u.id, 'accepted');
      toast.success(t('explore.friends.accepted'));
      onAccepted?.();
    } catch {
      toast.error(t('explore.friends.acceptError'));
    } finally {
      setBusyId(null);
    }
  }, [t, toast, onAccepted]);

  const statusButton = (u, setStatus) => {
    const busy = busyId === u.id;
    switch (u.friend_status) {
      case 'accepted':
        return (
          <span className="ef-friends-btn ef-friends-btn--friends">
            <span aria-hidden="true">✓</span> {t('explore.friends.btnFriends')}
          </span>
        );
      case 'pending_out':
        return (
          <span className="ef-friends-btn ef-friends-btn--done">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
            {t('explore.friends.btnRequested')}
          </span>
        );
      case 'pending_in':
        return u.friendship_id ? (
          <button type="button" className="ef-friends-btn ef-friends-btn--primary" disabled={busy} onClick={() => accept(u, setStatus)}>
            {t('explore.friends.btnAccept')}
          </button>
        ) : null;
      default:
        return (
          <button type="button" className="ef-friends-btn ef-friends-btn--primary" disabled={busy} onClick={() => request(u, setStatus)}>
            {t('explore.friends.btnRequest')}
          </button>
        );
    }
  };

  const limitModal = limitOpen
    ? <DailyLimitModal variant="friend" onClose={() => setLimitOpen(false)} />
    : null;

  return { statusButton, limitModal };
}

/** Avatar, name (+ age), one sub-line, and whatever sits on the right. */
export function PersonRow({ person, sub, action }) {
  const navigate = useNavigate();
  return (
    <li className="ef-friends-row">
      <button type="button" className="ef-friends-person" onClick={() => navigate(`/user/${person.id}`)}>
        <span className="ef-friends-av">
          {person.avatar_url
            ? <img src={thumbUrl(person.avatar_url)} alt="" loading="lazy" decoding="async" />
            : <span>{(person.name || '?')[0].toUpperCase()}</span>}
        </span>
        <span className="ef-friends-info">
          <UserName className="ef-friends-name" name={person.name} age={person.age} />
          {sub && <span className="ef-friends-bio">{sub}</span>}
        </span>
      </button>
      {action}
    </li>
  );
}

/** (id, status) updater for a people list held in React state. */
export const statusSetter = (setList) => (id, friend_status) =>
  setList(prev => prev.map(u => (u.id === id ? { ...u, friend_status } : u)));

export const FriendSearch = ({ onAccepted, children, autoFocus = false }) => {
  const { t } = useTranslation();
  const { user: currentUser } = useContext(AuthContext) || {};
  const { statusButton, limitModal } = useFriendActions({ onAccepted });

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [limited, setLimited] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // Debounced search — the pattern of pages/Friends.jsx: 300ms, the stale
  // request is aborted, and only the still-current request may clear the
  // spinner. The spinner starts with the keystroke, so the debounce never
  // flashes "Keine Treffer".
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setLimited(false);
      return undefined;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await usersApi.search(q, { signal: ctrl.signal });
        setResults((res.data || []).filter(u => u.id !== currentUser?.id));
        setLimited(false);
      } catch (err) {
        if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
          setResults([]);
          setLimited(err.response?.status === 429);
        }
      } finally {
        if (abortRef.current === ctrl) setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(debounceRef.current);
      // Stale query or unmount — stop the request, and let go of it so its
      // finally cannot clear the spinner of the query that replaces it.
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [query, currentUser?.id]);

  const setStatus = statusSetter(setResults);
  const showResults = query.trim().length >= 2;

  return (
    <>
      <div className="ef-friends-search">
        <svg className="ef-friends-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoFocus={autoFocus}
          className="ef-friends-search-input"
          placeholder={t('explore.friends.searchPlaceholder')}
          aria-label={t('explore.friends.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="ef-friends-search-clear"
            onClick={() => setQuery('')}
            aria-label={t('explore.friends.searchClear')}
          >×</button>
        )}
      </div>

      {!showResults ? children : searching ? (
        <div className="explore-loading"><div className="explore-spinner" /></div>
      ) : results.length === 0 ? (
        <div className="explore-empty">
          <div className="explore-empty-icon">🔍</div>
          <p>{t(limited ? 'explore.friends.searchLimited' : 'explore.friends.searchEmpty')}</p>
        </div>
      ) : (
        <ul className="ef-friends-list">
          {results.map(u => (
            <PersonRow key={u.id} person={u} sub={u.bio || u.location} action={statusButton(u, setStatus)} />
          ))}
        </ul>
      )}
      {limitModal}
    </>
  );
};

export default FriendSearch;
