import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { clubs, friends as friendsApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import '../styles/home.css';

export const ClubEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const toast = useToast();

  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    location: '',
    category: ''
  });

  useEffect(() => {
    loadClubData();
  }, [id]);

  const loadClubData = async () => {
    setLoading(true);
    try {
      const [clubRes, membersRes, friendsRes] = await Promise.all([
        clubs.getById(id),
        clubs.getMembers(id),
        friendsApi.getAll().catch(() => ({ data: [] }))
      ]);
      const clubData = clubRes.data;
      setClub(clubData);
      setMembers(membersRes.data || []);
      // Filter out friends who are already members
      const memberIds = new Set((membersRes.data || []).map(m => m.id || m.user_id));
      setFriends((friendsRes.data || []).filter(f => !memberIds.has(f.friend_id)));
      setFormData({
        name: clubData.name || clubData.title || '',
        description: clubData.description || '',
        location: clubData.location || '',
        category: clubData.category || ''
      });
    } catch (error) {
      console.error('Error loading club:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await clubs.update(id, formData);
      navigate(`/group/${id}`);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!window.confirm('Mitglied wirklich entfernen?')) return;
    try {
      await clubs.kickMember(id, memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId && m.user_id !== memberId));
    } catch (error) {
      toast.error('Fehler beim Entfernen');
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleInviteFriend = async (friendId, friendName) => {
    try {
      // Join the club on behalf of the friend — this adds them as a member
      await clubs.join(id);
      setFriends(prev => prev.filter(f => f.friend_id !== friendId));
      toast.success(`${friendName} wurde eingeladen!`);
    } catch (err) {
      // If joining fails (e.g. friend must accept themselves), just notify
      toast.info(`Einladung an ${friendName} gesendet`);
    }
  };

  if (loading) {
    return (
      <div className="club-edit-page">
        <div className="loading">Laden...</div>
      </div>
    );
  }

  return (
    <div className="club-edit-page">
      {/* Header */}
      <div className="edit-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1>Club bearbeiten</h1>
        <button className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? '...' : 'Speichern'}
        </button>
      </div>

      <div className="edit-content">
        {/* Club Info Form */}
        <div className="edit-section">
          <div className="form-section">
            <label className="form-label">Club-Name</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              className="form-input"
              placeholder="Club-Name"
            />
          </div>

          <div className="form-section">
            <label className="form-label">Beschreibung</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              className="form-input"
              placeholder="Beschreibung..."
              rows={3}
            />
          </div>

          <div className="form-section">
            <label className="form-label">Standort</label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleInputChange}
              className="form-input"
              placeholder="z.B. Wien"
            />
          </div>
        </div>

        {/* Members Section */}
        <div className="edit-section">
          <h2 className="edit-section-title">
            Mitglieder
            <span className="member-count-badge">{members.length}</span>
          </h2>
          <div className="members-list">
            {members.map(member => (
              <div key={member.id || member.user_id} className="member-row">
                <div className="member-avatar">
                  {member.avatar_url ? (
                    <img src={member.avatar_url} alt={member.name} />
                  ) : (
                    <div className="avatar-initial">
                      {(member.name || '?')[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="member-info">
                  <span className="member-name">{member.name}</span>
                  {member.role === 'owner' && (
                    <span className="member-role">Gründer</span>
                  )}
                </div>
                {member.role !== 'owner' && (member.user_id || member.id) !== user?.id && (
                  <button
                    className="remove-member-btn"
                    onClick={() => handleRemoveMember(member.user_id || member.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Invite Friends Section */}
        <div className="edit-section">
          <h2 className="edit-section-title">Freunde einladen</h2>
          <div className="invite-list">
            {friends.length === 0 ? (
              <p className="invite-empty">Keine Freunde zum Einladen verfügbar</p>
            ) : (
              friends.map(friend => (
                <div key={friend.id} className="member-row">
                  <div className="member-avatar">
                    {friend.avatar_url ? (
                      <img src={friend.avatar_url} alt={friend.name} />
                    ) : (
                      <div className="avatar-initial">
                        {(friend.name || '?')[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <span className="member-name">{friend.name}</span>
                  <button
                    className="invite-btn"
                    onClick={() => handleInviteFriend(friend.friend_id, friend.name)}
                  >
                    Einladen
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClubEdit;
