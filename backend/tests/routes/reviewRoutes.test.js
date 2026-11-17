import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// ROUTE ORDER (Tina-Update 17.11.2026): the new after-the-event routes sit
// next to '/pending', '/dismiss' and '/for-group/:groupId' under /api/reviews.
// Answered by the wrong handler, the friends list would silently be the
// „Wer war dabei?“ list. Every controller is a stub that names itself
// (pattern of userRoutes.test.js). The rate limiter and the admin gate are
// spies, so the test also says WHICH routes run through them.
const stub = (name) => (_req, res) => res.json({ handler: name });
const stubs = (names) => Object.fromEntries(names.map((n) => [n, stub(n)]));
const pass = (_req, _res, next) => next();

const gates = vi.hoisted(() => ({ limited: [], admin: { allow: true, seen: [] } }));

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.userId = 7; next(); },
  optionalAuth: pass,
  requireAdmin: (req, res, next) => {
    gates.admin.seen.push(req.path);
    if (!gates.admin.allow) return res.status(403).json({ error: 'Admin only' });
    next();
  },
}));
vi.mock('../../src/middleware/rateLimiter.js', () => ({
  // Records the user id it saw: authenticate has to run BEFORE the limiter,
  // which keys on req.userId.
  eventRatingLimiter: (req, _res, next) => { gates.limited.push([req.method, req.path, req.userId]); next(); },
}));
vi.mock('../../src/controllers/reviewController.js', () => stubs([
  'getPendingReviews', 'submitReview', 'dismissReview', 'getReviewForGroup', 'getMyAttendance',
]));
vi.mock('../../src/controllers/connectController.js', () => stubs(['getPendingConnect', 'dismissConnect']));
vi.mock('../../src/controllers/eventRatingController.js', () => stubs([
  'getPendingRatings', 'submitRating', 'dismissRating', 'getRatingsAdmin',
]));

const reviewRoutes = (await import('../../src/routes/reviewRoutes.js')).default;
const app = express();
app.use(express.json());
app.use('/api/reviews', reviewRoutes);

const handlerOf = async (req) => (await req.expect(200)).body.handler;

beforeEach(() => {
  gates.limited.length = 0;
  gates.admin.allow = true;
  gates.admin.seen.length = 0;
});

describe('review routes — after the event', () => {
  it('the friends list and its close reach their own handlers', async () => {
    expect(await handlerOf(request(app).get('/api/reviews/connect/pending'))).toBe('getPendingConnect');
    expect(await handlerOf(request(app).post('/api/reviews/connect/dismiss').send({ group_id: 5 }))).toBe('dismissConnect');
  });

  it('„Wie war’s bei X?“: the question, the rating, the X and the admin list reach their own handlers', async () => {
    expect(await handlerOf(request(app).get('/api/reviews/ratings/pending'))).toBe('getPendingRatings');
    expect(await handlerOf(request(app).post('/api/reviews/ratings').send({ group_id: 5, stars: 4 }))).toBe('submitRating');
    expect(await handlerOf(request(app).post('/api/reviews/ratings/dismiss').send({ group_id: 5 }))).toBe('dismissRating');
    expect(await handlerOf(request(app).get('/api/reviews/ratings/admin'))).toBe('getRatingsAdmin');
  });

  it('rating and closing run through the limiter, AFTER authenticate — the question itself does not', async () => {
    await request(app).get('/api/reviews/ratings/pending').expect(200);
    await request(app).get('/api/reviews/connect/pending').expect(200);
    await request(app).post('/api/reviews/connect/dismiss').send({ group_id: 5 }).expect(200);
    expect(gates.limited).toEqual([]);
    await request(app).post('/api/reviews/ratings').send({ group_id: 5, stars: 4 }).expect(200);
    await request(app).post('/api/reviews/ratings/dismiss').send({ group_id: 5 }).expect(200);
    expect(gates.limited).toEqual([['POST', '/ratings', 7], ['POST', '/ratings/dismiss', 7]]);
  });

  it('the ratings list is for admins only: without the gate\'s yes the handler is never reached', async () => {
    gates.admin.allow = false;
    const res = await request(app).get('/api/reviews/ratings/admin').expect(403);
    expect(res.body.handler).toBeUndefined();
    expect(gates.admin.seen).toEqual(['/ratings/admin']);
    // …and no other route of this router asks for an admin.
    gates.admin.seen.length = 0;
    await request(app).get('/api/reviews/ratings/pending').expect(200);
    await request(app).get('/api/reviews/pending').expect(200);
    expect(gates.admin.seen).toEqual([]);
  });

  it('the neighbours still route as before', async () => {
    expect(await handlerOf(request(app).get('/api/reviews/pending'))).toBe('getPendingReviews');
    expect(await handlerOf(request(app).post('/api/reviews').send({ group_id: 5, attendances: [] }))).toBe('submitReview');
    expect(await handlerOf(request(app).post('/api/reviews/dismiss').send({ group_id: 5 }))).toBe('dismissReview');
    expect(await handlerOf(request(app).get('/api/reviews/for-group/5'))).toBe('getReviewForGroup');
    expect(await handlerOf(request(app).get('/api/reviews/attendance'))).toBe('getMyAttendance');
  });
});
