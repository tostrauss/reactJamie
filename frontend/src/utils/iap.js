/**
 * Apple StoreKit (In-App Purchase) abstraction for the iOS native build.
 *
 * Why this exists: Apple Review Guideline 3.1.1 mandates StoreKit for any
 * digital goods sold inside an iOS app. Stripe is still used on web and
 * Android — only the iOS-Capacitor path routes through this module.
 *
 * Plugin used: `@capacitor-community/in-app-purchases`
 *   - Loaded dynamically so the web bundle stays clean (no Capacitor types).
 *   - All exports are safe to call on web; they throw a typed error so the
 *     UI can fall back to Stripe without crashing.
 *
 * Product IDs MUST match what's configured in App Store Connect — see
 * store/STOREKIT-SETUP.md for the canonical list.
 */

import { isNativeIOS } from './platform';
import { iap as iapApi } from './api';

// ── Product catalogue (same IDs registered in App Store Connect) ─────────
export const IAP_PRODUCTS = {
  boost_starter: { type: 'consumable',    credits: 1 },
  boost_popular: { type: 'consumable',    credits: 5 },
  boost_pro:     { type: 'consumable',    credits: 15 },
  pro_weekly:    { type: 'subscription',  plan: 'weekly'   },
  pro_monthly:   { type: 'subscription',  plan: 'monthly'  },
  pro_sixmonth:  { type: 'subscription',  plan: 'sixmonth' },
};

// Map the existing Stripe package ids → StoreKit product ids.
export const BOOST_PKG_TO_PRODUCT_ID = {
  starter: 'boost_starter',
  popular: 'boost_popular',
  pro:     'boost_pro',
};
export const PRO_PLAN_TO_PRODUCT_ID = {
  weekly:   'pro_weekly',
  monthly:  'pro_monthly',
  sixmonth: 'pro_sixmonth',
};

class IapUnavailableError extends Error {
  constructor() { super('StoreKit IAP is only available on the iOS native build'); this.name = 'IapUnavailableError'; }
}

let pluginPromise = null;
async function getPlugin() {
  if (!isNativeIOS()) throw new IapUnavailableError();
  if (!pluginPromise) {
    // This package is not on npm yet — the StoreKit plugin is still being
    // chosen (see store/STOREKIT-SETUP.md). It is listed in vite.config.js
    // build.rollupOptions.external so the build doesn't try to resolve it;
    // at runtime the .catch below degrades to IapUnavailableError until a
    // real plugin (e.g. @revenuecat/purchases-capacitor) replaces it.
    pluginPromise = import('@capacitor-community/in-app-purchases')
      .then(m => m.InAppPurchases || m.default || m)
      .catch(err => {
        pluginPromise = null;
        throw new Error('IAP plugin not installed: ' + err.message);
      });
  }
  return pluginPromise;
}

/** True only inside the iOS native build. */
export const isIapAvailable = () => isNativeIOS();

/**
 * Purchase a boost package via StoreKit, then hand the JWS transaction
 * receipt to the backend for verification + credit grant.
 *
 * Returns the verified server payload `{ credits_added, new_total }`.
 */
export async function purchaseBoost(packageId) {
  const productId = BOOST_PKG_TO_PRODUCT_ID[packageId];
  if (!productId) throw new Error('Unknown boost package: ' + packageId);

  const Iap = await getPlugin();
  const result = await Iap.purchaseProduct({ productId });
  // result.transactionReceipt is the JWS-signed transaction on StoreKit 2.
  if (!result?.transactionReceipt) throw new Error('No StoreKit receipt returned');

  const verify = await iapApi.verifyApple({
    product_type: 'boost',
    product_id:   productId,
    receipt:      result.transactionReceipt,
    transaction_id: result.transactionId,
  });
  return verify.data;
}

/**
 * Subscribe to JAMIE Pro via StoreKit. Same flow as boost but the server
 * activates a recurring subscription instead of granting credits.
 */
export async function subscribePro(planKey) {
  const productId = PRO_PLAN_TO_PRODUCT_ID[planKey];
  if (!productId) throw new Error('Unknown pro plan: ' + planKey);

  const Iap = await getPlugin();
  const result = await Iap.purchaseProduct({ productId });
  if (!result?.transactionReceipt) throw new Error('No StoreKit receipt returned');

  const verify = await iapApi.verifyApple({
    product_type: 'subscription',
    product_id:   productId,
    receipt:      result.transactionReceipt,
    transaction_id: result.transactionId,
  });
  return verify.data;
}

/**
 * Restore previous purchases (Apple guideline 3.1.1 also requires a
 * "Restore Purchases" button for subscriptions).
 */
export async function restorePurchases() {
  const Iap = await getPlugin();
  const result = await Iap.restorePurchases();
  // The backend re-verifies whatever Apple returns.
  const receipts = result?.receipts || [];
  if (!receipts.length) return { restored: 0 };
  await iapApi.restoreApple({ receipts });
  return { restored: receipts.length };
}
