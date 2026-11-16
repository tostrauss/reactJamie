import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// Hanging a deal on an event (P4 v1, 16.11.2026) was an ADMIN action; since
// P4 v2 (16.11.2026) a club's managers do it for their own events too, so the
// route no longer goes through requireAdmin — the handler decides (unit test
// clubDeals.test.js, smoke test). This pins which routes keep requireAdmin
// and that each reaches its own handler. requireAdmin is stubbed on a header:
// x-admin: 1 passes, anything else is the real middleware's 403. Every
// controller is a stub that names itself (pattern of groupRoutes.test.js).
const stub = (name) => (_req, res) => res.json({ handler: name });
const stubs = (names) => Object.fromEntries(names.map((n) => [n, stub(n)]));
const pass = (_req, _res, next) => next();

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: pass,
  requireAdmin: (req, res, next) => (req.get('x-admin') === '1'
    ? next() : res.status(403).json({ error: 'Admin access required' })),
}));
vi.mock('../../src/controllers/dealController.js', () => stubs([
  'getDeals', 'getDeal', 'createDeal', 'updateDeal', 'deleteDeal', 'getRedemptionStatus', 'redeemDeal',
  'getDealsForAdmin', 'getDealRedemptions', 'startNewRound', 'setEventDeal',
  'getClubDeals', 'createClubDeal', 'updateClubDeal', 'deleteClubDeal',
]));

const dealRoutes = (await import('../../src/routes/dealRoutes.js')).default;
const app = express();
app.use(express.json());
app.use('/api/deals', dealRoutes);

describe('deal routes — a deal at an event', () => {
  it('reaches setEventDeal without requireAdmin — admins and club managers alike (P4 v2)', async () => {
    const res = await request(app).put('/api/deals/event/5').send({ deal_id: 3 }).expect(200);
    expect(res.body.handler).toBe('setEventDeal');
  });

  it('a club\'s own deals: four routes, no requireAdmin, each to its handler (P4 v2)', async () => {
    const plain = (r) => r.expect(200).then((res) => res.body.handler);
    expect(await plain(request(app).get('/api/deals/club/7'))).toBe('getClubDeals');
    expect(await plain(request(app).post('/api/deals/club/7').send({}))).toBe('createClubDeal');
    expect(await plain(request(app).put('/api/deals/club/7/5').send({}))).toBe('updateClubDeal');
    expect(await plain(request(app).delete('/api/deals/club/7/5'))).toBe('deleteClubDeal');
  });

  it('JAMIE\'s own deal endpoints stay admin-only', async () => {
    await request(app).post('/api/deals').send({}).expect(403);
    await request(app).put('/api/deals/5').send({}).expect(403);
    await request(app).delete('/api/deals/5').expect(403);
    await request(app).get('/api/deals/admin/list').expect(403);
  });

  it('the neighbours still route as before', async () => {
    const admin = (r) => r.set('x-admin', '1').expect(200).then((res) => res.body.handler);
    expect(await admin(request(app).put('/api/deals/5').send({}))).toBe('updateDeal');
    expect(await admin(request(app).get('/api/deals/admin/list'))).toBe('getDealsForAdmin');
    expect(await admin(request(app).get('/api/deals/5'))).toBe('getDeal');
    expect(await admin(request(app).post('/api/deals/5/redeem'))).toBe('redeemDeal');
  });
});
