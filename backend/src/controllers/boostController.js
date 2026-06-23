import db from '../config/database.js';
import Stripe from 'stripe';
import crypto from 'crypto';
import { isUserPro } from './subscriptionController.js';
import { invalidatePrefix } from '../utils/cache.js';

// Execute a function inside a real DB transaction on a single dedicated connection.
// This is required because db.query() pulls from a pool — consecutive calls may land
// on different connections, making BEGIN/COMMIT on the pool object completely useless.
async function withTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Lazy-init Stripe (only when key is set)
const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
};

// ==========================================
// BOOST PACKAGES
// ==========================================
export const BOOST_PACKAGES = [
  { id: 'starter',  credits: 1,  amount_cents: 199,  label: '1 Boost',   description: '24h Top-Platzierung' },
  { id: 'popular',  credits: 5,  amount_cents: 799,  label: '5 Boost',   description: 'Beste Preis-Leistung' },
  { id: 'pro',      credits: 15, amount_cents: 1999, label: '15 Boost',  description: 'Maximale Sichtbarkeit' },
];

// ==========================================
// WIDERRUF-ELIGIBLE BOOST PURCHASES
// ==========================================
// Lists the caller's Stripe boost purchases that are still within the 14-day
// right-of-withdrawal window AND whose credits are unused. Tina's rule: once a
// boost is redeemed (applied), the purchase can no longer be withdrawn. We
// approximate "unredeemed" by requiring the wallet to still hold at least the
// purchased amount of credits. Apple/IAP purchases are excluded — those refund
// through the App Store, not us. Drives the "Widerruf erklären" buttons in
// Settings → Boost-Käufe (email-request flow, processed manually).
const BOOST_WITHDRAWAL_WINDOW_DAYS = 14;
export const getPurchases = async (req, res) => {
  try {
    const [txRes, balRes] = await Promise.all([
      db.query(
        `SELECT id, credits, amount_cents, payment_id, created_at
         FROM boost_transactions
         WHERE user_id = $1
           AND status = 'completed'
           AND payment_provider = 'stripe'
           AND created_at >= NOW() - make_interval(days => $2)
         ORDER BY created_at DESC`,
        [req.userId, BOOST_WITHDRAWAL_WINDOW_DAYS]
      ),
      db.query('SELECT credits FROM boost_credits WHERE user_id = $1', [req.userId]),
    ]);
    const balance = balRes.rows[0]?.credits ?? 0;
    const purchases = txRes.rows
      .filter(t => balance >= t.credits)
      .map(t => ({
        id: t.id,
        credits: t.credits,
        amount_cents: t.amount_cents,
        payment_id: t.payment_id,
        created_at: t.created_at,
      }));
    res.json(purchases);
  } catch (err) {
    console.error('getPurchases error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// GET CREDIT BALANCE
// ==========================================
export const getCredits = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT credits, total_earned FROM boost_credits WHERE user_id = $1`,
      [req.userId]
    );
    const row = result.rows[0] || { credits: 0, total_earned: 0 };

    // Get referral code (create if missing)
    let codeResult = await db.query(
      'SELECT code, used_count FROM referral_codes WHERE user_id = $1',
      [req.userId]
    );
    let referralCode = codeResult.rows[0]?.code || null;
    let referralUsed = codeResult.rows[0]?.used_count || 0;
    if (!referralCode) {
      referralCode = await generateUniqueCode(req.userId);
    }

    res.json({
      credits: row.credits,
      total_earned: row.total_earned,
      referral_code: referralCode,
      referral_used: referralUsed,
    });
  } catch (err) {
    console.error('getCredits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// LIST PACKAGES
// ==========================================
export const getPackages = (_req, res) => {
  res.json(BOOST_PACKAGES);
};

// ==========================================
// APPLY BOOST TO A GROUP / CLUB
// ==========================================
export const applyBoost = async (req, res) => {
  const { target_type, target_id, hours = 24 } = req.body;
  if (!target_type || !target_id) {
    return res.status(400).json({ error: 'target_type and target_id required' });
  }
  if (!['group', 'club'].includes(target_type)) {
    return res.status(400).json({ error: 'target_type must be group or club' });
  }
  // Validate & clamp client-supplied duration: one credit buys at most 24h.
  // Without this a user could send hours=100000 for an ~11-year boost.
  const hoursNum = Number(hours);
  if (!Number.isFinite(hoursNum) || hoursNum <= 0 || hoursNum > 24) {
    return res.status(400).json({ error: 'hours must be a number between 1 and 24' });
  }

  try {
    // Verify ownership first (cheap check, no lock needed)
    const ownerRes = await db.query(
      `SELECT owner_id FROM groups WHERE id = $1 AND type = $2`,
      [target_id, target_type]
    );
    if (!ownerRes.rows.length || Number(ownerRes.rows[0].owner_id) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Du kannst nur deine eigenen Gruppen/Clubs boosten' });
    }

    const isPro = await isUserPro(req.userId);
    const boostedUntil = new Date(Date.now() + hoursNum * 60 * 60 * 1000);

    await withTransaction(async (client) => {
      if (!isPro) {
        // Lock the row and re-check balance atomically — prevents race conditions
        const balanceRes = await client.query(
          'SELECT credits FROM boost_credits WHERE user_id = $1 FOR UPDATE',
          [req.userId]
        );
        const credits = balanceRes.rows[0]?.credits || 0;
        if (credits < 1) {
          const err = new Error('INSUFFICIENT_CREDITS');
          err.status = 402;
          throw err;
        }
        await client.query(
          'UPDATE boost_credits SET credits = credits - 1 WHERE user_id = $1',
          [req.userId]
        );
      }
      await client.query(
        `INSERT INTO boosts (user_id, target_type, target_id, credits_spent, boosted_until)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.userId, target_type, target_id, isPro ? 0 : 1, boostedUntil]
      );
    });

    // Drop the feed caches so the new top-placement appears immediately
    // instead of after the 30s TTL (both group + club feeds are cached).
    invalidatePrefix('groups:');
    invalidatePrefix('clubs:');

    res.json({ success: true, boosted_until: boostedUntil, pro_boost: isPro });
  } catch (err) {
    if (err.message === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ error: 'Nicht genug Boost-Credits. Kaufe Credits oder werde JAMIE Pro für kostenlose Boosts.' });
    }
    console.error('applyBoost error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// CREATE STRIPE PAYMENT INTENT
// ==========================================
export const createStripeIntent = async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const { package_id } = req.body;
  const pkg = BOOST_PACKAGES.find(p => p.id === package_id);
  if (!pkg) return res.status(400).json({ error: 'Invalid package' });

  try {
    const intent = await stripe.paymentIntents.create({
      amount: pkg.amount_cents,
      currency: 'eur',
      metadata: { user_id: String(req.userId), package_id, credits: String(pkg.credits) },
      automatic_payment_methods: { enabled: true },
    });

    // Record pending transaction
    await db.query(
      `INSERT INTO boost_transactions (user_id, credits, amount_cents, payment_provider, payment_id, status)
       VALUES ($1, $2, $3, 'stripe', $4, 'pending')`,
      [req.userId, pkg.credits, pkg.amount_cents, intent.id]
    );

    res.json({ client_secret: intent.client_secret, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY });
  } catch (err) {
    console.error('createStripeIntent error:', err);
    res.status(500).json({ error: 'Zahlung fehlgeschlagen' });
  }
};

// ==========================================
// STRIPE WEBHOOK — confirm payment & credit wallet
// ==========================================
export const stripeWebhook = async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).send('Stripe not configured');

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(503).send('Webhook secret not configured');

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing stripe-signature header');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const userId = parseInt(intent.metadata.user_id);
    const credits = parseInt(intent.metadata.credits);
    if (!isNaN(userId) && !isNaN(credits) && credits > 0) {
      try {
        await creditUser(userId, credits, 'stripe', intent.id);
      } catch (err) {
        console.error('creditUser failed in stripeWebhook:', err);
        // Return 200 to prevent Stripe from retrying — log to monitor instead
      }
    }
  }

  res.json({ received: true });
};

// ==========================================
// HELPERS
// ==========================================
// Core wallet credit — must run on a dedicated transaction client.
// Idempotent: only credits if the transaction is still in 'pending' state.
// Stripe retries webhooks on any 5xx/timeout, so without this guard a single
// payment could credit the wallet multiple times.
async function _creditUserInTx(client, userId, credits, provider, paymentId) {
  // Atomically flip pending → completed; UPDATE only succeeds on the first call.
  const claim = await client.query(
    `UPDATE boost_transactions SET status = 'completed'
     WHERE payment_provider = $1 AND payment_id = $2 AND status = 'pending'
     RETURNING user_id, credits`,
    [provider, paymentId]
  );
  if (claim.rowCount === 0) {
    // Already credited (replay) — no-op, return silently.
    return { credited: false };
  }
  // Use the txn's recorded user_id/credits — never trust caller-supplied values
  // for the actual credit amount. Protects against metadata tampering even
  // though we generated it ourselves.
  const txnUserId  = claim.rows[0].user_id;
  const txnCredits = claim.rows[0].credits;
  if (txnUserId !== userId) {
    // user_id mismatch — refuse to credit. Caller's user_id should match the txn.
    throw new Error('PAYMENT_USER_MISMATCH');
  }
  await client.query(
    `INSERT INTO boost_credits (user_id, credits, total_earned)
     VALUES ($1, $2, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET credits = boost_credits.credits + $2,
           total_earned = boost_credits.total_earned + $2`,
    [txnUserId, txnCredits]
  );
  return { credited: true };
}

// Public helper for callers that don't have an outer transaction
async function creditUser(userId, credits, provider, paymentId) {
  return withTransaction((client) => _creditUserInTx(client, userId, credits, provider, paymentId));
}

async function generateUniqueCode(userId) {
  // Generate a short memorable code like JAMIE-X7K2
  let attempts = 0;
  while (attempts < 10) {
    const code = 'JAMIE-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    try {
      await db.query(
        'INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)',
        [userId, code]
      );
      return code;
    } catch {
      attempts++;
    }
  }
  throw new Error('Could not generate unique referral code');
}

// ==========================================
// REDEEM REFERRAL CODE
// ==========================================
export const redeemReferral = async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });

  try {
    // Find code owner
    const codeRes = await db.query(
      'SELECT user_id FROM referral_codes WHERE UPPER(code) = UPPER($1)',
      [code]
    );
    if (!codeRes.rows.length) return res.status(404).json({ error: 'Code nicht gefunden' });

    const ownerId = codeRes.rows[0].user_id;
    if (ownerId === req.userId) return res.status(400).json({ error: 'Eigener Code nicht einlösbar' });

    // Check if already redeemed
    const alreadyRes = await db.query(
      `SELECT id FROM boost_transactions WHERE user_id = $1 AND payment_provider = 'referral'`,
      [req.userId]
    );
    if (alreadyRes.rows.length) return res.status(400).json({ error: 'Bereits eingelöst' });

    await withTransaction(async (client) => {
      // Insert pending transaction records first so the UNIQUE constraint on payment_id
      // prevents double-crediting even under concurrent requests
      await client.query(
        `INSERT INTO boost_transactions (user_id, credits, amount_cents, payment_provider, payment_id, status)
         VALUES ($1, 1, 0, 'referral', $2, 'pending')`,
        [req.userId, `ref_${ownerId}_to_${req.userId}`]
      );
      await client.query(
        `INSERT INTO boost_transactions (user_id, credits, amount_cents, payment_provider, payment_id, status)
         VALUES ($1, 1, 0, 'referral', $2, 'pending')`,
        [ownerId, `ref_${ownerId}_invited_${req.userId}`]
      );
      await _creditUserInTx(client, req.userId, 1, 'referral', `ref_${ownerId}_to_${req.userId}`);
      await _creditUserInTx(client, ownerId, 1, 'referral', `ref_${ownerId}_invited_${req.userId}`);
      await client.query(
        'UPDATE referral_codes SET used_count = used_count + 1 WHERE user_id = $1',
        [ownerId]
      );
    });

    res.json({ success: true, message: 'Code eingelöst! +1 Boost-Credit' });
  } catch (err) {
    if (err.code === '23505') { // unique_violation — already redeemed
      return res.status(400).json({ error: 'Bereits eingelöst' });
    }
    console.error('redeemReferral error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
