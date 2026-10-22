import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { admin } from '../utils/api';
import { serverErrorMessage } from '../utils/apiError';

/**
 * Admin → "Clubs umklassifizieren" (Tina, 22.10.2026).
 *
 * The split gave every existing club club_type='community' — nobody lost
 * visibility, and this is where the real ones (clubs, companies, promoters)
 * become 'official'. That matters twice over: only an official club needs
 * approval before it goes live, and only official clubs appear in the Clubs
 * segment of Entdecken. Right after the deploy that segment is EMPTY until
 * someone curates here, which is why this section ships first.
 *
 * Same screen also carries the free-text category line ("Sport · Laufclub")
 * the club row shows under its name — the owner maintains it in the club
 * editor, an admin can correct a useless one.
 *
 * Self-loading and tolerant like AdminFeaturedClubsSection: 404 (a server
 * older than this bundle) or 503 (club_type not migrated yet — the server
 * takes traffic before its migrations finish) → the section is not rendered.
 */
const H2 = { color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 };
const CARD = { background: 'var(--bg-card, #1e2235)', borderRadius: 16 };
const MUTED = 'rgba(255,255,255,0.5)';
const DIVIDER = '1px solid rgba(255,255,255,0.06)';
// 16px: iOS zooms into any focused field below that, and /admin is used from phones.
const FIELD = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 12px',
  color: '#fff', fontSize: 16, fontFamily: 'inherit', outline: 'none',
};
const BTN = {
  minHeight: 44, padding: '0 14px', borderRadius: 12, fontSize: 14, fontWeight: 700,
  fontFamily: 'inherit', cursor: 'pointer', border: 'none',
};
const SEARCH_DEBOUNCE_MS = 300;     // same as the featured-clubs search
// clubController: category_label is VARCHAR(60) and the server re-checks.
const CATEGORY_MAX = 60;

// NULL / missing column counts as community — the same contract the server
// reads with `club_type IS DISTINCT FROM 'official'`.
const typeOf = (c) => (c.club_type === 'official' ? 'official' : 'community');

export const AdminClassifySection = () => {
  const { t } = useTranslation();
  const uid = useId();

  const [hidden, setHidden] = useState(false);
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  // Per club: the edited category line, plus its save state.
  const [drafts, setDrafts] = useState({});          // id → string
  const [busyId, setBusyId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [errorId, setErrorId] = useState(null);
  const [errorText, setErrorText] = useState('');
  const searchSeq = useRef(0);

  const load = useCallback(async (term) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const res = await admin.getClubsForAdmin(term);
      if (seq !== searchSeq.current) return;         // a newer keystroke won
      const data = res?.data;
      if (!Array.isArray(data)) { setHidden(true); return; }
      setRows(data);
    } catch (err) {
      if (seq !== searchSeq.current) return;
      const status = err?.response?.status;
      if (status === 404 || status === 503) setHidden(true);
      // Anything else: keep whatever is on screen. The admin can type again.
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, []);

  // Debounced, with the sequence guard above — otherwise a slow "j" overwrites
  // the results for "jamie" (the bug AdminFeaturedClubsSection documents).
  useEffect(() => {
    const term = query.trim();
    const h = setTimeout(() => load(term), term ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(h);
  }, [query, load]);

  if (hidden) return null;

  const draftOf = (c) => (drafts[c.id] !== undefined ? drafts[c.id] : (c.category_label || ''));

  const save = async (club, body) => {
    setBusyId(club.id);
    setErrorId(null);
    setErrorText('');
    try {
      const res = await admin.classifyClub(club.id, body);
      const saved = res?.data?.club;
      // Render what the server actually stored, not what we hoped it would.
      setRows((prev) => prev.map((r) => (Number(r.id) === Number(club.id)
        ? { ...r, club_type: saved?.club_type ?? r.club_type, category_label: saved?.category_label ?? null }
        : r)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[club.id];
        return next;
      });
      setSavedId(club.id);
      setTimeout(() => setSavedId((s) => (s === club.id ? null : s)), 2000);
    } catch (err) {
      setErrorId(club.id);
      setErrorText(serverErrorMessage(err, t, 'admin.classify.saveError'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={H2}>{t('admin.classify.title')}</h2>
      <p style={{ color: MUTED, fontSize: 13, margin: '0 0 12px' }}>{t('admin.classify.hint')}</p>

      <input
        id={`${uid}-search`}
        style={{ ...FIELD, marginBottom: 12 }}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('admin.classify.searchPlaceholder')}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
      />

      <div style={CARD}>
        {rows.length === 0 ? (
          <p style={{ color: MUTED, fontSize: 14, padding: 16, margin: 0 }}>
            {searching ? t('common.loadingShort') : t('admin.classify.empty')}
          </p>
        ) : rows.map((c, i) => {
          const current = typeOf(c);
          const draft = draftOf(c);
          const dirty = draft.trim() !== (c.category_label || '').trim();
          return (
            <div key={c.id} style={{ padding: 14, borderTop: i === 0 ? 'none' : DIVIDER }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <strong style={{ color: '#fff', fontSize: 15, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {c.name}
                </strong>
                {/* Why a club may not be reachable even after a reclassify. */}
                {c.approval_status !== 'approved' && (
                  <span style={{ fontSize: 11, color: '#fbbf24', whiteSpace: 'nowrap' }}>
                    {c.approval_status}
                  </span>
                )}
                {c.is_active === false && (
                  <span style={{ fontSize: 11, color: '#f87171', whiteSpace: 'nowrap' }}>inaktiv</span>
                )}
              </div>

              <div style={{ color: MUTED, fontSize: 12, marginBottom: 10 }}>
                {[c.location, `${c.members_count || 0} Mitglieder`].filter(Boolean).join(' · ')}
              </div>

              {/* Two explicit buttons, not a toggle: which state is active has
                  to be readable at a glance, and a mis-tap is one tap back. */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {['community', 'official'].map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    style={{
                      ...BTN,
                      flex: 1,
                      background: current === kind ? 'var(--accent-coral, #FD7666)' : 'rgba(255,255,255,0.06)',
                      color: current === kind ? '#fff' : 'rgba(255,255,255,0.75)',
                      opacity: busyId === c.id ? 0.6 : 1,
                    }}
                    disabled={busyId === c.id || current === kind}
                    onClick={() => save(c, { club_type: kind })}
                    aria-pressed={current === kind}
                  >
                    {t(`admin.classify.${kind}`)}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id={`${uid}-cat-${c.id}`}
                  style={{ ...FIELD, flex: 1 }}
                  value={draft}
                  maxLength={CATEGORY_MAX}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  placeholder={t('admin.classify.categoryPlaceholder')}
                  aria-label={t('admin.classify.categoryPlaceholder')}
                />
                <button
                  type="button"
                  style={{
                    ...BTN,
                    background: dirty ? 'var(--accent-coral, #FD7666)' : 'rgba(255,255,255,0.06)',
                    color: dirty ? '#fff' : 'rgba(255,255,255,0.5)',
                  }}
                  disabled={!dirty || busyId === c.id}
                  onClick={() => save(c, { category_label: draft.trim() })}
                >
                  {t('admin.classify.save')}
                </button>
              </div>

              {savedId === c.id && (
                <p style={{ color: '#4ade80', fontSize: 12, margin: '8px 0 0' }}>{t('admin.classify.saved')}</p>
              )}
              {errorId === c.id && (
                <p style={{ color: '#f87171', fontSize: 12, margin: '8px 0 0' }}>{errorText}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default AdminClassifySection;
