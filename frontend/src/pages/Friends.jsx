import { useState, useEffect, useRef, useContext } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { friends as friendsApi, users as usersApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { UserName } from '../components/UserName';
import '../styles/friends.css';

export const Friends = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
  const { user: currentUser } = useContext(AuthContext) || {};
  const [searchParams] = useSearchParams();

  // Open straight on the "Eingehende Anfragen" tab when arrived via the
  // friend-request badge (Profile → Freunde shortcut uses ?tab=pending).
  const [tab, setTab] = useState(searchParams.get('tab') === 'pending' ? 'pending' : 'friends');
  const [friendsList, setFriendsList] = useState([]);
  const [pending, setPending] = useState([]);
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => { loadAll(); }, []);

  // Debounced user search — runs once query reaches 2+ chars
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      setSearching(true);
      try {
        const res = await usersApi.search(q, { signal: abortRef.current.signal });
        const rows = (res.data || []).filter(u => u.id !== currentUser?.id);
        setSearchResults(rows);
      } catch (err) {
        if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
          setSearchResults([]);
        }
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, currentUser?.id]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [fRes, pRes, sRes] = await Promise.all([
        friendsApi.getAll().catch(() => ({ data: [] })),
        friendsApi.getPending().catch(() => ({ data: [] })),
        friendsApi.getSent().catch(() => ({ data: [] })),
      ]);
      setFriendsList(fRes.data || []);
      setPending(pRes.data || []);
      setSent(sRes.data || []);
    } catch {
      toast.error(t('friends.toast.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (requestId) => {
    setActionLoading(requestId);
    try {
      await friendsApi.respondRequest(requestId, 'accept');
      setPending(prev => prev.filter(r => r.id !== requestId));
      await loadAll();
      toast.success(t('friends.toast.accepted'));
    } catch {
      toast.error(t('friends.toast.acceptError'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (requestId) => {
    setActionLoading(requestId);
    try {
      await friendsApi.respondRequest(requestId, 'reject');
      setPending(prev => prev.filter(r => r.id !== requestId));
      toast.success(t('friends.toast.rejected'));
    } catch {
      toast.error(t('friends.toast.rejectError'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (friendId) => {
    setActionLoading(friendId);
    try {
      await friendsApi.remove(friendId);
      setFriendsList(prev => prev.filter(f => f.friend_id !== friendId && f.id !== friendId));
      toast.success(t('friends.toast.removed'));
    } catch {
      toast.error(t('friends.toast.removeError'));
    } finally {
      setActionLoading(null);
    }
  };

  const Avatar = ({ src, name, size = 48 }) => (
    <div className="fr-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {src
        ? <img src={src} alt={name} loading="lazy" decoding="async" />
        : <span>{(name || '?')[0].toUpperCase()}</span>
      }
    </div>
  );

  return (
    <div className="fr-page">
      <div className="fr-header">
        <button className="fr-back" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <h1 className="fr-title">{t('friends.title')}</h1>
        <div style={{ width: 40 }} />
      </div>

      <div className="fr-search-wrap">
        <svg className="fr-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          type="text"
          className="fr-search-input"
          placeholder={t('friends.search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            className="fr-search-clear"
            onClick={() => setQuery('')}
            aria-label={t('friends.search.clear')}
          >×</button>
        )}
      </div>

      <div className="fr-tabs">
        <button
          className={`fr-tab ${tab === 'friends' ? 'fr-tab-active' : ''}`}
          onClick={() => setTab('friends')}
        >
          {t('friends.tabs.friends')}
          {friendsList.length > 0 && <span className="fr-count">{friendsList.length}</span>}
        </button>
        <button
          className={`fr-tab ${tab === 'pending' ? 'fr-tab-active' : ''}`}
          onClick={() => setTab('pending')}
        >
          {t('friends.tabs.pending')}
          {pending.length > 0 && <span className="fr-count fr-count-red">{pending.length}</span>}
        </button>
        <button
          className={`fr-tab ${tab === 'sent' ? 'fr-tab-active' : ''}`}
          onClick={() => setTab('sent')}
        >
          {t('friends.tabs.sent')}
          {sent.length > 0 && <span className="fr-count">{sent.length}</span>}
        </button>
      </div>

      <div className="fr-body">
        {query.trim().length >= 2 ? (
          searching ? (
            <div className="fr-loading"><div className="fr-spinner" /></div>
          ) : searchResults.length === 0 ? (
            <div className="fr-empty">
              <div className="fr-empty-icon">🔍</div>
              <p>{t('friends.search.empty')}</p>
            </div>
          ) : (
            <div className="fr-list">
              {searchResults.map(u => (
                <div key={u.id} className="fr-row">
                  <div className="fr-row-left" onClick={() => navigate(`/user/${u.id}`)}>
                    <Avatar src={u.avatar_url} name={u.name} />
                    <div className="fr-row-info">
                      <p className="fr-row-name"><UserName name={u.name} age={u.age} /></p>
                      {u.location && <p className="fr-row-sub">{u.location}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : loading ? (
          <div className="fr-loading"><div className="fr-spinner" /></div>
        ) : (
          <>
            {/* ── Freunde ── */}
            {tab === 'friends' && (
              friendsList.length === 0 ? (
                <div className="fr-empty">
                  <div className="fr-empty-icon">👥</div>
                  <p>{t('friends.empty.noFriends')}</p>
                  <span>{t('friends.empty.noFriendsHint')}</span>
                </div>
              ) : (
                <div className="fr-list">
                  {friendsList.map(f => {
                    const fid = f.friend_id || f.id;
                    return (
                      <div key={fid} className="fr-row">
                        <div className="fr-row-left" onClick={() => navigate(`/user/${fid}`)}>
                          <Avatar src={f.avatar_url} name={f.name} />
                          <div className="fr-row-info">
                            <p className="fr-row-name"><UserName name={f.name} age={f.age} /></p>
                            {f.location && <p className="fr-row-sub">{f.location}</p>}
                          </div>
                        </div>
                        <div className="fr-row-actions">
                          <button
                            className="fr-btn fr-btn-ghost"
                            onClick={() => navigate(`/dm/${fid}`)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                            </svg>
                          </button>
                          <button
                            className="fr-btn fr-btn-remove"
                            disabled={actionLoading === fid}
                            onClick={() => handleRemove(fid)}
                          >
                            {actionLoading === fid ? '…' : '×'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* ── Eingehende Anfragen ── */}
            {tab === 'pending' && (
              pending.length === 0 ? (
                <div className="fr-empty">
                  <div className="fr-empty-icon">📬</div>
                  <p>{t('friends.empty.noPending')}</p>
                </div>
              ) : (
                <div className="fr-list">
                  {pending.map(r => (
                    <div key={r.id} className="fr-row fr-row-request">
                      <div className="fr-row-left" onClick={() => navigate(`/user/${r.requester_id}`)}>
                        <Avatar src={r.requester_avatar} name={r.requester_name} />
                        <div className="fr-row-info">
                          <p className="fr-row-name"><UserName name={r.requester_name} age={r.requester_age} /></p>
                          {r.requester_location && <p className="fr-row-sub">{r.requester_location}</p>}
                        </div>
                      </div>
                      <div className="fr-row-actions">
                        <button
                          className="fr-btn fr-btn-accept"
                          disabled={actionLoading === r.id}
                          onClick={() => handleAccept(r.id)}
                        >
                          {actionLoading === r.id ? '…' : '✓'}
                        </button>
                        <button
                          className="fr-btn fr-btn-remove"
                          disabled={actionLoading === r.id}
                          onClick={() => handleReject(r.id)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* ── Gesendete Anfragen ── */}
            {tab === 'sent' && (
              sent.length === 0 ? (
                <div className="fr-empty">
                  <div className="fr-empty-icon">📤</div>
                  <p>{t('friends.empty.noSent')}</p>
                </div>
              ) : (
                <div className="fr-list">
                  {sent.map(r => (
                    <div key={r.id} className="fr-row">
                      <div className="fr-row-left" onClick={() => navigate(`/user/${r.addressee_id}`)}>
                        <Avatar src={r.addressee_avatar} name={r.addressee_name} />
                        <div className="fr-row-info">
                          <p className="fr-row-name"><UserName name={r.addressee_name} age={r.addressee_age} /></p>
                          <p className="fr-row-sub">{t('friends.sentPending')}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Friends;
