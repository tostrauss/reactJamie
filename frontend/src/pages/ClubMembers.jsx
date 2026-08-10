import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clubs, groups } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { UserName } from '../components/UserName';
import VerifiedBadge from '../components/VerifiedBadge';
import { isNativeIOS } from '../utils/platform';
import { thumbUrl } from '../utils/images';
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
  const { user } = useContext(AuthContext);

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

  // Only the entity owner sees the per-member remove control (the backend
  // kickMember endpoint is owner-only and rejects anyone else).
  const viewerIsOwner = !!(club && user && Number(club.owner_id) === Number(user.id));

  const handleRemove = async (member) => {
    const name = member.name || t('clubMembers.unknownName');
    if (!window.confirm(t('clubMembers.removeConfirm', { name }))) return;
    try {
      await entityApi.kickMember(id, member.id);
      setMembers(prev => prev.filter(m => m.id !== member.id));
      setTotalCount(prev => (typeof prev === 'number' ? Math.max(0, prev - 1) : prev));
    } catch {
      toast.error(t('clubMembers.toast.removeError'));
    }
  };

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
              // While searching: "matches / total members". Otherwise mirror
              // the detail page's capacity ratio (members / max_members) so the
              // two pages agree — a "10 / 10" here wrongly implied the group was
              // full when its cap is 20. Clubs have no cap → just the count.
              <span className="cd-members-page-count">
                {q
                  ? `${filtered.length} / ${totalCount ?? members.length}`
                  : club?.max_members
                    ? `${totalCount ?? members.length} / ${club.max_members}`
                    : (totalCount ?? members.length)}
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
                const isRowOwner = club && Number(club.owner_id) === Number(m.id);
                // Owner-only: remove any regular member (never the owner, never a
                // club co-manager — the backend enforces the same). Lives here on
                // the full roster so an organiser can clear no-shows without
                // digging into the edit screen (Lea, 2026-07-30).
                const canRemove = viewerIsOwner && !isRowOwner && m.role !== 'admin';
                return (
                  <div
                    key={m.id}
                    className="cd-member-row"
                    onClick={() => navigate(`/user/${m.id}`)}
                  >
                    {m.avatar_url ? (
                      <img
                        src={thumbUrl(m.avatar_url)}
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
                      {isRowOwner && (
                        <span className="cd-member-row-tag">{t('clubMembers.ownerTag')}</span>
                      )}
                    </div>
                    {m.is_trusted_user && (
                      <VerifiedBadge className="cd-member-row-trusted" size={18} />
                    )}
                    {canRemove && (
                      <button
                        type="button"
                        className="cd-member-remove"
                        aria-label={t('clubMembers.remove')}
                        onClick={(e) => { e.stopPropagation(); handleRemove(m); }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pro gate (groups only): the API returned just the first 3 of
              total_count members. Locked row opens the global ProModal.
              Nie auf nativem iOS — kein Pro-Upsell ohne Kaufweg (Apple 3.1.1);
              dort endet die Liste einfach still nach den sichtbaren Einträgen. */}
          {!loading && gated && totalCount > members.length && !isNativeIOS() && (
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
