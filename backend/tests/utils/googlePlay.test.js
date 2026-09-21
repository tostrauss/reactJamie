import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  isGooglePlayConfigured,
  summarizeSubscription,
  PLAY_STATE_TO_STATUS,
  verifyPubSubPush,
  decodeRtdn,
  getPackageName,
} from '../../src/utils/googlePlay.js';

const ENV_KEYS = [
  'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', 'GOOGLE_PLAY_PACKAGE_NAME',
  'GOOGLE_PLAY_RTDN_SECRET', 'GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PLAY_RTDN_AUDIENCE',
];
const saved = {};
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const FAKE_SA = { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----' };

describe('isGooglePlayConfigured', () => {
  it('is false when the env var is unset (fail-closed)', () => {
    expect(isGooglePlayConfigured()).toBe(false);
  });
  it('accepts raw JSON', () => {
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify(FAKE_SA);
    expect(isGooglePlayConfigured()).toBe(true);
  });
  it('accepts base64 JSON (Railway-safe form)', () => {
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify(FAKE_SA)).toString('base64');
    expect(isGooglePlayConfigured()).toBe(true);
  });
  it('is false for garbage / incomplete keys instead of throwing', () => {
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = 'not json';
    expect(isGooglePlayConfigured()).toBe(false);
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'x' });
    expect(isGooglePlayConfigured()).toBe(false);
  });
  it('package name defaults to jamie.app', () => {
    expect(getPackageName()).toBe('jamie.app');
    process.env.GOOGLE_PLAY_PACKAGE_NAME = 'other.app';
    expect(getPackageName()).toBe('other.app');
  });
});

describe('summarizeSubscription (subscriptionsv2 → our status)', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const future = '2026-10-21T12:00:00Z';
  const past = '2026-09-01T12:00:00Z';
  const v2 = (state, extra = {}) => ({
    subscriptionState: state,
    latestOrderId: 'GPA.1111-2222-3333-44444',
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    lineItems: [{ productId: 'pro_monthly', expiryTime: future }],
    ...extra,
  });

  it('ACTIVE with future expiry grants access', () => {
    const s = summarizeSubscription(v2('SUBSCRIPTION_STATE_ACTIVE'), now);
    expect(s.status).toBe('active');
    expect(s.grantsAccess).toBe(true);
    expect(s.productId).toBe('pro_monthly');
    expect(s.periodEnd.toISOString()).toBe(new Date(future).toISOString());
    expect(s.acknowledged).toBe(false);
    expect(s.isTest).toBe(false);
  });

  it('CANCELED keeps access until expiry (auto-renew off ≠ gone)', () => {
    const s = summarizeSubscription(v2('SUBSCRIPTION_STATE_CANCELED'), now);
    expect(s.status).toBe('canceling');
    expect(s.grantsAccess).toBe(true);
  });

  it('IN_GRACE_PERIOD keeps access (Google: retrying payment)', () => {
    expect(summarizeSubscription(v2('SUBSCRIPTION_STATE_IN_GRACE_PERIOD'), now).grantsAccess).toBe(true);
  });

  it('ON_HOLD / PAUSED / EXPIRED / PENDING never grant access', () => {
    for (const st of ['SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_PENDING']) {
      const s = summarizeSubscription(v2(st), now);
      expect(s.grantsAccess, st).toBe(false);
      // None of these may ever collide with the statuses getStatus treats as Pro.
      expect(['active', 'canceling', 'trialing']).not.toContain(s.status);
    }
  });

  it('an ACTIVE state with an expiry in the past does NOT grant access', () => {
    const s = summarizeSubscription(v2('SUBSCRIPTION_STATE_ACTIVE', { lineItems: [{ productId: 'pro_monthly', expiryTime: past }] }), now);
    expect(s.status).toBe('active');
    expect(s.grantsAccess).toBe(false);
  });

  it('unknown / missing state maps to pending, never to access', () => {
    const s = summarizeSubscription({}, now);
    expect(s.status).toBe('pending');
    expect(s.grantsAccess).toBe(false);
    expect(s.periodEnd).toBeNull();
  });

  it('surfaces linkedPurchaseToken, testPurchase and acknowledgement', () => {
    const s = summarizeSubscription(v2('SUBSCRIPTION_STATE_ACTIVE', {
      linkedPurchaseToken: 'old-token', testPurchase: {}, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    }), now);
    expect(s.linkedPurchaseToken).toBe('old-token');
    expect(s.isTest).toBe(true);
    expect(s.acknowledged).toBe(true);
  });

  it('every Play state has a mapping (no silent undefined → pending drift)', () => {
    for (const st of ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_CANCELED', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
      'SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_PENDING']) {
      expect(PLAY_STATE_TO_STATUS[st], st).toBeTruthy();
    }
  });
});

describe('verifyPubSubPush (RTDN auth)', () => {
  const req = ({ token, auth } = {}) => ({
    query: token ? { token } : {},
    headers: auth ? { authorization: auth } : {},
    get: (h) => (h.toLowerCase() === 'authorization' ? auth : undefined),
  });

  it('rejects everything when neither secret nor OIDC e-mail is configured', async () => {
    expect(await verifyPubSubPush(req({ token: 'anything' }))).toEqual({ ok: false, reason: 'rtdn-not-configured' });
  });

  it('accepts the exact URL secret and rejects a wrong or missing one', async () => {
    process.env.GOOGLE_PLAY_RTDN_SECRET = 's3cret-s3cret-s3cret';
    expect((await verifyPubSubPush(req({ token: 's3cret-s3cret-s3cret' }))).ok).toBe(true);
    expect((await verifyPubSubPush(req({ token: 's3cret-s3cret-s3creT' }))).ok).toBe(false);
    expect((await verifyPubSubPush(req({ token: 's3cret' }))).ok).toBe(false); // different length must not throw
    expect((await verifyPubSubPush(req())).ok).toBe(false);
  });

  it('with only OIDC configured, a bogus bearer token is rejected (not accepted, not thrown)', async () => {
    process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL = 'push@proj.iam.gserviceaccount.com';
    const r = await verifyPubSubPush(req({ auth: 'Bearer not.a.jwt' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^oidc-invalid/);
  });

  it('with only OIDC configured, a URL secret alone does not get in', async () => {
    process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL = 'push@proj.iam.gserviceaccount.com';
    expect((await verifyPubSubPush(req({ token: 'whatever' }))).ok).toBe(false);
  });
});

describe('decodeRtdn', () => {
  const envelope = (payload) => Buffer.from(JSON.stringify({
    message: { data: Buffer.from(JSON.stringify(payload)).toString('base64'), messageId: 'm-1' },
    subscription: 'projects/p/subscriptions/s',
  }));

  it('unwraps the base64 RTDN payload from a Pub/Sub push envelope', () => {
    const { payload, messageId } = decodeRtdn(envelope({
      version: '1.0', packageName: 'jamie.app', eventTimeMillis: '1',
      subscriptionNotification: { version: '1.0', notificationType: 2, purchaseToken: 'tok', subscriptionId: 'pro_monthly' },
    }));
    expect(messageId).toBe('m-1');
    expect(payload.subscriptionNotification.notificationType).toBe(2);
    expect(payload.subscriptionNotification.purchaseToken).toBe('tok');
  });

  it('throws on an envelope without message.data', () => {
    expect(() => decodeRtdn(Buffer.from('{"message":{}}'))).toThrow(/message\.data/);
    expect(() => decodeRtdn(Buffer.from('nope'))).toThrow();
  });
});
