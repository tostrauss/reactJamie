import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Friend requests in Chat → Anfragen (Lea, 18.10.2026: „Man bemerkt die
// Freundschaftsanfragen nicht, nur wenn man aufs eigene Profil schaut“). The
// deck needs the same facts about the person as for a join request, and a
// live ping once a request is STORED — never before, never on a failed write.

// ── Mocks ─────────────────────────────────────────────────────────────────
// db.query dispatches on SQL text (same pattern as joinRequests.test.js);
// every write and every emit lands in `log`, so the order can be checked.
const log = [];
const scenario = {
  targetExists: true,
  existing: null,      // friendships row between the two users (sendFriendRequest)
  insertError: null,   // error the INSERT throws
  pendingRow: null,    // the request respondFriendRequest finds (accept/reject)
  undoRow: null,       // the rejected request undo restores
  pendingList: [],     // rows for getPendingRequests
  tierRows: [],        // rows of the Abzeichen-Stufen aggregate
  tierFail: false,
};

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text) => {
      // FIRST: the tier aggregate is routed on its marker (utils/attendanceTiers.js).
      if (text.includes('attendance-tiers')) {
        if (scenario.tierFail) throw Object.assign(new Error('boot window'), { code: '42P01' });
        return { rows: scenario.tierRows };
      }
      if (text.includes('SELECT 1 FROM users WHERE id')) {
        return { rows: scenario.targetExists ? [{ '?column?': 1 }] : [] };
      }
      if (text.includes('SELECT id, status, requester_id FROM friendships')) {
        return { rows: scenario.existing ? [scenario.existing] : [] };
      }
      if (text.includes('INSERT INTO friendships')) {
        if (scenario.insertError) throw scenario.insertError;
        log.push('db:insert');
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("status = 'rejected' RETURNING id")) {
        if (scenario.undoRow) log.push('db:undo');
        return { rows: scenario.undoRow ? [scenario.undoRow] : [] };
      }
      if (text.includes("UPDATE friendships SET status = 'pending', requester_id")) {
        log.push('db:re-request');
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT id, requester_id FROM friendships')) {
        return { rows: scenario.pendingRow ? [scenario.pendingRow] : [] };
      }
      if (text.includes('UPDATE friendships SET status = $1')) {
        log.push('db:respond');
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('JOIN users u ON f.requester_id = u.id')) {
        return { rows: scenario.pendingList };
      }
      if (text.includes('SELECT name FROM users')) return { rows: [{ name: 'Anna' }] };
      return { rows: [] };
    }),
    pool: { connect: vi.fn() },
  },
}));

vi.mock('../../src/config/sentry.js', () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: vi.fn() },
}));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/controllers/pushController.js', () => ({ sendPushToUser: vi.fn() }));

const { sendFriendRequest, respondFriendRequest, getPendingRequests } =
  await import('../../src/controllers/friendshipController.js');
const { default: db } = await import('../../src/config/database.js');

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const emits = [];
const ioMock = {
  to: vi.fn((room) => ({
    emit: (event, payload) => { log.push(`emit:${room}:${event}`); emits.push({ room, event, payload }); },
  })),
};
const makeReq = ({ userId = 5, body = {}, params = {}, io = ioMock } = {}) => ({
  userId, body, params, app: { get: vi.fn(() => io) },
});

beforeEach(() => {
  log.length = 0;
  emits.length = 0;
  Object.assign(scenario, {
    targetExists: true, existing: null, insertError: null, pendingRow: null, undoRow: null,
    pendingList: [], tierRows: [], tierFail: false,
  });
  ioMock.to.mockClear();
  db.query.mockClear(); // keeps the SQL router, drops the recorded calls
});

// ── sendFriendRequest → live ping to the recipient ────────────────────────
describe('sendFriendRequest pings the recipient\'s deck', () => {
  it('emits friend_request_update to user_<recipient> AFTER the INSERT', async () => {
    const res = makeRes();
    await sendFriendRequest(makeReq({ userId: 5, body: { userId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(log).toEqual(['db:insert', 'emit:user_9:friend_request_update']);
    // The payload names no one — the deck refetches the pending list.
    expect(emits).toEqual([{ room: 'user_9', event: 'friend_request_update', payload: { action: 'received' } }]);
  });

  it('a re-request (row reused after reject/expiry) pings as well, after the UPDATE', async () => {
    scenario.existing = { id: 3, status: 'expired', requester_id: 9 };
    const res = makeRes();
    await sendFriendRequest(makeReq({ userId: 5, body: { userId: 9 } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(log).toEqual(['db:re-request', 'emit:user_9:friend_request_update']);
  });

  it.each([
    ['already pending', { id: 3, status: 'pending', requester_id: 5 }, 400],
    ['already friends', { id: 3, status: 'accepted', requester_id: 5 }, 400],
    ['blocked (either side)', { id: 3, status: 'blocked', requester_id: 9 }, 403],
  ])('no ping when nothing was stored: %s', async (_label, existing, status) => {
    scenario.existing = existing;
    const res = makeRes();
    await sendFriendRequest(makeReq({ userId: 5, body: { userId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(emits).toEqual([]);
  });

  it('no ping when the INSERT loses a race (23505 → already pending)', async () => {
    scenario.insertError = Object.assign(new Error('dup'), { code: '23505' });
    const res = makeRes();
    await sendFriendRequest(makeReq({ userId: 5, body: { userId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(emits).toEqual([]);
  });

  it('no ping for an unknown user', async () => {
    scenario.targetExists = false;
    const res = makeRes();
    await sendFriendRequest(makeReq({ userId: 5, body: { userId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(emits).toEqual([]);
  });

  it('a failing emit never turns a stored request into a 500', async () => {
    const broken = { to: vi.fn(() => { throw new Error('adapter down'); }) };
    const res = makeRes();
    await sendFriendRequest(makeReq({ userId: 5, body: { userId: 9 }, io: broken }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it('works without a Socket.IO server at all', async () => {
    const res = makeRes();
    await sendFriendRequest(makeReq({ userId: 5, body: { userId: 9 }, io: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

// ── respondFriendRequest → the answering side's other decks ───────────────
describe('respondFriendRequest keeps the answerer\'s decks in step', () => {
  it.each([
    ['accept', 'accepted'],
    ['reject', 'rejected'],
  ])('%s pings the ANSWERER\'s own room after the write — never the requester', async (action, status) => {
    scenario.pendingRow = { id: 3, requester_id: 9 };
    const res = makeRes();
    await respondFriendRequest(makeReq({ userId: 5, params: { requestId: '3' }, body: { action } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status }));
    expect(log).toEqual(['db:respond', 'emit:user_5:friend_request_update']);
    expect(emits[0].payload).toEqual({ action: status });
    expect(ioMock.to).not.toHaveBeenCalledWith('user_9');
  });

  it('undo pings the answerer after the row is pending again', async () => {
    scenario.undoRow = { id: 3 };
    const res = makeRes();
    await respondFriendRequest(makeReq({ userId: 5, params: { requestId: '3' }, body: { action: 'undo' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(log).toEqual(['db:undo', 'emit:user_5:friend_request_update']);
    expect(emits[0].payload).toEqual({ action: 'restored' });
  });

  it('no ping when the request is gone (404) — accept or undo', async () => {
    for (const action of ['accept', 'undo']) {
      const res = makeRes();
      await respondFriendRequest(makeReq({ userId: 5, params: { requestId: '3' }, body: { action } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    }
    expect(emits).toEqual([]);
  });
});

// ── getPendingRequests → what RequestCard renders ─────────────────────────
describe('getPendingRequests carries what the deck card shows', () => {
  const rows = () => [
    { id: 3, requester_id: 9, addressee_id: 5, status: 'pending', requester_name: 'Anna',
      requester_interests: ['Yoga'], requester_trusted: true, updated_at: '2026-10-18T10:00:00Z' },
    { id: 4, requester_id: 11, addressee_id: 5, status: 'pending', requester_name: 'Ben',
      requester_interests: [], requester_trusted: false, updated_at: '2026-10-17T10:00:00Z' },
  ];

  it('selects interests and the trusted seal next to the old requester_* fields', async () => {
    const res = makeRes();
    await getPendingRequests(makeReq({ userId: 5 }), res);
    const call = db.query.mock.calls.find(c => c[0].includes('JOIN users u ON f.requester_id = u.id'));
    expect(call[0]).toContain('u.interests AS requester_interests');
    expect(call[0]).toContain('u.is_trusted_user AS requester_trusted');
    // The Friends page keeps everything it read before.
    for (const col of ['f.*', 'requester_name', 'requester_avatar', 'requester_age', 'requester_location']) {
      expect(call[0]).toContain(col);
    }
    expect(call[0]).toContain("f.status = 'pending'");
    expect(call[1]).toEqual([5]);
  });

  it('stamps each requester\'s Abzeichen-Stufe — the five-step level and the old bundles\' scale', async () => {
    scenario.pendingList = rows();
    scenario.tierRows = [{ user_id: 9, confirmed_events: 30, confirmers: 6 }]; // 🌟
    const res = makeRes();
    await getPendingRequests(makeReq({ userId: 5 }), res);
    const out = res.json.mock.calls[0][0];
    expect(Array.isArray(out)).toBe(true); // still a bare array for the Friends page
    expect(out[0]).toMatchObject({ requester_name: 'Anna', requester_attendance_step: 3, requester_attendance_tier: 2 });
    expect(out[1]).toMatchObject({ requester_name: 'Ben', requester_attendance_step: 0, requester_attendance_tier: 0 });
    expect(out[0]).not.toHaveProperty('attendance_step');
    // Looked up for exactly the requesters in this answer.
    const tierCall = db.query.mock.calls.find(c => c[0].includes('attendance-tiers'));
    expect(tierCall[1]).toEqual([[9, 11]]);
  });

  it('a failing tier lookup still answers 200 with the fields absent (unknown is not 0)', async () => {
    scenario.pendingList = rows();
    scenario.tierFail = true;
    const res = makeRes();
    await getPendingRequests(makeReq({ userId: 5 }), res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const out = res.json.mock.calls[0][0];
    expect(out).toHaveLength(2);
    expect(out[0]).not.toHaveProperty('requester_attendance_step');
    expect(out[0]).toHaveProperty('requester_trusted', true);
  });

  it('no requests → no tier query at all', async () => {
    const res = makeRes();
    await getPendingRequests(makeReq({ userId: 5 }), res);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(db.query.mock.calls.some(c => c[0].includes('attendance-tiers'))).toBe(false);
  });
});
