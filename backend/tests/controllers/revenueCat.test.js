import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// In-memory transaction client (same pattern as googleIap.test.js).
const txQueries = [];
const client = {
  query: vi.fn(async (sql, params) => {
    txQueries.push({ sql, params });
    return scriptedTx(sql, params);
  }),
  release: vi.fn(),
};
const defaultTx = (sql) => (/^\s*SELECT/i.test(sql) ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [] });
let scriptedTx = defaultTx;

const poolQueries = [];
let scriptedPool = () => ({ rowCount: 0, rows: [] });

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (sql, params) => { poolQueries.push({ sql, params }); return scriptedPool(sql, params); }),
    pool: { connect: vi.fn(async () => client) },
  },
}));
vi.mock('../../src/config/sentry.js', () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: vi.fn(), captureMessage: vi.fn() },
}));

const rcApi = { getSubscriber: vi.fn() };
vi.mock('../../src/utils/revenueCat.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getSubscriber: (...a) => rcApi.getSubscriber(...a) };
});
const playApi = { isGooglePlayConfigured: vi.fn(() => false) };
vi.mock('../../src/utils/googlePlay.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, isGooglePlayConfigured: (...a) => playApi.isGooglePlayConfigured(...a) };
});

const { summarizeEntitlement, verifyWebhookAuth, toUserId } = await import('../../src/utils/revenueCat.js');
const { syncRevenueCat, revenueCatWebhook, getPaymentsConfig, rcSubId } =
  await import('../../src/controllers/revenueCatController.js');

// ── Helpers ───────────────────────────────────────────────────────────────
const makeRes = () => {
  const res = { statusCode: 200, headers: {} };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn(() => res);
  res.end = vi.fn(() => res);
  res.set = vi.fn((k, v) => { res.headers[k] = v; return res; });
  return res;
};
const makeReq = ({ userId = 42, body = {}, auth } = {}) => ({
  userId, body, get: (h) => (h.toLowerCase() === 'authorization' ? auth : undefined),
});
const FUTURE = new Date(Date.now() + 30 * 86400_000).toISOString();
const PAST = new Date(Date.now() - 86400_000).toISOString();
const subscriber = ({ expires = FUTURE, sub = {}, product = 'pro_sixmonth' } = {}) => ({
  entitlements: { pro: { expires_date: expires, product_identifier: product, grace_period_expires_date: null } },
  subscriptions: {
    [product]: {
      expires_date: expires, period_type: 'normal', store: 'app_store', is_sandbox: false,
      store_transaction_id: '2000000123', unsubscribe_detected_at: null, refunded_at: null, ...sub,
    },
  },
});
const writes = (re) => txQueries.filter(q => re.test(q.sql));

const ENV_KEYS = ['PAYMENTS_ENABLED', 'IOS_IAP_ENABLED', 'PLAY_BILLING_ENABLED', 'REVENUECAT_IOS_API_KEY',
  'REVENUECAT_SECRET_API_KEY', 'REVENUECAT_WEBHOOK_AUTH', 'REVENUECAT_ALLOW_SANDBOX'];
const savedEnv = {};
beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.PAYMENTS_ENABLED = 'true';
  process.env.REVENUECAT_SECRET_API_KEY = 'sk_test';
  process.env.REVENUECAT_WEBHOOK_AUTH = 'whsecret-123';
  delete process.env.IOS_IAP_ENABLED;
  delete process.env.PLAY_BILLING_ENABLED;
  delete process.env.REVENUECAT_IOS_API_KEY;
  delete process.env.REVENUECAT_ALLOW_SANDBOX;
  txQueries.length = 0;
  poolQueries.length = 0;
  scriptedTx = defaultTx;
  scriptedPool = () => ({ rowCount: 0, rows: [] });
  rcApi.getSubscriber.mockReset();
  playApi.isGooglePlayConfigured.mockReset().mockReturnValue(false);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ── summarizeEntitlement (pure) ───────────────────────────────────────────
describe('summarizeEntitlement', () => {
  it('none when the entitlement was never granted', () => {
    expect(summarizeEntitlement({ entitlements: {} }).status).toBe('none');
    expect(summarizeEntitlement(undefined).grantsAccess).toBe(false);
  });
  it('active paid subscription', () => {
    const s = summarizeEntitlement(subscriber());
    expect(s).toMatchObject({ status: 'active', grantsAccess: true, productId: 'pro_sixmonth', store: 'app_store' });
    expect(s.periodEnd.toISOString()).toBe(FUTURE);
  });
  it('trial → trialing, auto-renew off → canceling', () => {
    expect(summarizeEntitlement(subscriber({ sub: { period_type: 'trial' } })).status).toBe('trialing');
    expect(summarizeEntitlement(subscriber({ sub: { unsubscribe_detected_at: PAST } })).status).toBe('canceling');
  });
  it('expired, and refunded → revoked', () => {
    expect(summarizeEntitlement(subscriber({ expires: PAST })).status).toBe('expired');
    expect(summarizeEntitlement(subscriber({ expires: PAST, sub: { refunded_at: PAST } })).status).toBe('revoked');
  });
  it('billing grace period keeps access', () => {
    const sub = subscriber({ expires: PAST });
    sub.entitlements.pro.grace_period_expires_date = FUTURE;
    expect(summarizeEntitlement(sub)).toMatchObject({ status: 'active', grantsAccess: true });
  });
  it('no expiry (promotional lifetime grant) counts as active', () => {
    const s = summarizeEntitlement(subscriber({ expires: null }));
    expect(s.grantsAccess).toBe(true);
    expect(s.periodEnd.getUTCFullYear()).toBe(2099);
  });
  it('sandbox purchases count by default (App Review buys in the sandbox)', () => {
    expect(summarizeEntitlement(subscriber({ sub: { is_sandbox: true } })).grantsAccess).toBe(true);
    process.env.REVENUECAT_ALLOW_SANDBOX = 'false';
    expect(summarizeEntitlement(subscriber({ sub: { is_sandbox: true } })).grantsAccess).toBe(false);
  });
});

describe('verifyWebhookAuth / toUserId', () => {
  it('accepts the exact secret, with or without Bearer', () => {
    expect(verifyWebhookAuth('whsecret-123')).toBe(true);
    expect(verifyWebhookAuth('Bearer whsecret-123')).toBe(true);
    expect(verifyWebhookAuth('whsecret-124')).toBe(false);
    expect(verifyWebhookAuth(undefined)).toBe(false);
  });
  it('only plain positive integers are JAMIE user ids', () => {
    expect(toUserId('42')).toBe(42);
    expect(toUserId('$RCAnonymousID:abc')).toBeNull();
    expect(toUserId('0')).toBeNull();
    expect(toUserId('42; DROP')).toBeNull();
  });
});

// ── POST /api/iap/revenuecat/sync ─────────────────────────────────────────
describe('syncRevenueCat', () => {
  it('403 while payments are off', async () => {
    process.env.PAYMENTS_ENABLED = 'false';
    const res = makeRes();
    await syncRevenueCat(makeReq(), res);
    expect(res.statusCode).toBe(403);
    expect(rcApi.getSubscriber).not.toHaveBeenCalled();
  });
  it('503 without the secret key (never grant blind)', async () => {
    delete process.env.REVENUECAT_SECRET_API_KEY;
    const res = makeRes();
    await syncRevenueCat(makeReq(), res);
    expect(res.statusCode).toBe(503);
  });
  it('asks RevenueCat about the CALLER and upserts the subscription row', async () => {
    rcApi.getSubscriber.mockResolvedValue(subscriber());
    const res = makeRes();
    await syncRevenueCat(makeReq({ userId: 42, body: { app_user_id: '999' } }), res);
    expect(rcApi.getSubscriber).toHaveBeenCalledWith('42');   // body is ignored
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, is_pro: true, status: 'active' }));
    const up = writes(/INSERT INTO subscriptions/)[0];
    expect(up.params).toEqual([42, 'active', new Date(FUTURE), rcSubId(42), 'apple:42']);
    const ledger = writes(/INSERT INTO iap_receipts/)[0];
    expect(ledger.params[1]).toBe('apple');
    expect(ledger.params[3]).toBe('rc:2000000123');
    expect(writes(/COMMIT/)).toHaveLength(1);
  });
  it('no entitlement → retires an old active row, is_pro false', async () => {
    rcApi.getSubscriber.mockResolvedValue({ entitlements: {} });
    const res = makeRes();
    await syncRevenueCat(makeReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ is_pro: false, status: 'none' }));
    expect(poolQueries[0].sql).toMatch(/UPDATE subscriptions SET status = 'expired'/);
    expect(writes(/INSERT INTO subscriptions/)).toHaveLength(0);
  });
  it('user already has an active Stripe sub → row recorded as duplicate, no 500', async () => {
    rcApi.getSubscriber.mockResolvedValue(subscriber());
    let first = true;
    scriptedTx = (sql) => {
      if (/INSERT INTO subscriptions/.test(sql) && first) {
        first = false;
        const e = new Error('dup'); e.code = '23505'; throw e;
      }
      return defaultTx(sql);
    };
    const res = makeRes();
    await syncRevenueCat(makeReq(), res);
    expect(writes(/ROLLBACK TO SAVEPOINT/)).toHaveLength(1);
    const ups = writes(/INSERT INTO subscriptions/);
    expect(ups[1].params[1]).toBe('duplicate');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, duplicate: true }));
  });
  it('RevenueCat down → 502 (purchase went through, webhook will grant)', async () => {
    rcApi.getSubscriber.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const res = makeRes();
    await syncRevenueCat(makeReq(), res);
    expect(res.statusCode).toBe(502);
  });
});

// ── POST /api/iap/revenuecat/webhook ──────────────────────────────────────
describe('revenueCatWebhook', () => {
  it('401 on a wrong Authorization header, 503 when unconfigured', async () => {
    let res = makeRes();
    await revenueCatWebhook(makeReq({ auth: 'nope', body: { event: { type: 'RENEWAL', app_user_id: '42' } } }), res);
    expect(res.statusCode).toBe(401);
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    res = makeRes();
    await revenueCatWebhook(makeReq({ auth: 'whsecret-123', body: {} }), res);
    expect(res.statusCode).toBe(503);
    expect(rcApi.getSubscriber).not.toHaveBeenCalled();
  });
  it('TEST event and anonymous ids are acknowledged without a sync', async () => {
    for (const event of [{ type: 'TEST', app_user_id: '42' }, { type: 'RENEWAL', app_user_id: '$RCAnonymousID:x' }]) {
      const res = makeRes();
      await revenueCatWebhook(makeReq({ auth: 'whsecret-123', body: { event } }), res);
      expect(res.statusCode).toBe(200);
    }
    expect(rcApi.getSubscriber).not.toHaveBeenCalled();
  });
  it('TRANSFER re-syncs both accounts that still exist', async () => {
    scriptedPool = (sql) => (/FROM users/.test(sql) ? { rowCount: 2, rows: [{ id: 7 }, { id: 8 }] } : { rowCount: 0, rows: [] });
    rcApi.getSubscriber.mockImplementation(async (id) => (id === '8' ? subscriber() : { entitlements: {} }));
    const res = makeRes();
    await revenueCatWebhook(makeReq({
      auth: 'whsecret-123',
      body: { event: { type: 'TRANSFER', transferred_from: ['7'], transferred_to: ['8'] } },
    }), res);
    expect(res.statusCode).toBe(200);
    expect(rcApi.getSubscriber.mock.calls.map(c => c[0]).sort()).toEqual(['7', '8']);
    expect(writes(/INSERT INTO subscriptions/)[0].params[0]).toBe(8);
  });
  it('500 on a transient failure so RevenueCat retries', async () => {
    scriptedPool = () => ({ rowCount: 1, rows: [{ id: 42 }] });
    rcApi.getSubscriber.mockRejectedValue(new Error('timeout'));
    const res = makeRes();
    await revenueCatWebhook(makeReq({ auth: 'whsecret-123', body: { event: { type: 'RENEWAL', app_user_id: '42' } } }), res);
    expect(res.statusCode).toBe(500);
  });
});

// ── GET /api/iap/config ───────────────────────────────────────────────────
describe('getPaymentsConfig', () => {
  const cfg = () => { const res = makeRes(); getPaymentsConfig({}, res); return res.json.mock.calls[0][0]; };

  it('iOS is off unless master switch, iOS switch AND both keys are set', () => {
    process.env.IOS_IAP_ENABLED = 'true';
    expect(cfg().ios_iap_enabled).toBe(false);                 // no public key
    process.env.REVENUECAT_IOS_API_KEY = 'appl_pub';
    expect(cfg()).toMatchObject({ ios_iap_enabled: true, revenuecat: { ios_api_key: 'appl_pub', entitlement: 'pro' } });
    delete process.env.REVENUECAT_SECRET_API_KEY;
    expect(cfg().ios_iap_enabled).toBe(false);                 // can't verify → never sell
    process.env.REVENUECAT_SECRET_API_KEY = 'sk_test';
    process.env.PAYMENTS_ENABLED = 'false';
    expect(cfg()).toMatchObject({ payments_enabled: false, ios_iap_enabled: false });
  });
  it('Play is off unless its switch is on AND Google is configured', () => {
    process.env.PLAY_BILLING_ENABLED = 'true';
    expect(cfg().play_billing_enabled).toBe(false);
    playApi.isGooglePlayConfigured.mockReturnValue(true);
    expect(cfg().play_billing_enabled).toBe(true);
  });
  it('never leaks the secret key', () => {
    process.env.REVENUECAT_IOS_API_KEY = 'appl_pub';
    expect(JSON.stringify(cfg())).not.toContain('sk_test');
  });
});
