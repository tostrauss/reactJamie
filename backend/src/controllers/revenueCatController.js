/**
 * RevenueCat (iOS in-app subscriptions) + the runtime payments config.
 *
 * Endpoints:
 *   GET  /api/iap/config              public: which purchase paths are live
 *   POST /api/iap/revenuecat/sync     JWT: re-read my entitlement after a
 *                                     purchase / restore
 *   POST /api/iap/revenuecat/webhook  RevenueCat → us (Authorization header)
 *
 * Why the config is served at RUNTIME: the iOS app bundles the web build, so
 * any flag compiled into the bundle is frozen until the next App Store
 * release. The on/off decision for iOS purchases (and, for consistency, web
 * and Play) therefore lives in Railway env and reaches every client at app
 * start. Rollback = flip an env var, no rebuild, no review.
 *
 * Subscriptions row per RevenueCat user: stripe_subscription_id =
 * `revenuecat:<userId>`, stripe_customer_id = `apple:<userId>` (or `google:`
 * for a Play-store subscriber) so storeOf() keeps the Stripe-only endpoints
 * (portal, cancel, Widerruf) away from it, exactly like the direct Apple and
 * Play rows.
 */

import db from '../config/database.js';
import { paymentsEnabled, iosIapEnabled, playBillingEnabled } from '../config/features.js';
import { Sentry } from '../config/sentry.js';
import * as rc from '../utils/revenueCat.js';
import { isGooglePlayConfigured } from '../utils/googlePlay.js';

// Product ids RevenueCat may report. Same catalogue as App Store Connect,
// Play Console and frontend/src/utils/iap.js. Anything else (for example a
// promotional grant from the RC dashboard) still counts, because the
// ENTITLEMENT is what grants Pro, not the product. This list only feeds the
// ledger's plan label.
const RC_PRODUCTS = Object.freeze({
  pro_monthly:  { plan: 'monthly'  },
  pro_sixmonth: { plan: 'sixmonth' },
  pro_yearly:   { plan: 'yearly'   },
});

export const rcSubId = (userId) => `revenuecat:${userId}`;

const ACTIVE_STATUSES = ['active', 'trialing', 'canceling'];

/**
 * Read the user's entitlement at RevenueCat and make our DB match it.
 * Used by /sync (after purchase and restore) and by the webhook.
 */
export async function syncRevenueCatSubscription({ userId, source }) {
  const subscriber = await rc.getSubscriber(String(userId));
  const s = rc.summarizeEntitlement(subscriber);

  if (s.status === 'none') {
    // Never had the entitlement (or it was removed entirely). Retire a
    // previously active row, if any. Nothing else to record.
    await db.query(
      `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
        WHERE stripe_subscription_id = $1 AND status = ANY($2)`,
      [rcSubId(userId), ACTIVE_STATUSES],
    );
    return { ...s, duplicate: false };
  }

  const prefix = rc.storePrefix(s.store);
  const client = await db.pool.connect();
  let duplicate = false;
  try {
    await client.query('BEGIN');

    // Ledger row per store transaction (renewals get a new id). Idempotent.
    if (s.storeTransactionId) {
      await client.query(
        `INSERT INTO iap_receipts
            (user_id, platform, product_id, product_type, transaction_id,
             original_transaction_id, environment, raw_receipt, payload, expires_at)
         VALUES ($1, $2, $3, 'subscription', $4, $5, $6, '', $7, $8)
         ON CONFLICT (platform, transaction_id) DO NOTHING`,
        [
          userId,
          prefix === 'google' ? 'google' : 'apple',
          s.productId || 'unknown',
          `rc:${s.storeTransactionId}`,
          rcSubId(userId),
          s.isSandbox ? 'Sandbox' : 'Production',
          JSON.stringify({ source, status: s.status, store: s.store, plan: RC_PRODUCTS[s.productId]?.plan || null }),
          s.periodEnd,
        ],
      );
    }

    // The DB allows ONE active-ish subscription per user
    // (subscriptions_one_active_per_user). If this user already pays through
    // another channel (e.g. a Stripe sub bought on the web), the upsert
    // would 23505. Record the store row as 'duplicate' instead: the user
    // stays Pro through the other row, and support can see (and refund) the
    // double payment. The savepoint keeps the transaction usable after the
    // failed statement.
    const upsert = (status) => client.query(
      `INSERT INTO subscriptions
          (user_id, status, current_period_end, stripe_subscription_id, stripe_customer_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (stripe_subscription_id) DO UPDATE
         SET status             = EXCLUDED.status,
             current_period_end = EXCLUDED.current_period_end,
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             updated_at         = NOW()`,
      [userId, status, s.periodEnd, rcSubId(userId), `${prefix}:${userId}`],
    );
    await client.query('SAVEPOINT rc_upsert');
    try {
      await upsert(s.status);
    } catch (err) {
      if (err.code !== '23505' || !ACTIVE_STATUSES.includes(s.status)) throw err;
      await client.query('ROLLBACK TO SAVEPOINT rc_upsert');
      await upsert('duplicate');
      duplicate = true;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (duplicate) {
    console.warn(`[revenuecat] user ${userId} has a store subscription AND another active one, recorded as duplicate`);
    Sentry.captureMessage?.('revenuecat duplicate subscription', {
      level: 'warning', extra: { userId, source, store: s.store, productId: s.productId },
    });
  }
  return { ...s, duplicate };
}

/**
 * GET /api/iap/config (public, no auth)
 * Which purchase paths the client may show. Everything fail-closed: a path is
 * only on when payments are on, its own switch is on, AND the server can
 * actually verify that store's purchases.
 */
export const getPaymentsConfig = (_req, res) => {
  const iosKey = rc.getIosApiKey();
  res.set('Cache-Control', 'no-store');
  res.json({
    payments_enabled: paymentsEnabled(),
    ios_iap_enabled: iosIapEnabled() && !!iosKey && rc.isRevenueCatConfigured(),
    play_billing_enabled: playBillingEnabled() && isGooglePlayConfigured(),
    revenuecat: {
      ios_api_key: iosKey,
      entitlement: rc.getEntitlementId(),
    },
  });
};

/**
 * POST /api/iap/revenuecat/sync
 * Called by the app right after a purchase and on "Käufe wiederherstellen".
 * The client proves nothing. We look the user up at RevenueCat ourselves.
 */
export const syncRevenueCat = async (req, res) => {
  if (!paymentsEnabled()) {
    return res.status(403).json({ error: 'Zahlungen sind derzeit deaktiviert.', code: 'PAYMENTS_DISABLED' });
  }
  if (!rc.isRevenueCatConfigured()) {
    return res.status(503).json({ error: 'In-App-Käufe sind serverseitig nicht konfiguriert.', code: 'RC_NOT_CONFIGURED' });
  }
  try {
    const r = await syncRevenueCatSubscription({ userId: req.userId, source: 'client-sync' });
    return res.json({
      ok: true,
      is_pro: r.grantsAccess === true,
      status: r.status,
      current_period_end: r.periodEnd || null,
      duplicate: r.duplicate,
    });
  } catch (err) {
    console.error('[revenuecat] sync failed:', err.message);
    Sentry.captureException?.(err, { tags: { area: 'payments', kind: 'revenuecat-sync' } });
    // 502, not 500: the purchase itself went through at Apple. The client
    // tells the user Pro will switch on shortly, and the webhook does it.
    return res.status(502).json({ error: 'Kauf wird noch bestätigt, bitte gleich noch einmal versuchen.', code: 'RC_UPSTREAM' });
  }
};

/**
 * POST /api/iap/revenuecat/webhook
 * RevenueCat retries non-2xx (up to 5 times with backoff). So: 401 for bad
 * auth (misconfiguration, must surface), 200 for events we consciously skip,
 * 500 only for transient failures we want retried.
 *
 * Event payload fields are not trusted for state: we only take the user ids
 * from it and re-read the truth from the REST API.
 */
export const revenueCatWebhook = async (req, res) => {
  if (!rc.isWebhookConfigured()) {
    console.warn('[revenuecat-webhook] REVENUECAT_WEBHOOK_AUTH not set, rejecting');
    return res.status(503).end();
  }
  if (!rc.verifyWebhookAuth(req.get('authorization'))) {
    console.warn('[revenuecat-webhook] bad Authorization header');
    return res.status(401).end();
  }

  const event = req.body?.event;
  if (!event || typeof event !== 'object') return res.status(200).end();
  if (event.type === 'TEST') {
    console.log('[revenuecat-webhook] test event received ✓');
    return res.status(200).end();
  }

  // Every JAMIE user this event touches. TRANSFER moves a purchase between
  // App User IDs (restore on another account): sync both sides so the old
  // account loses Pro and the new one gains it.
  const ids = new Set();
  for (const v of [
    event.app_user_id, event.original_app_user_id,
    ...(Array.isArray(event.aliases) ? event.aliases : []),
    ...(Array.isArray(event.transferred_from) ? event.transferred_from : []),
    ...(Array.isArray(event.transferred_to) ? event.transferred_to : []),
  ]) {
    const id = rc.toUserId(v);
    if (id) ids.add(id);
  }
  if (!ids.size) {
    console.warn('[revenuecat-webhook]', event.type, 'without a JAMIE user id, skipped');
    return res.status(200).end();
  }

  try {
    // Only ids that still exist (account deleted → nothing to update, and
    // the FK would reject the insert).
    const existing = await db.query('SELECT id FROM users WHERE id = ANY($1::int[])', [[...ids]]);
    for (const row of existing.rows) {
      await syncRevenueCatSubscription({ userId: row.id, source: `webhook:${event.type}` });
    }
    return res.status(200).end();
  } catch (err) {
    console.error('[revenuecat-webhook] handler failed:', err.message);
    Sentry.captureException?.(err, { tags: { area: 'payments', kind: 'revenuecat-webhook' } });
    return res.status(500).end();
  }
};
