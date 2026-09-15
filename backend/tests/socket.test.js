import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const query = vi.fn();
vi.mock('../src/config/database.js', () => ({ default: { query: (...a) => query(...a) } }));
vi.mock('../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
// The connect handler stamps read-receipt delivery (utils/readReceipts.js), which
// is two UPDATEs on a throttle. That is deliberate and covered by the real-Postgres
// smoke suite; here it would just be noise in the "did the JOIN touch the DB"
// assertions this file exists for.
vi.mock('../src/utils/readReceipts.js', () => ({ stampDelivered: vi.fn(async () => {}) }));

const socketHandler = (await import('../src/socket.js')).default;

/**
 * Drives socketHandler against a fake Socket.IO server so the connection
 * handler's event wiring can be exercised without a real transport.
 */
const mkIo = () => {
  const handlers = {};
  const io = {
    use: vi.fn(),
    on: vi.fn((ev, fn) => { if (ev === 'connection') io._onConnection = fn; }),
    to: vi.fn(() => ({ emit: vi.fn() })),
    in: vi.fn(() => ({ fetchSockets: async () => [] })),
    engine: { on: vi.fn() },
    _onConnection: null,
    _handlers: handlers,
  };
  return io;
};

const mkSocket = (userId = 7) => {
  const on = {};
  return {
    userId,
    id: 'sock1',
    rooms: new Set(),
    handshake: { auth: {}, headers: {}, query: {} },
    join: vi.fn(function (r) { this.rooms.add(r); }),
    leave: vi.fn(function (r) { this.rooms.delete(r); }),
    to: vi.fn(() => ({ emit: vi.fn() })),
    emit: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((ev, fn) => { on[ev] = fn; }),
    _fire: (ev, ...args) => on[ev]?.(...args),
    _has: (ev) => typeof on[ev] === 'function',
  };
};

const connect = (userId = 7) => {
  const io = mkIo();
  socketHandler(io);
  const socket = mkSocket(userId);
  io._onConnection(socket);
  // The handler auto-joins `user_<id>` on connect; assert that once here and
  // then clear, so the cases below see only what THEY triggered.
  expect(socket.join).toHaveBeenCalledWith(`user_${userId}`);
  socket.join.mockClear();
  return { io, socket };
};

describe('socket event guards (audit 2026-09-15, finding 6)', () => {
  beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [{ '?column?': 1 }] }); });

  it('join_room rejects a non-numeric id WITHOUT touching the database', async () => {
    const { socket } = connect();
    await socket._fire('join_room', 'x');
    await socket._fire('join_room', '');
    await socket._fire('join_room', '-3');
    await socket._fire('join_room', null);
    // checkMembership only caches on success, so before this each of these
    // cost a full pool round trip — every single time, forever.
    expect(query).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('join_room joins the STRING room name the typing gate compares against', async () => {
    const { socket } = connect();
    query.mockResolvedValue({ rows: [{ user_id: 7 }] });
    await socket._fire('join_room', 42);
    expect(socket.join).toHaveBeenCalledWith('42');
  });

  it('caps DB-touching events per socket and stops querying past the budget', async () => {
    const { socket } = connect();
    query.mockResolvedValue({ rows: [{ user_id: 7 }] });
    // Distinct ids so the membership cache cannot mask the budget.
    for (let i = 1; i <= 40; i++) await socket._fire('join_room', i);
    expect(query.mock.calls.length).toBeLessThanOrEqual(30);
    expect(query.mock.calls.length).toBeGreaterThan(0);
  });

  it('disconnects a socket that stays over budget for three windows', async () => {
    vi.useFakeTimers();
    try {
      const { socket } = connect();
      query.mockResolvedValue({ rows: [{ user_id: 7 }] });
      for (let w = 0; w < 3; w++) {
        for (let i = 1; i <= 35; i++) await socket._fire('join_room', w * 100 + i);
        vi.advanceTimersByTime(10_001);
      }
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // dm_typing fires on EVERY KEYSTROKE (DirectMessagePage's textarea onChange).
  // Sharing one bucket with the room joins meant ~3 characters per second
  // exceeded the budget, and three such windows force-closed the socket of a
  // perfectly legitimate user mid-conversation, every ~30 s of typing.
  it('typing never disconnects a socket, however fast the user types', async () => {
    vi.useFakeTimers();
    try {
      const { socket } = connect();
      query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      // 40 WPM for half a minute — well past the old 30-per-10s budget.
      for (let w = 0; w < 3; w++) {
        for (let i = 0; i < 60; i++) {
          await socket._fire('dm_typing', { receiverId: 99 });
        }
        vi.advanceTimersByTime(10_001);
      }
      expect(socket.disconnect).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('typing still has a ceiling — it drops events rather than querying forever', async () => {
    const { socket } = connect();
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    for (let i = 0; i < 400; i++) await socket._fire('dm_typing', { receiverId: 99 });
    // Shed well before 400, and never at the cost of the connection.
    expect(query.mock.calls.length).toBeLessThanOrEqual(120);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('a typing flood does not consume the room-join budget', async () => {
    const { socket } = connect();
    query.mockResolvedValue({ rows: [{ user_id: 7 }] });
    for (let i = 0; i < 200; i++) await socket._fire('dm_typing', { receiverId: 99 });
    query.mockClear();
    // Joining a room must still work — the buckets are independent.
    await socket._fire('join_room', 5);
    expect(socket.join).toHaveBeenCalledWith('5');
  });

  it('leave_room is not budgeted — a socket can always leave', async () => {
    const { socket } = connect();
    for (let i = 0; i < 100; i++) socket._fire('leave_room', 9);
    expect(socket.leave).toHaveBeenCalledWith('9');
    expect(socket.leave.mock.calls.length).toBe(100);
  });

  // Regression guard for the 2026-09-04 release audit: destructuring a socket
  // payload threw a TypeError that escaped socket.io as an uncaughtException.
  it('DM handlers survive a missing / malformed payload', async () => {
    const { socket } = connect();
    for (const ev of ['join_dm_room', 'leave_dm_room', 'dm_typing', 'dm_stop_typing']) {
      expect(socket._has(ev)).toBe(true);
      await expect(Promise.resolve(socket._fire(ev))).resolves.not.toThrow();
      await expect(Promise.resolve(socket._fire(ev, null))).resolves.not.toThrow();
      await expect(Promise.resolve(socket._fire(ev, 'nope'))).resolves.not.toThrow();
    }
  });
});
