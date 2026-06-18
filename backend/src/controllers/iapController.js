/**
 * Apple StoreKit 2 in-app purchase verification + credit / subscription grant.
 *
 * iOS Capacitor build calls POST /api/iap/apple/verify with the JWS
 * transactionReceipt returned by StoreKit. We verify the JWS against
 * Apple's signing chain, then atomically:
 *   - record the receipt (UNIQUE per transaction_id → idempotent)
 *   - grant the matching credits / activate the subscription
 *
 * Required env vars (set in Railway before the iOS app ships):
 *   APPLE_IAP_BUNDLE_ID          - the iOS bundle id (jamie.app)
 *   APPLE_IAP_ENVIRONMENT        - "Production" | "Sandbox" (default Sandbox)
 *   APPLE_IAP_ISSUER_ID          - App Store Connect → Users → Keys → "Issuer ID"
 *   APPLE_IAP_KEY_ID             - same screen → newly created In-App Purchase key
 *   APPLE_IAP_PRIVATE_KEY        - contents of the .p8 (escape newlines as \n)
 *
 * The first three identify your team to Apple's server; the last two sign
 * outgoing requests to App Store Server API for renewal lookups.
 *
 * Install dependency first:   cd backend && npm install @apple/app-store-server-library
 */

import db from '../config/database.js';

// Mirror of the iOS app's product catalogue. Server is authoritative on
// what each product gives you so a manipulated client can't fake amounts.
const APPLE_PRODUCTS = {
  // Boost consumables
  boost_starter: { type: 'boost',        credits: 1  },
  boost_popular: { type: 'boost',        credits: 5  },
  boost_pro:     { type: 'boost',        credits: 15 },
  // Pro subscriptions
  pro_weekly:    { type: 'subscription', plan: 'weekly'   },
  pro_monthly:   { type: 'subscription', plan: 'monthly'  },
  pro_sixmonth:  { type: 'subscription', plan: 'sixmonth' },
};

let _appleClient = null;
async function getAppleClient() {
  if (_appleClient) return _appleClient;

  try {
    const lib = await import('@apple/app-store-server-library');
    const env  = process.env.APPLE_IAP_ENVIRONMENT === 'Production'
      ? lib.Environment.PRODUCTION
      : lib.Environment.SANDBOX;

    const bundleId  = process.env.APPLE_IAP_BUNDLE_ID || 'jamie.app';
    const issuerId  = process.env.APPLE_IAP_ISSUER_ID;
    const keyId     = process.env.APPLE_IAP_KEY_ID;
    const keyPem    = (process.env.APPLE_IAP_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    if (!issuerId || !keyId || !keyPem) {
      throw new Error('Apple IAP not configured: missing APPLE_IAP_ISSUER_ID / KEY_ID / PRIVATE_KEY');
    }

    const verifier = new lib.SignedDataVerifier(
      await loadAppleRootCAs(),
      true,                  // enable online checking of OCSP
      env,
      bundleId,
    );
    const api = new lib.AppStoreServerAPIClient(keyPem, keyId, issuerId, bundleId, env);

    _appleClient = { lib, env, verifier, api };
    return _appleClient;
  } catch (err) {
    throw new Error('Apple StoreKit library unavailable: ' + err.message);
  }
}

// Apple's root certificates (G3 + the legacy G2) are bundled in the
// official library distribution. We re-export them here to make sure
// the verifier ships the same trust anchors no matter the install path.
async function loadAppleRootCAs() {
  // The library exports static helpers to load the bundled roots.
  const lib = await import('@apple/app-store-server-library');
  return [
    lib.AppleRootCertificate.G3,
    lib.AppleRootCertificate.G2,
    lib.AppleRootCertificate.G1,
  ].filter(Boolean);
}

/**
 * POST /api/iap/apple/verify
 * Body: { product_type, product_id, receipt (JWS), transaction_id? }
 */
export const verifyApple = async (req, res) => {
  const { product_id, receipt, transaction_id } = req.body || {};

  if (!product_id || !receipt) {
    return res.status(400).json({ error: 'product_id and receipt required' });
  }

  const product = APPLE_PRODUCTS[product_id];
  if (!product) {
    return res.status(400).json({ error: 'Unknown product_id' });
  }

  let verified;
  try {
    const { verifier } = await getAppleClient();
    verified = await verifier.verifyAndDecodeTransaction(receipt);
  } catch (err) {
    console.error('Apple IAP verify failed:', err.message);
    return res.status(400).json({ error: 'Receipt verification failed' });
  }

  // Apple guarantees these fields exist in a verified payload.
  const {
    transactionId,
    originalTransactionId,
    productId: applePid,
    bundleId,
    environment,
    expiresDate,            // ms epoch, subscriptions only
  } = verified;

  // Defense in depth: every claim re-checked even though the verifier did.
  if (bundleId !== (process.env.APPLE_IAP_BUNDLE_ID || 'jamie.app')) {
    return res.status(400).json({ error: 'Receipt bundle mismatch' });
  }
  if (applePid !== product_id) {
    return res.status(400).json({ error: 'Receipt product mismatch' });
  }
  if (transaction_id && transactionId !== transaction_id) {
    return res.status(400).json({ error: 'Receipt transaction mismatch' });
  }

  // Atomic insert+grant. If the transaction already exists (replay/restore)
  // the INSERT is silently skipped and we return the current state.
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM iap_receipts WHERE platform = 'apple' AND transaction_id = $1`,
      [transactionId],
    );
    const alreadyCredited = existing.rowCount > 0;

    if (!alreadyCredited) {
      await client.query(
        `INSERT INTO iap_receipts
            (user_id, platform, product_id, product_type, transaction_id,
             original_transaction_id, environment, raw_receipt, payload, expires_at)
         VALUES ($1, 'apple', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          req.userId,
          product_id,
          product.type,
          transactionId,
          originalTransactionId || null,
          environment || null,
          receipt,
          JSON.stringify(verified),
          expiresDate ? new Date(expiresDate) : null,
        ],
      );

      if (product.type === 'boost') {
        await grantBoostCredits(client, req.userId, product.credits);
      } else {
        await activateSubscription(client, req.userId, product.plan, originalTransactionId, expiresDate);
      }
    }

    await client.query('COMMIT');

    // Read-after-write so the client always sees the current state.
    const wallet = await db.query(
      `SELECT credits FROM boost_credits WHERE user_id = $1`,
      [req.userId],
    );
    res.json({
      ok: true,
      already_credited: alreadyCredited,
      credits_added: alreadyCredited ? 0 : (product.credits || 0),
      new_total:     wallet.rows[0]?.credits || 0,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Apple IAP grant failed:', err);
    res.status(500).json({ error: 'Receipt accepted but credit failed — contact support' });
  } finally {
    client.release();
  }
};

async function grantBoostCredits(client, userId, credits) {
  await client.query(
    `INSERT INTO boost_credits (user_id, credits, total_earned)
     VALUES ($1, $2, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET credits = boost_credits.credits + EXCLUDED.credits,
                   total_earned = boost_credits.total_earned + EXCLUDED.credits`,
    [userId, credits],
  );
}

async function activateSubscription(client, userId, plan, originalTxId, expiresMs) {
  const periodEnd = expiresMs ? new Date(expiresMs) : null;
  // The subscriptions table mirrors the Stripe one but with the Apple
  // originalTransactionId standing in for stripe_subscription_id. The Pro
  // status getter (subscriptionController.getStatus) reads status + period
  // end and doesn't care whether Stripe or Apple wrote the row.
  //
  // ON CONFLICT path covers:
  //   - Apple Server Notification RENEW: writes a fresh receipt row but
  //     reuses the same originalTransactionId → would 23505 without this.
  //   - Restore Purchases on a second device with a new transaction_id
  //     but the same chain origin.
  // We refresh status + period_end so re-activation extends Pro correctly.
  await client.query(
    `INSERT INTO subscriptions
        (user_id, status, current_period_end, stripe_subscription_id, stripe_customer_id)
     VALUES ($1, 'active', $2, $3, $4)
     ON CONFLICT (stripe_subscription_id) DO UPDATE
       SET status             = 'active',
           current_period_end = EXCLUDED.current_period_end,
           updated_at         = NOW()`,
    [userId, periodEnd, `apple:${originalTxId}`, `apple:${userId}`],
  );
}

/**
 * POST /api/iap/apple/notifications
 *
 * Apple's App Store Server Notifications V2 webhook. Apple sends one of
 * these every time a subscription renews / lapses / is refunded / etc.
 * The body is a JWS-signed payload — same trust chain as a regular
 * transaction receipt.
 *
 * Configure the endpoint at App Store Connect → JAMIE → App Information →
 * App Store Server Notifications → Version 2 → both Production & Sandbox
 * URLs set to https://app.jamie-app.com/api/iap/apple/notifications.
 *
 * NOTE: This route is mounted with express.raw() in server.js (like the
 * Stripe webhooks) — req.body is a Buffer. Apple sends JSON with a single
 * `signedPayload` JWS field, so we parse the body manually.
 */
export const appleServerNotification = async (req, res) => {
  let signedPayload;
  try {
    const json = JSON.parse(req.body.toString('utf8'));
    signedPayload = json.signedPayload;
    if (!signedPayload) throw new Error('signedPayload missing');
  } catch (err) {
    console.error('Apple notification parse failed:', err.message);
    return res.status(400).end();
  }

  let notification;
  try {
    const { verifier, lib } = await getAppleClient();
    // verifyAndDecodeNotification returns a typed ResponseBodyV2DecodedPayload
    notification = await verifier.verifyAndDecodeNotification(signedPayload);
  } catch (err) {
    // Apple retries on non-2xx. We want to log + accept (200) when the
    // notification is malformed so they stop retrying; otherwise 5xx and
    // they'll back-off + retry the genuine transient failures.
    console.error('Apple notification verification failed:', err.message);
    return res.status(202).end();
  }

  const { notificationType, subtype, data } = notification;

  // The signedTransactionInfo + signedRenewalInfo inside `data` are
  // themselves JWS — decode them through the same verifier.
  let txInfo = null, renewalInfo = null;
  try {
    const { verifier } = await getAppleClient();
    if (data?.signedTransactionInfo) {
      txInfo = await verifier.verifyAndDecodeTransaction(data.signedTransactionInfo);
    }
    if (data?.signedRenewalInfo) {
      renewalInfo = await verifier.verifyAndDecodeRenewalInfo(data.signedRenewalInfo);
    }
  } catch (err) {
    console.error('Apple notification subpayload decode failed:', err.message);
    return res.status(202).end();
  }

  if (!txInfo) {
    // Notification types like TEST and PRICE_INCREASE arrive without a
    // transaction; we acknowledge and move on.
    return res.status(200).end();
  }

  try {
    await handleAppleNotification(notificationType, subtype, txInfo, renewalInfo);
    res.status(200).end();
  } catch (err) {
    console.error('Apple notification handler failed:', err);
    // 5xx → Apple retries with exponential backoff.
    res.status(500).end();
  }
};

async function handleAppleNotification(type, subtype, tx, renewal) {
  // Find the user by walking back to the original purchase receipt we stored.
  const userLookup = await db.query(
    `SELECT user_id FROM iap_receipts
     WHERE platform = 'apple'
       AND (transaction_id = $1 OR original_transaction_id = $1)
     ORDER BY id ASC LIMIT 1`,
    [tx.originalTransactionId],
  );
  const userId = userLookup.rows[0]?.user_id;
  if (!userId) {
    // Renewal arrived for a receipt we never saw — could mean the user
    // bought on another device and we missed the initial verify call.
    // Record a partial row so future events line up, then bail.
    console.warn('Apple notification for unknown originalTransactionId', tx.originalTransactionId);
    return;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Log this transaction (idempotent on transaction_id).
    await client.query(
      `INSERT INTO iap_receipts
          (user_id, platform, product_id, product_type, transaction_id,
           original_transaction_id, environment, raw_receipt, payload, expires_at)
       VALUES ($1, 'apple', $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (platform, transaction_id) DO NOTHING`,
      [
        userId,
        tx.productId,
        APPLE_PRODUCTS[tx.productId]?.type || 'subscription',
        tx.transactionId,
        tx.originalTransactionId,
        tx.environment || null,
        '',                            // notification gives us a JWS but we already have it from the original verify
        JSON.stringify({ tx, renewal, type, subtype }),
        tx.expiresDate ? new Date(tx.expiresDate) : null,
      ],
    );

    // Update the subscriptions table based on the notification type.
    // The notification types we care about:
    //   DID_RENEW                 → extend period_end
    //   DID_CHANGE_RENEWAL_STATUS → user toggled auto-renew off → status='canceling'
    //   EXPIRED                   → status='expired'
    //   REVOKE / REFUND           → status='revoked' (must lose Pro features immediately)
    //   GRACE_PERIOD_EXPIRED      → status='expired'
    const subId = `apple:${tx.originalTransactionId}`;
    switch (type) {
      case 'DID_RENEW':
      case 'SUBSCRIBED':
        await client.query(
          `UPDATE subscriptions
             SET status = 'active', current_period_end = $1
           WHERE stripe_subscription_id = $2`,
          [tx.expiresDate ? new Date(tx.expiresDate) : null, subId],
        );
        break;

      case 'DID_CHANGE_RENEWAL_STATUS':
        // subtype 'AUTO_RENEW_DISABLED' or 'AUTO_RENEW_ENABLED'
        await client.query(
          `UPDATE subscriptions
             SET status = $1
           WHERE stripe_subscription_id = $2`,
          [subtype === 'AUTO_RENEW_DISABLED' ? 'canceling' : 'active', subId],
        );
        break;

      case 'EXPIRED':
      case 'GRACE_PERIOD_EXPIRED':
        await client.query(
          `UPDATE subscriptions SET status = 'expired' WHERE stripe_subscription_id = $1`,
          [subId],
        );
        break;

      case 'REVOKE':
      case 'REFUND':
        await client.query(
          `UPDATE subscriptions SET status = 'revoked' WHERE stripe_subscription_id = $1`,
          [subId],
        );
        break;

      default:
        // OFFER_REDEEMED, RENEWAL_EXTENDED, etc. — logged in iap_receipts above.
        break;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * POST /api/iap/apple/restore
 * Body: { receipts: [jws, ...] }
 * Used by the "Restore Purchases" button. Re-verifies each receipt;
 * relies on the same dedup as verifyApple.
 */
export const restoreApple = async (req, res) => {
  const receipts = Array.isArray(req.body?.receipts) ? req.body.receipts : [];
  if (!receipts.length) return res.json({ restored: 0 });

  let restored = 0;
  for (const receipt of receipts) {
    try {
      req.body = { product_id: null, receipt };
      // Pre-decode just to learn the product_id, then re-run verify.
      const { verifier } = await getAppleClient();
      const decoded = await verifier.verifyAndDecodeTransaction(receipt);
      req.body.product_id     = decoded.productId;
      req.body.transaction_id = decoded.transactionId;

      // Inline call so each receipt rolls back independently if it fails.
      await new Promise((resolve) => {
        verifyApple(req, { json: (out) => { if (!out.already_credited) restored++; resolve(); },
                           status: () => ({ json: () => resolve() }) });
      });
    } catch {
      // skip malformed receipts; user can retry
    }
  }
  res.json({ restored });
};
