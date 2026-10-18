import { describe, it, expect } from 'vitest';
import { badgeLabel, isInternalPath, notificationTarget } from '../utils/notifications';

// Where a notification row leads (the bell's list, 18.10.2026) and what the
// badge says. Pure functions — the page tests cover the rendering.
describe('notificationTarget', () => {
  it.each([
    ['an internal link wins over everything', { type: 'news', link: '/deal/12', reference_type: 'group', reference_id: 3 }, '/deal/12'],
    ['hof_like → the Hall of Fame', { type: 'hof_like', reference_type: 'group', reference_id: 40 }, '/explore'],
    ['group', { type: 'group_cancelled', reference_type: 'group', reference_id: 7 }, '/group/7'],
    ['club', { type: 'club_updated', reference_type: 'club', reference_id: 9 }, '/club/9'],
    ['user', { type: 'friend_accepted', reference_type: 'user', reference_id: 33 }, '/user/33'],
    ['a numeric string id', { type: 'x', reference_type: 'group', reference_id: '12' }, '/group/12'],
    ['a deleted group → nowhere', { type: 'group_deleted', reference_type: 'group', reference_id: 7, reference_gone: true }, null],
    ['a deleted club → nowhere', { type: 'club_deleted', reference_type: 'club', reference_id: 9, reference_gone: true }, null],
    ['news without a link → nowhere', { type: 'news', link: null }, null],
    ['an external link is ignored', { type: 'news', link: 'https://evil.example' }, null],
    ['a protocol-relative link is ignored', { type: 'news', link: '//evil.example' }, null],
    ['an unknown reference type → nowhere', { type: 'x', reference_type: 'message', reference_id: 5 }, null],
    ['no id → nowhere', { type: 'x', reference_type: 'group', reference_id: null }, null],
    ['avatar_removed (reference "profile") → nowhere', { type: 'avatar_removed', reference_type: 'profile' }, null],
    ['nothing at all', null, null],
  ])('%s', (_label, n, expected) => {
    expect(notificationTarget(n)).toBe(expected);
  });
});

describe('isInternalPath', () => {
  it.each([
    ['/deal/12', true], ['/explore', true], ['/club/3?tab=events', true], ['/', true],
    ['deal/12', false], ['//evil.example', false], ['/\\evil', false], ['/a b', false], ['', false], [undefined, false],
  ])('%j → %s', (value, expected) => {
    expect(isInternalPath(value)).toBe(expected);
  });
});

describe('badgeLabel', () => {
  it.each([[1, '1'], [9, '9'], [10, '9+'], [99, '9+']])('%i → %s', (n, expected) => {
    expect(badgeLabel(n)).toBe(expected);
  });
});
