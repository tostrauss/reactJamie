import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Programmable fake pool client + query recorder.
const statements = [];
let clientQueryImpl;

vi.mock('../../src/config/database.js', () => {
  const fakeClient = {
    query: vi.fn(async (text, params) => {
      statements.push({ text, params });
      return clientQueryImpl(text, params);
    }),
    release: vi.fn(),
  };
  return {
    default: {
      query: vi.fn(async (text, params) => {
        statements.push({ text, params });
        return { rows: params ? params.filter((_, i) => i % 7 === 0).map(uid => ({ user_id: uid })) : [] };
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
  clientQueryImpl = async (text) => {
    if (text.startsWith('INSERT INTO groups')) return { rows: [{ id: 42 }] };
    return { rows: [] };
  };
});

describe('createEntityWithOwner', () => {
  it('runs entity INSERT + owner INSERT inside BEGIN/COMMIT and returns the row', async () => {
    const entity = await createEntityWithOwner('INSERT INTO groups (name) VALUES ($1) RETURNING *', ['X'], 7);
    expect(entity).toEqual({ id: 42 });
    const kinds = statements.map(s => s.text.split(' ')[0] + (s.text.includes('group_members') ? ':members' : ''));
    expect(kinds).toEqual(['BEGIN', 'INSERT', 'INSERT:members', 'COMMIT']);
    expect(statements[2].params).toEqual([42, 7, 'owner']);
    expect(db._fakeClient.release).toHaveBeenCalledTimes(1);
  });

  it('ROLLBACKs and releases when the owner INSERT fails (no ownerless entity)', async () => {
    clientQueryImpl = async (text) => {
      if (text.startsWith('INSERT INTO groups')) return { rows: [{ id: 42 }] };
      if (text.includes('group_members')) throw new Error('pool pressure');
      return { rows: [] };
    };
    await expect(
      createEntityWithOwner('INSERT INTO groups (name) VALUES ($1) RETURNING *', ['X'], 7)
    ).rejects.toThrow('pool pressure');
    expect(statements.some(s => s.text.startsWith('ROLLBACK'))).toBe(true);
    expect(statements.some(s => s.text.startsWith('COMMIT'))).toBe(false);
    expect(db._fakeClient.release).toHaveBeenCalledTimes(1);
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
