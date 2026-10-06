/**
 * Abstimmungen im Chat — pure client helpers (B1, tester 06.10.2026).
 *
 * The server owns every count (backend/src/utils/polls.js). The client applies
 * an optimistic tick while a vote is in flight and otherwise only MERGES the
 * summaries it receives, by `version`: an older summary (a late socket event,
 * the echo of an earlier tap) never rolls the bubble back.
 *
 * POLL_KINDS / POLL_LIMITS are MIRRORED byte-for-byte from the backend;
 * backend/tests/utils/polls.test.js reads both files and fails on drift.
 */
export const POLL_KINDS = ['choice', 'date'];
export const POLL_LIMITS = Object.freeze({ QUESTION_MAX: 140, OPTION_MAX: 60, OPTIONS_MIN: 2, OPTIONS_MAX: 10, DATE_HORIZON_DAYS: 366 });

/** A summary we can draw: a question and at least two options. */
export const isRenderablePoll = (p) =>
  !!p && typeof p === 'object' && typeof p.question === 'string' && Array.isArray(p.options) && p.options.length >= 2;

const sorted = (arr) => [...arr].sort((a, b) => a - b);

/**
 * The selection after tapping option `pos`.
 * Single choice: tapping your own choice again withdraws it ([]), any other
 * replaces it. Multiple choice: toggles `pos`.
 */
export const nextChoices = (poll, pos) => {
  const mine = Array.isArray(poll?.my_votes) ? poll.my_votes : [];
  if (!poll?.multi) return mine.includes(pos) ? [] : [pos];
  return mine.includes(pos) ? sorted(mine.filter((p) => p !== pos)) : sorted([...mine, pos]);
};

/** Optimistic local application of a new selection. Never mutates, never < 0. */
export const applyVoteLocally = (poll, choices) => {
  if (!isRenderablePoll(poll)) return poll;
  const before = Array.isArray(poll.my_votes) ? poll.my_votes : [];
  const after = sorted(choices || []);
  const options = poll.options.map((o) => {
    let v = Number(o.votes) || 0;
    if (before.includes(o.pos)) v -= 1;
    if (after.includes(o.pos)) v += 1;
    return { ...o, votes: Math.max(0, v) };
  });
  const voters = Math.max(0, (Number(poll.voter_count) || 0) - (before.length > 0 ? 1 : 0) + (after.length > 0 ? 1 : 0));
  return { ...poll, options, voter_count: voters, my_votes: after };
};

/**
 * Merge an incoming summary into the one on screen.
 *  - not renderable → keep current
 *  - older version → keep current (no roll-back)
 *  - otherwise take it, keeping our my_votes when the incoming payload has none
 *    (the room payload never carries anyone's selection)
 * Returns `current` itself when nothing changed, so React can bail out.
 */
export const mergePoll = (current, incoming) => {
  if (!isRenderablePoll(incoming)) return current;
  if (!isRenderablePoll(current)) return { ...incoming, my_votes: Array.isArray(incoming.my_votes) ? incoming.my_votes : [] };
  if ((Number(incoming.version) || 0) < (Number(current.version) || 0)) return current;
  const next = { ...incoming, my_votes: Array.isArray(incoming.my_votes) ? incoming.my_votes : (current.my_votes ?? []) };
  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
};

/** Positions with the highest count — only when somebody voted. */
export const leadingPositions = (poll) => {
  if (!isRenderablePoll(poll)) return [];
  const max = Math.max(0, ...poll.options.map((o) => Number(o.votes) || 0));
  return max > 0 ? poll.options.filter((o) => Number(o.votes) === max).map((o) => o.pos) : [];
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

/**
 * Label of an option for THIS viewer. Date options are formatted from their
 * string parts in the viewer's locale — NEVER new Date('YYYY-MM-DD'), which
 * parses as UTC and shows yesterday west of Greenwich (the old off-by-one).
 */
export const formatPollOption = (opt, kind, locale = 'de-DE', now = new Date()) => {
  if (kind !== 'date') return opt?.label ?? '';
  const m = DATE_RE.exec(opt?.date || '');
  if (!m) return opt?.label ?? '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  const fmt = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) fmt.year = 'numeric';
  let out;
  try { out = d.toLocaleDateString(locale, fmt); } catch { return opt?.label ?? ''; }
  const t = TIME_RE.exec(opt?.time || '');
  if (t) {
    const tt = new Date(2000, 0, 1, Number(t[1]), Number(t[2]));
    try { out += ` · ${tt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`; } catch { out += ` · ${opt.time}`; }
  }
  return out;
};

// ── Creation draft ──────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

/** Today as local 'YYYY-MM-DD'. */
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** 'YYYY-MM-DD' + n days, on the string parts (no UTC drift). */
export const addDaysIso = (iso, n) => {
  const m = DATE_RE.exec(iso || '');
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n, 12);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const cleanDraftText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Validate a draft for the sheet. → { ok, questionError, countError, rowErrors }
 * rowErrors: { [index]: 'duplicate' | 'past' | 'range' }. Mirrors the server
 * rules so the button is only enabled for drafts the server will accept.
 */
export const validatePollDraft = (draft, today = todayIso()) => {
  const out = { ok: false, questionError: null, countError: null, rowErrors: {} };
  const question = cleanDraftText(draft?.question);
  if (!question) out.questionError = 'empty';
  else if (question.length > POLL_LIMITS.QUESTION_MAX) out.questionError = 'long';

  const rows = draft?.kind === 'date' ? (draft?.dates || []) : (draft?.options || []);
  const filled = [];
  const seen = new Map();
  rows.forEach((r, i) => {
    if (draft?.kind === 'date') {
      if (!DATE_RE.test(r?.date || '')) return;
      // The client's own "today": the server allows one day of slack only for
      // the time-zone gap between this device and Vienna.
      if (r.date < today) out.rowErrors[i] = 'past';
      else if (r.date > addDaysIso(today, POLL_LIMITS.DATE_HORIZON_DAYS)) out.rowErrors[i] = 'range';
      const key = `${r.date} ${r.time || ''}`;
      if (seen.has(key)) out.rowErrors[i] = 'duplicate';
      seen.set(key, i);
      filled.push(i);
    } else {
      const label = cleanDraftText(r?.label);
      if (!label) return;
      const key = label.toLocaleLowerCase('de');
      if (seen.has(key)) out.rowErrors[i] = 'duplicate';
      seen.set(key, i);
      filled.push(i);
    }
  });
  if (filled.length < POLL_LIMITS.OPTIONS_MIN) out.countError = 'few';
  out.ok = !out.questionError && !out.countError && Object.keys(out.rowErrors).length === 0;
  return out;
};

/** The create body for POST /messages/:groupId/polls. */
export const toPollPayload = (draft) => {
  const question = cleanDraftText(draft?.question);
  if (draft?.kind === 'date') {
    return {
      kind: 'date',
      question,
      multi: true,
      options: (draft.dates || []).filter((r) => DATE_RE.test(r?.date || '')).map((r) => ({ date: r.date, time: r.time || null })),
    };
  }
  return {
    kind: 'choice',
    question,
    multi: !!draft?.multi,
    options: (draft?.options || []).map((r) => ({ label: cleanDraftText(r?.label) })).filter((o) => o.label),
  };
};
