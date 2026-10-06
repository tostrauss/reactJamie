import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  POLL_KINDS, POLL_LIMITS, POLL_CONTENT_MAX, POLL_SQL,
  cleanPollText, viennaToday, parsePollInput, formatPollDateLabel, buildPollContent, buildResultLine,
  normalizeChoices, initialPollSummary, roomPoll, isPollSchemaMissing,
  getPollsFor, attachPolls, castVote, closePollRow,
} from '../../src/utils/polls.js';

// Abstimmungen im Chat (B1, tester 06.10.2026).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TODAY = '2026-10-06';

describe('limits mirrored in the frontend', () => {
  it('POLL_LIMITS and POLL_KINDS are identical in frontend/src/utils/polls.js', () => {
    const fe = fs.readFileSync(path.join(__dirname, '../../../frontend/src/utils/polls.js'), 'utf8');
    const limits = fe.match(/export const POLL_LIMITS = Object\.freeze\((\{[^}]*\})\);/);
    expect(limits, 'POLL_LIMITS missing in the frontend').toBeTruthy();
    expect(JSON.parse(limits[1].replace(/(\w+):/g, '"$1":'))).toEqual({ ...POLL_LIMITS });
    const kinds = fe.match(/export const POLL_KINDS = (\[[^\]]*\]);/);
    expect(JSON.parse(kinds[1].replace(/'/g, '"'))).toEqual(POLL_KINDS);
  });
});

describe('cleanPollText', () => {
  it('strips bidi overrides, isolates, zero-width chars and BOM; keeps ZWJ emoji', () => {
    expect(cleanPollText('Ki\u202Eno')).toBe('Kino');
    expect(cleanPollText('\u2066Bowling\u2069')).toBe('Bowling');
    expect(cleanPollText('A\u200BB\uFEFF')).toBe('AB');
    expect(cleanPollText('👨\u200D👩\u200D👧 Familie')).toBe('👨\u200D👩\u200D👧 Familie');
  });
  it('folds newlines and whitespace runs to single spaces', () => {
    expect(cleanPollText('  Was\n\nmachen   wir?  ')).toBe('Was machen wir?');
  });
  it('non-strings become empty', () => {
    expect(cleanPollText(null)).toBe('');
    expect(cleanPollText(42)).toBe('');
  });
});

// Review B1: every format character (Unicode Cf) goes — not just a hand-picked
// list — so the word blocklist and the duplicate check cannot be dodged with a
// word joiner or a soft hyphen. Emoji keep working. Built with fromCodePoint so
// no invisible character ever sits in this source file.
describe('cleanPollText — every invisible format character', () => {
  const c = (...cps) => String.fromCodePoint(...cps);
  it('strips word joiner, soft hyphen, Arabic letter mark, Mongolian separator, invisible operators and stray tags', () => {
    expect(cleanPollText('Fo' + c(0x2060) + 'tze')).toBe('Fotze');
    expect(cleanPollText('Ja' + c(0xAD))).toBe('Ja');
    expect(cleanPollText('a' + c(0x61C) + 'b' + c(0x180E) + 'c' + c(0x2063) + 'd' + c(0xE0041) + 'e')).toBe('abcde');
  });
  it('keeps ZWJ sequences, variation selectors and subdivision flags', () => {
    const family = c(0x1F468, 0x200D, 0x1F469, 0x200D, 0x1F467);
    const scotland = c(0x1F3F4, 0xE0067, 0xE0062, 0xE0073, 0xE0063, 0xE0074, 0xE007F);
    const heart = c(0x2764, 0xFE0F);
    expect(cleanPollText(family + ' ' + scotland + ' ' + heart)).toBe(family + ' ' + scotland + ' ' + heart);
  });
  it('visually identical options are duplicates (cleaned + NFKC key)', () => {
    const r = parsePollInput({ kind: 'choice', question: 'q', options: [
      { label: 'Ja' }, { label: 'Ja' + c(0x2060) }] }, { today: TODAY });
    expect(r).toMatchObject({ ok: false, field: 'options' });
    const wide = parsePollInput({ kind: 'choice', question: 'q', options: [
      { label: 'Kino' }, { label: c(0xFF2B, 0xFF49, 0xFF4E, 0xFF4F) }] }, { today: TODAY });
    expect(wide).toMatchObject({ ok: false, field: 'options' });
  });
});

describe('summary counts every stored ballot (anonymity on leave)', () => {
  it('never recounts by current membership — a drop after "X hat die Gruppe verlassen" would show how X voted', () => {
    expect(POLL_SQL.summary).not.toContain('group_members');
  });
});

describe('viennaToday', () => {
  it('uses the Vienna calendar day, not UTC', () => {
    expect(viennaToday(new Date('2026-10-06T22:30:00Z'))).toBe('2026-10-07');
    expect(viennaToday(new Date('2026-10-06T10:00:00Z'))).toBe('2026-10-06');
  });
});

describe('parsePollInput — choice', () => {
  const ok = (b) => parsePollInput({ kind: 'choice', question: 'Was machen wir?', ...b }, { today: TODAY });
  it('accepts 2–10 labels, keeps order, single answer unless multi === true', () => {
    const r = ok({ options: [{ label: 'Bowling' }, { label: 'Kino' }] });
    expect(r).toEqual({ ok: true, kind: 'choice', question: 'Was machen wir?', multi: false,
      options: [{ label: 'Bowling' }, { label: 'Kino' }] });
    expect(ok({ multi: true, options: [{ label: 'A' }, { label: 'B' }] }).multi).toBe(true);
    expect(ok({ multi: 'yes', options: [{ label: 'A' }, { label: 'B' }] }).multi).toBe(false);
  });
  it('drops empty labels, rejects case-insensitive duplicates', () => {
    expect(ok({ options: [{ label: 'A' }, { label: '   ' }, { label: 'B' }] }).options).toHaveLength(2);
    expect(ok({ options: [{ label: 'Kino' }, { label: ' kino' }] })).toEqual({ ok: false, error: 'Jede Option darf nur einmal vorkommen.', field: 'options' });
  });
  it.each([
    [{ options: [{ label: 'A' }] }, 'Eine Umfrage braucht 2 bis 10 Optionen.', 'options'],
    [{ options: Array.from({ length: 11 }, (_, i) => ({ label: `O${i}` })) }, 'Eine Umfrage braucht 2 bis 10 Optionen.', 'options'],
    [{ options: [{ label: 'x'.repeat(61) }, { label: 'B' }] }, 'Jede Option braucht einen Text (höchstens 60 Zeichen).', 'options'],
    [{ options: [{ label: 'A', date: '2026-10-07' }, { label: 'B' }] }, 'Jede Option braucht einen Text (höchstens 60 Zeichen).', 'options'],
    [{ options: 'A,B' }, 'Eine Umfrage braucht 2 bis 10 Optionen.', 'options'],
    [{ question: '', options: [{ label: 'A' }, { label: 'B' }] }, 'Bitte gib eine Frage ein.', 'question'],
    [{ question: 'q'.repeat(141), options: [{ label: 'A' }, { label: 'B' }] }, 'Die Frage darf höchstens 140 Zeichen lang sein.', 'question'],
  ])('rejects %j', (b, error, field) => {
    expect(ok(b)).toEqual({ ok: false, error, field });
  });
  it('rejects an unknown kind', () => {
    expect(parsePollInput({ kind: 'sticker', question: 'q', options: [] })).toEqual({ ok: false, error: 'Ungültiger Umfragetyp.', field: 'kind' });
  });
});

describe('parsePollInput — date', () => {
  const ok = (options) => parsePollInput({ kind: 'date', question: 'Wann passt es euch?', multi: false, options }, { today: TODAY });
  it('sorts ascending, all-day first, normalises HH:MM:SS, forces multi', () => {
    const r = ok([{ date: '2026-10-11', time: '18:00:00' }, { date: '2026-10-10', time: null }, { date: '2026-10-11', time: '' }]);
    expect(r.ok).toBe(true);
    expect(r.multi).toBe(true);
    expect(r.options).toEqual([
      { date: '2026-10-10', time: null },
      { date: '2026-10-11', time: null },
      { date: '2026-10-11', time: '18:00' },
    ]);
  });
  it.each([
    [[{ date: '2026-02-30' }, { date: '2026-10-08' }], 'Ungültiges Datum.'],
    [[{ date: '2026-10-04' }, { date: '2026-10-08' }], 'Termine müssen zwischen heute und in einem Jahr liegen.'],
    [[{ date: '2027-10-08' }, { date: '2026-10-08' }], 'Termine müssen zwischen heute und in einem Jahr liegen.'],
    [[{ date: '2026-10-07', time: '24:00' }, { date: '2026-10-08' }], 'Ungültige Uhrzeit.'],
    [[{ date: '2026-10-07', time: '7:5' }, { date: '2026-10-08' }], 'Ungültige Uhrzeit.'],
    [[{ date: '2026-10-07', time: '18:00' }, { date: '2026-10-07', time: '18:00' }], 'Jede Option darf nur einmal vorkommen.'],
    [[{ date: '2026-10-07' }], 'Eine Umfrage braucht 2 bis 10 Optionen.'],
  ])('rejects %j', (options, error) => {
    expect(ok(options)).toEqual({ ok: false, error, field: 'options' });
  });
  it('allows yesterday (Vienna) for the time-zone gap', () => {
    expect(ok([{ date: '2026-10-05' }, { date: '2026-10-08' }]).ok).toBe(true);
  });
});

describe('formatPollDateLabel (server-built, creator language)', () => {
  it.each([
    ['de', 'Sa 10.10. 18:00'],
    ['en', 'Sat 10 Oct 18:00'],
    ['it', 'sab 10 ott 18:00'],
    ['fr', 'sam. 10 oct. 18:00'],
    ['es', 'sáb 10 oct 18:00'],
  ])('%s', (locale, expected) => {
    expect(formatPollDateLabel({ date: '2026-10-10', time: '18:00' }, locale, '2026')).toBe(expected);
  });
  it('adds the year only when it is not the current one; all-day has no time', () => {
    expect(formatPollDateLabel({ date: '2027-01-02', time: null }, 'de', '2026')).toBe('Sa 02.01.2027');
    expect(formatPollDateLabel({ date: '2027-01-02', time: null }, 'en', '2026')).toBe('Sat 2 Jan 2027');
  });
});

describe('buildPollContent', () => {
  it('one readable line for old clients', () => {
    expect(buildPollContent('choice', 'Was machen wir?', ['Bowling', 'Kino'])).toBe('📊 Was machen wir? — Bowling · Kino');
    expect(buildPollContent('date', 'Wann?', ['Sa 10.10.', 'So 11.10. 18:00'])).toBe('📅 Wann? — Sa 10.10. · So 11.10. 18:00');
  });
  it('never contains a newline and the worst case fits POLL_CONTENT_MAX (773)', () => {
    expect(POLL_CONTENT_MAX).toBe(773);
    const worst = buildPollContent('choice', 'q'.repeat(140), Array.from({ length: 10 }, () => 'x'.repeat(60)));
    expect(worst).not.toContain('\n');
    expect(worst.length).toBeLessThanOrEqual(POLL_CONTENT_MAX);
  });
});

describe('buildResultLine', () => {
  const s = (votes, extra = {}) => ({
    kind: 'choice', question: 'Was machen wir?', voter_count: 3,
    options: votes.map((v, i) => ({ pos: i, label: `O${i}`, votes: v })), ...extra,
  });
  it('names the winner with the vote count', () => {
    expect(buildResultLine(s([1, 2]), 'de')).toBe('📊 Ergebnis „Was machen wir?“: O1 (2 Stimmen)');
    expect(buildResultLine(s([1, 0]), 'de')).toBe('📊 Ergebnis „Was machen wir?“: O0 (1 Stimme)');
  });
  it('ties list every winner, more than three are cut', () => {
    expect(buildResultLine(s([2, 2]), 'en')).toBe('📊 Result "Was machen wir?": O0 / O1 (2 votes)');
    expect(buildResultLine(s([1, 1, 1, 1]), 'de')).toBe('📊 Ergebnis „Was machen wir?“: O0 / O1 / O2 / … (1 Stimme)');
  });
  it.each([
    ['it', '📅 Risultato «Wann?»: O0 (2 voti)'],
    ['fr', '📅 Résultat « Wann? » : O0 (2 votes)'],
    ['es', '📅 Resultado «Wann?»: O0 (2 votos)'],
  ])('%s', (l, expected) => {
    expect(buildResultLine(s([2, 1], { kind: 'date', question: 'Wann?' }), l)).toBe(expected);
  });
  it('null without votes', () => {
    expect(buildResultLine(s([0, 0], { voter_count: 0 }), 'de')).toBeNull();
    expect(buildResultLine(null)).toBeNull();
  });
});

describe('normalizeChoices', () => {
  it('sorts, dedupes, accepts digit strings', () => {
    expect(normalizeChoices([2, '0', 2], { optionCount: 3, multi: true })).toEqual([0, 2]);
    expect(normalizeChoices([], { optionCount: 3, multi: false })).toEqual([]);
  });
  it.each([
    [[3], 3, true], [[-1], 3, true], [['x'], 3, true], [[1.5], 3, true], [['123'], 3, true],
    [[0, 1], 3, false], ['0', 3, true],
  ])('rejects %j', (raw, optionCount, multi) => {
    expect(normalizeChoices(raw, { optionCount, multi })).toBeNull();
  });
});

describe('summaries', () => {
  it('initialPollSummary + roomPoll strip the viewer selection for the room', () => {
    const p = initialPollSummary({ kind: 'choice', question: 'q', multi: false, options: [{ label: 'A' }, { label: 'B' }] });
    expect(p).toMatchObject({ version: 0, voter_count: 0, closed: false, my_votes: [] });
    expect(p.options[1]).toEqual({ pos: 1, label: 'B', date: null, time: null, votes: 0 });
    expect(roomPoll(p)).not.toHaveProperty('my_votes');
  });
  it('schema-missing errors are recognised', () => {
    expect(isPollSchemaMissing({ code: '42P01' })).toBe(true);
    expect(isPollSchemaMissing({ code: '42703' })).toBe(true);
    expect(isPollSchemaMissing({ code: '23505' })).toBe(false);
  });
});

describe('read path (getPollsFor / attachPolls) — never breaks the chat', () => {
  beforeEach(() => vi.restoreAllMocks());
  const row = { message_id: 7, kind: 'choice', question: 'q', multi: false, closed: false, version: '3', voter_count: '2',
    options: [{ pos: 0, label: 'A', date: null, time: null, votes: '1' }, { pos: 1, label: 'B', date: null, time: null, votes: 1 }],
    my_votes: [1, 0] };

  it('no query for no valid ids', async () => {
    const db = { query: vi.fn() };
    expect(await getPollsFor(db, [], 1)).toEqual(new Map());
    expect(await getPollsFor(db, ['temp-1', null, 0], 1)).toEqual(new Map());
    expect(db.query).not.toHaveBeenCalled();
  });

  it('dedupes ids, coerces numbers, sorts my_votes', async () => {
    const db = { query: vi.fn(async () => ({ rows: [row] })) };
    const m = await getPollsFor(db, [7, '7'], 5);
    expect(db.query.mock.calls[0][1]).toEqual([[7], 5]);
    expect(m.get(7)).toMatchObject({ version: 3, voter_count: 2, my_votes: [0, 1] });
    expect(m.get(7).options[0].votes).toBe(1);
  });

  it('42P01 → empty Map silently; any other error → logged, still a Map', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = { query: vi.fn(async () => { throw Object.assign(new Error('x'), { code: '42P01' }); }) };
    expect(await getPollsFor(missing, [1], 1)).toEqual(new Map());
    expect(err).not.toHaveBeenCalled();
    const broken = { query: vi.fn(async () => { throw new Error('reset'); }) };
    expect(await getPollsFor(broken, [1], 1)).toEqual(new Map());
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('attachPolls: a page without poll rows never queries (hot path untouched)', async () => {
    const db = { query: vi.fn() };
    const rows = [{ id: 1, message_type: 'text' }, { id: 2, message_type: 'image' }];
    await attachPolls(db, rows, 1);
    expect(db.query).not.toHaveBeenCalled();
    expect(rows[0]).not.toHaveProperty('poll');
  });

  it('attachPolls patches only poll rows, and only when data came back', async () => {
    const db = { query: vi.fn(async () => ({ rows: [row] })) };
    const rows = [{ id: 7, message_type: 'poll' }, { id: 8, message_type: 'poll' }, { id: 9, message_type: 'text' }];
    await attachPolls(db, rows, 1);
    expect(rows[0].poll.question).toBe('q');
    expect(rows[1]).not.toHaveProperty('poll');
    expect(rows[2]).not.toHaveProperty('poll');
  });
});

describe('write SQL', () => {
  it('a vote bumps the version and re-checks closed_at in the same statement', async () => {
    expect(POLL_SQL.vote).toContain('version = version + 1');
    expect(POLL_SQL.vote).toContain('closed_at IS NULL');
    expect(POLL_SQL.vote).toContain('ON CONFLICT (message_id, user_id)');
    expect(POLL_SQL.retract).toMatch(/DELETE FROM message_poll_votes v USING bump/);
    const db = { query: vi.fn(async () => ({ rows: [{ open: 0 }] })) };
    expect(await castVote(db, 1, 2, [0])).toBe(false);
    expect(db.query.mock.calls[0][0]).toContain('/* poll:vote */');
    await castVote(db, 1, 2, []);
    expect(db.query.mock.calls[1][0]).toContain('/* poll:retract */');
    expect(db.query.mock.calls[1][1]).toEqual([1, 2]);
  });

  it('closePollRow reports whether it changed anything', async () => {
    expect(await closePollRow({ query: vi.fn(async () => ({ rowCount: 1, rows: [{ version: 4 }] })) }, 1, 2)).toBe(true);
    expect(await closePollRow({ query: vi.fn(async () => ({ rowCount: 0, rows: [] })) }, 1, 2)).toBe(false);
  });

  it('every statement carries its routing tag and casts its parameters', () => {
    for (const [name, sql] of Object.entries(POLL_SQL)) {
      expect(sql.startsWith('/* poll:'), name).toBe(true);
    }
    expect(POLL_SQL.create).toContain('$7::text[]');
    expect(POLL_SQL.create).toContain('$8::date[]');
    expect(POLL_SQL.create).toContain('$9::time[]');
  });
});
