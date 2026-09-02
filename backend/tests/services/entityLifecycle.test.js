import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Programmable fake db + query recorder. Every query flows through ONE base
// implementation that records into `statements` and delegates to the
// per-test `dbQueryImpl` (mockResolvedValueOnce would bypass the recorder).
const statements = [];
let dbQueryImpl;

vi.mock('../../src/config/database.js', () => {
  const fakeClient = { query: vi.fn(), release: vi.fn() };
  return {
    default: {
      query: vi.fn(async (text, params) => {
        statements.push({ text, params });
        return dbQueryImpl(text, params);
      }),
      pool: { connect: vi.fn(async () => fakeClient) },
      _fakeClient: fakeClient,
    },
  };
});

const db = (await import('../../src/config/database.js')).default;
const { createEntityWithOwner, notifyCancellationFanout } = await import('../../src/services/entityLifecycle.js');

beforeEach(() => {
  statements.length = 0;
  db._fakeClient.release.mockClear();
  // Default behavior: fanout INSERTs echo back one row per recipient
  // (RETURNING * emulation — user_id sits at every 7th param position).
  dbQueryImpl = async (text, params) => ({
    rows: params ? params.filter((_, i) => i % 7 === 0).map(uid => ({ user_id: uid })) : [],
  });
});

describe('createEntityWithOwner (single atomic CTE)', () => {
  it('issues ONE query containing both INSERTs, appends the owner param, returns the row', async () => {
    dbQueryImpl = async () => ({ rows: [{ id: 42, name: 'X' }] });
    const entity = await createEntityWithOwner(
      'INSERT INTO groups (name, owner_id) VALUES ($1, $2) RETURNING *', ['X', 7], 7);
    expect(entity).toEqual({ id: 42, name: 'X' });
    const cteCalls = statements.filter(s => s.text.includes('WITH ins AS'));
    expect(cteCalls).toHaveLength(1);
    const { text, params } = cteCalls[0];
    expect(text).toContain('INSERT INTO groups');
    expect(text).toContain('INSERT INTO group_members');
    // Owner param is appended after the caller's params, numbered correctly.
    expect(text).toContain("SELECT id, $3, 'owner' FROM ins");
    expect(params).toEqual(['X', 7, 7]);
  });

  it('propagates a failure — atomic by construction, no partial state possible', async () => {
    dbQueryImpl = async () => { throw new Error('deadlock detected'); };
    await expect(
      createEntityWithOwner('INSERT INTO groups (name) VALUES ($1) RETURNING *', ['X'], 7)
    ).rejects.toThrow('deadlock detected');
    // No client checkout, no explicit tx statements to leak.
    expect(statements.some(s => s.text.startsWith('BEGIN'))).toBe(false);
    expect(db._fakeClient.release).not.toHaveBeenCalled();
  });
});

describe('notifyCancellationFanout', () => {
  it('chunks 2500 members into 3 INSERTs and stays under the bind limit', async () => {
    const memberIds = Array.from({ length: 2500 }, (_, i) => i + 1);
    const notified = await notifyCancellationFanout({
      memberIds, senderId: 1, type: 'club_cancelled', referenceType: 'club',
      referenceId: 9, title: 't', body: 'b', io: null,
    });
    const inserts = statements.filter(s => s.text.includes('INSERT INTO notifications'));
    expect(inserts).toHaveLength(3);
    expect(inserts[0].params).toHaveLength(1000 * 7);
    expect(inserts[2].params).toHaveLength(500 * 7);
    // Placeholder count must match the param count (65535 ceiling honored).
    expect((inserts[0].text.match(/\$\d+/g) || []).length).toBe(7000);
    expect(notified).toBe(2500);
  });

  it('fully parameterizes type/reference_type (no string interpolation)', async () => {
    await notifyCancellationFanout({
      memberIds: [5], senderId: 1, type: "x'; DROP TABLE users; --", referenceType: 'club',
      referenceId: 9, title: 't', body: 'b', io: null,
    });
    const insert = statements.find(s => s.text.includes('INSERT INTO notifications'));
    expect(insert.text).not.toContain('DROP TABLE');
    expect(insert.params).toContain("x'; DROP TABLE users; --");
  });

  it('emits new_notification per inserted row when io is provided', async () => {
    const emitted = [];
    const io = { to: (room) => ({ emit: (ev, payload) => emitted.push({ room, ev, payload }) }) };
    await notifyCancellationFanout({
      memberIds: [7, 14], senderId: 1, type: 'group_cancelled', referenceType: 'group',
      referenceId: 3, title: 't', body: 'b', io,
    });
    expect(emitted.map(e => e.room)).toEqual(['user_7', 'user_14']);
    expect(emitted.every(e => e.ev === 'new_notification')).toBe(true);
  });
});
