import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { admin } from '../utils/api';
import { AdminDealsSection } from '../components/AdminDealsSection';

const downloadCSV = (data, filename) => {
  if (!data?.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => JSON.stringify(row[h] ?? '')).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

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
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-DE';
  const [stats, setStats] = useState(null);
  const [screens, setScreens] = useState([]);
  const [recentUsers, setRecentUsers] = useState([]);
  const [pendingClubs, setPendingClubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportLoading, setExportLoading] = useState('');
  const [clubActionId, setClubActionId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, screensRes, usersRes, clubsRes] = await Promise.all([
        admin.getStats(),
        admin.getScreenTime(),
        admin.getUsers(20),
        admin.getPendingClubs().catch(() => ({ data: [] })),
      ]);
      setStats(statsRes.data);
      setScreens(screensRes.data || []);
      setRecentUsers(usersRes.data || []);
      setPendingClubs(clubsRes.data || []);
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

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a2e', padding: '24px 16px', paddingBottom: 60 }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ color: '#FD7666', fontSize: 24, fontWeight: 800 }}>{t('admin.title')}</h1>
          <button onClick={load} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 13 }}>
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
          <KPICard label={t('admin.kpis.reviews')} value={stats?.reviews?.total} />
        </div>

        {/* Sponsored cooperations (Kooperationen) */}
        <AdminDealsSection />

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
                        {t('admin.pendingClubs.createdBy')} <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{club.owner_name || '–'}</strong> ({club.owner_email || '–'})
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
                        {s.avg_duration_sec != null ? `${Math.round(s.avg_duration_sec)}s` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {stats?.suggestions?.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
              {t('admin.sections.categorySuggestions')}
            </h2>
            <div style={{ background: 'var(--bg-card, #1e2235)', borderRadius: 16, padding: '16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {stats.suggestions.map((s, i) => (
                <span key={i} style={{
                  background: 'rgba(255,255,255,0.08)', borderRadius: 8,
                  padding: '6px 12px', fontSize: 13, color: '#fff',
                }}>
                  {s.suggestion} <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>×{s.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {recentUsers.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
              {t('admin.sections.newUsers')}
            </h2>
            <div style={{ background: 'var(--bg-card, #1e2235)', borderRadius: 16, overflow: 'hidden' }}>
              {recentUsers.map((u, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  borderBottom: i < recentUsers.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: '#FD7666', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden',
                  }}>
                    {u.avatar_url
                      ? <img src={u.avatar_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : u.name?.[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                      {u.name}
                      {u.is_trusted_user && <span style={{ color: '#4ade80', marginLeft: 6, fontSize: 12 }}>✓</span>}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{u.email}</div>
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, flexShrink: 0 }}>
                    {new Date(u.created_at).toLocaleDateString(dateLocale)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
      </div>
    </div>
  );
};

export default AdminDashboard;
