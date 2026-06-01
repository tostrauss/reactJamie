import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Track every SQL statement that flowed through the mocked transaction client.
// Tests then assert on the sequence to prove the idempotency guard works.
const runStatements = [];

// ── Mocks ─────────────────────────────────────────────────────────────────
// `db.pool.connect()` returns a fake client whose responses are
// programmable per-test via `claimResult`. All queries are recorded.
let claimResult = { rowCount: 0, rows: [] };

vi.mock('../../src/config/database.js', () => {
  const fakeClient = {
    query: vi.fn(async (text /*, params */) => {
      runStatements.push(text);
      if (text.startsWith('BEGIN'))   return {};
      if (text.startsWith('COMMIT'))  return {};
      if (text.startsWith('ROLLBACK')) return {};
      if (text.includes("UPDATE boost_transactions SET status = 'completed'")) {
        return claimResult;
      }
      if (text.includes('INSERT INTO boost_credits')) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    default: {
      query: vi.fn(),
      pool: { connect: vi.fn(async () => fakeClient) },
    },
  };
});

vi.mock('../../src/config/sentry.js', () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: vi.fn() },
}));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/controllers/subscriptionController.js', () => ({
  isUserPro: vi.fn(async () => false),
}));

// Stripe is constructed (`new Stripe(...)`) in the controller. The mock
// factory below is hoisted before any test code runs, so we have to use
// vi.hoisted() to share the stub between the factory and the tests.
const { stripeStub } = vi.hoisted(() => ({
  stripeStub: {
    webhooks: { constructEvent: vi.fn() },
    paymentIntents: { create: vi.fn() },
  },
}));
vi.mock('stripe', () => {
  return { default: class FakeStripe { constructor() { return stripeStub; } } };
});

// Pull the internal credit helper via direct import of the module file —
// the public `stripeWebhook` and `capturePaypalOrder` paths funnel through it.
const boostMod = await import('../../src/controllers/boostController.js');

// ── Helpers ───────────────────────────────────────────────────────────────
beforeEach(() => {
  runStatements.length = 0;
  claimResult = { rowCount: 1, rows: [{ user_id: 42, credits: 5 }] };
});

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
};

// ── Tests ─────────────────────────────────────────────────────────────────
describe('Stripe webhook → creditUser idempotency', () => {
  it('credits the wallet exactly once on first payment_intent.succeeded', async () => {
    // Provide a stripe lib that returns a valid event from constructEvent
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_first', metadata: { user_id: '42', credits: '5' } } },
    };
    // Patch process.env.STRIPE_WEBHOOK_SECRET so the webhook proceeds
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    stripeStub.webhooks.constructEvent.mockReturnValue(event);

    const req = {
      headers: { 'stripe-signature': 'sig' },
      body: Buffer.from(JSON.stringify(event)),
    };
    const res = makeRes();
    await boostMod.stripeWebhook(req, res);

    // The atomic claim UPDATE must have fired exactly once and an INSERT
    // INTO boost_credits must have followed it.
    const claimCount  = runStatements.filter(s => s.includes("UPDATE boost_transactions SET status = 'completed'")).length;
    const creditCount = runStatements.filter(s => s.includes('INSERT INTO boost_credits')).length;
    expect(claimCount).toBe(1);
    expect(creditCount).toBe(1);
  });

  it('credits ZERO on replay when the txn is already completed', async () => {
    // Stripe retries the same payment_intent.succeeded — our atomic UPDATE
    // returns rowCount 0 because the row is already in 'completed' state.
    claimResult = { rowCount: 0, rows: [] };

    const event = {
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_replayed', metadata: { user_id: '42', credits: '5' } } },
    };
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    stripeStub.webhooks.constructEvent.mockReturnValue(event);

    const req = {
      headers: { 'stripe-signature': 'sig' },
      body: Buffer.from(JSON.stringify(event)),
    };
    const res = makeRes();
    await boostMod.stripeWebhook(req, res);

    // The atomic UPDATE fired and returned 0 rows — no INSERT into
    // boost_credits must have happened. This is the regression guard for
    // the double-credit vulnerability.
    const creditCount = runStatements.filter(s => s.includes('INSERT INTO boost_credits')).length;
    expect(creditCount).toBe(0);
    // Webhook still returns 200 so Stripe stops retrying
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true }));
  });
});
