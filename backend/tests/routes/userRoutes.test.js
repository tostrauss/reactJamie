import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// ROUTE ORDER (26.10.2026): the own-profile routes are literal /me paths next
// to '/:id' and '/:id/hall-of-fame' — answered by the wrong handler, the
// stats row would silently vanish or a hide would 400. Every controller is a
// stub that names itself (pattern of groupRoutes.test.js).
const stub = (name) => (_req, res) => res.json({ handler: name });
const stubs = (names) => Object.fromEntries(names.map((n) => [n, stub(n)]));
const pass = (_req, _res, next) => next();

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: pass, optionalAuth: pass }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userSearchLimiter: pass }));
vi.mock('../../src/controllers/userController.js', () => stubs(['getUserById', 'searchUsers']));
vi.mock('../../src/controllers/hallOfFameController.js', () => stubs([
  'getUserHallOfFame', 'getMyProfileStats', 'hideMemory', 'unhideMemory',
]));

const userRoutes = (await import('../../src/routes/userRoutes.js')).default;
const app = express();
app.use(express.json());
app.use('/api/users', userRoutes);

const handlerOf = async (req) => (await req.expect(200)).body.handler;

describe('user routes — own profile', () => {
  it('stats and hide/unhide reach their own handlers', async () => {
    expect(await handlerOf(request(app).get('/api/users/me/profile-stats'))).toBe('getMyProfileStats');
    expect(await handlerOf(request(app).post('/api/users/me/hall-of-fame/5/hide'))).toBe('hideMemory');
    expect(await handlerOf(request(app).delete('/api/users/me/hall-of-fame/5/hide'))).toBe('unhideMemory');
  });

  it('the neighbours still route as before', async () => {
    expect(await handlerOf(request(app).get('/api/users/me/hall-of-fame'))).toBe('getUserHallOfFame');
    expect(await handlerOf(request(app).get('/api/users/12/hall-of-fame'))).toBe('getUserHallOfFame');
    expect(await handlerOf(request(app).get('/api/users/12'))).toBe('getUserById');
    expect(await handlerOf(request(app).get('/api/users/search?q=an'))).toBe('searchUsers');
  });
});
