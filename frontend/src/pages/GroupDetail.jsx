import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { groups, clubs } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ReportModal } from '../components/ReportModal';
import { BoostModal } from '../components/BoostModal';
import '../styles/group-detail.css';

const formatGroupDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return d.toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatGroupTime = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' Uhr';
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

        // Load favorite status
        const favRes = await (isClubType ? clubs.getFavorites() : groups.getFavorites()).catch(() => ({ data: [] }));
        setIsFavorited((favRes.data || []).some(f => f.id === parseInt(id, 10)));

        setGroup(entity);
        setIsJoined(joinedList.some((g) => g.id === parseInt(id, 10)));
        setMembers(membersRes.data);
      } catch (error) {
        console.error('Error fetching group details:', error);
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
      const isClubType = group?.type === 'club';
      isClubType ? await clubs.toggleFavorite(id) : await groups.toggleFavorite(id);
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
        setMembers(prev => [{ id: user.id, name: user.name, avatar_url: user.avatar_url, location: user.location }, ...prev]);
      }
      const response = group?.type === 'club' ? await clubs.getById(id) : await groups.getById(id);
      setGroup(response.data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Fehler beim Beitreten/Verlassen');
    }
  };

  if (loading) return <div className="loading">Laden...</div>;
  if (!group) return <div className="error">Gruppe nicht gefunden</div>;

  const isClub = group.type === 'club';
  const isOwner = user && group.owner_id === user.id;
  const formattedDate = formatGroupDate(group.date);
  const formattedTime = formatGroupTime(group.date);

  return (
    <div className="gd-page">

      {/* Header */}
      <div className="gd-header">
        {group.image_url ? (
          <img src={group.image_url} alt={group.name} className="gd-cover" />
        ) : (
          <div className="gd-cover-gradient-bg" />
        )}
        <div className="gd-cover-overlay" />

        <button className="gd-back-btn" onClick={() => navigate(-1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>

        <div className="gd-header-content">
          <div className="gd-badges">
            <span className={`gd-badge type-${isClub ? 'club' : 'group'}`}>
              {isClub ? 'Club' : 'Gruppe'}
            </span>
            {group.category && (
              <span className="gd-badge category">{group.category}</span>
            )}
          </div>
          <h1 className="gd-title">{group.name || group.title}</h1>
        </div>
      </div>

      {/* Body */}
      <div className="gd-body">

        {/* Meta */}
        <div className="gd-meta">
          <div className="gd-meta-card">
            <div className="gd-meta-label">Organisiert von</div>
            <div className="gd-meta-owner">
              <div className="gd-owner-avatar">
                {group.owner_avatar
                  ? <img src={group.owner_avatar} alt={group.owner_name} />
                  : group.owner_name?.[0]?.toUpperCase()}
              </div>
              <span className="gd-owner-name">{group.owner_name}</span>
            </div>
          </div>
          <div className="gd-meta-card">
            <div className="gd-meta-label">Mitglieder</div>
            <div className="gd-member-count">
              {group.members_count ?? group.member_count ?? 0}
              <span> / {group.max_members || '∞'}</span>
            </div>
          </div>
        </div>

        {/* Info Pills */}
        {(formattedDate || formattedTime || group.location || group.skill_level) && (
          <div className="gd-info-pills">
            {formattedDate && (
              <span className="gd-pill"><span className="gd-pill-icon">📅</span>{formattedDate}</span>
            )}
            {formattedTime && (
              <span className="gd-pill"><span className="gd-pill-icon">🕐</span>{formattedTime}</span>
            )}
            {group.location && (
              <span className="gd-pill"><span className="gd-pill-icon">📍</span>{group.location}</span>
            )}
            {group.skill_level && group.skill_level !== 'Alle Levels' && (
              <span className="gd-pill"><span className="gd-pill-icon">⚡</span>{group.skill_level}</span>
            )}
          </div>
        )}

        {/* Description */}
        {group.description && (
          <>
            <h3 className="gd-section-title">Über {isClub ? 'diesen Club' : 'diese Gruppe'}</h3>
            <p className="gd-description">{group.description}</p>
          </>
        )}

        {/* Action Buttons */}
        <div className="gd-actions">
          {isJoined ? (
            <>
              <button className="gd-btn-chat" onClick={() => navigate(`/chat/${group.id}`)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Chat öffnen
              </button>
              <button className="gd-btn-leave" onClick={handleJoinToggle}>Verlassen</button>
            </>
          ) : (
            <button className="gd-btn-join" onClick={handleJoinToggle}>
              {isClub ? 'Club beitreten' : 'Gruppe beitreten'}
            </button>
          )}
          <button
            className={`gd-btn-fav${isFavorited ? ' active' : ''}`}
            onClick={handleFavoriteToggle}
            title={isFavorited ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorited ? '#FD7666' : 'none'} stroke={isFavorited ? '#FD7666' : 'currentColor'} strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
        </div>

        {/* Members */}
        <div className="gd-members">
          <h3 className="gd-section-title">Mitglieder</h3>
          {members.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Noch keine Mitglieder. Sei der Erste!</p>
          ) : (
            members.map(member => (
              <div key={member.id} className="gd-member-item" onClick={() => navigate(`/user/${member.id}`)}>
                <div className="gd-member-avatar">
                  {member.avatar_url
                    ? <img src={member.avatar_url} alt={member.name} />
                    : (member.name || '?')[0].toUpperCase()}
                </div>
                <div>
                  <div className="gd-member-name">{member.name}</div>
                  <div className="gd-member-location">{member.location || 'Kein Standort'}</div>
                </div>
                {member.id === group.owner_id && (
                  <span className="gd-member-role">Owner</span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Boost (owner only) */}
        {isOwner && (
          <button className="gd-boost-btn" onClick={() => setShowBoostModal(true)}>
            🚀 {isClub ? 'Club' : 'Gruppe'} boosten
          </button>
        )}

        {/* Report */}
        <button className="gd-report-btn" onClick={() => setShowReportModal(true)}>
          {isClub ? 'Club melden' : 'Gruppe melden'}
        </button>
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
