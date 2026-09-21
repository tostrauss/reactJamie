/**
 * Google Play Billing for the Android Play app (Trusted Web Activity).
 *
 * The Play app is our live web PWA inside a TWA. Google Play's billing
 * policy forbids Stripe for digital goods inside it, so purchases there go
 * through Play Billing via TWO web APIs Chrome exposes only inside a TWA
 * whose Android shell ships the androidbrowserhelper `billing` extension
 * (twa/ — see store/PLAY-BILLING-SETUP.md):
 *
 *   • Digital Goods API  — window.getDigitalGoodsService(PLAY_BILLING_METHOD)
 *                          → product details, listPurchases()
 *   • Payment Request API — supportedMethods: PLAY_BILLING_METHOD
 *                          → shows the Play purchase sheet, returns a purchaseToken
 *
 * The purchaseToken is the ONLY proof of purchase. It goes to
 * POST /api/iap/google/verify; the server asks Google, grants Pro and
 * ACKNOWLEDGES the purchase (Google refunds unacknowledged ones after 3 days).
 *
 * Subscriptions only — Boost credits are not sold as Play consumables
 * ("Boosts bleiben, nur keine Einzelkäufe", Tina 21.09.2026).
 *
 * Product IDs MUST match the Play Console (and the other stores) exactly.
 * All exports are safe to call anywhere; outside an active Play-Billing TWA
 * they throw a typed error so the UI can show a neutral message.
 */

import { isPlayBillingActive } from './platform';
import { iap as iapApi } from './api';

export const PLAY_BILLING_METHOD = 'https://play.google.com/billing';

// Same IDs as App Store Connect / backend googleIapController.GOOGLE_PRODUCTS.
export const PRO_PLAN_TO_PLAY_PRODUCT_ID = Object.freeze({
  monthly:  'pro_monthly',
  sixmonth: 'pro_sixmonth',
  yearly:   'pro_yearly',
});

// Deep link into Play → Abos (no sku needed; Play shows all of this app's
// subscriptions). Used by Settings for cancel / payment method / refunds —
// Google, not us, manages a Play subscription.
export const PLAY_SUBSCRIPTIONS_URL =
  'https://play.google.com/store/account/subscriptions?package=jamie.app';

export class PlayBillingUnavailableError extends Error {
  constructor() {
    super('Play Billing is only available inside the Play Store app');
    this.name = 'PlayBillingUnavailableError';
  }
}

async function getService() {
  if (!isPlayBillingActive()) throw new PlayBillingUnavailableError();
  const service = await window.getDigitalGoodsService(PLAY_BILLING_METHOD);
  if (!service) throw new PlayBillingUnavailableError();
  return service;
}

/**
 * Play's localized price + title for the given plan keys, e.g. to show the
 * exact amount Google will charge. Returns {} when unavailable — the tiles
 * fall back to our own price strings, never break.
 */
export async function getPlayProductDetails(planKeys = Object.keys(PRO_PLAN_TO_PLAY_PRODUCT_ID)) {
  try {
    const service = await getService();
    const ids = planKeys.map(k => PRO_PLAN_TO_PLAY_PRODUCT_ID[k]).filter(Boolean);
    const details = await service.getDetails(ids);
    const byPlan = {};
    for (const d of details || []) {
      const plan = Object.keys(PRO_PLAN_TO_PLAY_PRODUCT_ID).find(k => PRO_PLAN_TO_PLAY_PRODUCT_ID[k] === d.itemId);
      if (plan) byPlan[plan] = { title: d.title, price: d.price, itemId: d.itemId };
    }
    return byPlan;
  } catch {
    return {};
  }
}

const isUserAbort = (err) =>
  err?.name === 'AbortError' || /cancel|abort|dismiss/i.test(err?.message || '');

/**
 * Buy JAMIE Pro through Play Billing, then hand the purchaseToken to the
 * backend for verification + grant. Resolves with the server payload
 * ({ ok, is_pro, status, current_period_end }).
 *
 * Throws Error('cancelled') when the user dismisses the Play sheet — the
 * callers already filter /cancel/i out of their error toasts.
 */
export async function purchasePlaySubscription(planKey) {
  const productId = PRO_PLAN_TO_PLAY_PRODUCT_ID[planKey];
  if (!productId) throw new Error('Unknown pro plan: ' + planKey);
  await getService(); // throws PlayBillingUnavailableError outside the TWA

  const request = new PaymentRequest(
    [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku: productId } }],
    // PaymentRequest requires a `total`; Play ignores it and charges the
    // price configured in the Play Console for the sku.
    { total: { label: 'JAMIE Pro', amount: { currency: 'EUR', value: '0' } } },
  );

  let response;
  try {
    response = await request.show();
  } catch (err) {
    if (isUserAbort(err)) throw new Error('cancelled');
    throw err;
  }

  const purchaseToken = response?.details?.purchaseToken;
  // The money has moved at this point regardless of what our server says:
  // complete() only closes Chrome's payment UI and never affects the Play
  // purchase. So close the sheet FIRST, then verify — a verify failure must not
  // leave the user staring at a spinner over a purchase that already happened.
  await response.complete(purchaseToken ? 'success' : 'fail');
  if (!purchaseToken) throw new Error('No purchaseToken returned by Play');

  try {
    const verify = await iapApi.verifyGoogle({ product_id: productId, purchase_token: purchaseToken });
    return verify.data;
  } catch (err) {
    // The restore path (listPurchases → /google/restore) picks the token up
    // on the next attempt / app start, so tell the user that instead of
    // "failed" — they DID pay.
    const e = new Error(err.response?.data?.error
      || 'Kauf bei Google erfolgreich, Bestätigung steht noch aus. Bitte gleich „Käufe wiederherstellen" tippen.');
    e.code = err.response?.data?.code || 'VERIFY_AFTER_PURCHASE_FAILED';
    e.purchased = true;
    throw e;
  }
}

/**
 * Re-bind the account's Play purchases (new device, reinstall, verify lost
 * after payment). Digital Goods `listPurchases()` returns the purchases the
 * signed-in Play account owns for this app; the backend re-syncs each one.
 */
export async function restorePlayPurchases() {
  const service = await getService();
  const purchases = await service.listPurchases();
  const list = (purchases || [])
    .filter(p => p?.purchaseToken)
    .map(p => ({ product_id: p.itemId, purchase_token: p.purchaseToken }));
  if (!list.length) return { restored: 0 };
  const { data } = await iapApi.restoreGoogle({ purchases: list });
  return { restored: data?.restored || 0, results: data?.results || [] };
}
