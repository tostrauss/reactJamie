import { describe, it, expect, vi } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

vi.mock('../../src/config/database.js', () => ({
  default: { query: vi.fn(), pool: { connect: vi.fn() } },
}));

const { computePushRecipients } = await import('../../src/controllers/messageController.js');

const rows = (...defs) => defs.map(([user_id, notifications_muted = false]) => ({ user_id, notifications_muted }));

describe('computePushRecipients (chat push discipline — audit risk #8)', () => {
  it('excludes muted members', () => {
    const out = computePushRecipients(rows([1], [2, true], [3]), new Set(), new Map(), 77);
    expect(out).toEqual([1, 3]);
  });

  it('excludes members with a live socket in the room', () => {
    const out = computePushRecipients(rows([1], [2], [3]), new Set([2]), new Map(), 77);
    expect(out).toEqual([1, 3]);
  });

  it('applies the per-member+chat cooldown and stamps only pushed members', () => {
    const cooldown = new Map();
    const t0 = 1_000_000;
    const first = computePushRecipients(rows([1], [2]), new Set([2]), cooldown, 77, t0);
    expect(first).toEqual([1]);
    // Only member 1 was pushed → only member 1 is stamped.
    expect(cooldown.has('1:77')).toBe(true);
    expect(cooldown.has('2:77')).toBe(false);

    // 10s later: member 1 still cooling down, member 2 (now offline) gets one.
    const second = computePushRecipients(rows([1], [2]), new Set(), cooldown, 77, t0 + 10_000);
    expect(second).toEqual([2]);

    // 31s later: member 1's window has passed.
    const third = computePushRecipients(rows([1]), new Set(), cooldown, 77, t0 + 31_000);
    expect(third).toEqual([1]);
  });

  it('scopes the cooldown per chat — same member, different group, still pushed', () => {
    const cooldown = new Map();
    const t0 = 5_000_000;
    expect(computePushRecipients(rows([1]), new Set(), cooldown, 77, t0)).toEqual([1]);
    expect(computePushRecipients(rows([1]), new Set(), cooldown, 88, t0)).toEqual([1]);
    expect(computePushRecipients(rows([1]), new Set(), cooldown, 77, t0 + 1_000)).toEqual([]);
  });

  it('matches active users by number even when socket data carries numbers and rows carry strings', () => {
    const out = computePushRecipients(rows(['4'], ['5']), new Set([4]), new Map(), 77);
    expect(out).toEqual(['5']);
  });
});
