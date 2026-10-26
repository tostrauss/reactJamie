import { useState, useEffect, useRef, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { users as usersApi, friends as friendsApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { UserName } from './UserName';
import { thumbUrl } from '../utils/images';

// People search of Explore's Friends tab (Tina, 22.10.2026): a name gives
// avatar, name, a line of bio and the friendship button right in the row —
// anfragen / angefragt / befreundet, and „Annehmen" when that person already
// asked (Tobi, 26.10.2026). While fewer than two characters are typed the
// children (the friends' memories) show instead.
//
// The request is the existing flow: sendFriendRequest pushes the addressee
// and pings their Anfragen deck, accepting notifies the requester — nothing
// new to notify here. friend_status comes from GET /users/search.
export const FriendSearch = ({ onAccepted, children }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toast = useToast();
  const { user: currentUser } = useContext(AuthContext) || {};

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [limited, setLimited] = useState(false);
  const [busyId, setBusyId] = useState(null);
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

  const setStatus = (id, friend_status) =>
    setResults(prev => prev.map(u => (u.id === id ? { ...u, friend_status } : u)));

  // Optimistic: the row says „Angefragt" at once and only falls back on a
  // real failure. The two 400s mean the state was simply stale.
  const handleRequest = async (u) => {
    setBusyId(u.id);
    setStatus(u.id, 'pending_out');
    try {
      await friendsApi.sendRequest(u.id);
    } catch (err) {
      const msg = err?.response?.data?.error;
      if (msg === 'Already friends') setStatus(u.id, 'accepted');
      else if (msg !== 'Friend request already pending') {
        setStatus(u.id, 'none');
        toast.error(t('explore.friends.requestError'));
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleAccept = async (u) => {
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
  };

  const statusButton = (u) => {
    const busy = busyId === u.id;
    switch (u.friend_status) {
      case 'accepted':
        return <span className="ef-friends-btn ef-friends-btn--done">{t('explore.friends.btnFriends')}</span>;
      case 'pending_out':
        return <span className="ef-friends-btn ef-friends-btn--done">{t('explore.friends.btnRequested')}</span>;
      case 'pending_in':
        return u.friendship_id ? (
          <button type="button" className="ef-friends-btn ef-friends-btn--primary" disabled={busy} onClick={() => handleAccept(u)}>
            {t('explore.friends.btnAccept')}
          </button>
        ) : null;
      default:
        return (
          <button type="button" className="ef-friends-btn ef-friends-btn--primary" disabled={busy} onClick={() => handleRequest(u)}>
            {t('explore.friends.btnRequest')}
          </button>
        );
    }
  };

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
            <li key={u.id} className="ef-friends-row">
              <button type="button" className="ef-friends-person" onClick={() => navigate(`/user/${u.id}`)}>
                <span className="ef-friends-av">
                  {u.avatar_url
                    ? <img src={thumbUrl(u.avatar_url)} alt="" loading="lazy" decoding="async" />
                    : <span>{(u.name || '?')[0].toUpperCase()}</span>}
                </span>
                <span className="ef-friends-info">
                  <UserName className="ef-friends-name" name={u.name} age={u.age} />
                  {(u.bio || u.location) && <span className="ef-friends-bio">{u.bio || u.location}</span>}
                </span>
              </button>
              {statusButton(u)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export default FriendSearch;
