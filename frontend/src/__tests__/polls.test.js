import { describe, it, expect } from 'vitest';
import {
  mergePoll, applyVoteLocally, nextChoices, validatePollDraft, formatPollOption, toPollPayload,
  addDaysIso, isRenderablePoll, leadingPositions,
} from '../utils/polls';

// Abstimmungen im Chat (B1) — pure helpers.
const poll = (over = {}) => ({
  kind: 'choice', question: 'Was machen wir?', multi: false, closed: false, version: 3, voter_count: 2,
  options: [{ pos: 0, label: 'Bowling', votes: 1 }, { pos: 1, label: 'Kino', votes: 1 }],
  my_votes: [0], ...over,
});

describe('mergePoll — never rolls the bubble back', () => {
  it('ignores an older version', () => {
    const cur = poll();
    expect(mergePoll(cur, poll({ version: 2, voter_count: 9 }))).toBe(cur);
  });
  it('applies an equal or newer one and keeps my_votes when the room payload has none', () => {
    const cur = poll();
    const { my_votes: _x, ...room } = poll({ version: 4, voter_count: 3 });
    const next = mergePoll(cur, room);
    expect(next.voter_count).toBe(3);
    expect(next.my_votes).toEqual([0]);
  });
  it('returns the same object when nothing changed (React can bail out)', () => {
    const cur = poll();
    expect(mergePoll(cur, poll())).toBe(cur);
  });
  it('ignores garbage, adopts a first renderable poll', () => {
    const cur = poll();
    expect(mergePoll(cur, null)).toBe(cur);
    expect(mergePoll(cur, { question: 'x', options: [] })).toBe(cur);
    expect(mergePoll(undefined, poll()).question).toBe('Was machen wir?');
  });
});

describe('applyVoteLocally (optimistic)', () => {
  it('single choice: moves my vote', () => {
    const p = applyVoteLocally(poll(), [1]);
    expect(p.options.map((o) => o.votes)).toEqual([0, 2]);
    expect(p.voter_count).toBe(2);
    expect(p.my_votes).toEqual([1]);
  });
  it('retract: voter_count goes down, never below 0', () => {
    const p = applyVoteLocally(poll({ voter_count: 0, options: [{ pos: 0, label: 'A', votes: 0 }, { pos: 1, label: 'B', votes: 0 }] }), []);
    expect(p.voter_count).toBe(0);
    expect(p.options.every((o) => o.votes === 0)).toBe(true);
  });
  it('a first vote adds a voter; the input is not mutated', () => {
    const before = poll({ my_votes: [], voter_count: 1 });
    const snapshot = JSON.stringify(before);
    const p = applyVoteLocally(before, [0, 1]);
    expect(p.voter_count).toBe(2);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('nextChoices', () => {
  it('single: tapping my own choice withdraws it, another replaces it', () => {
    expect(nextChoices(poll(), 0)).toEqual([]);
    expect(nextChoices(poll(), 1)).toEqual([1]);
  });
  it('multi: toggles, sorted', () => {
    expect(nextChoices(poll({ multi: true, my_votes: [1] }), 0)).toEqual([0, 1]);
    expect(nextChoices(poll({ multi: true, my_votes: [0, 1] }), 0)).toEqual([1]);
  });
});

describe('leadingPositions / isRenderablePoll', () => {
  it('lists the top counts only when somebody voted', () => {
    expect(leadingPositions(poll())).toEqual([0, 1]);
    expect(leadingPositions(poll({ options: [{ pos: 0, label: 'A', votes: 0 }, { pos: 1, label: 'B', votes: 0 }] }))).toEqual([]);
  });
  it('needs a question and two options', () => {
    expect(isRenderablePoll(poll())).toBe(true);
    expect(isRenderablePoll({ question: 'q', options: [{}] })).toBe(false);
    expect(isRenderablePoll(null)).toBe(false);
  });
});

describe('validatePollDraft', () => {
  const today = '2026-10-06';
  it('a date draft with two future dates is fine', () => {
    expect(validatePollDraft({ kind: 'date', question: 'Wann?', dates: [{ date: '2026-10-07' }, { date: '2026-10-08' }] }, today).ok).toBe(true);
  });
  it('flags past, out-of-range and duplicate dates per row', () => {
    const v = validatePollDraft({ kind: 'date', question: 'Wann?', dates: [
      { date: '2026-10-05' }, { date: '2027-10-08' }, { date: '2026-10-09', time: '18:00' }, { date: '2026-10-09', time: '18:00' },
    ] }, today);
    expect(v.rowErrors).toEqual({ 0: 'past', 1: 'range', 3: 'duplicate' });
    expect(v.ok).toBe(false);
  });
  it('choice drafts need two distinct labels (case-insensitive)', () => {
    expect(validatePollDraft({ kind: 'choice', question: 'Was?', options: [{ label: 'Kino' }, { label: '' }] }, today).countError).toBe('few');
    expect(validatePollDraft({ kind: 'choice', question: 'Was?', options: [{ label: 'Kino' }, { label: ' kino' }] }, today).rowErrors).toEqual({ 1: 'duplicate' });
    expect(validatePollDraft({ kind: 'choice', question: '  ', options: [{ label: 'A' }, { label: 'B' }] }, today).questionError).toBe('empty');
  });
});

describe('formatPollOption — never the UTC off-by-one', () => {
  it('shows day 11 for 2026-10-11 in de-DE and en-US, all-day and timed', () => {
    const now = new Date(2026, 9, 6);
    for (const locale of ['de-DE', 'en-US']) {
      expect(formatPollOption({ date: '2026-10-11' }, 'date', locale, now)).toContain('11');
      const timed = formatPollOption({ date: '2026-10-11', time: '18:00' }, 'date', locale, now);
      expect(timed).toContain('11');
      expect(timed).toMatch(/18|6/);
    }
  });
  it('choice options use the label; broken dates fall back to the label', () => {
    expect(formatPollOption({ label: 'Kino' }, 'choice')).toBe('Kino');
    expect(formatPollOption({ date: 'x', label: 'Sa 10.10.' }, 'date')).toBe('Sa 10.10.');
  });
});

describe('toPollPayload', () => {
  it('date: forced multi, null for no time, unfilled rows dropped', () => {
    expect(toPollPayload({ kind: 'date', question: ' Wann? ', dates: [{ date: '2026-10-07', time: '' }, { date: '2026-10-08', time: '18:00' }, { date: '' }] }))
      .toEqual({ kind: 'date', question: 'Wann?', multi: true, options: [{ date: '2026-10-07', time: null }, { date: '2026-10-08', time: '18:00' }] });
  });
  it('choice: trimmed labels, empty rows dropped, multi from the toggle', () => {
    expect(toPollPayload({ kind: 'choice', question: 'Was?', multi: true, options: [{ label: ' Kino ' }, { label: '' }, { label: 'Bowling' }] }))
      .toEqual({ kind: 'choice', question: 'Was?', multi: true, options: [{ label: 'Kino' }, { label: 'Bowling' }] });
  });
  it('addDaysIso works on the string parts across month ends', () => {
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
  });
});
