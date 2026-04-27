import db from '../config/database.js';
import Stripe from 'stripe';
import crypto from 'crypto';
import { isUserPro } from './subscriptionController.js';

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

  try {
    // Check if user has active Pro subscription (free boosts)
    const isPro = await isUserPro(req.userId);

    if (!isPro) {
      // Check credit balance
      const balanceRes = await db.query(
        'SELECT credits FROM boost_credits WHERE user_id = $1',
        [req.userId]
      );
      const credits = balanceRes.rows[0]?.credits || 0;
      if (credits < 1) {
        return res.status(402).json({ error: 'Nicht genug Boost-Credits. Kaufe Credits oder werde JAMIE Pro für kostenlose Boosts.' });
      }
    }

    // Verify ownership
    const ownerRes = await db.query(
      `SELECT owner_id FROM groups WHERE id = $1 AND type = $2`,
      [target_id, target_type]
    );
    if (!ownerRes.rows.length || ownerRes.rows[0].owner_id !== req.userId) {
      return res.status(403).json({ error: 'Du kannst nur deine eigenen Gruppen/Clubs boosten' });
    }

    const boostedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);

    await db.query('BEGIN');
    if (!isPro) {
      // Deduct credit (Pro users boost for free)
      await db.query(
        'UPDATE boost_credits SET credits = credits - 1 WHERE user_id = $1',
        [req.userId]
      );
    }
    // Insert boost
    await db.query(
      `INSERT INTO boosts (user_id, target_type, target_id, credits_spent, boosted_until)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.userId, target_type, target_id, isPro ? 0 : 1, boostedUntil]
    );
    await db.query('COMMIT');

    res.json({ success: true, boosted_until: boostedUntil, pro_boost: isPro });
  } catch (err) {
    await db.query('ROLLBACK').catch((rbErr) => console.error('ROLLBACK failed:', rbErr));
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
    res.status(500).json({ error: 'Stripe error' });
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
// CREATE PAYPAL ORDER
// ==========================================
export const createPaypalOrder = async (req, res) => {
  const { package_id } = req.body;
  const pkg = BOOST_PACKAGES.find(p => p.id === package_id);
  if (!pkg) return res.status(400).json({ error: 'Invalid package' });

  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'PayPal not configured' });
  }

  try {
    // Get PayPal access token
    const tokenRes = await fetch(paypalUrl('/v1/oauth2/token'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    const { access_token } = await tokenRes.json();

    // Create order
    const orderRes = await fetch(paypalUrl('/v2/checkout/orders'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'EUR', value: (pkg.amount_cents / 100).toFixed(2) },
          description: `JAMIE ${pkg.label}`,
          custom_id: `${req.userId}:${pkg.id}:${pkg.credits}`,
        }],
      }),
    });
    const order = await orderRes.json();

    // Record pending transaction
    await db.query(
      `INSERT INTO boost_transactions (user_id, credits, amount_cents, payment_provider, payment_id, status)
       VALUES ($1, $2, $3, 'paypal', $4, 'pending')`,
      [req.userId, pkg.credits, pkg.amount_cents, order.id]
    );

    res.json({ order_id: order.id });
  } catch (err) {
    console.error('createPaypalOrder error:', err);
    res.status(500).json({ error: 'PayPal error' });
  }
};

// ==========================================
// CAPTURE PAYPAL ORDER (called after user approves)
// ==========================================
export const capturePaypalOrder = async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;

  try {
    const tokenRes = await fetch(paypalUrl('/v1/oauth2/token'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    const { access_token } = await tokenRes.json();

    const captureRes = await fetch(paypalUrl(`/v2/checkout/orders/${order_id}/capture`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
    });
    const capture = await captureRes.json();

    if (capture.status === 'COMPLETED') {
      const customId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id || '';
      const [userId, , creditsStr] = customId.split(':');
      const credits = parseInt(creditsStr) || 0;

      await creditUser(parseInt(userId), credits, 'paypal', order_id);
      res.json({ success: true, credits });
    } else {
      res.status(400).json({ error: 'Payment not completed', status: capture.status });
    }
  } catch (err) {
    console.error('capturePaypalOrder error:', err);
    res.status(500).json({ error: 'PayPal capture error' });
  }
};

// ==========================================
// HELPERS
// ==========================================
function paypalUrl(path) {
  const base = process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
  return `${base}${path}`;
}

async function creditUser(userId, credits, provider, paymentId) {
  await db.query('BEGIN');
  try {
    await db.query(
      `INSERT INTO boost_credits (user_id, credits, total_earned)
       VALUES ($1, $2, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET credits = boost_credits.credits + $2,
             total_earned = boost_credits.total_earned + $2`,
      [userId, credits]
    );
    await db.query(
      `UPDATE boost_transactions SET status = 'completed'
       WHERE payment_provider = $1 AND payment_id = $2`,
      [provider, paymentId]
    );
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

async function generateUniqueCode(userId) {
  // Generate a short memorable code like JAMIE-X7K2
  let attempts = 0;
  while (attempts < 10) {
    const code = 'JAMIE-' + crypto.randomBytes(3).toString('hex').toUpperCase();
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

    await db.query('BEGIN');
    // Credit both users
    await creditUser(req.userId, 1, 'referral', `ref_${ownerId}_to_${req.userId}`);
    await creditUser(ownerId, 1, 'referral', `ref_${ownerId}_invited_${req.userId}`);
    // Increment used_count
    await db.query(
      'UPDATE referral_codes SET used_count = used_count + 1 WHERE user_id = $1',
      [ownerId]
    );
    await db.query('COMMIT');

    res.json({ success: true, message: 'Code eingelöst! +1 Boost-Credit' });
  } catch (err) {
    await db.query('ROLLBACK').catch((rbErr) => console.error('ROLLBACK failed:', rbErr));
    console.error('redeemReferral error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
