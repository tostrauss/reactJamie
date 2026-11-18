import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// ROUTE ORDER (Tina, 17.11.2026 — the new Friends page): '/going' and
// '/people' sit under /api/friends next to '/suggestions', '/blocked' and the
// id routes. Every controller is a stub that names itself (pattern of
// reviewRoutes.test.js); the limiter is a spy, so the test also says which
// route runs through it.
const stub = (name) => (_req, res) => res.json({ handler: name });
const stubs = (names) => Object.fromEntries(names.map((n) => [n, stub(n)]));

const gates = vi.hoisted(() => ({ limited: [], authed: [] }));

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { gates.authed.push(req.path); req.userId = 7; next(); },
}));
vi.mock('../../src/middleware/rateLimiter.js', () => ({
  friendRequestLimiter: (req, _res, next) => { gates.limited.push([req.method, req.path, req.userId]); next(); },
}));
vi.mock('../../src/controllers/friendshipController.js', () => stubs([
  'sendFriendRequest', 'respondFriendRequest', 'getPendingRequests', 'getSentRequests',
  'getFriendSuggestions', 'getFriends', 'removeFriend', 'checkFriendship',
  'blockUser', 'unblockUser', 'getBlockedUsers',
]));
vi.mock('../../src/controllers/friendsHubController.js', () => stubs(['getFriendsGoing', 'getPeopleYouMayKnow']));

const friendshipRoutes = (await import('../../src/routes/friendshipRoutes.js')).default;
const app = express();
app.use(express.json());
app.use('/api/friends', friendshipRoutes);

const handlerOf = async (req) => (await req.expect(200)).body.handler;

beforeEach(() => {
  gates.limited.length = 0;
  gates.authed.length = 0;
});

describe('friendship routes — the new Friends page', () => {
  it('„Wo gehen deine Freunde hin?“ and „Leute, die du kennen könntest“ reach their own handlers', async () => {
    expect(await handlerOf(request(app).get('/api/friends/going'))).toBe('getFriendsGoing');
    expect(await handlerOf(request(app).get('/api/friends/people'))).toBe('getPeopleYouMayKnow');
  });

  it('both are for signed-in callers only, and neither runs through the request limiter', async () => {
    await request(app).get('/api/friends/going').expect(200);
    await request(app).get('/api/friends/people').expect(200);
    expect(gates.authed).toEqual(['/going', '/people']);
    expect(gates.limited).toEqual([]);
  });

  it('the neighbours still route as before — old app bundles keep calling them', async () => {
    expect(await handlerOf(request(app).get('/api/friends'))).toBe('getFriends');
    expect(await handlerOf(request(app).get('/api/friends/suggestions'))).toBe('getFriendSuggestions');
    expect(await handlerOf(request(app).get('/api/friends/requests/pending'))).toBe('getPendingRequests');
    expect(await handlerOf(request(app).get('/api/friends/requests/sent'))).toBe('getSentRequests');
    expect(await handlerOf(request(app).get('/api/friends/status/9'))).toBe('checkFriendship');
    expect(await handlerOf(request(app).get('/api/friends/blocked'))).toBe('getBlockedUsers');
    expect(await handlerOf(request(app).post('/api/friends/request/3').send({ action: 'accept' }))).toBe('respondFriendRequest');
    expect(await handlerOf(request(app).post('/api/friends/block').send({ userId: 9 }))).toBe('blockUser');
    expect(await handlerOf(request(app).delete('/api/friends/block/9'))).toBe('unblockUser');
    expect(await handlerOf(request(app).delete('/api/friends/9'))).toBe('removeFriend');
  });

  it('sending a request is still limited, AFTER authenticate', async () => {
    expect(await handlerOf(request(app).post('/api/friends/request').send({ userId: 9 }))).toBe('sendFriendRequest');
    expect(gates.limited).toEqual([['POST', '/request', 7]]);
  });
});
