import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// ROUTE ORDER is what this file guards. GET /api/clubs/featured declared after
// '/:id' would be answered by getClubById('featured') — a 22P02 cast error,
// i.e. a 500 — and the onboarding club page would silently never show. Every
// controller is a stub that names itself, so the assertion is simply "which
// handler answered".
const stub = (name) => (_req, res) => res.json({ handler: name });
const stubs = (names) => Object.fromEntries(names.map((n) => [n, stub(n)]));
const pass = (_req, _res, next) => next();

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: pass, optionalAuth: pass, requireCompleteProfile: pass, requireAdmin: pass,
}));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ generalLimiter: pass }));
vi.mock('../../src/controllers/clubController.js', () => stubs([
  'createClub', 'getClubs', 'getClubById', 'joinClub', 'leaveClub', 'toggleClubFavorite',
  'getUserFavoriteClubs', 'getClubMembers', 'getUserClubs', 'getClubJoinRequests',
  'handleClubJoinRequest', 'updateClub', 'deleteClub', 'kickClubMember', 'addClubManager',
  'removeClubManager', 'cancelClub', 'getCategories', 'getClubEvents', 'getDiscoverEvents',
  'createClubEvent', 'updateClubEvent', 'deleteClubEvent',
]));
vi.mock('../../src/controllers/groupController.js', () => stubs([
  'joinWaitlist', 'leaveWaitlist', 'getWaitlist', 'getUserWaitlistStatus', 'getGroupMemberAvatars',
]));
vi.mock('../../src/controllers/featuredClubController.js', () => stubs([
  'getFeaturedClubs', 'getFeaturedClubsAdmin', 'setFeaturedClubs',
]));
vi.mock('../../src/controllers/adminController.js', () => stubs([
  'getStats', 'getRecentUsers', 'getScreenTime', 'exportUsers', 'exportScreens', 'exportSuggestions',
  'getPendingClubs', 'approveClub', 'rejectClub', 'deleteUser', 'updateUserRole', 'getTopClubs',
  'getOnlineUsers', 'getGrowth', 'getUserOrigins', 'getUserDetail', 'getIpDiagnostics',
  'getBackupStatus', 'setUserActive', 'sendUserTestPush', 'removeUserAvatar',
  'classifyClub', 'getClubsForAdmin',
]));
vi.mock('../../src/controllers/feedbackController.js', () => stubs(['getFeedbackAdmin']));
vi.mock('../../src/controllers/newsController.js', () => stubs(['getNewsAudience', 'listNews', 'sendNews']));

const clubRoutes = (await import('../../src/routes/clubRoutes.js')).default;
const adminRoutes = (await import('../../src/routes/adminRoutes.js')).default;

const app = express();
app.use(express.json());
app.use('/api/clubs', clubRoutes);
app.use('/api/admin', adminRoutes);

const handlerOf = async (req) => (await req.expect(200)).body.handler;

describe('club routes', () => {
  it('GET /api/clubs/featured reaches the featured list, not getClubById', async () => {
    expect(await handlerOf(request(app).get('/api/clubs/featured'))).toBe('getFeaturedClubs');
  });

  it('the neighbours still route as before', async () => {
    expect(await handlerOf(request(app).get('/api/clubs/42'))).toBe('getClubById');
    expect(await handlerOf(request(app).get('/api/clubs/events/discover'))).toBe('getDiscoverEvents');
    expect(await handlerOf(request(app).get('/api/clubs'))).toBe('getClubs');
  });
});

describe('admin routes', () => {
  it('GET and PUT /api/admin/clubs/featured reach the curation handlers', async () => {
    expect(await handlerOf(request(app).get('/api/admin/clubs/featured'))).toBe('getFeaturedClubsAdmin');
    expect(await handlerOf(request(app).put('/api/admin/clubs/featured').send({ clubIds: [1] }))).toBe('setFeaturedClubs');
  });

  // Community/Club reclassifying (22.10.2026) added a bare GET /clubs next to
  // the literal '/clubs/featured' and '/clubs/pending' — this is the guard that
  // none of the three starts answering for another.
  it('reclassifying routes do not swallow the curation or queue paths', async () => {
    expect(await handlerOf(request(app).get('/api/admin/clubs'))).toBe('getClubsForAdmin');
    expect(await handlerOf(request(app).post('/api/admin/clubs/7/classify'))).toBe('classifyClub');
    expect(await handlerOf(request(app).get('/api/admin/clubs/featured'))).toBe('getFeaturedClubsAdmin');
    expect(await handlerOf(request(app).get('/api/admin/clubs/pending'))).toBe('getPendingClubs');
  });

  it('the approval queue is untouched', async () => {
    expect(await handlerOf(request(app).get('/api/admin/clubs/pending'))).toBe('getPendingClubs');
    expect(await handlerOf(request(app).post('/api/admin/clubs/7/reject'))).toBe('rejectClub');
  });

  // "News an alle" (18.10.2026): the audience lives next to the list, both GET.
  it('the news endpoints reach their own handlers', async () => {
    expect(await handlerOf(request(app).get('/api/admin/news/audience'))).toBe('getNewsAudience');
    expect(await handlerOf(request(app).get('/api/admin/news'))).toBe('listNews');
    expect(await handlerOf(request(app).post('/api/admin/news').send({ title: 'x' }))).toBe('sendNews');
  });
});
