/**
 * iOS in-app purchases through RevenueCat (StoreKit underneath).
 *
 * Why: Apple Review Guideline 3.1.1 requires StoreKit for digital goods sold
 * inside an iOS app. Stripe stays web-only, Play Billing is the Android-TWA
 * path (utils/playBilling.js). This module is the iOS path only.
 *
 * Flow:
 *   1. App start: loadPaymentsConfig() fetches GET /api/iap/config. The
 *      server says whether iOS sales are on and hands us the PUBLIC RevenueCat
 *      key, so neither needs an iOS rebuild.
 *   2. Login: identifyIapUser(user.id) configures RevenueCat with the JAMIE
 *      user id as App User ID. Webhooks then name our user directly.
 *   3. Purchase: StoreKit sheet via RevenueCat, then POST
 *      /api/iap/revenuecat/sync. The server asks RevenueCat for the real
 *      entitlement; the client proves nothing.
 *   4. Renewals, cancels and refunds reach the server via the RevenueCat webhook.
 *
 * Product ids must match App Store Connect + RevenueCat (store/REVENUECAT-SETUP.md).
 */

import { isNativeIOS } from './platform';
import { iap as iapApi } from './api';
import { getPaymentsConfig, setPaymentsConfig } from './paymentsConfig';
import { captureException } from './sentry';

// Subscriptions only. The boost_* consumables were dropped on 21.09.2026
// ("Boosts bleiben, nur keine Einzelkäufe"): boosting is a Pro feature.
export const IAP_PRODUCTS = {
  pro_monthly:   { type: 'subscription',  plan: 'monthly'  },
  pro_sixmonth:  { type: 'subscription',  plan: 'sixmonth' },
  pro_yearly:    { type: 'subscription',  plan: 'yearly'   },
};

export const PRO_PLAN_TO_PRODUCT_ID = {
  monthly:  'pro_monthly',
  sixmonth: 'pro_sixmonth',
  yearly:   'pro_yearly',
};

// Apple's page for the user's subscriptions (cancel, switch plan). Opens the
// App Store's subscription sheet from Safari.
export const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

class IapUnavailableError extends Error {
  constructor(msg = 'In-app purchases are not available') { super(msg); this.name = 'IapUnavailableError'; }
}

// Version of THIS purchase glue, sent by the iOS app with GET /api/iap/config.
// The server offers the iOS purchase path only from IOS_IAP_MIN_CLIENT on
// (backend features.js iosClientMaySell): the bundles before the getPlugin
// fix below — 1.4.3 (12) and every TestFlight build since 23.09. — send
// nothing and stay without purchases even with the switch on. Keyed on the
// bundle, not on Apple's build number, which is only unique per version.
// Bump it whenever a fix must shut out older bundles, together with
// IOS_IAP_MIN_CLIENT in Railway.
export const IAP_CLIENT_VERSION = 2;

/** Fetch the runtime payments config. Never throws: on failure the last
 *  known (or the all-off default) config stays in place. */
export async function loadPaymentsConfig() {
  const params = isNativeIOS() ? { iap_client: IAP_CLIENT_VERSION } : undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await iapApi.getConfig(params);
      setPaymentsConfig(data);
      return getPaymentsConfig();
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return getPaymentsConfig();
}

// ── RevenueCat SDK lifecycle ──────────────────────────────────────────────
// The plugin only ever travels INSIDE an object: getPlugin() and
// readyPlugin() resolve { Purchases }, never the plugin itself. A Capacitor
// plugin is a Proxy that answers every property name with a native call —
// `then` included — so as the bare resolution value of a promise it passes
// for a thenable: the promise calls Purchases.then(resolve, reject), the
// native side rejects ("Purchases.then()" is not implemented on ios) and
// resolve/reject never run. In build 1.4.3 (12) that left RevenueCat
// unconfigured and the Pro sheet spinning forever (Sentry 08.10.2026).
let pluginPromise = null;
const getPlugin = () => {
  if (!pluginPromise) {
    // Dynamic import keeps the SDK out of the main web chunk.
    pluginPromise = import('@revenuecat/purchases-capacitor')
      .then((m) => ({ Purchases: m.Purchases }))
      .catch((err) => { pluginPromise = null; throw err; });
  }
  return pluginPromise;
};

let configuredFor = null;   // App User ID RevenueCat currently runs as
let identifyChain = Promise.resolve();

// A native call that never answers must not freeze the Pro sheet again: after
// this long the purchase path gives up with "nicht verfügbar" (and Sentry)
// instead of spinning. Only for calls without a user in the loop — never
// around the Apple purchase or restore sheet.
const NATIVE_TIMEOUT_MS = 20000;
function withTimeout(promise, step) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      captureException(new Error(`[iap] ${step} did not answer within ${NATIVE_TIMEOUT_MS / 1000}s`), {
        tags: { area: 'iap', step },
      });
      reject(new IapUnavailableError('In-App-Käufe antworten gerade nicht. Bitte später nochmal versuchen.'));
    }, NATIVE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Configure RevenueCat for the logged-in user (or switch user). Safe to call
 * repeatedly; a no-op outside the iOS app or while iOS sales are off.
 */
export function identifyIapUser(userId) {
  identifyChain = identifyChain.then(async () => {
    const cfg = getPaymentsConfig();
    if (!isNativeIOS() || !cfg.ios_iap_enabled || !cfg.revenuecat.ios_api_key || !userId) return;
    const appUserID = String(userId);
    if (configuredFor === appUserID) return;
    // Not configured until RevenueCat confirms the new user: a logIn that
    // fails on an account switch must not leave the previous account active,
    // or the next purchase would be booked to that other JAMIE user.
    configuredFor = null;
    productCache = null;
    const { Purchases } = await getPlugin();
    const { isConfigured } = await Purchases.isConfigured().catch(() => ({ isConfigured: false }));
    if (!isConfigured) {
      await Purchases.configure({ apiKey: cfg.revenuecat.ios_api_key, appUserID });
    } else {
      await Purchases.logIn({ appUserID });
    }
    configuredFor = appUserID;
    productCache = null;
  }).catch((err) => {
    console.warn('[iap] RevenueCat setup failed:', err?.message || err);
    captureException(err, { tags: { area: 'iap', step: 'configure' } });
  });
  return identifyChain;
}

/** Resolves { Purchases } once RevenueCat runs for the logged-in user. */
async function readyPlugin() {
  if (!isNativeIOS()) throw new IapUnavailableError();
  await withTimeout(identifyChain, 'configure');
  if (!configuredFor) throw new IapUnavailableError('In-App-Käufe sind gerade nicht verfügbar. Bitte App neu starten.');
  return getPlugin();
}

// ── Products (localized App Store prices) ─────────────────────────────────
let productCache = null;

/**
 * Localized StoreKit products keyed by plan ('monthly' | 'sixmonth' |
 * 'yearly'), plus intro-offer (free trial) eligibility per product.
 * Prices come from the user's App Store storefront, so a Swiss user sees CHF.
 */
export async function getIosProducts() {
  if (productCache) return productCache;
  const { Purchases } = await readyPlugin();
  const ids = Object.values(PRO_PLAN_TO_PRODUCT_ID);
  let products;
  try {
    ({ products } = await withTimeout(Purchases.getProducts({ productIdentifiers: ids }), 'products'));
  } catch (err) {
    if (!(err instanceof IapUnavailableError)) captureException(err, { tags: { area: 'iap', step: 'products' } });
    throw err;
  }
  let eligibility = {};
  try {
    eligibility = await withTimeout(
      Purchases.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: ids }), 'eligibility');
  } catch { /* unknown → no trial claim */ }

  const byPlan = {};
  for (const p of products || []) {
    const plan = IAP_PRODUCTS[p.identifier]?.plan;
    if (!plan) continue;
    const intro = p.introPrice;
    // RevenueCat status 2 = ELIGIBLE. Only a FREE intro offer is a "trial";
    // anything unknown stays silent (never promise a trial Apple won't give).
    const freeTrial = intro && intro.price === 0 && eligibility[p.identifier]?.status === 2
      ? { unit: intro.periodUnit, count: intro.periodNumberOfUnits }
      : null;
    byPlan[plan] = {
      productId: p.identifier,
      price: p.price,
      priceString: p.priceString,
      pricePerMonth: p.pricePerMonth,
      pricePerMonthString: p.pricePerMonthString,
      currencyCode: p.currencyCode,
      freeTrial,
      raw: p,
    };
  }
  const missing = ids.filter((id) => !Object.values(byPlan).some((p) => p.productId === id));
  if (missing.length) {
    // StoreKit answered without (some of) our subscriptions. That is App
    // Store Connect's side: a status of "Missing Metadata", no active Paid
    // Apps agreement, not available in this storefront, or not propagated
    // yet. Reported so it shows in Sentry without a Mac at hand.
    captureException(new Error(`[iap] StoreKit returned no product for ${missing.join(', ')}`), {
      level: 'warning', tags: { area: 'iap', step: 'products' },
    });
  }
  // An empty answer is not cached: the next Pro sheet asks StoreKit again.
  if (Object.keys(byPlan).length) productCache = byPlan;
  return byPlan;
}

const isCancel = (err) =>
  err?.userCancelled === true || String(err?.code) === '1' || /cancel/i.test(err?.message || '');

/**
 * Buy JAMIE Pro. Resolves with the server's view after the sync
 * ({ is_pro, status, current_period_end, pending? }). Throws an Error whose
 * message contains "cancel" when the user closed the Apple sheet.
 */
export async function subscribePro(planKey) {
  const productId = PRO_PLAN_TO_PRODUCT_ID[planKey];
  if (!productId) throw new Error('Unknown pro plan: ' + planKey);

  const { Purchases } = await readyPlugin();
  const products = await getIosProducts();
  const product = Object.values(products).find((p) => p.productId === productId)?.raw;
  if (!product) throw new IapUnavailableError('Dieses Abo ist im App Store gerade nicht verfügbar.');

  try {
    await Purchases.purchaseStoreProduct({ product });
  } catch (err) {
    if (isCancel(err)) throw new Error('cancelled');
    throw err;
  }
  productCache = null; // intro eligibility has changed
  return syncWithServer();
}

/**
 * Tell the server to re-read our entitlement. Apple has already charged at
 * this point, so a failed sync must not look like a failed purchase: the
 * RevenueCat webhook grants Pro shortly anyway.
 */
async function syncWithServer({ optimistic = true } = {}) {
  try {
    const { data } = await iapApi.syncRevenueCat();
    return data;
  } catch (err) {
    if (!optimistic) throw new Error(err.response?.data?.error || err.message);
    return { is_pro: true, pending: true };
  }
}

/**
 * "Käufe wiederherstellen" (Apple 3.1.1 requires it for subscriptions).
 * Resolves { restored: 1 } when Pro is active afterwards, else { restored: 0 }.
 */
export async function restorePurchases() {
  const { Purchases } = await readyPlugin();
  await Purchases.restorePurchases();
  // Not optimistic: nothing was charged here, so an error must say so.
  const data = await syncWithServer({ optimistic: false });
  return { restored: data?.is_pro ? 1 : 0 };
}

/** Open Apple's subscription management (cancel / switch plan). */
export function openAppleSubscriptions() {
  window.open(APPLE_SUBSCRIPTIONS_URL, '_blank', 'noopener');
}
