import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// A tiny in-memory transaction client: records every query so assertions can
// check WHAT was written, and lets tests script the SELECT answers.
const txQueries = [];
const client = {
  query: vi.fn(async (sql, params) => {
    txQueries.push({ sql, params });
    return scriptedTx(sql, params);
  }),
  release: vi.fn(),
};
// Default: SELECTs find nothing (fresh token), writes succeed.
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

// The Google API surface — scripted per test.
const play = {
  getSubscriptionV2: vi.fn(),
  acknowledgeSubscription: vi.fn(async () => ({})),
  isGooglePlayConfigured: vi.fn(() => true),
  verifyPubSubPush: vi.fn(async () => ({ ok: true, via: 'secret' })),
  getPackageName: vi.fn(() => 'jamie.app'),
};
vi.mock('../../src/utils/googlePlay.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,                              // summarizeSubscription, decodeRtdn, RTDN_TYPE stay REAL
    getSubscriptionV2: (...a) => play.getSubscriptionV2(...a),
    acknowledgeSubscription: (...a) => play.acknowledgeSubscription(...a),
    isGooglePlayConfigured: (...a) => play.isGooglePlayConfigured(...a),
    verifyPubSubPush: (...a) => play.verifyPubSubPush(...a),
    getPackageName: (...a) => play.getPackageName(...a),
  };
});

const { verifyGoogle, restoreGoogle, googleRtdn, GOOGLE_PRODUCTS, googleSubId } =
  await import('../../src/controllers/googleIapController.js');

// ── Helpers ───────────────────────────────────────────────────────────────
const makeRes = () => {
  const res = { statusCode: 200 };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn(() => res);
  res.end = vi.fn(() => res);
  return res;
};
const TOKEN = 'abcdefghij.AO-J1OxPlayPurchaseToken_1234567890';
const FUTURE = new Date(Date.now() + 30 * 86400_000).toISOString();
const PAST = new Date(Date.now() - 86400_000).toISOString();
const v2 = (state = 'SUBSCRIPTION_STATE_ACTIVE', extra = {}) => ({
  subscriptionState: state,
  latestOrderId: 'GPA.0000-1111-2222-33333',
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
  lineItems: [{ productId: 'pro_monthly', expiryTime: FUTURE }],
  ...extra,
});
const writes = (re) => txQueries.filter(q => re.test(q.sql));
const rtdnBody = (payload) => Buffer.from(JSON.stringify({
  message: { data: Buffer.from(JSON.stringify({ version: '1.0', packageName: 'jamie.app', ...payload })).toString('base64'), messageId: 'm' },
}));

const savedEnv = {};
beforeEach(() => {
  savedEnv.PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED;
  process.env.PAYMENTS_ENABLED = 'true';
  txQueries.length = 0;
  poolQueries.length = 0;
  scriptedTx = defaultTx;
  scriptedPool = () => ({ rowCount: 0, rows: [] });
  play.getSubscriptionV2.mockReset();
  play.acknowledgeSubscription.mockReset().mockResolvedValue({});
  play.isGooglePlayConfigured.mockReset().mockReturnValue(true);
  play.verifyPubSubPush.mockReset().mockResolvedValue({ ok: true, via: 'secret' });
  client.release.mockClear();
});
afterEach(() => {
  if (savedEnv.PAYMENTS_ENABLED === undefined) delete process.env.PAYMENTS_ENABLED;
  else process.env.PAYMENTS_ENABLED = savedEnv.PAYMENTS_ENABLED;
});

// ── Catalogue ─────────────────────────────────────────────────────────────
describe('GOOGLE_PRODUCTS catalogue', () => {
  it('sells subscriptions only — no boost consumables (Tina 21.09.2026)', () => {
    expect(Object.keys(GOOGLE_PRODUCTS).sort()).toEqual(['pro_monthly', 'pro_sixmonth', 'pro_yearly']);
    for (const p of Object.values(GOOGLE_PRODUCTS)) expect(p.type).toBe('subscription');
  });
  it('uses the same product ids as the Apple catalogue', async () => {
    const src = (await import('fs')).readFileSync(new URL('../../src/controllers/iapController.js', import.meta.url), 'utf8');
    for (const id of Object.keys(GOOGLE_PRODUCTS)) expect(src).toContain(`${id}:`);
  });
  it('keys the subscriptions row as google:<token>', () => {
    expect(googleSubId('t')).toBe('google:t');
  });
});

// ── verifyGoogle ──────────────────────────────────────────────────────────
describe('POST /api/iap/google/verify', () => {
  it('403 PAYMENTS_DISABLED while the kill-switch is off — before touching Google', async () => {
    process.env.PAYMENTS_ENABLED = 'false';
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYMENTS_DISABLED' }));
    expect(play.getSubscriptionV2).not.toHaveBeenCalled();
  });

  it('400 on missing fields / unknown product / malformed token', async () => {
    for (const body of [
      {}, { product_id: 'pro_monthly' }, { purchase_token: TOKEN },
      { product_id: 'boost_pro', purchase_token: TOKEN },          // no consumables
      { product_id: 'pro_monthly', purchase_token: 'short' },
      { product_id: 'pro_monthly', purchase_token: 'has spaces and ; chars 1234567890' },
    ]) {
      const res = makeRes();
      await verifyGoogle({ body, userId: 7 }, res);
      expect(res.status, JSON.stringify(body)).toHaveBeenCalledWith(400);
    }
    expect(play.getSubscriptionV2).not.toHaveBeenCalled();
  });

  it('503 PLAY_NOT_CONFIGURED without a service account (fail-closed, no Google call)', async () => {
    play.isGooglePlayConfigured.mockReturnValue(false);
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PLAY_NOT_CONFIGURED' }));
    expect(play.getSubscriptionV2).not.toHaveBeenCalled();
  });

  it('ACTIVE purchase → receipt + active subscription row + acknowledge, returns is_pro', async () => {
    play.getSubscriptionV2.mockResolvedValue(v2());
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);

    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true, is_pro: true, status: 'active', already_credited: false, acknowledged: true,
    }));

    const receipt = writes(/INSERT INTO iap_receipts/)[0];
    expect(receipt).toBeTruthy();
    expect(receipt.sql).toContain("'google'");
    expect(receipt.params[0]).toBe(7);                       // user_id
    expect(receipt.params[1]).toBe('pro_monthly');           // product_id
    expect(receipt.params[2]).toBe('GPA.0000-1111-2222-33333'); // transaction_id = order id
    expect(receipt.params[3]).toBe(TOKEN);                   // original_transaction_id = token
    expect(receipt.params[4]).toBe('Production');

    const sub = writes(/INSERT INTO subscriptions/)[0];
    expect(sub.params).toEqual([7, 'active', expect.any(Date), `google:${TOKEN}`, 'google:7']);

    expect(play.acknowledgeSubscription).toHaveBeenCalledWith('pro_monthly', TOKEN);
    expect(txQueries.map(q => q.sql)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
    expect(client.release).toHaveBeenCalled();
  });

  it('does not re-acknowledge an already acknowledged purchase', async () => {
    play.getSubscriptionV2.mockResolvedValue(v2('SUBSCRIPTION_STATE_ACTIVE', { acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }));
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.statusCode).toBe(200);
    expect(play.acknowledgeSubscription).not.toHaveBeenCalled();
  });

  it('a failed acknowledge does NOT undo the grant (best-effort, RTDN/restore retry it)', async () => {
    play.getSubscriptionV2.mockResolvedValue(v2());
    play.acknowledgeSubscription.mockRejectedValue(new Error('Play 500'));
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, is_pro: true, acknowledged: false }));
    expect(txQueries.map(q => q.sql)).toContain('COMMIT');
  });

  it('replay of the same order is idempotent: already_credited, still 200, sub row refreshed', async () => {
    play.getSubscriptionV2.mockResolvedValue(v2('SUBSCRIPTION_STATE_ACTIVE', { acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }));
    scriptedTx = (sql) => /INSERT INTO iap_receipts/.test(sql) ? { rowCount: 0, rows: [] } : defaultTx(sql);
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, already_credited: true }));
    expect(writes(/INSERT INTO subscriptions/)).toHaveLength(1);
  });

  it('409 when the token is already bound to ANOTHER account — and nothing is written', async () => {
    play.getSubscriptionV2.mockResolvedValue(v2());
    scriptedTx = (sql) => /SELECT user_id FROM iap_receipts/.test(sql)
      ? { rowCount: 1, rows: [{ user_id: 99 }] } : { rowCount: 1, rows: [] };
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_OWNED_BY_OTHER' }));
    expect(writes(/INSERT INTO/)).toHaveLength(0);
    expect(txQueries.map(q => q.sql)).toContain('ROLLBACK');
    expect(play.acknowledgeSubscription).not.toHaveBeenCalled();
  });

  it('same owner re-verifying is fine (user_id compares numerically — pg returns strings for BIGINT)', async () => {
    play.getSubscriptionV2.mockResolvedValue(v2());
    scriptedTx = (sql) => /SELECT user_id FROM iap_receipts/.test(sql)
      ? { rowCount: 1, rows: [{ user_id: '7' }] } : { rowCount: 1, rows: [] };
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.statusCode).toBe(200);
  });

  it('400 PRODUCT_MISMATCH when Google says the token is for a different product', async () => {
    play.getSubscriptionV2.mockResolvedValue(v2());
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_yearly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PRODUCT_MISMATCH' }));
    expect(writes(/INSERT INTO/)).toHaveLength(0);
  });

  it('400 PURCHASE_NOT_ACTIVE for an expired subscription — recorded, not granted', async () => {
    play.getSubscriptionV2.mockResolvedValue(v2('SUBSCRIPTION_STATE_EXPIRED', { lineItems: [{ productId: 'pro_monthly', expiryTime: PAST }] }));
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PURCHASE_NOT_ACTIVE', status: 'expired' }));
    // The row is still upserted with the truthful status, so getStatus says "expired", not "none".
    expect(writes(/INSERT INTO subscriptions/)[0].params[1]).toBe('expired');
    expect(play.acknowledgeSubscription).not.toHaveBeenCalled();
  });

  it('202 pending for a deferred-payment purchase', async () => {
    play.getSubscriptionV2.mockResolvedValue(v2('SUBSCRIPTION_STATE_PENDING'));
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ pending: true }));
  });

  it('upgrade with linkedPurchaseToken retires the old subscription row', async () => {
    play.getSubscriptionV2.mockResolvedValue(v2('SUBSCRIPTION_STATE_ACTIVE', {
      lineItems: [{ productId: 'pro_yearly', expiryTime: FUTURE }], linkedPurchaseToken: 'old-token-old-token-old',
    }));
    const res = makeRes();
    await verifyGoogle({ body: { product_id: 'pro_yearly', purchase_token: TOKEN }, userId: 7 }, res);
    expect(res.statusCode).toBe(200);
    const retire = writes(/UPDATE subscriptions SET status = 'expired'/)[0];
    expect(retire.params).toEqual(['google:old-token-old-token-old']);
  });

  it('Google 404 on the token → 400 PURCHASE_INVALID; Google 403 → 503 PLAY_NOT_CONFIGURED; Google 500 → 502', async () => {
    for (const [status, expectStatus, code] of [[404, 400, 'PURCHASE_INVALID'], [403, 503, 'PLAY_NOT_CONFIGURED'], [500, 502, 'PLAY_UPSTREAM']]) {
      const err = new Error('play'); err.status = status;
      play.getSubscriptionV2.mockRejectedValue(err);
      const res = makeRes();
      await verifyGoogle({ body: { product_id: 'pro_monthly', purchase_token: TOKEN }, userId: 7 }, res);
      expect(res.status, `google ${status}`).toHaveBeenCalledWith(expectStatus);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code }));
    }
  });
});

// ── restoreGoogle ─────────────────────────────────────────────────────────
describe('POST /api/iap/google/restore', () => {
  it('403 while payments are off', async () => {
    process.env.PAYMENTS_ENABLED = 'false';
    const res = makeRes();
    await restoreGoogle({ body: { purchases: [{ purchase_token: TOKEN }] }, userId: 7 }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('empty list → restored 0 without calling Google', async () => {
    const res = makeRes();
    await restoreGoogle({ body: { purchases: [] }, userId: 7 }, res);
    expect(res.json).toHaveBeenCalledWith({ restored: 0, results: [] });
    expect(play.getSubscriptionV2).not.toHaveBeenCalled();
  });

  it('counts only access-granting purchases, isolates a bad token, caps the batch at 10', async () => {
    play.getSubscriptionV2
      .mockResolvedValueOnce(v2())
      .mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 404 }))
      .mockResolvedValueOnce(v2('SUBSCRIPTION_STATE_EXPIRED', { latestOrderId: 'GPA.9', lineItems: [{ productId: 'pro_monthly', expiryTime: PAST }] }))
      .mockResolvedValue(v2());
    const list = Array.from({ length: 12 }, (_, i) => ({ product_id: 'pro_monthly', purchase_token: `${TOKEN}${i}` }));
    list.splice(1, 0, { purchase_token: 'bad token!' }); // malformed → skipped without a Google call
    const res = makeRes();
    await restoreGoogle({ body: { purchases: list }, userId: 7 }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.results).toHaveLength(10);
    expect(out.results[1]).toEqual({ ok: false, code: 'INVALID_TOKEN' });
    expect(out.results[2]).toEqual({ ok: false, code: 'PLAY_404' });
    expect(out.results[3]).toEqual(expect.objectContaining({ ok: false, status: 'expired' }));
    expect(out.restored).toBe(7); // 10 entries − invalid − 404 − expired
    expect(play.getSubscriptionV2).toHaveBeenCalledTimes(9);
  });
});

// ── RTDN webhook ──────────────────────────────────────────────────────────
describe('POST /api/iap/google/notifications (RTDN)', () => {
  const req = (body, extra = {}) => ({ body, query: {}, headers: {}, get: () => undefined, ...extra });

  it('401 when Pub/Sub auth fails, 503 when RTDN auth is not configured at all', async () => {
    play.verifyPubSubPush.mockResolvedValue({ ok: false, reason: 'unauthenticated' });
    let res = makeRes();
    await googleRtdn(req(rtdnBody({ testNotification: { version: '1.0' } })), res);
    expect(res.status).toHaveBeenCalledWith(401);

    play.verifyPubSubPush.mockResolvedValue({ ok: false, reason: 'rtdn-not-configured' });
    res = makeRes();
    await googleRtdn(req(rtdnBody({ testNotification: { version: '1.0' } })), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(poolQueries).toHaveLength(0);
  });

  it('test notification → 200, nothing written', async () => {
    const res = makeRes();
    await googleRtdn(req(rtdnBody({ testNotification: { version: '1.0' } })), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(poolQueries).toHaveLength(0);
    expect(play.getSubscriptionV2).not.toHaveBeenCalled();
  });

  it('undecodable envelope → 200 (never let Pub/Sub redeliver garbage forever)', async () => {
    const res = makeRes();
    await googleRtdn(req(Buffer.from('not json')), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('foreign packageName → 200 and ignored', async () => {
    const res = makeRes();
    await googleRtdn(req(rtdnBody({ packageName: 'other.app', subscriptionNotification: { notificationType: 2, purchaseToken: TOKEN } })), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(play.getSubscriptionV2).not.toHaveBeenCalled();
  });

  it('unknown purchaseToken (client never verified) → 200, no sync — restore will bind it', async () => {
    scriptedPool = () => ({ rowCount: 0, rows: [] });
    const res = makeRes();
    await googleRtdn(req(rtdnBody({ subscriptionNotification: { notificationType: 4, purchaseToken: TOKEN, subscriptionId: 'pro_monthly' } })), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(play.getSubscriptionV2).not.toHaveBeenCalled();
  });

  it('RENEWED for a known token re-syncs from Google and extends the row for the ORIGINAL owner', async () => {
    scriptedPool = () => ({ rowCount: 1, rows: [{ user_id: '7' }] });
    play.getSubscriptionV2.mockResolvedValue(v2('SUBSCRIPTION_STATE_ACTIVE', { latestOrderId: 'GPA.0000-1111-2222-33333..1', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }));
    scriptedTx = (sql) => /SELECT user_id FROM iap_receipts/.test(sql) ? { rowCount: 1, rows: [{ user_id: '7' }] } : { rowCount: 1, rows: [] };
    const res = makeRes();
    await googleRtdn(req(rtdnBody({ subscriptionNotification: { notificationType: 2, purchaseToken: TOKEN, subscriptionId: 'pro_monthly' } })), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const sub = writes(/INSERT INTO subscriptions/)[0];
    expect(sub.params[0]).toBe('7');
    expect(sub.params[1]).toBe('active');
    expect(sub.params[3]).toBe(`google:${TOKEN}`);
  });

  it('EXPIRED → status expired (Pro gone)', async () => {
    scriptedPool = () => ({ rowCount: 1, rows: [{ user_id: 7 }] });
    play.getSubscriptionV2.mockResolvedValue(v2('SUBSCRIPTION_STATE_EXPIRED', { lineItems: [{ productId: 'pro_monthly', expiryTime: PAST }] }));
    scriptedTx = (sql) => /SELECT user_id FROM iap_receipts/.test(sql) ? { rowCount: 1, rows: [{ user_id: 7 }] } : { rowCount: 1, rows: [] };
    const res = makeRes();
    await googleRtdn(req(rtdnBody({ subscriptionNotification: { notificationType: 13, purchaseToken: TOKEN } })), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(writes(/INSERT INTO subscriptions/)[0].params[1]).toBe('expired');
    expect(play.acknowledgeSubscription).not.toHaveBeenCalled();
  });

  it('REVOKED (type 12) forces status revoked even if Google still reports a period', async () => {
    scriptedPool = () => ({ rowCount: 1, rows: [{ user_id: 7 }] });
    play.getSubscriptionV2.mockResolvedValue(v2('SUBSCRIPTION_STATE_EXPIRED'));
    scriptedTx = (sql) => /SELECT user_id FROM iap_receipts/.test(sql) ? { rowCount: 1, rows: [{ user_id: 7 }] } : { rowCount: 1, rows: [] };
    const res = makeRes();
    await googleRtdn(req(rtdnBody({ subscriptionNotification: { notificationType: 12, purchaseToken: TOKEN } })), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(writes(/INSERT INTO subscriptions/)[0].params[1]).toBe('revoked');
  });

  it('voided purchase (refund/chargeback) → revoked without a Google round-trip', async () => {
    const res = makeRes();
    await googleRtdn(req(rtdnBody({ voidedPurchaseNotification: { purchaseToken: TOKEN, orderId: 'GPA.1', productType: 1, refundType: 1 } })), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const upd = poolQueries.find(q => /status = 'revoked'/.test(q.sql));
    expect(upd.params).toEqual([`google:${TOKEN}`]);
    expect(play.getSubscriptionV2).not.toHaveBeenCalled();
  });

  it('transient Google failure during a known-token sync → 500 so Pub/Sub retries', async () => {
    scriptedPool = () => ({ rowCount: 1, rows: [{ user_id: 7 }] });
    play.getSubscriptionV2.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const res = makeRes();
    await googleRtdn(req(rtdnBody({ subscriptionNotification: { notificationType: 2, purchaseToken: TOKEN } })), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
