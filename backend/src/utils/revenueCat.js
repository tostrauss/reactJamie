/**
 * RevenueCat server client, used for iOS in-app subscriptions.
 *
 * The iOS app buys JAMIE Pro through the RevenueCat Capacitor SDK
 * (frontend/src/utils/iap.js). RevenueCat checks the StoreKit receipt with
 * Apple. We do not trust anything the client sends. After a purchase, and on
 * every RevenueCat webhook, we ask RevenueCat's REST API for the subscriber's
 * CURRENT entitlement and copy that into our `subscriptions` table. So every
 * path (purchase, restore, renewal, cancel, refund, transfer) ends in one
 * sync. Same pattern as googleIapController.syncGoogleSubscription.
 *
 * App User ID = the JAMIE users.id as a string. The app calls
 * Purchases.logIn(String(user.id)), so a subscriber id is always a user id.
 * Anonymous RevenueCat ids ($RCAnonymousID:…) are ignored.
 *
 * Env (Railway):
 *   REVENUECAT_IOS_API_KEY       public Apple SDK key (appl_…). Sent to the app
 *                                via GET /api/iap/config, so a new key needs no
 *                                iOS rebuild.
 *   REVENUECAT_SECRET_API_KEY    secret REST key (sk_…). Server only, never
 *                                sent to the client.
 *   REVENUECAT_WEBHOOK_AUTH      the "Authorization header value" set on the
 *                                webhook in the RevenueCat dashboard
 *   REVENUECAT_ENTITLEMENT_ID    default "pro"
 *   REVENUECAT_ALLOW_SANDBOX     default true. Apple's reviewers and TestFlight
 *                                buy in the sandbox, so turning this off would
 *                                fail App Review.
 *
 * Runbook: store/REVENUECAT-SETUP.md
 */

import { timingSafeEqual } from 'crypto';

const API_BASE = 'https://api.revenuecat.com/v1';
// Same fail-fast posture as the Stripe/Google clients: a slow upstream must
// never hold a request (and its DB pool connection) open for minutes.
const HTTP_TIMEOUT_MS = 8000;

// Lifetime / promotional grants without an expiry. isUserPro needs a
// current_period_end in the future, so "never expires" becomes a far date.
const NO_EXPIRY = new Date('2099-12-31T23:59:59Z');

export const getEntitlementId = () => process.env.REVENUECAT_ENTITLEMENT_ID || 'pro';
export const getIosApiKey = () => process.env.REVENUECAT_IOS_API_KEY || null;
const getSecretKey = () => process.env.REVENUECAT_SECRET_API_KEY || null;
const allowSandbox = () => process.env.REVENUECAT_ALLOW_SANDBOX !== 'false';

/** The server can verify purchases. Without the secret key the iOS purchase
 *  path must stay closed: Apple would charge the user and we could not grant
 *  Pro. The /api/iap/config gate checks this. */
export const isRevenueCatConfigured = () => !!getSecretKey();
export const isWebhookConfigured = () => !!process.env.REVENUECAT_WEBHOOK_AUTH;

// JAMIE user ids are positive integers. Anything else (anonymous RC ids,
// aliases from another project) is not ours to sync.
export const toUserId = (appUserId) => {
  const s = String(appUserId ?? '');
  return /^[1-9]\d{0,9}$/.test(s) ? Number(s) : null;
};

/**
 * GET /v1/subscribers/{app_user_id}. Returns the `subscriber` object.
 * Note: RevenueCat creates an empty subscriber on first lookup. Harmless.
 */
export async function getSubscriber(appUserId) {
  const key = getSecretKey();
  if (!key) {
    const err = new Error('RevenueCat not configured: REVENUECAT_SECRET_API_KEY missing');
    err.code = 'RC_NOT_CONFIGURED';
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/subscribers/${encodeURIComponent(String(appUserId))}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`RevenueCat ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    return body?.subscriber || {};
  } finally {
    clearTimeout(timer);
  }
}

const toDate = (v) => (v ? new Date(v) : null);
const later = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

// RevenueCat `store` → our stripe_customer_id prefix. storeOf() in
// subscriptionController uses the prefix to keep Stripe-only endpoints
// (portal, cancel, Widerruf) away from store subscriptions.
const STORE_PREFIX = { app_store: 'apple', mac_app_store: 'apple', play_store: 'google' };
export const storePrefix = (store) => STORE_PREFIX[store] || 'apple';

/**
 * Pure: turns a RevenueCat subscriber into our subscription state.
 *
 * status: 'none' (never had the entitlement) | 'active' | 'trialing' |
 *         'canceling' (auto-renew off, still paid up) | 'expired' | 'revoked'
 */
export function summarizeEntitlement(subscriber, entitlementId = getEntitlementId(), now = new Date()) {
  const ent = subscriber?.entitlements?.[entitlementId];
  if (!ent) return { status: 'none', grantsAccess: false };

  const productId = ent.product_identifier || null;
  const sub = (productId && subscriber?.subscriptions?.[productId]) || {};
  const isSandbox = sub.is_sandbox === true;

  // Access ends at the later of expiry and billing-grace end. RevenueCat keeps
  // the entitlement alive through Apple's billing grace period.
  const periodEnd = ent.expires_date === null
    ? NO_EXPIRY
    : later(toDate(ent.expires_date), toDate(ent.grace_period_expires_date));

  const base = {
    productId,
    periodEnd,
    isSandbox,
    store: sub.store || null,
    storeTransactionId: sub.store_transaction_id || null,
    originalPurchaseDate: toDate(sub.original_purchase_date),
  };

  if (isSandbox && !allowSandbox()) {
    return { ...base, status: 'expired', grantsAccess: false, sandboxRejected: true };
  }

  const active = !!periodEnd && periodEnd > now;
  if (!active) {
    return { ...base, status: sub.refunded_at ? 'revoked' : 'expired', grantsAccess: false };
  }
  let status = 'active';
  if (sub.period_type === 'trial') status = 'trialing';
  else if (sub.unsubscribe_detected_at) status = 'canceling';
  return { ...base, status, grantsAccess: true };
}

/** Constant-time check of the webhook's Authorization header. */
export function verifyWebhookAuth(header) {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected || typeof header !== 'string') return false;
  // RevenueCat sends the configured value verbatim. Accept it with or without
  // a "Bearer " prefix, since the dashboard field is free text.
  const candidates = [header, header.replace(/^Bearer\s+/i, '')];
  const bb = Buffer.from(expected);
  return candidates.some((c) => {
    const ba = Buffer.from(c);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  });
}
