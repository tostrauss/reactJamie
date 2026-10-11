import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { admin, clubs as clubsApi } from '../utils/api';
import { movePhoto as moveItem } from '../utils/photoOrder';
import { serverErrorMessage } from '../utils/apiError';

/**
 * Admin → "Clubs im Onboarding" (Tina's checklist, 10.10.2026: "Clubs
 * anzeigen, extra Seite (Jamie Groups Official der erste Club, dann noch …) —
 * wir sortieren Clubs im Admin-Dashboard").
 *
 * New users see exactly this list, in exactly this order, on /onboarding/clubs
 * right after signing up; an empty list skips that page. Because the order IS
 * the feature, editing is local and explicit: ↑ ↓ ✕ and "Hinzufügen" only
 * change this screen, one "Reihenfolge speichern" replaces the whole list on
 * the server (PUT /admin/clubs/featured), and the server's answer — read back
 * inside its transaction — is rendered as the new truth. No drag & drop:
 * /admin is opened from a phone as often as from a desktop, and three 44px
 * buttons work on both.
 *
 * Self-loading and tolerant like AdminFeedbackSection: 404 (a server older
 * than this bundle) or 503 (featured_clubs not migrated yet — the server takes
 * traffic before its migrations finish) → the section is not rendered at all.
 */
const H2 = { color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 };
const CARD = { background: 'var(--bg-card, #1e2235)', borderRadius: 16 };
const MUTED = 'rgba(255,255,255,0.5)';
const DIVIDER = '1px solid rgba(255,255,255,0.06)';

// featuredClubController.MAX_FEATURED_CLUBS. The server sends `max` with every
// list, this is only the fallback for a response without it.
const DEFAULT_MAX = 20;
const SEARCH_DEBOUNCE_MS = 300; // same as the users search further down this page
const SEARCH_LIMIT = 20;

// Ids arrive as numbers from pg, but nothing here may break on a "12".
const sameId = (a, b) => Number(a) === Number(b);
// The order as a comparable value: "dirty" = differs from what the server last
// confirmed, so moving a club down and back up again leaves nothing to save.
const orderKey = (rows) => rows.map((c) => Number(c.id)).join(',');

// Why a curated club no longer reaches new users. The public list filters on
// the LIVE club row (clubAliveSql) and a save containing such a club is refused
// with FEATURED_INVALID_CLUBS, so the admin has to SEE which one to drop.
// Rejected = 'rejected' + is_active FALSE → both badges, both true.
const warningsFor = (c) => {
  const w = [];
  if (c.approval_status && c.approval_status !== 'approved') w.push('notApproved');
  if (c.is_active === false || c.is_deleted) w.push('inactive');
  if (!w.length && c.alive === false) w.push('inactive');
  return w;
};

// A GET /clubs search row → the admin list's row shape (featuredClubController
// ADMIN_SQL), so locally added clubs render exactly like saved ones.
const toListRow = (c) => {
  const approval = c.approval_status || 'approved';
  const active = c.is_active !== false;
  const deleted = !!c.deleted_at;
  return {
    id: c.id,
    name: c.name,
    image_url: c.image_url || null,
    location: c.location || null,
    members_count: c.members_count,
    is_private: !!c.is_private,
    approval_status: approval,
    is_active: active,
    is_deleted: deleted,
    alive: approval === 'approved' && active && !deleted,
  };
};

// Admins see pending clubs in GET /clubs too (the moderation view); only an
// approved one may be curated — the server re-checks on save either way.
const isApprovedClub = (c) => (c.approval_status || 'approved') === 'approved' && c.is_active !== false;

const Thumb = ({ club }) => (
  <div
    aria-hidden="true"
    style={{
      width: 40, height: 40, borderRadius: 10, overflow: 'hidden', flexShrink: 0,
      background: 'rgba(253,118,102,0.18)', color: '#FD7666',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800,
    }}
  >
    {club.image_url
      ? <img src={club.image_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      : (club.name || '?').trim().charAt(0).toUpperCase()}
  </div>
);

// Name (+ lock for private clubs) and "N Mitglieder · Ort" — shared by the
// curated rows and the search results so both read the same. `basis` is the
// width below which the curated row moves its buttons onto their own line.
const ClubMeta = ({ club, nameId, basis = '0px', children }) => {
  const { t } = useTranslation();
  return (
    <div style={{ flex: `1 1 ${basis}`, minWidth: 0 }}>
      <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
        <span id={nameId}>{club.name}</span>
        {/* No-break space: the lock wraps WITH the last word instead of
            dangling alone on the next line. */}
        {club.is_private && (
          <>
            {'\u00A0'}
            <span role="img" aria-label={t('groups.card.privateBadge')} title={t('groups.card.privateBadge')} style={{ fontSize: 12 }}>
              🔒
            </span>
          </>
        )}
      </div>
      <div style={{ color: MUTED, fontSize: 12, marginTop: 2, overflowWrap: 'anywhere' }}>
        {/* Number(): i18next only plural-resolves a numeric count. */}
        {t('admin.featuredClubs.members', { count: Number(club.members_count) || 0 })}
        {club.location ? ` · ${club.location}` : ''}
      </div>
      {children}
    </div>
  );
};

// 44px minimum touch target, like the moderation buttons on this page.
const IconBtn = ({ id, label, describedBy, onClick, disabled, danger, children }) => (
  <button
    type="button"
    id={id}
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-describedby={describedBy}
    title={label}
    style={{
      width: 44, height: 44, padding: 0, borderRadius: 12, border: 'none', flexShrink: 0,
      background: danger ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.08)',
      color: danger ? '#f87171' : '#fff', fontSize: 18, fontWeight: 700, lineHeight: 1, fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.3 : 1,
    }}
  >
    <span aria-hidden="true">{children}</span>
  </button>
);

export const AdminFeaturedClubsSection = () => {
  const { t } = useTranslation();
  const uid = useId();
  const [list, setList] = useState(null);          // null = loading (or hidden)
  const [savedKey, setSavedKey] = useState('');    // orderKey of the server's list
  const [max, setMax] = useState(DEFAULT_MAX);
  const [hidden, setHidden] = useState(false);     // 404 / 503 → render nothing
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null); // null = none, '' = no detail, else the detail
  const [invalidIds, setInvalidIds] = useState([]); // FEATURED_INVALID_CLUBS → which clubs to drop
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const focusAfterMove = useRef(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const res = await admin.getFeaturedClubs();
      const data = res?.data;
      if (!Array.isArray(data?.clubs)) { setHidden(true); return; } // not this API
      setList(data.clubs);
      setSavedKey(orderKey(data.clubs));
      setMax(Number(data.max) > 0 ? Number(data.max) : DEFAULT_MAX);
    } catch (err) {
      const status = err?.response?.status;
      // 404 = older server, 503 = table not there yet: the feature does not
      // exist for this server, so neither does the section. Anything else is
      // a real failure the admin should see (and can retry) — hiding it would
      // read as "the club list is gone".
      if (status === 404 || status === 503) setHidden(true);
      else setLoadFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Debounced search over GET /clubs (ILIKE on name/description, uncached
  // server-side). The sequence number drops answers that arrive after a newer
  // keystroke — otherwise a slow "j" could overwrite the results for "jamie".
  useEffect(() => {
    const term = query.trim();
    const seq = ++searchSeq.current;
    if (!term) { setResults([]); setSearching(false); return undefined; }
    setSearching(true);
    const h = setTimeout(async () => {
      let rows = [];
      try {
        const res = await clubsApi.getAll({ search: term, limit: SEARCH_LIMIT });
        const data = res?.data;
        rows = Array.isArray(data) ? data : (Array.isArray(data?.clubs) ? data.clubs : []);
      } catch { /* nothing found is the honest fallback; the admin can type again */ }
      if (seq !== searchSeq.current) return;
      setResults(rows.filter(isApprovedClub));
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [query]);

  // React re-inserts a moved row's DOM node, which drops keyboard focus from
  // the arrow that was just pressed. Put it back — or on the other arrow when
  // this one became disabled at the end of the list. Only after a keyboard /
  // focused press (see `move`); a tap on a phone never focused anything.
  useEffect(() => {
    const f = focusAfterMove.current;
    if (!f) return;
    focusAfterMove.current = null;
    const el = document.getElementById(`${uid}-${f.dir}-${f.id}`);
    const other = document.getElementById(`${uid}-${f.dir === 'up' ? 'down' : 'up'}-${f.id}`);
    (el && !el.disabled ? el : other)?.focus();
  }, [list, uid]);

  if (hidden) return null;

  if (loadFailed) {
    return (
      <div id="clubs-featured" style={{ marginBottom: 32 }}>
        <h2 style={H2}>{t('admin.featuredClubs.title')}</h2>
        <div style={{ ...CARD, padding: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span role="alert" style={{ color: '#f87171', fontSize: 13, flex: '1 1 200px' }}>{t('admin.errorLoad')}</span>
          <button
            type="button"
            onClick={load}
            style={{
              minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)',
              background: 'transparent', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t('admin.refresh')}
          </button>
        </div>
      </div>
    );
  }

  if (list === null) return null; // first load in flight — no layout jump for a section that may hide

  const dirty = orderKey(list) !== savedKey;
  // Any edit retires the last save's verdict. The refused-club markers stay
  // until those clubs are removed — they are still the reason a save fails.
  const edited = () => { setSaved(false); setSaveError(null); };

  const move = (e, index, dir) => {
    if (saving) return;
    const club = list[index];
    if (document.activeElement === e.currentTarget) focusAfterMove.current = { id: club.id, dir };
    setList((prev) => moveItem(prev, index, dir === 'up' ? index - 1 : index + 1));
    edited();
  };

  const remove = (club) => {
    if (saving) return;
    setList((prev) => prev.filter((c) => !sameId(c.id, club.id)));
    edited();
  };

  const atMax = list.length >= max;
  const isListed = (club) => list.some((c) => sameId(c.id, club.id));

  const add = (club) => {
    // Single source of the two rules the server would otherwise refuse with
    // FEATURED_INVALID: no club twice, never more than `max`.
    if (saving || atMax || isListed(club)) return;
    setList((prev) => [...prev, toListRow(club)]);
    edited();
  };

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await admin.setFeaturedClubs(list.map((c) => Number(c.id)));
      const data = res?.data;
      // The answer is what was committed (read back inside the server's
      // transaction) — render that, not our local copy.
      const committed = Array.isArray(data?.clubs) ? data.clubs : list;
      setList(committed);
      setSavedKey(orderKey(committed));
      if (Number(data?.max) > 0) setMax(Number(data.max));
      setInvalidIds([]);
      setSaved(true);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === 'FEATURED_INVALID_CLUBS' && Array.isArray(data.invalidIds)) {
        // Nothing was written. Mark the refused clubs and name them below;
        // the hint goes away as the admin removes them.
        setInvalidIds(data.invalidIds.map(Number));
        setSaveError('');
      } else {
        // A coded refusal carries a sentence worth showing (503 "gleich wieder
        // verfügbar", 400 FEATURED_INVALID) and offline gets the network line;
        // a bare 500 just the plain "Speichern fehlgeschlagen".
        const plain = t('admin.featuredClubs.saveError');
        const detail = (!err?.response || data?.code) ? serverErrorMessage(err, t, 'admin.featuredClubs.saveError') : '';
        setSaveError(detail === plain ? '' : detail);
      }
    } finally {
      setSaving(false);
    }
  };

  const invalidNames = list
    .filter((c) => invalidIds.some((id) => sameId(id, c.id)))
    .map((c) => c.name || `#${c.id}`);
  const errorDetail = invalidNames.length
    ? t('admin.featuredClubs.invalidClubs', { names: invalidNames.join(', ') })
    : saveError;

  return (
    <div id="clubs-featured" style={{ marginBottom: 32 }}>
      <h2 style={H2}>{t('admin.featuredClubs.title')} ({list.length}/{max})</h2>
      <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.45, margin: '-4px 0 12px' }}>{t('admin.featuredClubs.hint')}</p>

      {list.length === 0 ? (
        <div style={{ ...CARD, padding: 20, fontSize: 13, color: MUTED }}>{t('admin.featuredClubs.empty')}</div>
      ) : (
        // role="list": Safari/VoiceOver drop the list semantics of a
        // list-style:none list, and "3 of 8" is exactly what matters here.
        <ol role="list" style={{ ...CARD, listStyle: 'none', margin: 0, padding: 0, overflow: 'hidden' }}>
          {list.map((c, i) => {
            const nameId = `${uid}-name-${c.id}`;
            const refused = invalidIds.some((id) => sameId(id, c.id));
            const warnings = warningsFor(c);
            return (
              <li
                key={c.id}
                data-refused={refused ? 'true' : undefined}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                  borderBottom: i < list.length - 1 ? DIVIDER : 'none',
                  // Refused by the last save: tinted + a red edge, named in the alert below.
                  background: refused ? 'rgba(248,113,113,0.08)' : 'transparent',
                  boxShadow: refused ? 'inset 3px 0 0 #f87171' : 'none',
                }}
              >
                <span style={{ width: 20, lineHeight: '40px', textAlign: 'right', color: MUTED, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {i + 1}
                </span>
                <Thumb club={c} />
                {/* Text and buttons share one wrapping line: side by side on a
                    desktop, buttons on their own line under the text on a phone
                    — three 44px buttons beside the name left it ~130px there. */}
                <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 10px' }}>
                  <ClubMeta club={c} nameId={nameId} basis="170px">
                    {warnings.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {warnings.map((w) => (
                          <span key={w} style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', background: 'rgba(251,191,36,0.12)', borderRadius: 8, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                            ⚠ {t(`admin.featuredClubs.${w}`)}
                          </span>
                        ))}
                      </div>
                    )}
                  </ClubMeta>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <IconBtn
                      id={`${uid}-up-${c.id}`}
                      label={t('admin.featuredClubs.moveUp')}
                      describedBy={nameId}
                      disabled={saving || i === 0}
                      onClick={(e) => move(e, i, 'up')}
                    >
                      ↑
                    </IconBtn>
                    <IconBtn
                      id={`${uid}-down-${c.id}`}
                      label={t('admin.featuredClubs.moveDown')}
                      describedBy={nameId}
                      disabled={saving || i === list.length - 1}
                      onClick={(e) => move(e, i, 'down')}
                    >
                      ↓
                    </IconBtn>
                    <IconBtn
                      label={t('admin.featuredClubs.remove')}
                      describedBy={nameId}
                      disabled={saving}
                      onClick={() => remove(c)}
                      danger
                    >
                      ✕
                    </IconBtn>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Save sits right under the list it saves; the search adds below. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          style={{
            minHeight: 44, padding: '0 20px', borderRadius: 12, fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
            border: dirty ? 'none' : '1px solid rgba(255,255,255,0.15)',
            background: dirty ? '#FD7666' : 'transparent',
            color: dirty ? '#fff' : 'rgba(255,255,255,0.4)',
            cursor: !dirty ? 'default' : saving ? 'wait' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? t('admin.featuredClubs.saving') : t('admin.featuredClubs.save')}
        </button>
        {saved && !dirty && (
          <span role="status" style={{ color: '#4ade80', fontSize: 13, fontWeight: 600 }}>{t('admin.featuredClubs.saved')}</span>
        )}
      </div>
      {(saveError !== null || invalidNames.length > 0) && (
        <div role="alert" style={{ color: '#f87171', fontSize: 13, lineHeight: 1.45, marginTop: 8 }}>
          {t('admin.featuredClubs.saveError')}{errorDetail ? ` – ${errorDetail}` : ''}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.featuredClubs.searchPlaceholder')}
          aria-label={t('admin.featuredClubs.searchPlaceholder')}
          style={{
            width: '100%', boxSizing: 'border-box', minHeight: 44,
            background: 'var(--bg-card, #1e2235)',
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
            padding: '12px 14px', color: '#fff', fontSize: 14, fontFamily: 'inherit', outline: 'none',
          }}
        />
        {atMax && (
          <div style={{ color: '#fbbf24', fontSize: 12, marginTop: 6 }}>{t('admin.featuredClubs.maxReached', { max })}</div>
        )}
        {query.trim() !== '' && (
          searching ? (
            <div style={{ color: MUTED, fontSize: 13, marginTop: 8 }}>{t('common.loadingShort')}</div>
          ) : results.length === 0 ? (
            <div style={{ color: MUTED, fontSize: 13, marginTop: 8 }}>{t('admin.featuredClubs.noResults')}</div>
          ) : (
            <ul role="list" style={{ ...CARD, listStyle: 'none', margin: '8px 0 0', padding: 0, overflow: 'hidden' }}>
              {results.map((c, i) => {
                const listed = isListed(c);
                const label = listed ? t('admin.featuredClubs.alreadyAdded') : t('admin.featuredClubs.add');
                return (
                  <li
                    key={c.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderBottom: i < results.length - 1 ? DIVIDER : 'none',
                    }}
                  >
                    <Thumb club={c} />
                    <ClubMeta club={c} nameId={`${uid}-result-${c.id}`} />
                    <button
                      type="button"
                      onClick={() => add(c)}
                      disabled={listed || atMax || saving}
                      aria-label={label}
                      aria-describedby={`${uid}-result-${c.id}`}
                      title={label}
                      style={{
                        minHeight: 44, minWidth: 44, padding: '0 14px', borderRadius: 12, flexShrink: 0,
                        border: listed ? 'none' : '1px solid rgba(253,118,102,0.5)',
                        background: listed ? 'rgba(74,222,128,0.12)' : 'transparent',
                        color: listed ? '#4ade80' : '#FD7666', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                        cursor: listed || atMax ? 'default' : 'pointer',
                        opacity: !listed && (atMax || saving) ? 0.4 : 1,
                      }}
                    >
                      {listed ? '✓' : `+ ${t('admin.featuredClubs.add')}`}
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>
    </div>
  );
};

export default AdminFeaturedClubsSection;
