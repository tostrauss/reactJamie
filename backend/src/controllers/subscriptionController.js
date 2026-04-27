import db from '../config/database.js';
import Stripe from 'stripe';

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
};

// ==========================================
// GET SUBSCRIPTION STATUS
// ==========================================
export const getStatus = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT status, current_period_end, stripe_subscription_id, stripe_customer_id
       FROM subscriptions WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
      [req.userId]
    );
    const sub = result.rows[0];
    const isActive =
      (sub?.status === 'active' || sub?.status === 'canceling') &&
      sub?.current_period_end &&
      new Date(sub.current_period_end) > new Date();

    res.json({
      is_pro: !!isActive,
      status: sub?.status || 'none',
      current_period_end: sub?.current_period_end || null,
    });
  } catch (err) {
    console.error('getStatus error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// CREATE SUBSCRIPTION (returns Stripe client_secret)
// ==========================================
export const createSubscription = async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  try {
    const userResult = await db.query(
      'SELECT email, name FROM users WHERE id = $1',
      [req.userId]
    );
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });
    const { email, name } = userResult.rows[0];

    // Check for existing active subscription
    const existingResult = await db.query(
      `SELECT stripe_customer_id, stripe_subscription_id, status
       FROM subscriptions WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
      [req.userId]
    );
    const existing = existingResult.rows[0];

    if (existing?.status === 'active' || existing?.status === 'canceling') {
      return res.status(400).json({ error: 'Bereits ein aktives Abonnement vorhanden' });
    }

    // Get or create Stripe customer
    let customerId = existing?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: { user_id: String(req.userId) },
      });
      customerId = customer.id;
    }

    // Cancel any stale incomplete/pending Stripe subscriptions to avoid orphans
    if (existing?.stripe_subscription_id && existing?.status === 'pending') {
      try {
        const staleSub = await stripe.subscriptions.retrieve(existing.stripe_subscription_id);
        if (staleSub.status === 'incomplete') {
          await stripe.subscriptions.cancel(existing.stripe_subscription_id);
        }
      } catch (_) { /* ignore — subscription may not exist in Stripe anymore */ }
    }

    // Create Stripe subscription (incomplete until payment confirmed)
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'JAMIE Pro' },
          unit_amount: 500, // 5.00 EUR
          recurring: { interval: 'month' },
        },
      }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    });

    // Upsert subscription record
    await db.query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (stripe_subscription_id) DO UPDATE
         SET status = 'pending', updated_at = NOW()`,
      [req.userId, customerId, subscription.id]
    );

    res.json({
      client_secret: subscription.latest_invoice.payment_intent.client_secret,
      subscription_id: subscription.id,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
    });
  } catch (err) {
    console.error('createSubscription error:', err);
    res.status(500).json({ error: 'Stripe error' });
  }
};

// ==========================================
// CANCEL SUBSCRIPTION (at period end)
// ==========================================
export const cancelSubscription = async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  try {
    const result = await db.query(
      `SELECT stripe_subscription_id FROM subscriptions
       WHERE user_id = $1 AND (status = 'active' OR status = 'canceling')
       ORDER BY id DESC LIMIT 1`,
      [req.userId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Kein aktives Abonnement gefunden' });
    }

    const { stripe_subscription_id } = result.rows[0];
    await stripe.subscriptions.update(stripe_subscription_id, { cancel_at_period_end: true });

    await db.query(
      `UPDATE subscriptions SET status = 'canceling', updated_at = NOW()
       WHERE stripe_subscription_id = $1`,
      [stripe_subscription_id]
    );

    res.json({ success: true, message: 'Abonnement wird zum Periodenende gekündigt' });
  } catch (err) {
    console.error('cancelSubscription error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// STRIPE WEBHOOK — handle subscription lifecycle
// ==========================================
export const subscriptionWebhook = async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).send('Stripe not configured');

  const secret = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;
  if (!secret) return res.status(503).send('Subscription webhook secret not configured');

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing stripe-signature header');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  try {
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
      const sub = event.data.object;
      let status = 'inactive';
      if (sub.status === 'active') status = sub.cancel_at_period_end ? 'canceling' : 'active';
      else if (sub.status === 'canceled') status = 'canceled';
      else if (sub.status === 'past_due') status = 'past_due';
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
      await db.query(
        `UPDATE subscriptions SET status = $1, current_period_end = $2, updated_at = NOW()
         WHERE stripe_subscription_id = $3`,
        [status, periodEnd, sub.id]
      );
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await db.query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
         WHERE stripe_subscription_id = $1`,
        [sub.id]
      );
    } else if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const stripeSub = await stripe.subscriptions.retrieve(invoice.subscription);
        const periodEnd = new Date(stripeSub.current_period_end * 1000);
        const status = stripeSub.cancel_at_period_end ? 'canceling' : 'active';
        await db.query(
          `UPDATE subscriptions SET status = $1, current_period_end = $2, updated_at = NOW()
           WHERE stripe_subscription_id = $3`,
          [status, periodEnd, invoice.subscription]
        );
      }
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      if (invoice.subscription) {
        await db.query(
          `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [invoice.subscription]
        );
      }
    }
  } catch (dbErr) {
    console.error('subscriptionWebhook DB error:', dbErr);
  }

  res.json({ received: true });
};

// ==========================================
// HELPER: check if a userId has active Pro
// ==========================================
export const isUserPro = async (userId) => {
  try {
    const result = await db.query(
      `SELECT id FROM subscriptions
       WHERE user_id = $1
         AND (status = 'active' OR status = 'canceling')
         AND current_period_end > NOW()
       LIMIT 1`,
      [userId]
    );
    return result.rows.length > 0;
  } catch (err) {
    if (err.code === '42P01') return false; // table doesn't exist yet (run subscriptions_migration.sql)
    throw err;
  }
};
