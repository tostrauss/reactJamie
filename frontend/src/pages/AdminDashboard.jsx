import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { admin } from '../utils/api';

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
  const [stats, setStats] = useState(null);
  const [screens, setScreens] = useState([]);
  const [recentUsers, setRecentUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportLoading, setExportLoading] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, screensRes, usersRes] = await Promise.all([
        admin.getStats(),
        admin.getScreenTime(),
        admin.getUsers(20),
      ]);
      setStats(statsRes.data);
      setScreens(screensRes.data || []);
      setRecentUsers(usersRes.data || []);
    } catch (err) {
      if (err.response?.status === 401) {
        navigate('/login');
      } else if (err.response?.status === 403) {
        setError('Kein Admin-Zugriff. Bitte melde dich mit einem Admin-Account an.');
      } else {
        setError('Fehler beim Laden der Admin-Daten.');
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
      alert('Export fehlgeschlagen');
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
          Zurück zur App
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
          <h1 style={{ color: '#FD7666', fontSize: 24, fontWeight: 800 }}>JAMIE Analytics</h1>
          <button onClick={load} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 13 }}>
            Aktualisieren
          </button>
        </div>

        <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Nutzer
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
          <KPICard label="Gesamt" value={u.total} />
          <KPICard label="Heute" value={u.today} />
          <KPICard label="Diese Woche" value={u.this_week} />
          <KPICard label="Diesen Monat" value={u.this_month} />
          <KPICard label="Vertrauenswürdig" value={u.trusted} />
        </div>

        <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Gruppen & Events
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 32 }}>
          <KPICard label="Gruppen (Events)" value={g.total_groups} />
          <KPICard label="Clubs" value={g.total_clubs} />
          <KPICard label="Bewertungen" value={stats?.reviews} />
        </div>

        {screens.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
              Top Seiten (30 Tage)
            </h2>
            <div style={{ background: 'var(--bg-card, #1e2235)', borderRadius: 16, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>Seite</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>Aufrufe</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>Ø Dauer</th>
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
              Kategorie-Vorschläge
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
              Neue Nutzer
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
                      ? <img src={u.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                    {new Date(u.created_at).toLocaleDateString('de-AT')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>
          CSV Export
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {[
            { key: 'users', label: 'Nutzer exportieren' },
            { key: 'screens', label: 'Seiten exportieren' },
            { key: 'suggestions', label: 'Vorschläge exportieren' },
          ].map(({ key, label }) => (
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
              {exportLoading === key ? '⏳ Exportiere...' : `⬇ ${label}`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
