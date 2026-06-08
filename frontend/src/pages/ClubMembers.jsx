import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clubs } from '../utils/api';
import { useToast } from '../context/ToastContext';
import '../styles/club-detail.css';

const calcAge = (dob) => {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob)) / 31557600000);
};

export const ClubMembers = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();

  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const [clubRes, membersRes] = await Promise.all([
          clubs.getById(id),
          clubs.getMembers(id).catch(() => ({ data: [] })),
        ]);
        if (controller.signal.aborted) return;
        setClub(clubRes.data);
        const memberData = membersRes.data;
        setMembers(Array.isArray(memberData) ? memberData : (memberData?.members || []));
      } catch {
        if (!controller.signal.aborted) toast.error(t('clubMembers.toast.loadError'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [id]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? members.filter(m => (m.name || '').toLowerCase().includes(q))
    : members;

  return (
    <div className="cd-page">
      <div className="cd-scroll">
        {/* Top bar */}
        <div className="cd-top-bar">
          <button
            className="cd-back-btn"
            onClick={() => navigate(`/club/${id}`)}
            aria-label={t('clubMembers.back')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <h1 className="cd-top-title">
            {club?.name ? `${t('clubMembers.titlePrefix')} ${club.name}` : t('clubMembers.title')}
          </h1>
          <div style={{ width: 40 }} />
        </div>

        <div className="cd-members-page-body">
          {/* Search */}
          <div className="cd-members-search-wrap">
            <input
              type="text"
              className="cd-members-search"
              placeholder={t('clubMembers.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {members.length > 0 && (
              <span className="cd-members-page-count">
                {filtered.length} / {members.length}
              </span>
            )}
          </div>

          {loading ? (
            <p className="cd-events-empty">{t('clubMembers.loading')}</p>
          ) : filtered.length === 0 ? (
            <div className="cd-events-empty-state">
              <div className="cd-events-empty-icon">🔍</div>
              <p>{q ? t('clubMembers.emptySearch') : t('clubMembers.emptyAll')}</p>
            </div>
          ) : (
            <div className="cd-members-list cd-members-list--full">
              {filtered.map(m => {
                const age = calcAge(m.date_of_birth);
                const isOwner = club && club.owner_id === m.id;
                return (
                  <button
                    key={m.id}
                    className="cd-member-row"
                    onClick={() => navigate(`/user/${m.id}`)}
                  >
                    {m.avatar_url ? (
                      <img
                        src={m.avatar_url}
                        alt={m.name || ''}
                        className="cd-member-row-avatar"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="cd-member-row-avatar cd-member-row-avatar--placeholder">
                        {(m.name || '?')[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="cd-member-row-info">
                      <span className="cd-member-row-name">
                        {m.name || t('clubMembers.unknownName')}
                        {age != null && <span className="cd-member-row-age">, {age}</span>}
                      </span>
                      {isOwner && (
                        <span className="cd-member-row-tag">{t('clubMembers.ownerTag')}</span>
                      )}
                    </div>
                    {m.is_trusted_user && (
                      <span className="cd-member-row-trusted">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20,6 9,17 4,12"/>
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClubMembers;
