import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Product decision 26.10.2026 (Tobi): "wir machen nichts mehr über Stripe,
// Abos nur über Apple". These tests pin that the web checkout sells no new
// Pro subscription any more — while PAYMENTS_ENABLED stays ON (it is the
// master switch the iOS App Store path hangs on) and everything an existing
// web subscriber needs keeps working.

const queries = [];
vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (sql, params) => { queries.push({ sql, params }); return { rowCount: 0, rows: [] }; }),
    pool: { connect: vi.fn(async () => { throw new Error('no pool client expected'); }) },
  },
}));
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn(), captureMessage: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('stripe', () => ({ default: class FakeStripe { constructor() { return { subscriptions: { create: vi.fn() }, customers: { create: vi.fn() } }; } } }));
vi.mock('../../src/utils/paymentRegion.js', () => ({
  checkSubscriptionCountry: vi.fn(async () => ({ allowed: true, country: 'AT' })),
}));

const features = await import('../../src/config/features.js');
const subMod = await import('../../src/controllers/subscriptionController.js');

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};
// A plain browser request: no app-shell headers.
const browserReq = (extra = {}) => ({ body: { plan: 'monthly' }, userId: 42, get: () => undefined, ...extra });

const saved = {};
beforeEach(() => {
  for (const k of ['PAYMENTS_ENABLED', 'IOS_IAP_ENABLED', 'STRIPE_SECRET_KEY']) saved[k] = process.env[k];
  process.env.PAYMENTS_ENABLED = 'true';
  process.env.IOS_IAP_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  queries.length = 0;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('STRIPE_SUBSCRIPTION_PURCHASES_ENABLED', () => {
  it('ships OFF', () => {
    expect(features.STRIPE_SUBSCRIPTION_PURCHASES_ENABLED).toBe(false);
  });

  it('does not touch the master switch: with PAYMENTS_ENABLED on, the iOS path stays open', () => {
    expect(features.paymentsEnabled()).toBe(true);
    expect(features.iosIapEnabled()).toBe(true);
  });
});

describe('createSubscription (Stripe web checkout)', () => {
  it('answers 410 SUBSCRIPTION_PURCHASES_DISABLED even with payments on — before any DB or Stripe work', async () => {
    const res = makeRes();
    await subMod.createSubscription(browserReq(), res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUBSCRIPTION_PURCHASES_DISABLED' }));
    expect(queries).toHaveLength(0);
  });

  it('keeps the earlier guards in front: payments off still says PAYMENTS_DISABLED', async () => {
    process.env.PAYMENTS_ENABLED = 'false';
    const res = makeRes();
    await subMod.createSubscription(browserReq(), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYMENTS_DISABLED' }));
  });
});

describe('existing web subscribers are untouched', () => {
  it('getStatus still answers normally (not 410)', async () => {
    const res = makeRes();
    await subMod.getStatus({ userId: 42 }, res);
    expect(res.status).not.toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ is_pro: false }));
  });
});
