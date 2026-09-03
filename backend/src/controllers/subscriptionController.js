import db from '../config/database.js';
import Stripe from 'stripe';
import { isAppShellRequest, paymentsEnabled } from '../config/features.js';
import { Sentry } from '../config/sentry.js';
import { getClientIp } from '../utils/clientIp.js';

// Stripe Tax (IMPIBAG is USt-pflichtig, decided 2026-09-03). Own env switch,
// separate from PAYMENTS_ENABLED, so tax can be turned off without touching the
// payment kill switch or shipping a deploy. Off => byte-identical to the
// pre-tax behaviour.
//
// Prices stay GROSS: 4,99 € is what the customer is charged either way, and
// 'inclusive' makes Stripe carve the VAT out of it (4,158 + 0,832 @ 20% AT)
// instead of adding it on top. That is also why enabling this later cost no
// customer anything — nobody is ever charged more than the advertised price.
const stripeTaxEnabled = () => process.env.STRIPE_TAX_ENABLED === 'true';

// A webhook UPDATE that matches zero rows means Stripe knows about a
// subscription we have no row for — i.e. someone was CHARGED and their Pro
// status will never sync. Previously these returned 200 silently, so the only
// symptom was a support ticket with nothing in the logs to correlate it to.
// Throwing makes the outer catch return 500, which makes Stripe retry on its
// backoff schedule; every one of these updates is idempotent, so a retry is
// safe and usually wins once the racing INSERT has landed.
function assertWebhookMatched(result, eventType, stripeSubId) {
  if (result?.rowCount > 0) return;
  const msg = `subscriptionWebhook: ${eventType} matched NO subscriptions row for ${stripeSubId} — user may be charged without Pro`;
  console.error(msg);
  Sentry.captureMessage?.(msg, { level: 'error', tags: { area: 'payments', kind: 'webhook-orphan' }, extra: { eventType, stripeSubId } });
  const err = new Error('WEBHOOK_ROW_NOT_FOUND');
  err.retryable = true;
  throw err;
}

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  // The JAMIE Stripe account (IMPIBAG e.U.) enforces its newer 'dahlia' API
  // version: pinning to an older one is IGNORED for request validation (it
  // rejected inline price_data.product_data, a 2023-era shape, with
  // "unknown parameter … Did you mean product?"). So we target dahlia
  // explicitly to keep requests AND response shapes consistent, and matching
  // the two webhook endpoints (also dahlia).
  // timeout/maxNetworkRetries: the SDK defaults to 80s per request WITH retries.
  // createSubscription makes up to 6 calls, so a degraded Stripe could keep a
  // request (and, before the fix below, a DB pool connection) alive for minutes
  // — enough concurrent subscribes would exhaust the pool and 500 the WHOLE api,
  // not just payments. Fail fast instead; the user can retry.
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-04-22.dahlia',
    timeout: 8000,
    maxNetworkRetries: 1,
  });
};

// dahlia dropped inline price_data.product_data on subscription items — the
// price must reference an EXISTING Product id. We keep the amount dynamic in
// code (so repricing needs zero Stripe changes) and point every plan at ONE
// reusable "JAMIE Pro" product. Resolved from env if set, otherwise found or
// created once and cached per secret-key so a test→live key swap re-resolves
// against the right mode. products.list is read-after-write consistent (unlike
// products.search), so this never spawns duplicate products.
let _proProduct = { keyTail: null, id: null };
async function getProProductId(stripe) {
  if (process.env.STRIPE_PRO_PRODUCT_ID) return process.env.STRIPE_PRO_PRODUCT_ID;
  const keyTail = (process.env.STRIPE_SECRET_KEY || '').slice(-10);
  if (_proProduct.id && _proProduct.keyTail === keyTail) return _proProduct.id;
  const list = await stripe.products.list({ active: true, limit: 100 });
  const found = list.data.find(p => p.name === 'JAMIE Pro');
  const id = found ? found.id : (await stripe.products.create({ name: 'JAMIE Pro' })).id;
  _proProduct = { keyTail, id };
  return id;
}

// ==========================================
// PRO PLAN CATALOG (server is authoritative on price)
// ==========================================
// Hinge-style tiered pricing (repriced 2026-08-03, prev. 2026-06-11 spec):
//   • weekly  — 1,99 €/Woche, baseline (no discount)
//   • monthly — 4,99 €/Monat → 1,15 €/Woche, "42% sparen", DEFAULT + "Beliebt"
//   • sixmonth— 19,99 €/6 Monate → 0,77 €/Woche, "61% sparen", "Bestes Angebot"
// Per-week headlines derived so they stay honest:
//   weekly 1,99/1wk · monthly 4,99/4.33wk=1,15 · 6mo 19,99/26wk=0,77.
// amount_cents is the ONLY price the client can't influence — the request
// just names a plan key; we look up the amount here.
export const PRO_PLANS = {
  weekly:   { amount_cents: 199,  interval: 'week',  interval_count: 1, label: 'JAMIE Pro – Wöchentlich' },
  monthly:  { amount_cents: 499,  interval: 'month', interval_count: 1, label: 'JAMIE Pro – Monatlich' },
  sixmonth: { amount_cents: 1999, interval: 'month', interval_count: 6, label: 'JAMIE Pro – 6 Monate' },
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
    // `trialing` counts as Pro — the user has full access during the 14-day trial.
    const isActive =
      (sub?.status === 'active' || sub?.status === 'canceling' || sub?.status === 'trialing') &&
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
      is_trial: sub?.status === 'trialing',
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
  // Server-side kill-switch: while payments are off, the frontend flag alone
  // is bypassable with a direct API call — refuse to create new subscriptions.
  // createPortalSession stays open (manage/cancel existing subs, no new money).
  if (!paymentsEnabled()) {
    return res.status(403).json({ error: 'Zahlungen sind derzeit deaktiviert.', code: 'PAYMENTS_DISABLED' });
  }
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  // Store-policy backstop: no Stripe checkout from the Play/iOS app shells.
  if (isAppShellRequest(req)) {
    return res.status(403).json({ error: 'Abos sind nur im Browser verfügbar.', code: 'PAYMENTS_WEB_ONLY' });
  }

  // Resolve the requested plan against the server-side catalog. Unknown /
  // missing plan falls back to the default monthly tier rather than erroring.
  const planKey = (typeof req.body?.plan === 'string' && PRO_PLANS[req.body.plan])
    ? req.body.plan
    : DEFAULT_PLAN;
  const plan = PRO_PLANS[planKey];

  // Serialize concurrent create calls per user (double-tap, two tabs) so we
  // never create TWO Stripe subscriptions for one person → double charge. A
  // session-level advisory lock in the (7001, userId) namespace; released in
  // finally.
  //
  // TRY, don't wait: the lock is held across the Stripe round-trip, so a
  // blocking pg_advisory_lock made every duplicate tap queue up while ALSO
  // holding its own pool connection — N taps pinned N connections behind one
  // slow Stripe call. Since the only thing a waiter could do after acquiring is
  // discover the subscription the winner just created and 400, failing it
  // immediately is both cheaper and clearer. Combined with the 8s Stripe
  // timeout above, one subscribe can now occupy a connection for seconds, not
  // minutes — which is what keeps a subscribe wave from exhausting the pool and
  // 500ing the entire API.
  const lockClient = await db.pool.connect();
  let locked = false;
  try {
    const lockRes = await lockClient.query('SELECT pg_try_advisory_lock(7001, $1) AS ok', [req.userId]);
    if (!lockRes.rows[0]?.ok) {
      return res.status(409).json({
        error: 'Dein Abo wird gerade eingerichtet. Bitte einen Moment warten.',
        code: 'SUBSCRIPTION_IN_PROGRESS',
      });
    }
    locked = true;

    const userResult = await db.query(
      'SELECT email, name FROM users WHERE id = $1',
      [req.userId]
    );
    if (!userResult.rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    const { email, name } = userResult.rows[0];

    // Check for existing active subscription. 'trialing' is blocked too — a
    // user already on the free trial re-hitting create would otherwise spin up
    // a SECOND, immediately-charged subscription alongside the trial.
    const existingResult = await db.query(
      `SELECT stripe_customer_id, stripe_subscription_id, status
       FROM subscriptions WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
      [req.userId]
    );
    const existing = existingResult.rows[0];

    if (['active', 'canceling', 'trialing'].includes(existing?.status)) {
      return res.status(400).json({ error: 'Bereits ein aktives Abonnement vorhanden' });
    }
    // past_due blocks too: Stripe's smart retries recover most failed renewals
    // within days. Selling a SECOND subscription in that window double-charges
    // the user as soon as retry succeeds — and cancel/getStatus only ever see
    // the newest row, so the old one would keep billing invisibly. The user
    // fixes the card via the portal ("Abo verwalten") instead.
    if (existing?.status === 'past_due') {
      return res.status(400).json({
        error: 'Deine letzte Abo-Zahlung ist fehlgeschlagen. Bitte aktualisiere deine Zahlungsmethode unter Einstellungen → „Abo verwalten“, statt ein neues Abo zu starten.',
        code: 'PAST_DUE',
      });
    }

    // Get or create Stripe customer. A stored customer id can be invalid under
    // the CURRENT keys — a TEST-mode id left in the DB from pre-launch testing
    // (it 404s under live keys), or a customer deleted in the dashboard. Reusing
    // it makes subscriptions.create fail with "No such customer", so verify it
    // resolves and fall through to creating a fresh one if it doesn't.
    // Stripe Tax needs a customer LOCATION or automatic_tax refuses to price the
    // subscription. We have no billing address (the PaymentElement doesn't
    // collect one), so we hand Stripe the caller's IP and let it infer the
    // country. Same helper the geofence uses — the plain req.ip is a Railway
    // edge address, which would put every customer in the wrong country.
    const taxIp = stripeTaxEnabled() ? getClientIp(req) : null;

    let customerId = existing?.stripe_customer_id;
    if (customerId) {
      try {
        const c = await stripe.customers.retrieve(customerId);
        if (c?.deleted) customerId = null;
      } catch (e) {
        if (e?.code === 'resource_missing') customerId = null;
        else throw e;
      }
    }
    if (customerId && taxIp) {
      // An existing customer created before Stripe Tax has no tax location —
      // refresh it, otherwise automatic_tax fails for every returning buyer.
      try {
        await stripe.customers.update(customerId, { tax: { ip_address: taxIp } });
      } catch (e) {
        console.warn('stripe tax: could not set ip_address on existing customer', customerId, e?.message);
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: { user_id: String(req.userId) },
        ...(taxIp ? { tax: { ip_address: taxIp } } : {}),
      });
      customerId = customer.id;
    }

    // Cancel any stale incomplete/pending Stripe subscriptions to avoid orphans.
    // A trial sub abandoned at the card form is 'trialing' WITHOUT a payment
    // method on Stripe's side (it would auto-cancel at trial end) — cancel it
    // too, so a retried checkout doesn't stack a second trial next to it.
    if (existing?.stripe_subscription_id && existing?.status === 'pending') {
      try {
        const staleSub = await stripe.subscriptions.retrieve(existing.stripe_subscription_id);
        const abandonedTrial = staleSub.status === 'trialing'
          && !staleSub.default_payment_method && !staleSub.default_source;
        if (staleSub.status === 'incomplete' || abandonedTrial) {
          await stripe.subscriptions.cancel(existing.stripe_subscription_id);
        }
      } catch (_) { /* ignore — subscription may not exist in Stripe anymore */ }
    }

    // 14-day free trial for FIRST-TIME subscribers only (Tina's "Probeabo"):
    // the card is captured up front via a SetupIntent and auto-charged when the
    // trial ends. Anyone who has ever had a real subscription pays immediately —
    // this blocks cancel-and-resubscribe trial farming. A stale 'pending' row
    // (abandoned checkout) does NOT consume the trial.
    const priorRealSub = await db.query(
      `SELECT 1 FROM subscriptions
       WHERE user_id = $1 AND status IN ('active','trialing','canceling','canceled','past_due')
       LIMIT 1`,
      [req.userId]
    );
    const trialEligible = priorRealSub.rows.length === 0;

    // price_data is built from the server-side catalog entry so the client can
    // never dictate the charged amount or billing cadence. `product` points at
    // the single reusable "JAMIE Pro" product (dahlia needs a product id, not
    // inline product_data); the per-plan label rides along in metadata instead.
    const productId = await getProProductId(stripe);
    const subParams = {
      customer: customerId,
      items: [{
        price_data: {
          currency: 'eur',
          product: productId,
          unit_amount: plan.amount_cents,
          recurring: { interval: plan.interval, interval_count: plan.interval_count },
          // GROSS price: the advertised 1,99/4,99/19,99 € is the total charged;
          // Stripe carves the VAT out of it rather than adding it on top.
          ...(stripeTaxEnabled() ? { tax_behavior: 'inclusive' } : {}),
        },
      }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: { user_id: String(req.userId), plan: planKey, plan_label: plan.label },
      ...(stripeTaxEnabled() ? { automatic_tax: { enabled: true } } : {}),
    };
    if (trialEligible) {
      // Trial → no upfront charge, so Stripe issues a SetupIntent (not a
      // PaymentIntent) to save the card; the sub starts in `trialing`. Cancel
      // automatically if no card is on file at trial end (never fail-charge).
      subParams.trial_period_days = 14;
      subParams.trial_settings = { end_behavior: { missing_payment_method: 'cancel' } };
      subParams.expand = ['pending_setup_intent'];
    } else {
      // dahlia serves the first-payment client secret on the invoice's
      // confirmation_secret (older versions used latest_invoice.payment_intent).
      subParams.expand = ['latest_invoice.confirmation_secret'];
    }

    // FAIL-OPEN ON TAX, never on the sale. automatic_tax throws when Stripe
    // can't resolve the customer's location (IP inference failed, VPN, a
    // country we hold no registration for). Letting that bubble up would mean
    // "nobody can subscribe" — far worse than an un-itemized invoice, since the
    // customer is charged the identical gross amount either way and the VAT is
    // still declarable from it. So: retry once without automatic_tax, and make
    // the fallback loud so it can't quietly become the normal path.
    let subscription;
    try {
      subscription = await stripe.subscriptions.create(subParams);
    } catch (taxErr) {
      const isTaxFailure = stripeTaxEnabled() && (
        /tax/i.test(taxErr?.message || '') ||
        /customer_tax_location_invalid|tax_id_invalid/.test(taxErr?.code || '')
      );
      if (!isTaxFailure) throw taxErr;
      const msg = `stripe tax: automatic_tax failed for user ${req.userId} (${taxErr?.code || 'no code'}: ${taxErr?.message}) — retrying WITHOUT tax; invoice will not itemize VAT`;
      console.error(msg);
      Sentry.captureMessage?.(msg, { level: 'warning', tags: { area: 'payments', kind: 'tax-fallback' }, extra: { userId: req.userId, code: taxErr?.code } });
      delete subParams.automatic_tax;
      delete subParams.items[0].price_data.tax_behavior;
      subscription = await stripe.subscriptions.create(subParams);
    }

    // Upsert subscription record
    await db.query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (stripe_subscription_id) DO UPDATE
         SET status = 'pending', updated_at = NOW()`,
      [req.userId, customerId, subscription.id]
    );

    // Trial → client confirms a SetupIntent (confirmSetup); paid → confirms the
    // PaymentIntent (confirmPayment). The client switches on `mode`.
    const mode = trialEligible ? 'setup' : 'payment';
    const clientSecret = trialEligible
      ? (subscription.pending_setup_intent?.client_secret ?? null)
      : (subscription.latest_invoice?.confirmation_secret?.client_secret
         ?? subscription.latest_invoice?.payment_intent?.client_secret
         ?? null);
    if (!clientSecret) {
      console.error('createSubscription: missing client_secret', subscription.id, 'mode', mode);
      return res.status(500).json({ error: 'Stripe returned an incomplete intent' });
    }

    res.json({
      client_secret: clientSecret,
      mode,
      trial_days: trialEligible ? 14 : 0,
      subscription_id: subscription.id,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
    });
  } catch (err) {
    console.error('createSubscription error:', err);
    res.status(500).json({ error: 'Stripe error' });
  } finally {
    if (locked) await lockClient.query('SELECT pg_advisory_unlock(7001, $1)', [req.userId]).catch(() => {});
    lockClient.release();
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
    try {
      await stripe.subscriptions.update(stripe_subscription_id, { cancel_at_period_end: true });
    } catch (e) {
      // Sub deleted/fully canceled out-of-band (dashboard action, missed
      // subscription.deleted webhook): don't 500 — settle the DB row so the
      // in-app cancel button isn't permanently broken for this user.
      const alreadyGone = e?.code === 'resource_missing'
        || /canceled subscription/i.test(e?.message || '');
      if (!alreadyGone) throw e;
      await db.query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
         WHERE stripe_subscription_id = $1`,
        [stripe_subscription_id]
      );
      return res.json({ success: true, message: 'Abonnement ist bereits beendet' });
    }

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
      // dahlia removed invoice.payment_intent (payments moved to the invoice's
      // `payments` list) — expanding the old path makes the whole retrieve
      // throw, which used to skip the refund entirely. Fetch the invoice
      // separately and read the payment intent out of EITHER shape.
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      const invoiceId = typeof stripeSub.latest_invoice === 'string'
        ? stripeSub.latest_invoice
        : stripeSub.latest_invoice?.id;
      if (invoiceId) {
        let invoice;
        try {
          invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payments'] });
        } catch {
          invoice = await stripe.invoices.retrieve(invoiceId);
        }
        if (invoice.amount_paid > 0) {
          const payments = invoice.payments?.data ?? [];
          const paidEntry = payments.find(p => p.status === 'paid') ?? payments[0];
          const piRef = invoice.payment_intent ?? paidEntry?.payment?.payment_intent ?? null;
          const piId = typeof piRef === 'string' ? piRef : piRef?.id;
          const chargeRef = invoice.charge ?? paidEntry?.payment?.charge ?? null;
          const chargeId = typeof chargeRef === 'string' ? chargeRef : chargeRef?.id;
          if (piId) {
            await stripe.refunds.create({ payment_intent: piId });
            refunded = true;
          } else if (chargeId) {
            await stripe.refunds.create({ charge: chargeId });
            refunded = true;
          } else {
            console.error('Widerruf: paid invoice but no payment ref found', invoiceId);
          }
        }
        // amount_paid === 0 (trial phase) → nothing to refund, cancel is enough.
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
// API-VERSION RESILIENCE HELPERS
// ==========================================
// Our own calls are pinned to 'dahlia' (see getStripe), but webhook payloads
// are serialized with the ENDPOINT's API version and historical events may
// carry older shapes: current_period_end moved onto the subscription's items,
// and invoice.subscription was replaced by
// invoice.parent.subscription_details.subscription. These read a value out of
// EITHER shape so the webhook works no matter which version Stripe used.
// Without this, subscription.updated wrote current_period_end = NULL and
// isUserPro never saw an active subscription — paid/trial users got no Pro.
const subPeriodEndUnix = (sub) =>
  sub?.current_period_end
  ?? sub?.items?.data?.[0]?.current_period_end
  ?? null;
const invoiceSubId = (invoice) =>
  invoice?.subscription
  ?? invoice?.parent?.subscription_details?.subscription
  ?? invoice?.lines?.data?.[0]?.subscription
  ?? null;

// Single mapping from a Stripe subscription object to our DB status. Used by
// EVERY webhook branch that writes status — the old invoice.payment_succeeded
// handler derived 'active' from cancel_at_period_end alone, which (a) wrote
// 'active' over a trialing sub (whole trial cohort mislabeled) and (b) let a
// delayed/retried invoice event resurrect a canceled+refunded sub to Pro.
// Trialing counts only once a payment method is actually on file: a sub is
// born 'trialing' BEFORE confirmSetup, and treating that as Pro handed out
// 14 free days with no card (abandoned checkout still burned nothing, but
// got full Pro until trial end).
const mapSubStatus = (sub) => {
  if (sub.status === 'active') return sub.cancel_at_period_end ? 'canceling' : 'active';
  if (sub.status === 'trialing') {
    if (!sub.default_payment_method && !sub.default_source) return 'pending';
    return sub.cancel_at_period_end ? 'canceling' : 'trialing';
  }
  if (sub.status === 'canceled') return 'canceled';
  if (sub.status === 'past_due') return 'past_due';
  return 'inactive';
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
      const status = mapSubStatus(sub);
      // Resolve period end from either API shape. If the event carries neither
      // (some dahlia payloads omit it on the raw object), fall back to a pinned
      // retrieve, which returns the 2023-10-16 shape with a top-level value.
      let periodEndUnix = subPeriodEndUnix(sub);
      if (!periodEndUnix) {
        try {
          const full = await stripe.subscriptions.retrieve(sub.id);
          periodEndUnix = subPeriodEndUnix(full);
        } catch { /* leave null — a later invoice.payment_succeeded backfills it */ }
      }
      const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;
      const r = await db.query(
        `UPDATE subscriptions SET status = $1, current_period_end = $2, updated_at = NOW()
         WHERE stripe_subscription_id = $3`,
        [status, periodEnd, sub.id]
      );
      assertWebhookMatched(r, event.type, sub.id);
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const r = await db.query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
         WHERE stripe_subscription_id = $1`,
        [sub.id]
      );
      assertWebhookMatched(r, event.type, sub.id);
    } else if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const subId = invoiceSubId(invoice);
      if (subId) {
        const stripeSub = await stripe.subscriptions.retrieve(subId);
        const periodEndUnix = subPeriodEndUnix(stripeSub);
        const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;
        // Map the sub's REAL status — never assume "payment ⇒ active". Skip
        // the write entirely for unmapped states (e.g. a retrieve racing the
        // incomplete→active transition) so a 'pending' row isn't downgraded;
        // the following customer.subscription.updated settles it.
        const status = mapSubStatus(stripeSub);
        if (status !== 'inactive') {
          const r = await db.query(
            `UPDATE subscriptions SET status = $1, current_period_end = $2, updated_at = NOW()
             WHERE stripe_subscription_id = $3`,
            [status, periodEnd, subId]
          );
          assertWebhookMatched(r, event.type, subId);
        }
      }
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const subId = invoiceSubId(invoice);
      if (subId) {
        const r = await db.query(
          `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subId]
        );
        assertWebhookMatched(r, event.type, subId);
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
// HELPER: revoke Pro when a SUBSCRIPTION payment is refunded/disputed
// ==========================================
// charge.refunded / charge.dispute.created are delivered to the BOOST webhook
// endpoint (that's where the events are configured in the dashboard); its
// claw-back only knows boost_transactions, so a support refund of a
// subscription payment from the Stripe dashboard used to leave the user with
// full Pro AND an auto-renewing sub. Called by the boost webhook for every
// such charge; no-ops unless the charge maps to one of OUR subscriptions.
// Idempotent: canceling an already-canceled sub is caught, the DB write is a
// plain status UPDATE.
export const revokeSubscriptionForCharge = async (charge) => {
  const stripe = getStripe();
  if (!stripe || !charge) return;

  const piId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;

  // Invoice id out of either API shape: pre-basil charges carry .invoice;
  // newer versions map PI → invoice via the invoice_payments list.
  let invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
  if (!invoiceId && piId) {
    try {
      const payments = await stripe.invoicePayments.list({
        payment: { type: 'payment_intent', payment_intent: piId },
        limit: 1,
      });
      invoiceId = payments?.data?.[0]?.invoice ?? null;
      if (invoiceId && typeof invoiceId !== 'string') invoiceId = invoiceId.id;
    } catch { /* not an invoice payment (e.g. a boost PI) — nothing to do */ }
  }
  if (!invoiceId) return;

  const invoice = await stripe.invoices.retrieve(invoiceId);
  const subId = invoiceSubId(invoice);
  if (!subId) return;

  const row = await db.query(
    'SELECT id FROM subscriptions WHERE stripe_subscription_id = $1',
    [subId]
  );
  if (!row.rows.length) return;

  try {
    await stripe.subscriptions.cancel(subId);
  } catch (e) {
    const alreadyGone = e?.code === 'resource_missing'
      || /canceled subscription/i.test(e?.message || '');
    if (!alreadyGone) throw e; // real failure → caller 500s → Stripe retries
  }
  await db.query(
    `UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [subId]
  );
  console.log(`[subscription] revoked for refunded/disputed charge ${charge.id} (sub ${subId})`);
};

// ==========================================
// HELPER: check if a userId has active Pro
// ==========================================
export const isUserPro = async (userId) => {
  try {
    const result = await db.query(
      `SELECT id FROM subscriptions
       WHERE user_id = $1
         AND (status = 'active' OR status = 'canceling' OR status = 'trialing')
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
