import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Product decision 21.09.2026 (Tina + Tobi): "Boosts bleiben, nur keine
// Einzelkäufe". These tests pin that NO channel sells boost credits any more —
// web/Stripe, Apple consumables, Play — while Pro users still boost for free
// and leftover credits stay spendable.

const queries = [];
vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (sql, params) => { queries.push({ sql, params }); return scripted(sql, params); }),
    pool: { connect: vi.fn(async () => txClient) },
  },
}));
let scripted = () => ({ rowCount: 0, rows: [] });
// withTransaction (applyBoost) runs on a pooled client — same scripted answers.
const txClient = {
  query: vi.fn(async (sql, params) => { queries.push({ sql, params }); return scripted(sql, params); }),
  release: vi.fn(),
};
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn(), captureMessage: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('stripe', () => ({ default: class FakeStripe { constructor() { return { paymentIntents: { create: vi.fn() } }; } } }));
// checkSubscriptionCountry hits GeoIP + DB; allow so the 410 gate is what we hit.
vi.mock('../../src/utils/paymentRegion.js', () => ({
  checkSubscriptionCountry: vi.fn(async () => ({ allowed: true, country: 'AT' })),
}));

const features = await import('../../src/config/features.js');
const boostMod = await import('../../src/controllers/boostController.js');
const iapMod = await import('../../src/controllers/iapController.js');
const googleMod = await import('../../src/controllers/googleIapController.js');

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const saved = {};
beforeEach(() => {
  for (const k of ['PAYMENTS_ENABLED', 'STRIPE_SECRET_KEY']) saved[k] = process.env[k];
  process.env.PAYMENTS_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  queries.length = 0;
  scripted = () => ({ rowCount: 0, rows: [] });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('BOOST_SINGLE_PURCHASES_ENABLED flag', () => {
  it('ships OFF', () => {
    expect(features.BOOST_SINGLE_PURCHASES_ENABLED).toBe(false);
  });
});

describe('web / Stripe: POST /api/boost/stripe/create-intent', () => {
  it('→ 410 BOOST_PURCHASES_DISABLED even with payments on, Stripe configured and a valid package', async () => {
    const res = makeRes();
    await boostMod.createStripeIntent({ body: { package_id: 'starter' }, userId: 42, get: () => undefined }, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'BOOST_PURCHASES_DISABLED' }));
    // Nothing recorded — no pending boost_transactions row for a purchase that cannot happen.
    expect(queries.some(q => /INSERT INTO boost_transactions/.test(q.sql))).toBe(false);
  });

  it('the payments kill-switch still answers first while payments are off (403, not 410)', async () => {
    process.env.PAYMENTS_ENABLED = 'false';
    const res = makeRes();
    await boostMod.createStripeIntent({ body: { package_id: 'starter' }, userId: 42, get: () => undefined }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYMENTS_DISABLED' }));
  });
});

describe('Apple / Google: no boost products in any store catalogue', () => {
  it('verifyApple rejects boost_* as Unknown product_id — before touching Apple', async () => {
    for (const id of ['boost_starter', 'boost_popular', 'boost_pro']) {
      const res = makeRes();
      await iapMod.verifyApple({ body: { product_id: id, receipt: 'jws' }, userId: 42 }, res);
      expect(res.status, id).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unknown product_id' }));
    }
  });

  it('GOOGLE_PRODUCTS has subscriptions only', () => {
    for (const p of Object.values(googleMod.GOOGLE_PRODUCTS)) expect(p.type).toBe('subscription');
    expect(Object.keys(googleMod.GOOGLE_PRODUCTS).some(k => k.startsWith('boost'))).toBe(false);
  });
});

describe('applyBoost: Pro boosts free, leftover credits stay spendable, otherwise PRO_REQUIRED', () => {
  const OWNER_ROW = { rowCount: 1, rows: [{ owner_id: 42 }] };
  const req = { body: { target_type: 'group', target_id: 7 }, userId: 42 };

  it('non-Pro without credits → 402 PRO_REQUIRED (no "kaufe Credits" wording)', async () => {
    scripted = (sql) => {
      if (/SELECT owner_id FROM groups/.test(sql)) return OWNER_ROW;
      if (/FROM subscriptions/.test(sql)) return { rowCount: 0, rows: [] };            // not Pro
      if (/FROM boost_credits/.test(sql)) return { rowCount: 0, rows: [] };            // no credits
      return { rowCount: 1, rows: [] };
    };
    const res = makeRes();
    await boostMod.applyBoost(req, res);
    expect(res.status).toHaveBeenCalledWith(402);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('PRO_REQUIRED');
    expect(body.error).not.toMatch(/kauf/i);
  });

  it('non-Pro WITH a leftover credit → boost applied, credit spent', async () => {
    scripted = (sql) => {
      if (/SELECT owner_id FROM groups/.test(sql)) return OWNER_ROW;
      if (/FROM subscriptions/.test(sql)) return { rowCount: 0, rows: [] };
      if (/SELECT credits FROM boost_credits/.test(sql)) return { rowCount: 1, rows: [{ credits: 1 }] };
      return { rowCount: 1, rows: [] };
    };
    const res = makeRes();
    await boostMod.applyBoost(req, res);
    expect(res.status).not.toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, pro_boost: false }));
    expect(queries.some(q => /UPDATE boost_credits SET credits = credits - 1/.test(q.sql))).toBe(true);
  });

  it('Pro → boost applied for free, wallet untouched', async () => {
    scripted = (sql) => {
      if (/SELECT owner_id FROM groups/.test(sql)) return OWNER_ROW;
      if (/FROM subscriptions/.test(sql)) return { rowCount: 1, rows: [{ id: 1 }] };   // Pro
      return { rowCount: 1, rows: [] };
    };
    const res = makeRes();
    await boostMod.applyBoost(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, pro_boost: true }));
    expect(queries.some(q => /boost_credits/.test(q.sql))).toBe(false);
  });
});
