import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// isTWA() latches its result in a module-level cache, so every scenario loads
// a FRESH copy of platform.js via resetModules + dynamic import.
const loadPlatform = async () => {
  vi.resetModules();
  return import('../utils/platform');
};

const setReferrer = (value) => Object.defineProperty(document, 'referrer', { value, configurable: true });

let savedDGS;
beforeEach(() => {
  sessionStorage.clear();
  savedDGS = window.getDigitalGoodsService;
  delete window.getDigitalGoodsService;
  setReferrer('');
});
afterEach(() => {
  if (savedDGS) window.getDigitalGoodsService = savedDGS; else delete window.getDigitalGoodsService;
  setReferrer('');
});

describe('platform.js — shipped switches', () => {
  it('Play Billing, payments and iOS IAP all ship OFF (flipped only per runbook, server first)', async () => {
    const p = await loadPlatform();
    expect(p.PLAY_BILLING_ENABLED).toBe(false);
    expect(p.PAYMENTS_ENABLED).toBe(false);
    expect(p.IOS_IAP_ENABLED).toBe(false);
  });
});

describe('platform.js — Play Billing detection (real module)', () => {
  it('plain browser: not a TWA, Digital Goods API absent', async () => {
    const p = await loadPlatform();
    expect(p.isTWA()).toBe(false);
    expect(p.isPlayBillingSupported()).toBe(false);
    expect(p.isPlayBillingActive()).toBe(false);
  });

  it('TWA is recognised only for OUR package referrer and latched in sessionStorage', async () => {
    setReferrer('android-app://jamie.app');
    let p = await loadPlatform();
    expect(p.isTWA()).toBe(true);
    expect(sessionStorage.getItem('jamie_twa')).toBe('1');

    // Hard reload inside the TWA drops the referrer — the latch keeps us in TWA mode.
    setReferrer('');
    p = await loadPlatform();
    expect(p.isTWA()).toBe(true);
  });

  it('a link opened FROM another app is NOT a TWA', async () => {
    setReferrer('android-app://com.whatsapp');
    const p = await loadPlatform();
    expect(p.isTWA()).toBe(false);
  });

  it('isPlayBillingSupported needs BOTH getDigitalGoodsService and PaymentRequest', async () => {
    const p = await loadPlatform();
    const savedPR = window.PaymentRequest;
    try {
      window.getDigitalGoodsService = async () => ({});
      window.PaymentRequest = function PaymentRequest() {};
      expect(p.isPlayBillingSupported()).toBe(true);
      delete window.PaymentRequest;
      expect(p.isPlayBillingSupported()).toBe(false);
    } finally {
      if (savedPR) window.PaymentRequest = savedPR; else delete window.PaymentRequest;
    }
  });

  it('with the flag OFF, a fully capable NEW Play build still gets NO purchases (rollback path)', async () => {
    setReferrer('android-app://jamie.app');
    window.getDigitalGoodsService = async () => ({});
    const savedPR = window.PaymentRequest;
    window.PaymentRequest = function PaymentRequest() {};
    try {
      const p = await loadPlatform();
      expect(p.isTWA()).toBe(true);
      expect(p.isPlayBillingSupported()).toBe(true);
      expect(p.isPlayBillingActive()).toBe(false);   // PLAY_BILLING_ENABLED = false
      expect(p.purchasesEnabled()).toBe(false);      // never Stripe inside the Play app
      expect(p.paymentsComingSoon()).toBe(true);     // teaser + InterestButton instead
    } finally {
      if (savedPR) window.PaymentRequest = savedPR; else delete window.PaymentRequest;
    }
  });

  it('no single-boost purchase helper exists any more (boosts are Pro-only since 21.09.2026)', async () => {
    const p = await loadPlatform();
    expect(p.boostPurchasesEnabled).toBeUndefined();
  });
});

describe('playBilling.js', () => {
  it('product ids mirror the Apple ids exactly — one catalogue across stores', async () => {
    const { PRO_PLAN_TO_PLAY_PRODUCT_ID, PLAY_BILLING_METHOD, PLAY_SUBSCRIPTIONS_URL } = await import('../utils/playBilling');
    // Literal, not imported from utils/iap.js: that module's dynamic import of
    // the (non-existent) StoreKit plugin cannot be resolved by vitest.
    expect(PRO_PLAN_TO_PLAY_PRODUCT_ID).toEqual({ monthly: 'pro_monthly', sixmonth: 'pro_sixmonth', yearly: 'pro_yearly' });
    expect(Object.keys(PRO_PLAN_TO_PLAY_PRODUCT_ID).sort()).toEqual(['monthly', 'sixmonth', 'yearly']);
    expect(PLAY_BILLING_METHOD).toBe('https://play.google.com/billing');
    expect(PLAY_SUBSCRIPTIONS_URL).toContain('package=jamie.app');
  });

  it('purchase / restore / details degrade gracefully outside the Play app', async () => {
    const { purchasePlaySubscription, restorePlayPurchases, getPlayProductDetails, PlayBillingUnavailableError } =
      await import('../utils/playBilling');
    await expect(purchasePlaySubscription('monthly')).rejects.toBeInstanceOf(PlayBillingUnavailableError);
    await expect(restorePlayPurchases()).rejects.toBeInstanceOf(PlayBillingUnavailableError);
    await expect(purchasePlaySubscription('weekly')).rejects.toThrow(/Unknown pro plan/);
    await expect(getPlayProductDetails()).resolves.toEqual({});   // tiles fall back to our prices
  });
});
