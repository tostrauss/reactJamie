import { useState, useCallback, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { admin } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { AdminDealsSection } from '../components/AdminDealsSection';
import { AdminGrowthSection } from '../components/AdminGrowthSection';
import { AdminFeedbackSection } from '../components/AdminFeedbackSection';
import { AdminUserModal } from '../components/AdminUserModal';
import { UserName } from '../components/UserName';
import { downloadCSV } from '../utils/csv';

const KPICard = ({ label, value, sub }) => (
  <div style={{
    background: 'var(--bg-card, #1e2235)',
    borderRadius: 16,
    padding: '20px',
    flex: '1 1 140px',
    minWidth: 140,
  }}>
    <div style={{ fontSize: 28, fontWeight: 800, color: '#FD7666' }}>{value ?? '—'}</div>
    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginTop: 4 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{sub}</div>}
  </div>
);

export const AdminDashboard = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it-IT' : ((i18n.resolvedLanguage || i18n.language || 'de').startsWith('fr') ? 'fr-FR' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('es') ? 'es-ES' : 'de-DE');
  const [stats, setStats] = useState(null);
  const [screens, setScreens] = useState([]);
  const [pendingClubs, setPendingClubs] = useState([]);
  const [topClubs, setTopClubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportLoading, setExportLoading] = useState('');
  const [clubActionId, setClubActionId] = useState(null);
  const [managingUser, setManagingUser] = useState(null);
  const { user: authUser } = useContext(AuthContext) || {};

  // ---- Users panel (searchable + paginated) -------------------------------
  // Loaded independently of the rest of the dashboard so a search keystroke
  // re-queries just the user list, not the whole stats payload.
  const USERS_PAGE_SIZE = 50;
  const [users, setUsers] = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);

  // Stable (empty deps) so the debounce effect below only re-runs on
  // userSearch change, not on every users-array update.
  const loadUsers = useCallback(async ({ reset = false, search = '', offset = 0 } = {}) => {
    setUsersLoading(true);
    try {
      const res = await admin.getUsers({ limit: USERS_PAGE_SIZE, offset, search });
      // Backwards-tolerant: old backend returned a bare array, new one
      // returns { users, total }.
      const data = res.data;
      const rows = Array.isArray(data) ? data : (data.users || []);
      const total = Array.isArray(data) ? rows.length : (data.total ?? rows.length);
      setUsers(prev => (reset ? rows : [...prev, ...rows]));
      setUserTotal(total);
    } catch {
      // Non-fatal: leave the existing list in place rather than blanking it.
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Debounced search — also handles the initial load (userSearch starts '').
  useEffect(() => {
    const term = userSearch.trim();
    const h = setTimeout(() => loadUsers({ reset: true, search: term, offset: 0 }), 300);
    return () => clearTimeout(h);
  }, [userSearch, loadUsers]);

  // Role change from the manage modal: patch the row in place. KPIs refresh on
  // the next dashboard reload — stale-ish numbers for a few seconds are fine.
  const handleUserUpdated = (updated) => {
    setUsers(prev => prev.map(u => (u.id === updated.id ? { ...u, ...updated } : u)));
    setManagingUser(prev => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
  };

  // Deletion from the manage modal: drop the row + decrement the total.
  const handleUserDeleted = (id) => {
    setUsers(prev => prev.filter(u => u.id !== id));
    setUserTotal(prev => Math.max(0, prev - 1));
  };

  // ---- Online users (live presence) ---------------------------------------
  // Polled every 30s — cheap on the server (reads the Socket.IO connection
  // map). Stays null while loading or when the backend route doesn't exist
  // yet (old deployment) → the section simply doesn't render.
  const [onlineUsers, setOnlineUsers] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const fetchOnline = () =>
      admin.getOnlineUsers()
        .then(res => { if (!cancelled) setOnlineUsers(res.data); })
        .catch(() => {}); // tolerant: keep last state on error / missing route
    fetchOnline();
    const iv = setInterval(fetchOnline, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, screensRes, clubsRes, topClubsRes] = await Promise.all([
        admin.getStats(),
        admin.getScreenTime(),
        admin.getPendingClubs().catch(() => ({ data: [] })),
        // Tolerant of missing route on old backends: returns []
        admin.getTopClubs(30, 20).catch(() => ({ data: [] })),
      ]);
      setStats(statsRes.data);
      setScreens(screensRes.data || []);
      setPendingClubs(clubsRes.data || []);
      setTopClubs(topClubsRes.data || []);
    } catch (err) {
      if (err.response?.status === 401) {
        navigate('/login');
      } else if (err.response?.status === 403) {
        setError(t('admin.errorAccess'));
      } else {
        setError(t('admin.errorLoad'));
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (type) => {
    setExportLoading(type);
    try {
      let res;
      if (type === 'users') res = await admin.exportUsers();
      else if (type === 'screens') res = await admin.exportScreens();
      else res = await admin.exportSuggestions();
      downloadCSV(res.data, `jamie_${type}_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      alert(t('admin.export.error'));
    } finally {
      setExportLoading('');
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#1a1a2e', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={{ color: '#f87171', fontSize: 16, textAlign: 'center', marginBottom: 16 }}>{error}</p>
        <button onClick={() => navigate('/')} style={{ color: '#FD7666', background: 'none', border: 'none', fontSize: 14, cursor: 'pointer' }}>
          {t('admin.backToApp')}
        </button>
      </div>
    );
  }

  const u = stats?.users || {};
  const g = stats?.groups || {};

  const d = stats?.deal_redemptions || {};

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#1a1a2e',
      // Reserve the iOS Dynamic Island / Android status bar so the back button
      // and title aren't trapped under the notch — previously the header sat
      // at y=24 with no inset, which on iPhone 15+ landed under the camera.
      // bottom 68px = flat nav clearance (flush 48px strip + "+" protrusion,
      // no safe-area — see .bottom-nav in global.css)
      padding: 'calc(16px + env(safe-area-inset-top, 0px)) 16px 68px',
    }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button
            onClick={() => navigate(-1)}
            aria-label={t('admin.backToApp')}
            style={{
              background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%',
              width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#fff', flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <h1 style={{ color: '#FD7666', fontSize: 24, fontWeight: 800, margin: 0, flex: 1 }}>{t('admin.title')}</h1>
          <button
            onClick={() => { load(); loadUsers({ reset: true, search: userSearch.trim(), offset: 0 }); }}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 13 }}
          >
            {t('admin.refresh')}
          </button>
        </div>

        <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('admin.sections.users')}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
          <KPICard label={t('admin.kpis.total')} value={u.total} />
          <KPICard label={t('admin.kpis.today')} value={u.today} />
          <KPICard label={t('admin.kpis.thisWeek')} value={u.this_week} />
          <KPICard label={t('admin.kpis.thisMonth')} value={u.this_month} />
        </div>

        <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('admin.sections.groupsEvents')}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 32 }}>
          <KPICard label={t('admin.kpis.groups')} value={g.total_groups} />
          <KPICard label={t('admin.kpis.clubs')} value={g.total_clubs} />
        </div>

        {/* Growth & cohorts — investor headline (DAU/MAU, retention,
            engagement over time). Self-loading + tolerant of a missing route
            on old backends, so it renders independently of the stats payload. */}
        <AdminGrowthSection />

        {/* Cooperation redemption KPIs — sales-facing performance read at a
            glance. Sits above the deals CRUD list so opening /admin shows
            the headline number before the admin scrolls. */}
        <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('admin.sections.dealRedemptions')}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 32 }}>
          {/* Number(): pg can deliver COUNT as string, and i18next only
              plural-resolves numeric counts — a string count falls back to
              the (nonexistent) base key and renders it raw. */}
          <KPICard label={t('admin.kpis.redemptionsTotal')} value={d.total} sub={t('admin.kpis.redemptionsTotalSub', { count: Number(d.distinct_deals_redeemed) || 0 })} />
          <KPICard label={t('admin.kpis.today')} value={d.today} />
          <KPICard label={t('admin.kpis.thisWeek')} value={d.this_week} />
          <KPICard label={t('admin.kpis.thisMonth')} value={d.this_month} />
        </div>

        {/* Sponsored cooperations (Kooperationen) */}
        <AdminDealsSection />

        {/* In-app feedback (FeedbackModal submissions). Placed above the club
            queue: fresh bug reports should be seen before slower CRUD work. */}
        <AdminFeedbackSection />

        {/* Approval queue for user-created clubs (#14) */}
        <div id="clubs-pending" style={{ marginBottom: 32 }}>
          <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
            {t('admin.sections.pendingClubsFmt', { count: pendingClubs.length })}
          </h2>
          {pendingClubs.length === 0 ? (
            <div style={{ background: 'var(--bg-card, #1e2235)', borderRadius: 16, padding: 20, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
              {t('admin.pendingClubs.empty')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingClubs.map(club => (
                <div key={club.id} style={{ background: 'var(--bg-card, #1e2235)', borderRadius: 16, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#FD7666' }}>{club.name}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                        {club.category || t('admin.pendingClubs.noCategory')} · {club.location || t('admin.pendingClubs.noPlace')} · {new Date(club.created_at).toLocaleDateString(dateLocale)}
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                        {t('admin.pendingClubs.createdBy')} <strong style={{ color: 'rgba(255,255,255,0.7)' }}><UserName name={club.owner_name || '–'} age={club.owner_age} /></strong> ({club.owner_email || '–'})
                      </div>
                    </div>
                    {club.image_url && (
                      <img src={club.image_url} alt="" style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }} />
                    )}
                  </div>
                  {club.description && (
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '8px 0', lineHeight: 1.5 }}>
                      {club.description}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button
                      disabled={clubActionId === club.id}
                      onClick={async () => {
                        setClubActionId(club.id);
                        try {
                          await admin.approveClub(club.id);
                          setPendingClubs(prev => prev.filter(c => c.id !== club.id));
                        } catch {
                          alert(t('admin.pendingClubs.approveError'));
                        } finally {
                          setClubActionId(null);
                        }
                      }}
                      style={{
                        flex: 1, padding: '10px 16px', borderRadius: 10,
                        border: 'none', background: '#4ade80', color: '#0a0a0a',
                        fontWeight: 700, fontSize: 13, cursor: 'pointer',
                        opacity: clubActionId === club.id ? 0.6 : 1,
                      }}
                    >
                      {clubActionId === club.id ? t('admin.pendingClubs.approving') : t('admin.pendingClubs.approve')}
                    </button>
                    <button
                      disabled={clubActionId === club.id}
                      onClick={async () => {
                        if (!window.confirm(t('admin.pendingClubs.rejectConfirm', { name: club.name }))) return;
                        setClubActionId(club.id);
                        try {
                          await admin.rejectClub(club.id);
                          setPendingClubs(prev => prev.filter(c => c.id !== club.id));
                        } catch {
                          alert(t('admin.pendingClubs.rejectError'));
                        } finally {
                          setClubActionId(null);
                        }
                      }}
                      style={{
                        flex: 1, padding: '10px 16px', borderRadius: 10,
                        border: '1px solid rgba(248, 113, 113, 0.5)', background: 'transparent',
                        color: '#f87171', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                        opacity: clubActionId === club.id ? 0.6 : 1,
                      }}
                    >
                      {t('admin.pendingClubs.reject')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {screens.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
              {t('admin.sections.topPages')}
            </h2>
            <div style={{ background: 'var(--bg-card, #1e2235)', borderRadius: 16, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{t('admin.topPages.page')}</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{t('admin.topPages.views')}</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{t('admin.topPages.avgDuration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {screens.map((s, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '12px 16px', color: '#fff' }}>{s.screen_name}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#FD7666', fontWeight: 700 }}>{s.views}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>
                        {s.avg_duration_ms != null ? `${Math.round(s.avg_duration_ms / 1000)}s` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Top Clubs / Groups by per-entity view count (subject_id ⨯ groups).
            Answers "wie oft wird *ein* Club aufgerufen" — the Top Seiten
            table above only shows ClubDetail in aggregate. */}
        {topClubs.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
              {t('admin.sections.topClubs')}
            </h2>
            <div style={{ background: 'var(--bg-card, #1e2235)', borderRadius: 16, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{t('admin.topClubs.name')}</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{t('admin.topClubs.views')}</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{t('admin.topClubs.uniqueUsers')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topClubs.map((c) => (
                    <tr key={`${c.screen_name}-${c.id}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '12px 16px', color: '#fff' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 10, padding: '2px 6px', borderRadius: 6,
                            background: c.type === 'club' ? 'rgba(253, 118, 102, 0.18)' : 'rgba(96, 165, 250, 0.18)',
                            color: c.type === 'club' ? '#FD7666' : '#60a5fa',
                            textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700,
                          }}>
                            {t(c.type === 'club' ? 'admin.topClubs.club' : 'admin.topClubs.group')}
                          </span>
                          <span style={{ opacity: c.is_deleted ? 0.5 : 1 }}>{c.name}</span>
                          {c.is_deleted && (
                            <span style={{ fontSize: 11, color: 'rgba(248,113,113,0.85)' }}>{t('admin.topClubs.deleted')}</span>
                          )}
                          {c.category && !c.is_deleted && (
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>· {c.category}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#FD7666', fontWeight: 700 }}>{c.views}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>{c.unique_users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Backend returns `category_suggestions` rows of { suggestion, votes };
            the old `suggestions`/`count` keys never matched, so this section
            was always empty. */}
        {stats?.category_suggestions?.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
              {t('admin.sections.categorySuggestions')}
            </h2>
            <div style={{ background: 'var(--bg-card, #1e2235)', borderRadius: 16, padding: '16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {stats.category_suggestions.map((s, i) => (
                <span key={i} style={{
                  background: 'rgba(255,255,255,0.08)', borderRadius: 8,
                  padding: '6px 12px', fontSize: 13, color: '#fff',
                }}>
                  {s.suggestion} <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>×{s.votes}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 32 }}>
          <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
            {t('admin.sections.allUsersFmt', { count: userTotal })}
          </h2>

          {/* Server-side search across name / email / location (and exact id). */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <input
              type="search"
              inputMode="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder={t('admin.users.searchPlaceholder')}
              aria-label={t('admin.users.searchPlaceholder')}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-card, #1e2235)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
                padding: '12px 40px 12px 14px', color: '#fff', fontSize: 14, outline: 'none',
              }}
            />
            {userSearch && (
              <button
                onClick={() => setUserSearch('')}
                aria-label={t('admin.users.clearSearch')}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%',
                  width: 26, height: 26, color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                }}
              >
                ✕
              </button>
            )}
          </div>

          <div style={{ background: 'var(--bg-card, #1e2235)', borderRadius: 16, overflow: 'hidden' }}>
            {users.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                {usersLoading ? t('admin.users.loading') : t('admin.users.empty')}
              </div>
            ) : users.map((u, i) => (
              <div key={u.id ?? i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                borderBottom: i < users.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              }}>
                <div
                  onClick={() => navigate(`/user/${u.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/user/${u.id}`); }}
                  title={t('admin.users.viewProfile')}
                  aria-label={t('admin.users.viewProfile')}
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: '#FD7666', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden', cursor: 'pointer',
                  }}>
                  {u.avatar_url
                    ? <img src={u.avatar_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : u.name?.[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                    <UserName name={u.name} age={u.age} />
                    {u.is_admin && <span style={{ color: '#FD7666', marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>ADMIN</span>}
                    {u.is_trusted_user && <span style={{ color: '#4ade80', marginLeft: 6, fontSize: 12 }}>✓</span>}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                </div>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, flexShrink: 0, textAlign: 'right' }}>
                  {new Date(u.created_at).toLocaleDateString(dateLocale)}
                </div>
                <button
                  onClick={() => setManagingUser(u)}
                  title={t('admin.userModal.manage')}
                  aria-label={t('admin.userModal.manage')}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.18)',
                    color: 'rgba(255,255,255,0.8)',
                    borderRadius: 8,
                    width: 34, height: 30,
                    fontSize: 16, fontWeight: 700, lineHeight: 1,
                    cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  ⋯
                </button>
              </div>
            ))}
          </div>

          {/* "Mehr laden" — only when there are more rows than currently shown.
              Search is server-side, so total reflects the filtered set. */}
          {users.length < userTotal && (
            <button
              onClick={() => loadUsers({ reset: false, search: userSearch.trim(), offset: users.length })}
              disabled={usersLoading}
              style={{
                width: '100%', marginTop: 12, padding: '12px 16px', borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
                color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: usersLoading ? 'wait' : 'pointer', opacity: usersLoading ? 0.5 : 1,
              }}
            >
              {usersLoading
                ? t('admin.users.loading')
                : t('admin.users.loadMoreFmt', { shown: users.length, total: userTotal })}
            </button>
          )}
        </div>

        <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('admin.sections.csvExport')}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {['users', 'screens', 'suggestions'].map(key => (
            <button
              key={key}
              onClick={() => handleExport(key)}
              disabled={exportLoading === key}
              style={{
                padding: '12px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)',
                background: 'transparent', color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: 'pointer', opacity: exportLoading === key ? 0.5 : 1,
              }}
            >
              {exportLoading === key ? t('admin.export.loading') : `⬇ ${t(`admin.export.${key}`)}`}
            </button>
          ))}
        </div>

        {/* Online users — live Socket.IO presence, polled every 30s. Sits at
            the very bottom (Tobi, 2026-07-06). Hidden until the first
            successful fetch, so old backends without the route show nothing. */}
        {onlineUsers !== null && (
          <div style={{ marginTop: 32 }}>
            <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: '#4ade80',
                boxShadow: '0 0 6px rgba(74,222,128,0.8)', display: 'inline-block', flexShrink: 0,
              }} />
              {t('admin.sections.onlineNowFmt', { count: onlineUsers.count })}
            </h2>
            <div style={{ background: 'var(--bg-card, #1e2235)', borderRadius: 16, overflow: 'hidden' }}>
              {(onlineUsers.users || []).length === 0 ? (
                <div style={{ padding: 20, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                  {t('admin.online.empty')}
                </div>
              ) : onlineUsers.users.map((u, i) => (
                <div key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  borderBottom: i < onlineUsers.users.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: '#FD7666', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden',
                    }}>
                      {u.avatar_url
                        ? <img src={u.avatar_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : u.name?.[0]?.toUpperCase()}
                    </div>
                    {/* Green presence dot on the avatar */}
                    <span style={{
                      position: 'absolute', right: -1, bottom: -1, width: 10, height: 10,
                      borderRadius: '50%', background: '#4ade80',
                      border: '2px solid var(--bg-card, #1e2235)',
                    }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                      {u.name}
                      {u.is_admin && <span style={{ color: '#FD7666', marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>ADMIN</span>}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, flexShrink: 0, textAlign: 'right' }}>
                    {t('admin.online.sinceFmt', { time: new Date(u.connected_at).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' }) })}
                    {u.sockets > 1 && (
                      <div style={{ color: 'rgba(255,255,255,0.25)' }}>
                        {t('admin.online.devicesFmt', { count: u.sockets })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {managingUser && (
        <AdminUserModal
          user={managingUser}
          currentUserId={authUser?.id}
          onClose={() => setManagingUser(null)}
          onUpdated={handleUserUpdated}
          onDeleted={handleUserDeleted}
        />
      )}
    </div>
  );
};

export default AdminDashboard;
