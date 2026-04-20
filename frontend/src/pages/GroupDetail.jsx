import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { groups, clubs } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ReportModal } from '../components/ReportModal';
import { BoostModal } from '../components/BoostModal';
import '../styles/group-detail.css';

const formatHeaderDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const weekday = d.toLocaleDateString('de-AT', { weekday: 'long' });
  const day = d.getDate();
  const month = d.getMonth() + 1;
  return `${weekday} - ${day}.${month}.`;
};

const formatShortDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return `${d.getDate()}.${d.getMonth() + 1}.`;
};

export const GroupDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const toast = useToast();

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showBoostModal, setShowBoostModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        let groupRes, membersRes, joinedGroupsRes, joinedClubsRes;
        try {
          [groupRes, joinedGroupsRes, membersRes] = await Promise.all([
            groups.getById(id),
            groups.getJoined(),
            groups.getMembers(id)
          ]);
        } catch {
          [groupRes, joinedClubsRes, membersRes] = await Promise.all([
            clubs.getById(id),
            clubs.getJoined(),
            clubs.getMembers(id)
          ]);
        }
        const entity = groupRes.data;
        const isClubType = entity.type === 'club';
        const joinedList = [
          ...(joinedGroupsRes?.data || []),
          ...(joinedClubsRes?.data || [])
        ];
        const favRes = await (isClubType ? clubs.getFavorites() : groups.getFavorites()).catch(() => ({ data: [] }));
        setIsFavorited((favRes.data || []).some(f => f.id === parseInt(id, 10)));
        setGroup(entity);
        setIsJoined(joinedList.some((g) => g.id === parseInt(id, 10)));
        setMembers(membersRes.data);
      } catch (error) {
        toast.error('Gruppe konnte nicht geladen werden');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const handleFavoriteToggle = async () => {
    const wasFav = isFavorited;
    setIsFavorited(!wasFav);
    try {
      group?.type === 'club' ? await clubs.toggleFavorite(id) : await groups.toggleFavorite(id);
    } catch {
      setIsFavorited(wasFav);
      toast.error('Favorit konnte nicht gespeichert werden');
    }
  };

  const handleJoinToggle = async () => {
    try {
      const isClub = group?.type === 'club';
      if (isJoined) {
        isClub ? await clubs.leave(id) : await groups.leave(id);
        setIsJoined(false);
        setMembers(prev => prev.filter(m => m.id !== user.id));
      } else {
        isClub ? await clubs.join(id) : await groups.join(id);
        setIsJoined(true);
        setMembers(prev => [...prev, { id: user.id, name: user.name, avatar_url: user.avatar_url }]);
      }
      const response = group?.type === 'club' ? await clubs.getById(id) : await groups.getById(id);
      setGroup(response.data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Fehler beim Beitreten/Verlassen');
    }
  };

  const handleDelete = async () => {
    const label = group?.type === 'club' ? 'Club' : 'Gruppe';
    if (!window.confirm(`${label} wirklich löschen?`)) return;
    try {
      group?.type === 'club' ? await clubs.delete(id) : await groups.delete(id);
      toast.success(`${label} wurde gelöscht.`);
      navigate('/home');
    } catch (error) {
      toast.error(error.response?.data?.error || `${label} konnte nicht gelöscht werden.`);
    }
  };

  if (loading) return <div className="gd-loading">Laden...</div>;
  if (!group) return <div className="gd-loading">Gruppe nicht gefunden</div>;

  const isClub = group.type === 'club';
  const isOwner = user && group.owner_id === user.id;
  const maxSlots = Math.min(group.max_members || 4, 4);
  const filledSlots = members.slice(0, maxSlots);
  const emptySlots = Math.max(0, maxSlots - filledSlots.length);
  const headerDate = formatHeaderDate(group.date);
  const shortDate = formatShortDate(group.date);

  return (
    <div className="gd-page">
      {/* Top header */}
      <div className="gd-top-bar">
        <button className="gd-back-btn" onClick={() => navigate(-1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="gd-top-title">{headerDate || (group.category || group.name)}</h1>
        <button
          className={`gd-fav-top${isFavorited ? ' active' : ''}`}
          onClick={handleFavoriteToggle}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorited ? '#FD7666' : 'none'} stroke={isFavorited ? '#FD7666' : 'currentColor'} strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
      </div>

      <div className="gd-scroll">
        {/* Photo grid */}
        <div className="gd-photo-grid-wrapper">
          <div className="gd-photo-grid">
            {filledSlots.map((member) => (
              <div
                key={member.id}
                className="gd-photo-slot filled"
                onClick={() => navigate(`/user/${member.id}`)}
              >
                {member.avatar_url
                  ? <img src={member.avatar_url} alt={member.name} />
                  : <div className="gd-photo-placeholder">{(member.name || '?')[0].toUpperCase()}</div>
                }
                {member.age && <span className="gd-photo-age">{member.age}</span>}
                <div className="gd-photo-bottom">
                  <span className="gd-photo-name">{(member.name || '').toUpperCase()}</span>
                  {member.is_trusted_user && (
                    <span className="gd-photo-check">✓</span>
                  )}
                </div>
              </div>
            ))}
            {[...Array(emptySlots)].map((_, i) => (
              <div key={`empty-${i}`} className="gd-photo-slot empty">
                <span className="gd-photo-plus">+</span>
              </div>
            ))}
          </div>
        </div>

        {/* Anfragen / Chat button */}
        <div className="gd-anfragen-row">
          {isJoined ? (
            <button className="gd-anfragen-btn joined" onClick={() => navigate(`/chat/${group.id}`)}>
              Chat öffnen
            </button>
          ) : (
            <button className="gd-anfragen-btn" onClick={handleJoinToggle}>
              Anfragen
            </button>
          )}
        </div>

        <div className="gd-body">
          <div className="gd-content-card">
          {/* Info row */}
          <div className="gd-info-row">
            {group.skill_level && group.skill_level !== 'Alle Levels' && (
              <span className="gd-info-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="#FD7666" stroke="none">
                  <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
                </svg>
                Level: {group.skill_level}
              </span>
            )}
            {shortDate && (
              <span className="gd-info-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Wann: {shortDate}
              </span>
            )}
            <span className="gd-info-item">
              Teilnehmer: {group.members_count ?? members.length}/{group.max_members || '∞'}
            </span>
          </div>

          {/* Group title */}
          <h2 className="gd-group-title">{group.category || group.name || group.title}</h2>

          {/* Description */}
          {group.description && (
            <p className="gd-description">{group.description}</p>
          )}

          {/* Owner actions */}
          {isJoined && (
            <div className="gd-owner-actions">
              {isOwner
                ? <button className="gd-btn-leave" onClick={handleDelete}>{isClub ? 'Club löschen' : 'Gruppe löschen'}</button>
                : <button className="gd-btn-leave" onClick={handleJoinToggle}>Verlassen</button>
              }
              {isOwner && (
                <button className="gd-boost-btn" onClick={() => setShowBoostModal(true)}>
                  🚀 Boosten
                </button>
              )}
            </div>
          )}

          <button className="gd-report-btn" onClick={() => setShowReportModal(true)}>
            {isClub ? 'Club melden' : 'Gruppe melden'}
          </button>
          </div>{/* gd-content-card */}

          {/* Share + Fav buttons */}
          <div className="gd-bottom-actions">
            <button className="gd-action-pill" onClick={() => {
              if (navigator.share) {
                navigator.share({ title: group.category || group.name, url: window.location.href });
              } else {
                navigator.clipboard.writeText(window.location.href);
                toast.success('Link kopiert!');
              }
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
            </button>
            <button className={`gd-action-pill${isFavorited ? ' active' : ''}`} onClick={handleFavoriteToggle}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill={isFavorited ? '#FD7666' : 'none'} stroke={isFavorited ? '#FD7666' : 'currentColor'} strokeWidth="2">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {showReportModal && (
        <ReportModal
          type="group"
          id={parseInt(id)}
          name={group.name || group.title}
          onClose={() => setShowReportModal(false)}
        />
      )}
      {showBoostModal && (
        <BoostModal
          targetType={group.type || 'group'}
          targetId={parseInt(id)}
          targetName={group.name || group.title}
          onClose={() => setShowBoostModal(false)}
        />
      )}
    </div>
  );
};

export default GroupDetail;
