import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clubs, groups } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { UserName } from '../components/UserName';
import '../styles/club-detail.css';

// Serves BOTH /club/:id/members and /group/:id/members — the list UI is
// identical. Groups differ in one way: their members endpoint applies the
// Pro gate (non-members without Pro get only the first 3 + gated flag),
// which we surface as a locked hint row that opens the ProModal.
export const ClubMembers = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { t } = useTranslation();

  const isGroup = location.pathname.startsWith('/group/');
  const entityApi = isGroup ? groups : clubs;

  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [gated, setGated] = useState(false);
  const [totalCount, setTotalCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const [clubRes, membersRes] = await Promise.all([
          entityApi.getById(id),
          entityApi.getMembers(id).catch(() => ({ data: [] })),
        ]);
        if (controller.signal.aborted) return;
        setClub(clubRes.data);
        const memberData = membersRes.data;
        if (Array.isArray(memberData)) {
          setMembers(memberData);
          setGated(false);
          setTotalCount(null);
        } else {
          setMembers(memberData?.members || []);
          setGated(!!memberData?.gated);
          setTotalCount(memberData?.total_count ?? null);
        }
      } catch {
        if (!controller.signal.aborted) toast.error(t('clubMembers.toast.loadError'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [id, isGroup]); // eslint-disable-line react-hooks/exhaustive-deps

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
            // Pop, don't push: pushing the detail page duplicated it in the
            // history, so back FROM the detail page landed here again. Only a
            // deep link (location.key === 'default' — no in-app history) gets
            // the explicit detail-page navigation, as replace.
            onClick={() =>
              location.key !== 'default'
                ? navigate(-1)
                : navigate(isGroup ? `/group/${id}` : `/club/${id}`, { replace: true })
            }
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
                {filtered.length} / {totalCount ?? members.length}
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
                      <UserName
                        className="cd-member-row-name"
                        name={m.name || t('clubMembers.unknownName')}
                        age={m.age}
                      />
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

          {/* Pro gate (groups only): the API returned just the first 3 of
              total_count members. Locked row opens the global ProModal. */}
          {!loading && gated && totalCount > members.length && (
            <button
              className="cd-members-gated"
              onClick={() => window.dispatchEvent(new Event('jamie:open-pro-modal'))}
            >
              <span className="cd-members-gated-lock">🔒</span>
              <span className="cd-members-gated-text">
                {t('clubMembers.gatedHint', { count: totalCount - members.length })}
              </span>
              <span className="cd-members-gated-cta">{t('clubMembers.gatedCta')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClubMembers;
