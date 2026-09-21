/**
 * Google Play Billing (TWA) — purchase verification, restore and RTDN webhook.
 *
 * Flow (frontend/src/utils/playBilling.js):
 *   1. Inside the Play app, Chrome's PaymentRequest('https://play.google.com/
 *      billing') sells the subscription and returns a `purchaseToken`.
 *   2. The app POSTs { product_id, purchase_token } to /api/iap/google/verify.
 *   3. We look the token up at Google (subscriptionsv2.get), record it in
 *      iap_receipts (platform 'google'), upsert the `subscriptions` row keyed
 *      `google:<purchaseToken>` and ACKNOWLEDGE the purchase — Google refunds
 *      anything still unacknowledged after 3 days.
 *   4. Renewals / cancellations / refunds arrive as Real-time Developer
 *      Notifications (Pub/Sub push) on /api/iap/google/notifications; we
 *      re-fetch the token and re-run the SAME sync, so every path converges on
 *      Google's view of the subscription.
 *
 * Subscriptions ONLY. Boost credits are NOT sold as Play consumables: Tina's
 * line (21.09.2026) is "Boosts bleiben, nur keine Einzelkäufe" — boosts come
 * with Pro. So there is nothing to `consume()` here, on purpose.
 *
 * The subscriptions table mirrors the Stripe/Apple shape: stripe_subscription_id
 * = `google:<purchaseToken>`, stripe_customer_id = `google:<userId>`. The Pro
 * getter (subscriptionController.getStatus / isUserPro) reads status + period
 * end and does not care who wrote the row.
 */

import db from '../config/database.js';
import { paymentsEnabled } from '../config/features.js';
import { Sentry } from '../config/sentry.js';
import * as play from '../utils/googlePlay.js';

// Mirror of the Play Console product catalogue. Same IDs as App Store Connect
// (iapController.APPLE_PRODUCTS) and frontend/src/utils/iap.js so ONE set of
// product ids exists across stores. Server is authoritative on what a product
// grants — a manipulated client can only name a product, never an amount.
export const GOOGLE_PRODUCTS = Object.freeze({
  pro_monthly:  { type: 'subscription', plan: 'monthly'  },
  pro_sixmonth: { type: 'subscription', plan: 'sixmonth' },
  pro_yearly:   { type: 'subscription', plan: 'yearly'   },
});

export const googleSubId = (purchaseToken) => `google:${purchaseToken}`;

// Purchase tokens are long opaque strings (letters, digits, `.`, `-`, `_`).
// This is a sanity bound against garbage/abuse, not a format spec.
const PURCHASE_TOKEN_RE = /^[\w.-]{16,1024}$/;
const MAX_RESTORE_BATCH = 10;

const codedError = (code, message) => {
  const err = new Error(message || code);
  err.code = code;
  return err;
};

/**
 * Fetch a token at Google and make our DB reflect it. Used by verify, restore
 * AND the RTDN webhook so all three converge on one code path.
 *
 * @param {object} opts
 * @param {number} opts.userId              owner of the purchase
 * @param {string} opts.purchaseToken
 * @param {string|null} [opts.expectedProductId]  what the client CLAIMED (verify only)
 * @param {string} opts.source              'verify' | 'restore' | 'rtdn:<type>'
 * @param {string|null} [opts.forceStatus]  override (RTDN REVOKED → 'revoked')
 */
export async function syncGoogleSubscription({
  userId, purchaseToken, expectedProductId = null, source, forceStatus = null,
}) {
  const v2 = await play.getSubscriptionV2(purchaseToken);
  const s = play.summarizeSubscription(v2);

  if (expectedProductId && s.productId && s.productId !== expectedProductId) {
    throw codedError('PRODUCT_MISMATCH', `token is for ${s.productId}, client claimed ${expectedProductId}`);
  }
  const product = GOOGLE_PRODUCTS[s.productId];
  if (!product) throw codedError('UNKNOWN_PRODUCT', `unknown Play product ${s.productId}`);

  const status = forceStatus || s.status;
  const grantsAccess = forceStatus ? false : s.grantsAccess;

  const client = await db.pool.connect();
  let alreadyCredited = false;
  try {
    await client.query('BEGIN');

    // A purchase token belongs to exactly ONE JAMIE account. Without this, a
    // token captured from one account's traffic could be replayed to grant Pro
    // to another (verify is authenticated, but the token is the only proof).
    const owner = await client.query(
      `SELECT user_id FROM iap_receipts
        WHERE platform = 'google' AND original_transaction_id = $1
        ORDER BY id ASC LIMIT 1`,
      [purchaseToken],
    );
    if (owner.rowCount > 0 && Number(owner.rows[0].user_id) !== Number(userId)) {
      throw codedError('TOKEN_OWNED_BY_OTHER', 'purchase token already bound to another account');
    }

    // Ledger row per Play ORDER (renewals get a new latestOrderId, state changes
    // within one order — cancel, restart — do not). ON CONFLICT DO NOTHING keeps
    // this idempotent; the subscription upsert below ALWAYS runs so a state
    // change on an already-logged order still lands.
    const ins = await client.query(
      `INSERT INTO iap_receipts
          (user_id, platform, product_id, product_type, transaction_id,
           original_transaction_id, environment, raw_receipt, payload, expires_at)
       VALUES ($1, 'google', $2, 'subscription', $3, $4, $5, $6, $7, $8)
       ON CONFLICT (platform, transaction_id) DO NOTHING`,
      [
        userId,
        s.productId,
        s.latestOrderId || purchaseToken,
        purchaseToken,
        s.isTest ? 'Test' : 'Production',
        purchaseToken,
        JSON.stringify({ v2, source }),
        s.periodEnd,
      ],
    );
    alreadyCredited = ins.rowCount === 0;

    await client.query(
      `INSERT INTO subscriptions
          (user_id, status, current_period_end, stripe_subscription_id, stripe_customer_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (stripe_subscription_id) DO UPDATE
         SET status             = EXCLUDED.status,
             current_period_end = EXCLUDED.current_period_end,
             updated_at         = NOW()`,
      [userId, status, s.periodEnd, googleSubId(purchaseToken), `google:${userId}`],
    );

    // Upgrade / downgrade / resubscribe: Google issues a NEW token and names
    // the one it replaces. Retire the old row so the user has one live sub.
    if (s.linkedPurchaseToken) {
      await client.query(
        `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
          WHERE stripe_subscription_id = $1 AND status <> 'expired'`,
        [googleSubId(s.linkedPurchaseToken)],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Acknowledge AFTER the grant is durable (an external call inside the tx
  // would hold a pool connection on Google's latency). Best-effort: the next
  // RTDN or restore re-runs this and Google only voids after 3 days.
  let acknowledged = s.acknowledged;
  if (!acknowledged && grantsAccess) {
    try {
      await play.acknowledgeSubscription(s.productId, purchaseToken);
      acknowledged = true;
    } catch (err) {
      console.error('[play] acknowledge failed:', err.message);
      Sentry.captureException?.(err, { tags: { area: 'payments', kind: 'play-ack' } });
    }
  }

  return { ...s, status, grantsAccess, alreadyCredited, acknowledged, plan: product.plan };
}

const mapSyncError = (err, res) => {
  switch (err.code) {
    case 'TOKEN_OWNED_BY_OTHER':
      return res.status(409).json({ error: 'Dieser Kauf gehört zu einem anderen JAMIE-Konto.', code: err.code });
    case 'PRODUCT_MISMATCH':
    case 'UNKNOWN_PRODUCT':
      return res.status(400).json({ error: 'Kauf passt nicht zum gewählten Produkt.', code: err.code });
    default:
      break;
  }
  // Google's answer about the token itself → the token is bad, not us.
  if (err.status === 400 || err.status === 404 || err.status === 410) {
    return res.status(400).json({ error: 'Kauf konnte nicht bestätigt werden.', code: 'PURCHASE_INVALID' });
  }
  // Our credentials are wrong → ops problem, surface loudly.
  if (err.status === 401 || err.status === 403) {
    console.error('[play] service account rejected:', err.message);
    Sentry.captureException?.(err, { tags: { area: 'payments', kind: 'play-auth' } });
    return res.status(503).json({ error: 'Google Play Billing ist serverseitig nicht konfiguriert.', code: 'PLAY_NOT_CONFIGURED' });
  }
  console.error('[play] sync failed:', err);
  return res.status(502).json({ error: 'Google Play ist gerade nicht erreichbar — bitte gleich noch einmal versuchen.', code: 'PLAY_UPSTREAM' });
};

/**
 * POST /api/iap/google/verify
 * Body: { product_id, purchase_token }
 */
export const verifyGoogle = async (req, res) => {
  // Server-side payments kill-switch (defense in depth — the route also
  // carries requirePayments).
  if (!paymentsEnabled()) {
    return res.status(403).json({ error: 'Zahlungen sind derzeit deaktiviert.', code: 'PAYMENTS_DISABLED' });
  }
  const { product_id, purchase_token } = req.body || {};
  if (!product_id || !purchase_token) {
    return res.status(400).json({ error: 'product_id and purchase_token required' });
  }
  if (!GOOGLE_PRODUCTS[product_id]) {
    return res.status(400).json({ error: 'Unknown product_id' });
  }
  if (typeof purchase_token !== 'string' || !PURCHASE_TOKEN_RE.test(purchase_token)) {
    return res.status(400).json({ error: 'Invalid purchase_token' });
  }
  if (!play.isGooglePlayConfigured()) {
    return res.status(503).json({ error: 'Google Play Billing ist serverseitig nicht konfiguriert.', code: 'PLAY_NOT_CONFIGURED' });
  }

  try {
    const r = await syncGoogleSubscription({
      userId: req.userId, purchaseToken: purchase_token, expectedProductId: product_id, source: 'verify',
    });
    if (r.status === 'pending') {
      // Deferred payment method (e.g. cash at a kiosk): Google will send an
      // RTDN when it clears. Recorded, not granted.
      return res.status(202).json({ ok: false, pending: true, status: 'pending' });
    }
    if (!r.grantsAccess) {
      return res.status(400).json({ error: 'Dieses Abo ist nicht aktiv.', code: 'PURCHASE_NOT_ACTIVE', status: r.status });
    }
    return res.json({
      ok: true,
      already_credited: r.alreadyCredited,
      is_pro: true,
      status: r.status,
      current_period_end: r.periodEnd,
      acknowledged: r.acknowledged,
    });
  } catch (err) {
    return mapSyncError(err, res);
  }
};

/**
 * POST /api/iap/google/restore
 * Body: { purchases: [{ product_id?, purchase_token }, ...] }  (Digital Goods
 * API `listPurchases()` output). Re-syncs each token; the same ownership +
 * dedup rules apply, so restoring can never double-grant or steal.
 */
export const restoreGoogle = async (req, res) => {
  if (!paymentsEnabled()) {
    return res.status(403).json({ error: 'Zahlungen sind derzeit deaktiviert.', code: 'PAYMENTS_DISABLED' });
  }
  const purchases = Array.isArray(req.body?.purchases) ? req.body.purchases.slice(0, MAX_RESTORE_BATCH) : [];
  if (!purchases.length) return res.json({ restored: 0, results: [] });
  if (!play.isGooglePlayConfigured()) {
    return res.status(503).json({ error: 'Google Play Billing ist serverseitig nicht konfiguriert.', code: 'PLAY_NOT_CONFIGURED' });
  }

  let restored = 0;
  const results = [];
  for (const p of purchases) {
    const token = p?.purchase_token;
    if (typeof token !== 'string' || !PURCHASE_TOKEN_RE.test(token)) {
      results.push({ ok: false, code: 'INVALID_TOKEN' });
      continue;
    }
    try {
      const r = await syncGoogleSubscription({
        userId: req.userId, purchaseToken: token,
        expectedProductId: GOOGLE_PRODUCTS[p.product_id] ? p.product_id : null,
        source: 'restore',
      });
      if (r.grantsAccess) restored++;
      results.push({ ok: r.grantsAccess, status: r.status, product_id: r.productId });
    } catch (err) {
      // One bad token must not sink the others; the user can retry.
      results.push({ ok: false, code: err.code || (err.status ? `PLAY_${err.status}` : 'SYNC_FAILED') });
    }
  }
  res.json({ restored, results });
};

/**
 * POST /api/iap/google/notifications — Real-time Developer Notifications.
 *
 * Pub/Sub push: any non-2xx is a NACK and Pub/Sub redelivers with backoff.
 * So: 200 for everything we consciously decide to drop (unknown token, test
 * ping, malformed envelope — redelivering garbage forever helps nobody),
 * 401 for failed auth (misconfiguration, must surface), 500 only for
 * transient failures we WANT retried (DB/Google hiccups).
 *
 * Mounted with express.raw() in server.js BEFORE express.json(), like the
 * Stripe/Apple webhooks — req.body is a Buffer.
 */
export const googleRtdn = async (req, res) => {
  const auth = await play.verifyPubSubPush(req);
  if (!auth.ok) {
    console.warn('[play-rtdn] rejected:', auth.reason);
    return res.status(auth.reason === 'rtdn-not-configured' ? 503 : 401).end();
  }

  let payload;
  try {
    ({ payload } = play.decodeRtdn(req.body));
  } catch (err) {
    console.error('[play-rtdn] undecodable envelope:', err.message);
    Sentry.captureMessage?.('play-rtdn undecodable envelope', { level: 'warning', extra: { message: err.message } });
    return res.status(200).end();
  }

  if (payload.packageName && payload.packageName !== play.getPackageName()) {
    console.warn('[play-rtdn] foreign packageName', payload.packageName);
    return res.status(200).end();
  }
  if (payload.testNotification) {
    console.log('[play-rtdn] test notification received ✓');
    return res.status(200).end();
  }

  try {
    if (payload.voidedPurchaseNotification?.purchaseToken) {
      // Refund / chargeback outside the subscription lifecycle: Pro is gone NOW.
      await db.query(
        `UPDATE subscriptions SET status = 'revoked', updated_at = NOW()
          WHERE stripe_subscription_id = $1`,
        [googleSubId(payload.voidedPurchaseNotification.purchaseToken)],
      );
      return res.status(200).end();
    }

    const sn = payload.subscriptionNotification;
    if (!sn?.purchaseToken) return res.status(200).end();

    const owner = await db.query(
      `SELECT user_id FROM iap_receipts
        WHERE platform = 'google' AND original_transaction_id = $1
        ORDER BY id ASC LIMIT 1`,
      [sn.purchaseToken],
    );
    if (!owner.rowCount) {
      // A purchase we never saw a verify call for (client died between the
      // Play sheet and our POST). Nothing to attach it to yet — the restore
      // path (listPurchases on next app open) binds it and later RTDNs match.
      console.warn('[play-rtdn] unknown purchaseToken, type', sn.notificationType, '— awaiting client restore');
      return res.status(200).end();
    }

    await syncGoogleSubscription({
      userId: owner.rows[0].user_id,
      purchaseToken: sn.purchaseToken,
      source: `rtdn:${sn.notificationType}`,
      forceStatus: sn.notificationType === play.RTDN_TYPE.REVOKED ? 'revoked' : null,
    });
    return res.status(200).end();
  } catch (err) {
    console.error('[play-rtdn] handler failed:', err);
    Sentry.captureException?.(err, { tags: { area: 'payments', kind: 'play-rtdn' } });
    return res.status(500).end();
  }
};
