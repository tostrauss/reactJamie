import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { admin } from '../utils/api';
import { downloadCSV } from '../utils/csv';

// Validated categorical pair (dataviz skill, dark surface): coral #FD7666 (DAU,
// brand accent) + blue #3B82F6 (MAU). CVD separation ΔE 23.5 / normal 33.6 —
// unambiguous under all colour-vision types. Identity is also carried by the
// legend dots + direct end labels, never colour alone.
const C_DAU = '#FD7666';
const C_MAU = '#3B82F6';
const GRID = 'rgba(255,255,255,0.08)';
const INK_MUTED = 'rgba(255,255,255,0.45)';

const H2 = { color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 };
const CARD = { background: 'var(--bg-card, #1e2235)', borderRadius: 16, padding: 20, flex: '1 1 130px', minWidth: 130 };

const fmtDay = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '');
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
// Most recent row whose field is non-null (retention fills in as days elapse).
const latestNonNull = (rows, key) => {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] != null) return rows[i][key];
  return null;
};

const Tile = ({ label, value, sub }) => (
  <div style={CARD}>
    <div style={{ fontSize: 26, fontWeight: 800, color: C_DAU }}>{value ?? '—'}</div>
    <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginTop: 4 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: INK_MUTED, marginTop: 2 }}>{sub}</div>}
  </div>
);

// ── SVG geometry (internal coords, scales responsively via viewBox) ──
const W = 720, HGT = 220, PAD = { l: 40, r: 54, t: 14, b: 26 };
const plotW = W - PAD.l - PAD.r, plotH = HGT - PAD.t - PAD.b;
const xAt = (i, n) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
const yAt = (v, max) => PAD.t + plotH - (max <= 0 ? 0 : (v / max) * plotH);
const niceMax = (m) => {
  if (m <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(m)));
  return Math.ceil(m / pow) * pow;
};

// Shared hover: maps a mouse event to the nearest data index in SVG space.
function useHoverIndex(n) {
  const [idx, setIdx] = useState(null);
  const ref = useRef(null);
  const onMove = useCallback((e) => {
    const svg = ref.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(xAt(i, n) - sx); if (d < bestD) { bestD = d; best = i; } }
    setIdx(best);
  }, [n]);
  return { idx, ref, onMove, onLeave: () => setIdx(null) };
}

function YGrid({ max }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(max * f));
  return (
    <g>
      {ticks.map((v, i) => {
        const y = yAt(v, max);
        return (
          <g key={i}>
            <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke={GRID} strokeWidth="1" />
            <text x={PAD.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill={INK_MUTED}>{v}</text>
          </g>
        );
      })}
    </g>
  );
}

function XLabels({ rows }) {
  const n = rows.length;
  const idxs = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  return (
    <g>
      {idxs.map(i => (
        <text key={i} x={xAt(i, n)} y={HGT - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="10" fill={INK_MUTED}>
          {fmtDay(rows[i]?.day)}
        </text>
      ))}
    </g>
  );
}

// Multi-line chart (DAU + MAU) with legend, direct end labels, hover crosshair.
function LineChart({ rows, lines }) {
  const n = rows.length;
  const max = niceMax(Math.max(1, ...rows.flatMap(r => lines.map(l => Number(r[l.key]) || 0))));
  const { idx, ref, onMove, onLeave } = useHoverIndex(n);
  const path = (key) => rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${xAt(i, n).toFixed(1)},${yAt(Number(r[key]) || 0, max).toFixed(1)}`).join(' ');
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 6 }}>
        {lines.map(l => (
          <span key={l.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#fff' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />{l.label}
          </span>
        ))}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${HGT}`} width="100%" style={{ display: 'block', overflow: 'visible' }}
           onMouseMove={onMove} onMouseLeave={onLeave}>
        <YGrid max={max} />
        <XLabels rows={rows} />
        {lines.map(l => (
          <path key={l.key} d={path(l.key)} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* Direct end labels — latest value, ink text + colour dot for identity */}
        {n > 0 && lines.map(l => {
          const v = Number(rows[n - 1][l.key]) || 0;
          return (
            <g key={l.key}>
              <circle cx={xAt(n - 1, n)} cy={yAt(v, max)} r="3.5" fill={l.color} />
              <text x={xAt(n - 1, n) + 7} y={yAt(v, max) + 3} fontSize="11" fontWeight="700" fill="#fff">{v}</text>
            </g>
          );
        })}
        {idx != null && (
          <g>
            <line x1={xAt(idx, n)} y1={PAD.t} x2={xAt(idx, n)} y2={PAD.t + plotH} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
            {lines.map(l => <circle key={l.key} cx={xAt(idx, n)} cy={yAt(Number(rows[idx][l.key]) || 0, max)} r="3.5" fill={l.color} stroke="#1e2235" strokeWidth="1.5" />)}
          </g>
        )}
      </svg>
      {idx != null && (
        <div style={{ position: 'absolute', top: 0, left: `${(xAt(idx, n) / W) * 100}%`, transform: 'translateX(-50%)', pointerEvents: 'none',
                      backgroundColor: '#12152a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 8px', fontSize: 11, color: '#fff', whiteSpace: 'nowrap' }}>
          <div style={{ color: INK_MUTED, marginBottom: 2 }}>{fmtDay(rows[idx].day)}</div>
          {lines.map(l => (
            <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />{l.label}: <b>{Number(rows[idx][l.key]) || 0}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Single-series bars (new users / messages per day) with per-bar hover.
function BarChart({ rows, dataKey, color = C_DAU }) {
  const n = rows.length;
  const max = niceMax(Math.max(1, ...rows.map(r => Number(r[dataKey]) || 0)));
  const { idx, ref, onMove, onLeave } = useHoverIndex(n);
  const bw = Math.max(1, (plotW / Math.max(n, 1)) - 2);
  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${HGT}`} width="100%" style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={onLeave}>
        <YGrid max={max} />
        <XLabels rows={rows} />
        {rows.map((r, i) => {
          const v = Number(r[dataKey]) || 0;
          const y = yAt(v, max), h = PAD.t + plotH - y;
          return <rect key={i} x={xAt(i, n) - bw / 2} y={y} width={bw} height={Math.max(0, h)} rx="2" fill={color} opacity={idx == null || idx === i ? 1 : 0.55}><title>{`${fmtDay(r.day)}: ${v}`}</title></rect>;
        })}
        {idx != null && <line x1={xAt(idx, n)} y1={PAD.t} x2={xAt(idx, n)} y2={PAD.t + plotH} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />}
      </svg>
      {idx != null && (
        <div style={{ position: 'absolute', top: 0, left: `${(xAt(idx, n) / W) * 100}%`, transform: 'translateX(-50%)', pointerEvents: 'none',
                      backgroundColor: '#12152a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 8px', fontSize: 11, color: '#fff', whiteSpace: 'nowrap' }}>
          <div style={{ color: INK_MUTED, marginBottom: 2 }}>{fmtDay(rows[idx].day)}</div>
          <b>{Number(rows[idx][dataKey]) || 0}</b>
        </div>
      )}
    </div>
  );
}

const RANGES = [[30, 'range30'], [90, 'range90'], [365, 'range365']];

// 'AT' → 🇦🇹 via Regional-Indicator-Symbole; '??'/Ungültiges → 🌐
const countryFlag = (cc) =>
  /^[A-Za-z]{2}$/.test(cc || '')
    ? String.fromCodePoint(...cc.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
    : '🌐';

export const AdminGrowthSection = () => {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  // "Woher kommen die User" (Tobi 2026-08-05) — einmalig geladen, unabhängig
  // vom Zeitraum-Filter (Bestandszählung, keine Zeitreihe).
  const [origins, setOrigins] = useState(null);

  useEffect(() => {
    let cancelled = false;
    admin.getUserOrigins()
      .then(res => { if (!cancelled) setOrigins(res.data); })
      .catch(() => {}); // Route fehlt (älteres Backend) → Block bleibt weg
    return () => { cancelled = true; };
  }, []);

  // Ländername in der Admin-Sprache ("AT" → "Österreich"); Code als Fallback.
  const regionNames = (() => {
    try { return new Intl.DisplayNames([i18n.language || 'de'], { type: 'region' }); }
    catch { return null; }
  })();
  const countryLabel = (cc) =>
    cc === '??' ? t('admin.growth.originsUnknown') : (regionNames?.of(cc.toUpperCase()) || cc);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    admin.getGrowth(days)
      .then(res => { if (!cancelled) { setRows(res.data || []); setUnavailable(false); } })
      .catch(() => { if (!cancelled) setUnavailable(true); })   // old backend w/o route → hide section
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  // Route missing on an older backend: render nothing (matches online-users pattern).
  if (unavailable) return null;

  const last = rows[rows.length - 1] || {};
  const stickiness = last.mau > 0 ? `${Math.round((last.dau / last.mau) * 100)}%` : '—';
  const newUsersRange = rows.reduce((s, r) => s + (Number(r.new_users) || 0), 0);

  const btn = (active) => ({
    background: active ? C_DAU : 'rgba(255,255,255,0.08)', color: active ? '#1a1a2e' : 'rgba(255,255,255,0.7)',
    border: 'none', borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  });

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ ...H2, marginBottom: 0, flex: 1 }}>{t('admin.sections.growth')}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGES.map(([d, key]) => (
            <button key={d} style={btn(days === d)} onClick={() => setDays(d)}>{t(`admin.growth.${key}`)}</button>
          ))}
        </div>
        <button
          style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.5 }}
          disabled={!rows.length}
          onClick={() => downloadCSV(rows, `jamie_growth_${new Date().toISOString().slice(0, 10)}.csv`)}
        >
          {t('admin.growth.export')}
        </button>
      </div>

      {loading ? (
        <div style={{ ...CARD, textAlign: 'center', color: INK_MUTED }}>…</div>
      ) : rows.length === 0 ? (
        <div style={{ ...CARD, color: INK_MUTED, fontSize: 13, flex: 'none' }}>{t('admin.growth.empty')}</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <Tile label={t('admin.growth.dau')} value={last.dau} />
            <Tile label={t('admin.growth.mau')} value={last.mau} />
            <Tile label={t('admin.growth.stickiness')} value={stickiness} sub={t('admin.growth.stickinessSub')} />
            <Tile label={t('admin.growth.newUsers')} value={newUsersRange} sub={t('admin.growth.newUsersSub')} />
            <Tile label={t('admin.growth.retentionD1')} value={pct(latestNonNull(rows, 'retention_d1'))} sub={t('admin.growth.retentionSub')} />
            <Tile label={t('admin.growth.retentionD7')} value={pct(latestNonNull(rows, 'retention_d7'))} sub={t('admin.growth.retentionSub')} />
            <Tile label={t('admin.growth.retentionD30')} value={pct(latestNonNull(rows, 'retention_d30'))} sub={t('admin.growth.retentionSub')} />
          </div>

          <div style={{ ...CARD, flex: 'none', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 8 }}>{t('admin.growth.chartActive')}</div>
            <LineChart rows={rows} lines={[{ key: 'dau', color: C_DAU, label: t('admin.growth.legendDau') }, { key: 'mau', color: C_MAU, label: t('admin.growth.legendMau') }]} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ ...CARD, flex: '1 1 300px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 8 }}>{t('admin.growth.chartNewUsers')}</div>
              <BarChart rows={rows} dataKey="new_users" />
            </div>
            <div style={{ ...CARD, flex: '1 1 300px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 8 }}>{t('admin.growth.chartEngagement')}</div>
              <BarChart rows={rows} dataKey="messages" color={C_MAU} />
            </div>
          </div>

          <p style={{ fontSize: 11, color: INK_MUTED, marginTop: 12, lineHeight: 1.5 }}>{t('admin.growth.note')}</p>
        </>
      )}

      {/* ── Woher kommen die User (Tobi 2026-08-05) ─────────────────────── */}
      {origins && (origins.countries?.length || 0) > 0 && (() => {
        const totalUsers = origins.countries.reduce((s, c) => s + c.users, 0);
        const maxCountry = Math.max(...origins.countries.map(c => c.users), 1);
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
            <div style={{ ...CARD, flex: '1 1 320px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>
                {t('admin.growth.originsCountries')} <span style={{ color: INK_MUTED, fontWeight: 400 }}>({totalUsers})</span>
              </div>
              {origins.countries.map(c => (
                <div key={c.country} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 16, width: 24 }}>{countryFlag(c.country)}</span>
                  <span style={{ fontSize: 12, color: '#fff', width: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {countryLabel(c.country)}
                  </span>
                  <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(c.users / maxCountry) * 100}%`, height: '100%', background: C_DAU, borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 700, width: 56, textAlign: 'right' }}>
                    {c.users} <span style={{ color: INK_MUTED, fontWeight: 400 }}>({Math.round((c.users / totalUsers) * 100)}%)</span>
                  </span>
                </div>
              ))}
            </div>
            {(origins.cities?.length || 0) > 0 && (
              <div style={{ ...CARD, flex: '1 1 240px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>{t('admin.growth.originsCities')}</div>
                {origins.cities.map(c => (
                  <div key={c.city} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.city}</span>
                    <span style={{ fontSize: 12, color: INK_MUTED, fontWeight: 700 }}>{c.users}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};
