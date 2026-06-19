import db from '../config/database.js';
import Stripe from 'stripe';

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
};

// ==========================================
// PRO PLAN CATALOG (server is authoritative on price)
// ==========================================
// Hinge-style tiered pricing (repriced 2026-06-11, prev. Tina's 2026-06-04 spec):
//   • weekly  — 4,99 €/Woche, baseline (no discount)
//   • monthly — 14,99 €/Monat → 3,46 €/Woche, "31% sparen", DEFAULT + "Beliebt"
//   • sixmonth— 29,99 €/6 Monate → 1,15 €/Woche, "77% sparen", "Bestes Angebot"
// Per-week headlines derived so they stay honest:
//   weekly 4,99/1wk · monthly 14,99/4.33wk=3,46 · 6mo 29,99/26wk=1,15.
// amount_cents is the ONLY price the client can't influence — the request
// just names a plan key; we look up the amount here.
export const PRO_PLANS = {
  weekly:   { amount_cents: 499,  interval: 'week',  interval_count: 1, label: 'JAMIE Pro – Wöchentlich' },
  monthly:  { amount_cents: 1499, interval: 'month', interval_count: 1, label: 'JAMIE Pro – Monatlich' },
  sixmonth: { amount_cents: 2999, interval: 'month', interval_count: 6, label: 'JAMIE Pro – 6 Monate' },
};
const DEFAULT_PLAN = 'monthly';

// 14-day right of withdrawal (Widerruf — FAGG § 11, Variante A). Used by
// getStatus (button visibility) AND withdrawSubscription (server-side enforce).
const WITHDRAWAL_WINDOW_DAYS = 14;
const WITHDRAWAL_WINDOW_MS = WITHDRAWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// ==========================================
// GET SUBSCRIPTION STATUS
// ==========================================
export const getStatus = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT status, current_period_end, created_at, stripe_subscription_id, stripe_customer_id
       FROM subscriptions WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
      [req.userId]
    );
    const sub = result.rows[0];
    const isActive =
      (sub?.status === 'active' || sub?.status === 'canceling') &&
      sub?.current_period_end &&
      new Date(sub.current_period_end) > new Date();

    // 14-day Widerruf eligibility (Variante A): within the window of the original
    // sign-up AND Stripe-billed (Apple IAP refunds go through the App Store).
    // The withdraw endpoint re-checks this — the flag only drives button visibility.
    const isAppleManaged = !!sub?.stripe_customer_id?.startsWith?.('apple:');
    const withinWindow = !!sub?.created_at &&
      (Date.now() - new Date(sub.created_at).getTime()) <= WITHDRAWAL_WINDOW_MS;

    res.json({
      is_pro: !!isActive,
      status: sub?.status || 'none',
      current_period_end: sub?.current_period_end || null,
      withdrawal_eligible: !!isActive && !isAppleManaged && withinWindow,
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

  // Resolve the requested plan against the server-side catalog. Unknown /
  // missing plan falls back to the default monthly tier rather than erroring.
  const planKey = (typeof req.body?.plan === 'string' && PRO_PLANS[req.body.plan])
    ? req.body.plan
    : DEFAULT_PLAN;
  const plan = PRO_PLANS[planKey];

  try {
    const userResult = await db.query(
      'SELECT email, name FROM users WHERE id = $1',
      [req.userId]
    );
    if (!userResult.rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
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

    // Create Stripe subscription (incomplete until payment confirmed).
    // price_data is built from the server-side catalog entry so the client
    // can never dictate the charged amount or billing cadence.
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: plan.label },
          unit_amount: plan.amount_cents,
          recurring: { interval: plan.interval, interval_count: plan.interval_count },
        },
      }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { user_id: String(req.userId), plan: planKey },
    });

    // Upsert subscription record
    await db.query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (stripe_subscription_id) DO UPDATE
         SET status = 'pending', updated_at = NOW()`,
      [req.userId, customerId, subscription.id]
    );

    const clientSecret = subscription.latest_invoice?.payment_intent?.client_secret ?? null;
    if (!clientSecret) {
      console.error('createSubscription: missing client_secret on Stripe response', subscription.id);
      return res.status(500).json({ error: 'Stripe returned an incomplete payment intent' });
    }

    res.json({
      client_secret: clientSecret,
      subscription_id: subscription.id,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
    });
  } catch (err) {
    console.error('createSubscription error:', err);
    res.status(500).json({ error: 'Stripe error' });
  }
};

// ==========================================
// CREATE BILLING PORTAL SESSION
// ==========================================
// Returns a short-lived Stripe Billing Portal URL so a Pro user can manage
// or cancel their subscription, update payment method, view invoices, etc.
// Web + Android only — iOS users manage their subscription via the App Store
// (Apple Guideline 3.1.1), the frontend hides this button on isNativeIOS().
//
// Why a server-side endpoint rather than a client-side hosted link:
// the portal needs to be tied to a specific Stripe customer_id, and we
// don't trust the client to send the right one.
export const createPortalSession = async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  try {
    // Pull the most recent customer id for this user. Apple-only subscribers
    // have stripe_customer_id = `apple:<userId>` — those don't correspond to
    // a real Stripe customer and the portal call would fail, so reject early
    // with a hint to use App Store settings instead.
    const result = await db.query(
      `SELECT stripe_customer_id, stripe_subscription_id, status
       FROM subscriptions
       WHERE user_id = $1
       ORDER BY id DESC LIMIT 1`,
      [req.userId]
    );
    const sub = result.rows[0];
    if (!sub) return res.status(404).json({ error: 'Kein Abonnement gefunden' });
    if (!sub.stripe_customer_id || sub.stripe_customer_id.startsWith('apple:')) {
      return res.status(400).json({
        error: 'Apple-Abonnement — bitte in den App Store Einstellungen verwalten',
        managed_by: 'apple',
      });
    }

    const returnUrl = process.env.FRONTEND_URL?.split(',')[0] || 'https://app.jamie-app.com';
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${returnUrl}/settings`,
    });

    res.json({ url: session.url });
  } catch (err) {
    // The Stripe error most commonly seen here is "No configuration provided
    // and your test mode default configuration has not been created" — admins
    // must visit https://dashboard.stripe.com/test/settings/billing/portal
    // (or /settings/billing/portal in live mode) and activate the portal once.
    if (err?.message?.includes('No configuration provided')) {
      return res.status(503).json({ error: 'Stripe Customer Portal ist im Dashboard noch nicht aktiviert' });
    }
    console.error('createPortalSession error:', err);
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
// WIDERRUF — 14-day right of withdrawal (FAGG § 11, Variante A)
// ==========================================
// Distinct from cancelSubscription (which ends the plan at period close). A
// Widerruf UNDOES the contract within 14 days: cancel immediately + full refund
// of the last payment. Full refund (rather than the § 16 proportionate minimum)
// is a deliberate, always-compliant choice — refunding more than required is
// never a legal problem and keeps the flow simple. Apple-billed subscriptions
// are refunded through the App Store, not here.
export const withdrawSubscription = async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  try {
    const result = await db.query(
      `SELECT id, stripe_subscription_id, stripe_customer_id, status, created_at
       FROM subscriptions
       WHERE user_id = $1 AND (status = 'active' OR status = 'canceling')
       ORDER BY id DESC LIMIT 1`,
      [req.userId]
    );
    const sub = result.rows[0];
    if (!sub) return res.status(404).json({ error: 'Kein aktives Abonnement gefunden' });

    // Apple IAP subscriptions can't be refunded via Stripe.
    if (sub.stripe_customer_id?.startsWith?.('apple:')) {
      return res.status(400).json({
        error: 'Apple-Abonnement — Widerruf/Erstattung bitte über den App Store anfordern.',
        managed_by: 'apple',
      });
    }

    // Enforce the 14-day window server-side (never trust the client flag).
    if (Date.now() - new Date(sub.created_at).getTime() > WITHDRAWAL_WINDOW_MS) {
      return res.status(403).json({
        error: 'Die 14-tägige Widerrufsfrist ist abgelaufen. Du kannst dein Abo aber jederzeit kündigen.',
        code: 'WITHDRAWAL_EXPIRED',
      });
    }

    // Refund the latest payment in full, then cancel immediately. Refund is
    // best-effort: if it fails we still cancel so the user isn't trapped in a
    // paid plan, and return refunded:false so support can reconcile.
    let refunded = false;
    try {
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {
        expand: ['latest_invoice.payment_intent'],
      });
      const pi = stripeSub.latest_invoice?.payment_intent;
      if (pi?.id && pi.amount_received > 0) {
        await stripe.refunds.create({ payment_intent: pi.id });
        refunded = true;
      }
    } catch (refErr) {
      console.error('Widerruf refund failed:', refErr.message);
    }

    try {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
    } catch (cancelErr) {
      console.error('Widerruf cancel failed:', cancelErr.message);
    }

    await db.query(
      `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE id = $1`,
      [sub.id]
    );

    res.json({ success: true, refunded });
  } catch (err) {
    console.error('withdrawSubscription error:', err);
    res.status(500).json({ error: 'Widerruf fehlgeschlagen. Bitte kontaktiere office@jamie-app.com.' });
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
    // Return 500 so Stripe retries per its backoff schedule. Returning 200 here
    // would make Stripe consider the event handled — a paid user's Pro status
    // would silently never sync if the DB hiccupped during the webhook.
    console.error('subscriptionWebhook DB error:', dbErr);
    return res.status(500).json({ error: 'DB update failed' });
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
