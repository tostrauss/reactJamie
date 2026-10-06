// Abstimmungen im Gruppen-/Club-Chat (B1, tester 06.10.2026: "Eine
// Abstimmungsfunktion für Terminfindung oder Aktivitätsplanung wäre cool").
//
// A poll is an ordinary `messages` row (message_type = 'poll') plus three side
// tables that exist only in migrations.js: message_polls, message_poll_options,
// message_poll_votes. So it inherits everything a message already has — order,
// unread count, chat-list preview, reply/quote, reactions, receipts, soft
// delete, admin takedown, the 'message' report pointer and push.
//
// `content` is a complete one-line text — `📊 Frage — A · B · C` (📅 for date
// polls) — because the iOS app bundles the web build: 1.4.1 renders every
// non-system row as plain {msg.content}, and so do the chat list, the quote
// bar, the report snapshot and the admin mail. Old clients therefore see the
// question AND every option and can answer in text; nothing can crash. Never a
// newline: .message-content has no pre-wrap, newlines would collapse.
//
// Votes are ANONYMOUS: payloads carry per-option counts and voter_count; the
// viewer's own selection (`my_votes`) only goes into per-viewer HTTP responses
// and to the actor's own user_<id> socket room. No ids or names leave the
// server — the member list is a Pro feature since 21.09.2026, and naming voters
// would bypass it.
// A ballot, once cast, keeps counting when its voter leaves or is kicked (only
// an account deletion takes it away). Recounting by current membership looked
// fairer, but the counts then dropped right after the named "X hat die Gruppe
// verlassen" line — showing everyone exactly how X had voted. Casting or
// changing a ballot still needs a membership, and a closed poll's result stays
// what its result pill says.
//
// Every poll carries a monotonic `version`, bumped in the same statement as
// each vote, retract and close (which also takes the poll-row lock): clients
// apply a summary only when its version is >= theirs, so a late socket event
// or the echo of their own earlier tap can never roll the UI back, and
// close-versus-vote is atomic.
//
// Pure module: db is injected, nothing is imported — like reactions.js.
// Every statement starts with a /* poll:… */ tag so unit-test mocks can route
// on it; every parameter is cast explicitly (the 42P08 lesson).

export const POLL_KINDS = ['choice', 'date'];
// MIRRORED byte-for-byte in frontend/src/utils/polls.js — a test compares them.
export const POLL_LIMITS = Object.freeze({ QUESTION_MAX: 140, OPTION_MAX: 60, OPTIONS_MIN: 2, OPTIONS_MAX: 10, DATE_HORIZON_DAYS: 366 });
export const POLL_MARK = Object.freeze({ choice: '📊', date: '📅' });
// Longest possible content: mark + space, question, ' — ', 10 options of 60
// joined by ' · ' (mark counted as 2 UTF-16 units). The report snapshot clips
// poll rows at this length instead of 500, so admins see every option.
export const POLL_CONTENT_MAX = 3 + POLL_LIMITS.QUESTION_MAX + 3
  + POLL_LIMITS.OPTIONS_MAX * POLL_LIMITS.OPTION_MAX + (POLL_LIMITS.OPTIONS_MAX - 1) * 3;

// ── Text ─────────────────────────────────────────────────────────────────────
// Runs AFTER the global sanitizeInputs (tags stripped, trimmed). Removes what
// would let a poll lie about itself in the bubble or slip past the word
// blocklist: every format character (Unicode Cf — bidi marks, overrides and
// isolates, zero-width spaces and joiners, word joiner, soft hyphen, BOM, tag
// characters) except ZWJ U+200D, which emoji sequences need, and except the
// tags of a valid subdivision flag; plus control characters; collapses
// whitespace to one line.
// eslint-disable-next-line no-control-regex -- matching control chars IS the point here
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const INVISIBLE = /(\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F})|(?!\u200D)\p{Cf}/gu;
export const cleanPollText = (v) => (typeof v === 'string'
  ? v.normalize('NFC').replace(INVISIBLE, (m, flag) => flag ?? '').replace(/\s+/g, ' ').replace(CONTROL, '').trim()
  : '');

// ── Dates (strings end to end; no timezone conversion anywhere) ─────────────
// Today in Vienna as 'YYYY-MM-DD'. Date options are calendar days, compared as
// day numbers — never through new Date('YYYY-MM-DD'), which parses as UTC.
export const viennaToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const dayNumber = (iso) => {
  const m = DATE_RE.exec(iso || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ts = Date.UTC(y, mo - 1, d);
  const back = new Date(ts);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null; // 2026-02-30
  return Math.round(ts / 86_400_000);
};

const WEEKDAYS = {
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  it: ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'],
  fr: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
};
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  it: ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
};

/**
 * Server-built label of a date option in the CREATOR's app language (from
 * X-App-Locale): it goes into `content` and the result line, which old
 * clients show verbatim. Hand-rolled tables, so tests can pin exact strings
 * without depending on the runtime's ICU data. New clients format the typed
 * date per viewer instead.
 *   de 'Sa 10.10. 18:00' · en 'Sat 10 Oct 18:00' · it 'sab 10 ott 18:00'
 *   fr 'sam. 10 oct. 18:00' · es 'sáb 10 oct 18:00'   (+ year when not current)
 */
export const formatPollDateLabel = ({ date, time }, locale = 'de', currentYear = '') => {
  const m = DATE_RE.exec(date || '');
  if (!m) return String(date || '');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const l = WEEKDAYS[locale] ? locale : 'de';
  const wd = WEEKDAYS[l][new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const otherYear = String(y) !== String(currentYear);
  let out = l === 'de'
    ? `${wd} ${m[3]}.${m[2]}.${otherYear ? m[1] : ''}`
    : `${wd} ${d} ${MONTHS[l][mo - 1]}${otherYear ? ` ${m[1]}` : ''}`;
  if (time) out += ` ${time}`;
  return out;
};

// ── Validation ──────────────────────────────────────────────────────────────
const fail = (error, field) => ({ ok: false, error, field });

/**
 * Validate + normalise a create body. Returns
 *   { ok: true, kind, question, multi, options: [{ label?, date?, time? }] }
 * or { ok: false, error: <German sentence>, field }.
 * Choice options keep their order; date options are sorted ascending
 * (all-day before timed on the same day) and are always multi-select.
 */
export const parsePollInput = (body, { today = viennaToday() } = {}) => {
  const kind = body?.kind;
  if (!POLL_KINDS.includes(kind)) return fail('Ungültiger Umfragetyp.', 'kind');
  const question = cleanPollText(body?.question);
  if (!question) return fail('Bitte gib eine Frage ein.', 'question');
  if (question.length > POLL_LIMITS.QUESTION_MAX) return fail('Die Frage darf höchstens 140 Zeichen lang sein.', 'question');
  const raw = body?.options;
  if (!Array.isArray(raw) || raw.length > 50) return fail('Eine Umfrage braucht 2 bis 10 Optionen.', 'options');

  if (kind === 'choice') {
    const labels = [];
    for (const o of raw) {
      if (!o || typeof o !== 'object' || typeof o.label !== 'string' || 'date' in o || 'time' in o) {
        return fail('Jede Option braucht einen Text (höchstens 60 Zeichen).', 'options');
      }
      const label = cleanPollText(o.label);
      if (!label) continue; // empty rows are dropped, not an error
      if (label.length > POLL_LIMITS.OPTION_MAX) return fail('Jede Option braucht einen Text (höchstens 60 Zeichen).', 'options');
      labels.push(label);
    }
    if (labels.length < POLL_LIMITS.OPTIONS_MIN || labels.length > POLL_LIMITS.OPTIONS_MAX) {
      return fail('Eine Umfrage braucht 2 bis 10 Optionen.', 'options');
    }
    const seen = new Set();
    for (const l of labels) {
      // NFKC folds compatibility look-alikes (ｋｉｎｏ, ligatures) into one key.
      const k = l.normalize('NFKC').toLocaleLowerCase('de');
      if (seen.has(k)) return fail('Jede Option darf nur einmal vorkommen.', 'options');
      seen.add(k);
    }
    return { ok: true, kind, question, multi: body?.multi === true, options: labels.map((label) => ({ label })) };
  }

  // date
  const todayNum = dayNumber(today);
  const opts = [];
  for (const o of raw) {
    if (!o || typeof o !== 'object' || typeof o.date !== 'string') return fail('Ungültiges Datum.', 'options');
    const n = dayNumber(o.date);
    if (n == null) return fail('Ungültiges Datum.', 'options');
    if (n < todayNum - 1 || n > todayNum + POLL_LIMITS.DATE_HORIZON_DAYS) {
      return fail('Termine müssen zwischen heute und in einem Jahr liegen.', 'options');
    }
    let time = null;
    if (o.time != null && o.time !== '') {
      const t = TIME_RE.exec(String(o.time));
      if (!t) return fail('Ungültige Uhrzeit.', 'options');
      time = `${t[1]}:${t[2]}`;
    }
    opts.push({ date: o.date, time, n });
  }
  if (opts.length < POLL_LIMITS.OPTIONS_MIN || opts.length > POLL_LIMITS.OPTIONS_MAX) {
    return fail('Eine Umfrage braucht 2 bis 10 Optionen.', 'options');
  }
  const seen = new Set();
  for (const o of opts) {
    const k = `${o.date} ${o.time || ''}`;
    if (seen.has(k)) return fail('Jede Option darf nur einmal vorkommen.', 'options');
    seen.add(k);
  }
  opts.sort((a, b) => (a.n - b.n) || ((a.time ? 1 : 0) - (b.time ? 1 : 0)) || String(a.time).localeCompare(String(b.time)));
  return { ok: true, kind, question, multi: true, options: opts.map(({ date, time }) => ({ date, time })) };
};

/** `📊 Frage — A · B · C` — one line, never a newline, ≤ POLL_CONTENT_MAX. */
export const buildPollContent = (kind, question, labels) =>
  `${POLL_MARK[kind] || POLL_MARK.choice} ${question} — ${labels.join(' · ')}`;

/**
 * The one-line result posted as a system pill when a poll with votes is
 * closed — in the closer's language. Old clients render system pills, so they
 * learn the outcome too. null when nobody voted.
 */
export const buildResultLine = (summary, locale = 'de') => {
  if (!summary || !summary.voter_count) return null;
  const max = Math.max(0, ...(summary.options || []).map((o) => Number(o.votes) || 0));
  if (!max) return null;
  const winners = (summary.options || []).filter((o) => Number(o.votes) === max).map((o) => o.label);
  const w = winners.slice(0, 3).join(' / ') + (winners.length > 3 ? ' / …' : '');
  const qRaw = String(summary.question || '');
  const q = qRaw.length > 80 ? `${qRaw.slice(0, 79)}…` : qRaw;
  const mark = POLL_MARK[summary.kind] || POLL_MARK.choice;
  const n = max;
  switch (locale) {
    case 'en': return `${mark} Result "${q}": ${w} (${n} ${n === 1 ? 'vote' : 'votes'})`;
    case 'it': return `${mark} Risultato «${q}»: ${w} (${n} ${n === 1 ? 'voto' : 'voti'})`;
    case 'fr': return `${mark} Résultat « ${q} » : ${w} (${n} ${n === 1 ? 'vote' : 'votes'})`;
    case 'es': return `${mark} Resultado «${q}»: ${w} (${n} ${n === 1 ? 'voto' : 'votos'})`;
    default: return `${mark} Ergebnis „${q}“: ${w} (${n} ${n === 1 ? 'Stimme' : 'Stimmen'})`;
  }
};

/**
 * A vote body → sorted unique option positions, or null when invalid.
 * Integers or strings of 1–2 digits; each in [0, optionCount); at most 10; a
 * single-choice poll allows at most one. [] = retract.
 */
export const normalizeChoices = (raw, { optionCount, multi }) => {
  if (!Array.isArray(raw) || raw.length > POLL_LIMITS.OPTIONS_MAX) return null;
  const out = new Set();
  for (const v of raw) {
    let n;
    if (Number.isInteger(v)) n = v;
    else if (typeof v === 'string' && /^\d{1,2}$/.test(v)) n = Number(v);
    else return null;
    if (n < 0 || n >= optionCount) return null;
    out.add(n);
  }
  const arr = [...out].sort((a, b) => a - b);
  if (!multi && arr.length > 1) return null;
  return arr;
};

export const initialPollSummary = ({ kind, question, multi, options }) => ({
  kind,
  question,
  multi: !!multi,
  closed: false,
  version: 0,
  voter_count: 0,
  options: options.map((o, pos) => ({ pos, label: o.label, date: o.date ?? null, time: o.time ?? null, votes: 0 })),
  my_votes: [],
});

/** The room payload: the same for every viewer — without my_votes. */
export const roomPoll = (summary) => {
  if (!summary || typeof summary !== 'object') return summary;
  const { my_votes: _omit, ...rest } = summary;
  return rest;
};

export const isPollSchemaMissing = (err) => err?.code === '42P01' || err?.code === '42703';

// ── SQL ─────────────────────────────────────────────────────────────────────
export const POLL_SQL = Object.freeze({
  ctxCreate: `/* poll:ctx-create */
SELECT g.type, g.name AS group_name, g.owner_id, g.chat_only_owner, g.deleted_at, gm.user_id AS member_user_id
  FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2::int
 WHERE g.id = $1::int`,

  // One statement: the message, the poll and its options — a 'poll' row can
  // never exist without its data. The EXISTS guard re-checks membership in the
  // same statement; 0 rows = it vanished between the check and the write.
  create: `/* poll:create */
WITH m AS (
  INSERT INTO messages (group_id, user_id, content, message_type)
  SELECT $1::int, $2::int, $3::text, 'poll'
   WHERE EXISTS (SELECT 1 FROM group_members WHERE group_id = $1::int AND user_id = $2::int)
  RETURNING *
), p AS (
  INSERT INTO message_polls (message_id, kind, question, multi)
  SELECT m.id, $4::text, $5::text, $6::boolean FROM m
  RETURNING message_id
), o AS (
  INSERT INTO message_poll_options (message_id, position, label, opt_date, opt_time)
  SELECT p.message_id, (x.ord - 1)::smallint, x.label, x.d, x.t
    FROM p, unnest($7::text[], $8::date[], $9::time[]) WITH ORDINALITY AS x(label, d, t, ord)
  RETURNING position
)
SELECT m.*, u.name AS user_name, u.avatar_url, (SELECT COUNT(*)::int FROM o) AS option_count
  FROM m JOIN users u ON u.id = m.user_id`,

  ctxVote: `/* poll:ctx-vote */
SELECT m.group_id, p.multi, p.closed_at,
       (SELECT COUNT(*)::int FROM message_poll_options o WHERE o.message_id = p.message_id) AS option_count,
       EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = m.group_id AND gm.user_id = $2::int) AS is_member
  FROM messages m
  JOIN message_polls p ON p.message_id = m.id
  JOIN groups g ON g.id = m.group_id
 WHERE m.id = $1::int AND m.is_deleted = FALSE AND m.message_type = 'poll' AND g.deleted_at IS NULL`,

  // The UPDATE takes the poll-row lock and re-checks closed_at after waiting
  // on it, so a vote racing a close writes nothing (open = 0 → 409).
  vote: `/* poll:vote */
WITH bump AS (
  UPDATE message_polls SET version = version + 1
   WHERE message_id = $1::int AND closed_at IS NULL
  RETURNING message_id
), w AS (
  INSERT INTO message_poll_votes (message_id, user_id, choices)
  SELECT message_id, $2::int, $3::smallint[] FROM bump
  ON CONFLICT (message_id, user_id)
  DO UPDATE SET choices = EXCLUDED.choices, updated_at = NOW()
  RETURNING 1
)
SELECT (SELECT COUNT(*) FROM bump)::int AS open`,

  retract: `/* poll:retract */
WITH bump AS (
  UPDATE message_polls SET version = version + 1
   WHERE message_id = $1::int AND closed_at IS NULL
  RETURNING message_id
), d AS (
  DELETE FROM message_poll_votes v USING bump
   WHERE v.message_id = bump.message_id AND v.user_id = $2::int
  RETURNING 1
)
SELECT (SELECT COUNT(*) FROM bump)::int AS open`,

  ctxClose: `/* poll:ctx-close */
SELECT m.user_id AS author_id, m.group_id, g.owner_id, p.closed_at,
       gm.user_id AS member_user_id, gm.role AS member_role,
       (SELECT is_admin FROM users WHERE id = $2::int) AS caller_is_admin
  FROM messages m
  JOIN message_polls p ON p.message_id = m.id
  JOIN groups g ON g.id = m.group_id
  LEFT JOIN group_members gm ON gm.group_id = m.group_id AND gm.user_id = $2::int
 WHERE m.id = $1::int AND m.is_deleted = FALSE AND m.message_type = 'poll' AND g.deleted_at IS NULL`,

  close: `/* poll:close */
UPDATE message_polls SET closed_at = NOW(), closed_by = $2::int, version = version + 1
 WHERE message_id = $1::int AND closed_at IS NULL
RETURNING version`,

  // $2 = viewer id (0 when there is none). Every stored ballot counts — see
  // the header: never recount by current membership.
  summary: `/* poll:summary */
SELECT p.message_id, p.kind, p.question, p.multi, (p.closed_at IS NOT NULL) AS closed, p.version,
       (SELECT COUNT(*)::int FROM message_poll_votes v
         WHERE v.message_id = p.message_id) AS voter_count,
       (SELECT COALESCE(json_agg(json_build_object(
                 'pos', o.position, 'label', o.label,
                 'date', to_char(o.opt_date, 'YYYY-MM-DD'), 'time', to_char(o.opt_time, 'HH24:MI'),
                 'votes', (SELECT COUNT(*)::int FROM message_poll_votes v
                            WHERE v.message_id = o.message_id AND o.position = ANY (v.choices))
               ) ORDER BY o.position), '[]'::json)
          FROM message_poll_options o WHERE o.message_id = p.message_id) AS options,
       (SELECT v.choices::int[] FROM message_poll_votes v
         WHERE v.message_id = p.message_id AND v.user_id = $2::int) AS my_votes
  FROM message_polls p
 WHERE p.message_id = ANY ($1::int[])`,

  // The result pill of a closed poll, linked so a takedown of the poll takes
  // it down too (messageController.deleteMessage).
  linkResult: `/* poll:link-result */
UPDATE message_polls SET result_message_id = $2::int WHERE message_id = $1::int`,

  takedownResult: `/* poll:takedown-result */
UPDATE messages SET is_deleted = TRUE, updated_at = NOW()
 WHERE id = (SELECT result_message_id FROM message_polls WHERE message_id = $1::int)
   AND is_deleted = FALSE
RETURNING id, group_id`,

  export: `/* poll:export */
SELECT v.message_id, p.question,
       (SELECT array_agg(o.label ORDER BY o.position) FROM message_poll_options o
         WHERE o.message_id = v.message_id AND o.position = ANY (v.choices)) AS chosen,
       v.updated_at AS voted_at
  FROM message_poll_votes v JOIN message_polls p ON p.message_id = v.message_id
 WHERE v.user_id = $1::int ORDER BY v.updated_at DESC LIMIT 500`,
});

const shapeSummary = (r) => ({
  kind: r.kind,
  question: r.question,
  multi: !!r.multi,
  closed: !!r.closed,
  version: Number(r.version) || 0,
  voter_count: Number(r.voter_count) || 0,
  options: (Array.isArray(r.options) ? r.options : []).map((o) => ({
    pos: Number(o.pos),
    label: o.label,
    date: o.date ?? null,
    time: o.time ?? null,
    votes: Number(o.votes) || 0,
  })),
  my_votes: (Array.isArray(r.my_votes) ? r.my_votes : []).map(Number).sort((a, b) => a - b),
});

const cleanIds = (ids) => [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/** Map messageId → summary. THROWS — for the write paths. */
export const readPollSummaries = async (db, ids, viewerId) => {
  const out = new Map();
  const clean = cleanIds(ids);
  if (!clean.length) return out;
  const { rows } = await db.query(POLL_SQL.summary, [clean, Number(viewerId) || 0]);
  for (const r of rows || []) out.set(Number(r.message_id), shapeSummary(r));
  return out;
};

/**
 * Map messageId → summary for the READ paths. Never throws and ALWAYS returns
 * a Map: the chat must load even when the poll tables are missing (boot
 * window, failed migration) — the rows then render their `content` line.
 */
export const getPollsFor = async (db, ids, viewerId) => {
  if (!cleanIds(ids).length) return new Map();
  try {
    return await readPollSummaries(db, ids, viewerId);
  } catch (err) {
    if (!isPollSchemaMissing(err)) console.error('[polls] summary query failed:', err?.message);
    return new Map();
  }
};

/**
 * getMessages: attach `poll` to the poll rows of a page. Zero queries when the
 * page has no poll rows (the hot path stays exactly as it was); never adds a
 * `poll` key to any other row, and only when data was found.
 */
export const attachPolls = async (db, rows, viewerId) => {
  if (!Array.isArray(rows)) return rows;
  const pollRows = rows.filter((r) => r && r.message_type === 'poll');
  if (!pollRows.length) return rows;
  const map = await getPollsFor(db, pollRows.map((r) => r.id), viewerId);
  for (const r of pollRows) {
    const p = map.get(Number(r.id));
    if (p) r.poll = p;
  }
  return rows;
};

/** Set (non-empty) or retract ([]) the caller's ballot. → open: boolean. */
export const castVote = async (db, messageId, userId, choices) => {
  const sql = choices.length ? POLL_SQL.vote : POLL_SQL.retract;
  const params = choices.length ? [messageId, userId, choices] : [messageId, userId];
  const { rows } = await db.query(sql, params);
  return Number(rows?.[0]?.open) > 0;
};

/** Close once. → changed: boolean (false = it was already closed). */
export const closePollRow = async (db, messageId, userId) => {
  const res = await db.query(POLL_SQL.close, [messageId, userId]);
  return (res?.rowCount ?? res?.rows?.length ?? 0) > 0;
};
