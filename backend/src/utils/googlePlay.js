/**
 * Google Play Developer API client for Play Billing (TWA / Digital Goods API).
 *
 * The Play-Store Android app is a Trusted Web Activity. Inside it, Chrome
 * exposes the Digital Goods API + PaymentRequest('https://play.google.com/
 * billing'); a purchase yields an opaque `purchaseToken`. This module is the
 * SERVER side of that token: look the subscription up at Google, acknowledge
 * it, and authenticate Real-time Developer Notifications (RTDN, Pub/Sub push).
 *
 * Deliberately NO `googleapis` dependency (it is ~100 MB and pulls in every
 * Google API). `google-auth-library` is already installed for Google login;
 * its JWT client signs a service-account token for the androidpublisher scope
 * and the two REST calls we need are plain fetch.
 *
 * Env (Railway):
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  - the service-account key file, either the
 *                                       raw JSON or base64 of it (Railway's UI
 *                                       mangles multi-line JSON; base64 is safest)
 *   GOOGLE_PLAY_PACKAGE_NAME          - default jamie.app
 *   GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL - the Pub/Sub push subscription's
 *                                       OIDC service account (RTDN auth, preferred)
 *   GOOGLE_PLAY_RTDN_AUDIENCE         - OIDC audience, default = the webhook URL
 *   GOOGLE_PLAY_RTDN_SECRET           - alternative RTDN auth: `?token=<secret>`
 *                                       on the push endpoint URL
 *
 * Runbook: store/PLAY-BILLING-SETUP.md
 */

import { timingSafeEqual } from 'crypto';
import { JWT, OAuth2Client } from 'google-auth-library';

const ANDROIDPUBLISHER = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
// Same fail-fast posture as the Stripe client (timeout 8s): a degraded Google
// must never hold a request — and its DB pool connection — open for minutes.
const HTTP_TIMEOUT_MS = 8000;

export const DEFAULT_RTDN_AUDIENCE = 'https://app.jamie-app.com/api/iap/google/notifications';

export const getPackageName = () => process.env.GOOGLE_PLAY_PACKAGE_NAME || 'jamie.app';

function parseServiceAccount() {
  const raw = (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(text);
  if (!sa.client_email || !sa.private_key) {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: client_email / private_key missing');
  }
  // Env editors turn real newlines into the two characters `\n`; the PEM
  // parser needs real ones (same treatment as APPLE_IAP_PRIVATE_KEY).
  sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  return sa;
}

/** True when a usable service-account key is configured. Never throws. */
export const isGooglePlayConfigured = () => {
  try { return !!parseServiceAccount(); } catch { return false; }
};

// Cached per key so a key rotation in Railway re-resolves without a restart
// (mirrors getProProductId's keyTail cache in subscriptionController).
let _jwt = { keyTail: null, client: null };
function getJwtClient() {
  const sa = parseServiceAccount();
  if (!sa) throw new Error('Google Play not configured: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON missing');
  const keyTail = sa.private_key.slice(-32);
  if (_jwt.client && _jwt.keyTail === keyTail) return _jwt.client;
  _jwt = {
    keyTail,
    client: new JWT({ email: sa.client_email, key: sa.private_key, scopes: [SCOPE] }),
  };
  return _jwt.client;
}

async function playFetch(path, { method = 'GET' } = {}) {
  const { token } = await getJwtClient().getAccessToken();
  const url = `${ANDROIDPUBLISHER}/${encodeURIComponent(getPackageName())}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    const err = new Error(
      `Play API ${method} ${path} → ${res.status}: ${body?.error?.message || text.slice(0, 200)}`,
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * purchases.subscriptionsv2.get — the ONE call that tells us everything about
 * a subscription purchase token (state, expiry, product, acknowledgement,
 * upgrade chain, test flag).
 */
export const getSubscriptionV2 = (purchaseToken) =>
  playFetch(`/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`);

/**
 * purchases.subscriptions.acknowledge — Google REFUNDS and revokes any
 * purchase that is not acknowledged within 3 days. There is no v2
 * acknowledge; the v1 endpoint keyed by the subscription (product) id is the
 * documented way and works for v2-style products.
 */
export const acknowledgeSubscription = (subscriptionId, purchaseToken) =>
  playFetch(
    `/purchases/subscriptions/${encodeURIComponent(subscriptionId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    { method: 'POST' },
  );

// subscriptionsv2 SubscriptionState → our subscriptions.status vocabulary.
// getStatus/isUserPro treat ONLY active | canceling | trialing (+ period end in
// the future) as Pro, so every "no access" state maps to something else.
//   CANCELED      → user turned auto-renew off, keeps access until expiry
//   IN_GRACE_PERIOD → payment failed, Google says KEEP access while it retries
//   ON_HOLD       → grace period over, access must be revoked (past_due)
//   PAUSED        → user paused; no access
export const PLAY_STATE_TO_STATUS = Object.freeze({
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_CANCELED: 'canceling',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'active',
  SUBSCRIPTION_STATE_ON_HOLD: 'past_due',
  SUBSCRIPTION_STATE_PAUSED: 'paused',
  SUBSCRIPTION_STATE_EXPIRED: 'expired',
  SUBSCRIPTION_STATE_PENDING: 'pending',
  SUBSCRIPTION_STATE_UNSPECIFIED: 'pending',
});

const ACCESS_STATUSES = new Set(['active', 'canceling']);

/** Flatten a subscriptionsv2 response into the handful of fields we act on. */
export function summarizeSubscription(v2, now = new Date()) {
  const item = v2?.lineItems?.[0] || {};
  const expiry = item.expiryTime ? new Date(item.expiryTime) : null;
  const periodEnd = expiry && !Number.isNaN(expiry.getTime()) ? expiry : null;
  const state = v2?.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED';
  const status = PLAY_STATE_TO_STATUS[state] || 'pending';
  return {
    state,
    status,
    productId: item.productId || null,
    periodEnd,
    acknowledged: v2?.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    latestOrderId: v2?.latestOrderId || null,
    // Set on upgrades/downgrades/resubscribes: the OLD token this one replaces.
    linkedPurchaseToken: v2?.linkedPurchaseToken || null,
    isTest: !!v2?.testPurchase,
    grantsAccess: ACCESS_STATUSES.has(status) && !!periodEnd && periodEnd > now,
  };
}

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

let _oauth = null;

/**
 * Authenticate a Pub/Sub push request (RTDN). Two mechanisms, either passes:
 *   1. OIDC token (Pub/Sub push subscription → "Enable authentication"):
 *      Bearer JWT signed by Google, audience = our endpoint URL, email = the
 *      push service account we configured. Preferred.
 *   2. Shared secret in the URL (`?token=…`) — for the first smoke test before
 *      the OIDC service account exists. Only ever compared timing-safe.
 * FAIL-CLOSED: nothing configured → nothing accepted (the endpoint is public).
 */
export async function verifyPubSubPush(req) {
  const secret = process.env.GOOGLE_PLAY_RTDN_SECRET;
  const saEmail = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
  if (!secret && !saEmail) return { ok: false, reason: 'rtdn-not-configured' };

  if (secret) {
    const given = req.query?.token;
    if (typeof given === 'string' && safeEqual(given, secret)) return { ok: true, via: 'secret' };
  }

  if (saEmail) {
    const auth = req.get?.('authorization') || req.headers?.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m) {
      const audience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE || DEFAULT_RTDN_AUDIENCE;
      try {
        _oauth ||= new OAuth2Client();
        const ticket = await _oauth.verifyIdToken({ idToken: m[1], audience });
        const p = ticket.getPayload() || {};
        if (p.email_verified && String(p.email).toLowerCase() === saEmail.toLowerCase()) {
          return { ok: true, via: 'oidc' };
        }
        return { ok: false, reason: 'oidc-email-mismatch' };
      } catch (err) {
        return { ok: false, reason: `oidc-invalid: ${err.message}` };
      }
    }
  }
  return { ok: false, reason: 'unauthenticated' };
}

/**
 * Unwrap a Pub/Sub push envelope into the RTDN payload:
 *   { version, packageName, eventTimeMillis,
 *     subscriptionNotification?: { version, notificationType, purchaseToken, subscriptionId },
 *     voidedPurchaseNotification?: { purchaseToken, orderId, productType, refundType },
 *     testNotification?: { version } }
 */
export function decodeRtdn(rawBody) {
  const envelope = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  const data = envelope?.message?.data;
  if (!data) throw new Error('message.data missing');
  const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  return { payload, messageId: envelope.message.messageId || null };
}

// RTDN subscriptionNotification.notificationType values we name explicitly.
export const RTDN_TYPE = Object.freeze({
  RECOVERED: 1, RENEWED: 2, CANCELED: 3, PURCHASED: 4, ON_HOLD: 5,
  IN_GRACE_PERIOD: 6, RESTARTED: 7, PRICE_CHANGE_CONFIRMED: 8, DEFERRED: 9,
  PAUSED: 10, PAUSE_SCHEDULE_CHANGED: 11, REVOKED: 12, EXPIRED: 13,
  PENDING_PURCHASE_CANCELED: 20,
});
