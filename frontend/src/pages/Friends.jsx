import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { friends as friendsApi } from '../utils/api';
import { useToast } from '../context/ToastContext';
import '../styles/friends.css';

const calcAge = (dob) => {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob)) / 31557600000);
};

export const Friends = () => {
  const navigate = useNavigate();
  const toast = useToast();

  const [tab, setTab] = useState('friends');
  const [friendsList, setFriendsList] = useState([]);
  const [pending, setPending] = useState([]);
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => { loadAll(); }, []);

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
      toast.error('Freunde konnten nicht geladen werden');
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
      toast.success('Freundschaft angenommen!');
    } catch {
      toast.error('Fehler beim Annehmen');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (requestId) => {
    setActionLoading(requestId);
    try {
      await friendsApi.respondRequest(requestId, 'reject');
      setPending(prev => prev.filter(r => r.id !== requestId));
      toast.success('Anfrage abgelehnt');
    } catch {
      toast.error('Fehler beim Ablehnen');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (friendId) => {
    setActionLoading(friendId);
    try {
      await friendsApi.remove(friendId);
      setFriendsList(prev => prev.filter(f => f.friend_id !== friendId && f.id !== friendId));
      toast.success('Freund entfernt');
    } catch {
      toast.error('Fehler beim Entfernen');
    } finally {
      setActionLoading(null);
    }
  };

  const Avatar = ({ src, name, size = 48 }) => (
    <div className="fr-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {src
        ? <img src={src} alt={name} />
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
        <h1 className="fr-title">Freunde</h1>
        <div style={{ width: 40 }} />
      </div>

      <div className="fr-tabs">
        <button
          className={`fr-tab ${tab === 'friends' ? 'fr-tab-active' : ''}`}
          onClick={() => setTab('friends')}
        >
          Freunde
          {friendsList.length > 0 && <span className="fr-count">{friendsList.length}</span>}
        </button>
        <button
          className={`fr-tab ${tab === 'pending' ? 'fr-tab-active' : ''}`}
          onClick={() => setTab('pending')}
        >
          Anfragen
          {pending.length > 0 && <span className="fr-count fr-count-red">{pending.length}</span>}
        </button>
        <button
          className={`fr-tab ${tab === 'sent' ? 'fr-tab-active' : ''}`}
          onClick={() => setTab('sent')}
        >
          Gesendet
          {sent.length > 0 && <span className="fr-count">{sent.length}</span>}
        </button>
      </div>

      <div className="fr-body">
        {loading ? (
          <div className="fr-loading"><div className="fr-spinner" /></div>
        ) : (
          <>
            {/* ── Freunde ── */}
            {tab === 'friends' && (
              friendsList.length === 0 ? (
                <div className="fr-empty">
                  <div className="fr-empty-icon">👥</div>
                  <p>Noch keine Freunde</p>
                  <span>Schau dir Profile an und sende Anfragen!</span>
                </div>
              ) : (
                <div className="fr-list">
                  {friendsList.map(f => {
                    const fid = f.friend_id || f.id;
                    const age = calcAge(f.date_of_birth);
                    return (
                      <div key={fid} className="fr-row">
                        <div className="fr-row-left" onClick={() => navigate(`/user/${fid}`)}>
                          <Avatar src={f.avatar_url} name={f.name} />
                          <div className="fr-row-info">
                            <p className="fr-row-name">{f.name}{age ? `, ${age}` : ''}</p>
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
                  <p>Keine offenen Anfragen</p>
                </div>
              ) : (
                <div className="fr-list">
                  {pending.map(r => (
                    <div key={r.id} className="fr-row fr-row-request">
                      <div className="fr-row-left" onClick={() => navigate(`/user/${r.requester_id}`)}>
                        <Avatar src={r.requester_avatar} name={r.requester_name} />
                        <div className="fr-row-info">
                          <p className="fr-row-name">{r.requester_name}</p>
                          {r.location && <p className="fr-row-sub">{r.location}</p>}
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
                  <p>Keine gesendeten Anfragen</p>
                </div>
              ) : (
                <div className="fr-list">
                  {sent.map(r => (
                    <div key={r.id} className="fr-row">
                      <div className="fr-row-left" onClick={() => navigate(`/user/${r.addressee_id}`)}>
                        <Avatar src={r.addressee_avatar} name={r.addressee_name} />
                        <div className="fr-row-info">
                          <p className="fr-row-name">{r.addressee_name}</p>
                          <p className="fr-row-sub">Ausstehend</p>
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
