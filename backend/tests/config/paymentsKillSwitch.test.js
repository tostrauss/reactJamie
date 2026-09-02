import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// The kill-switch guards run BEFORE any Stripe/DB work, so the mocks only
// need to exist for the imports to resolve — no per-test programming.
vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
    pool: { connect: vi.fn() },
  },
}));
vi.mock('../../src/config/sentry.js', () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: vi.fn() },
}));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('stripe', () => {
  return { default: class FakeStripe { constructor() { return {}; } } };
});

const { paymentsEnabled } = await import('../../src/config/features.js');
const boostMod = await import('../../src/controllers/boostController.js');
const subMod = await import('../../src/controllers/subscriptionController.js');
const iapMod = await import('../../src/controllers/iapController.js');

// ── Helpers ───────────────────────────────────────────────────────────────
const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const savedEnv = {};
beforeEach(() => {
  savedEnv.PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED;
  savedEnv.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  delete process.env.PAYMENTS_ENABLED;
  delete process.env.STRIPE_SECRET_KEY;
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const expectPaymentsDisabled = (res) => {
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'PAYMENTS_DISABLED' })
  );
};

// ── Tests ─────────────────────────────────────────────────────────────────
describe('paymentsEnabled() flag semantics', () => {
  it('is fail-closed: OFF when the env var is unset', () => {
    expect(paymentsEnabled()).toBe(false);
  });

  it('is OFF for any value other than the literal "true"', () => {
    process.env.PAYMENTS_ENABLED = 'false';
    expect(paymentsEnabled()).toBe(false);
    process.env.PAYMENTS_ENABLED = '1';
    expect(paymentsEnabled()).toBe(false);
    process.env.PAYMENTS_ENABLED = 'TRUE';
    expect(paymentsEnabled()).toBe(false);
  });

  it('is ON only for PAYMENTS_ENABLED=true', () => {
    process.env.PAYMENTS_ENABLED = 'true';
    expect(paymentsEnabled()).toBe(true);
  });
});

describe('payments kill-switch on the money endpoints', () => {
  it('createStripeIntent → 403 PAYMENTS_DISABLED while payments are off', async () => {
    const res = makeRes();
    await boostMod.createStripeIntent({ body: {}, userId: 42 }, res);
    expectPaymentsDisabled(res);
  });

  it('createSubscription → 403 PAYMENTS_DISABLED while payments are off', async () => {
    const res = makeRes();
    await subMod.createSubscription({ body: {}, userId: 42 }, res);
    expectPaymentsDisabled(res);
  });

  it('verifyApple → 403 PAYMENTS_DISABLED while payments are off', async () => {
    const res = makeRes();
    await iapMod.verifyApple({ body: { product_id: 'x', receipt: 'y' }, userId: 42 }, res);
    expectPaymentsDisabled(res);
  });

  it('the gate OPENS with PAYMENTS_ENABLED=true — the next guard is reached', async () => {
    process.env.PAYMENTS_ENABLED = 'true';
    // No STRIPE_SECRET_KEY → getStripe() returns null → the pre-existing
    // "Stripe not configured" 503, proving the request passed the kill-switch.
    const res = makeRes();
    await boostMod.createStripeIntent({ body: {}, userId: 42 }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Stripe not configured' })
    );
  });

  it('the app-shell store-policy backstop still runs after the gate', async () => {
    process.env.PAYMENTS_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    const req = { body: {}, userId: 42, get: () => 'ios' };
    const res = makeRes();
    await boostMod.createStripeIntent(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PAYMENTS_WEB_ONLY' })
    );
  });
});
