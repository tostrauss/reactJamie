import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// ROUTE ORDER (Tina-Update 17.11.2026): the new after-the-event routes sit
// next to '/pending', '/dismiss' and '/for-group/:groupId' under /api/reviews.
// Answered by the wrong handler, the friends list would silently be the
// „Wer war dabei?“ list. Every controller is a stub that names itself
// (pattern of userRoutes.test.js).
const stub = (name) => (_req, res) => res.json({ handler: name });
const stubs = (names) => Object.fromEntries(names.map((n) => [n, stub(n)]));
const pass = (_req, _res, next) => next();

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: pass, optionalAuth: pass }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ eventRatingLimiter: pass }));
vi.mock('../../src/controllers/reviewController.js', () => stubs([
  'getPendingReviews', 'submitReview', 'dismissReview', 'getReviewForGroup', 'getMyAttendance',
]));
vi.mock('../../src/controllers/connectController.js', () => stubs(['getPendingConnect', 'dismissConnect']));

const reviewRoutes = (await import('../../src/routes/reviewRoutes.js')).default;
const app = express();
app.use(express.json());
app.use('/api/reviews', reviewRoutes);

const handlerOf = async (req) => (await req.expect(200)).body.handler;

describe('review routes — after the event', () => {
  it('the friends list and its close reach their own handlers', async () => {
    expect(await handlerOf(request(app).get('/api/reviews/connect/pending'))).toBe('getPendingConnect');
    expect(await handlerOf(request(app).post('/api/reviews/connect/dismiss').send({ group_id: 5 }))).toBe('dismissConnect');
  });

  it('the neighbours still route as before', async () => {
    expect(await handlerOf(request(app).get('/api/reviews/pending'))).toBe('getPendingReviews');
    expect(await handlerOf(request(app).post('/api/reviews').send({ group_id: 5, attendances: [] }))).toBe('submitReview');
    expect(await handlerOf(request(app).post('/api/reviews/dismiss').send({ group_id: 5 }))).toBe('dismissReview');
    expect(await handlerOf(request(app).get('/api/reviews/for-group/5'))).toBe('getReviewForGroup');
    expect(await handlerOf(request(app).get('/api/reviews/attendance'))).toBe('getMyAttendance');
  });
});
