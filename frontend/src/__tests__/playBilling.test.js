import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeStorage } from '../utils/safeStorage';

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
  safeStorage.removeItem('jamie_payments_config_v1');   // cached payments config
  savedDGS = window.getDigitalGoodsService;
  delete window.getDigitalGoodsService;
  setReferrer('');
});
afterEach(() => {
  if (savedDGS) window.getDigitalGoodsService = savedDGS; else delete window.getDigitalGoodsService;
  setReferrer('');
});

// Since 23.09.2026 the switches come from the SERVER at runtime
// (GET /api/iap/config → utils/paymentsConfig.js), because the iOS app bundles
// the web build and compiled-in consts froze until the next App Store release.
const setConfig = async (cfg) => {
  const m = await import('../utils/paymentsConfig');
  m.setPaymentsConfig(cfg);
};
const fakeIOS = () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }; };

describe('platform.js — runtime payment switches', () => {
  beforeEach(() => { delete window.Capacitor; });
  afterEach(() => { delete window.Capacitor; });

  it('everything is OFF until the server says otherwise (fail-closed)', async () => {
    const p = await loadPlatform();
    expect(p.paymentsEnabled()).toBe(false);
    expect(p.purchasesEnabled()).toBe(false);
    expect(p.isIosIapActive()).toBe(false);
    expect(p.isPlayBillingActive()).toBe(false);
    expect(p.paymentsComingSoon()).toBe(true);
  });

  it('web browser: payments_enabled alone opens Stripe', async () => {
    const p = await loadPlatform();
    await setConfig({ payments_enabled: true });
    expect(p.purchasesEnabled()).toBe(true);
    expect(p.proUpsellAllowed()).toBe(true);
  });

  it('iOS app: no purchases, no upsell until ios_iap_enabled', async () => {
    fakeIOS();
    const p = await loadPlatform();
    await setConfig({ payments_enabled: true, ios_iap_enabled: false });
    expect(p.purchasesEnabled()).toBe(false);       // never Stripe inside the app
    expect(p.proUpsellAllowed()).toBe(false);       // Apple 3.1.1
    expect(p.paymentsComingSoon()).toBe(false);     // iOS stays neutral, no teaser

    await setConfig({ payments_enabled: true, ios_iap_enabled: true });
    expect(p.isIosIapActive()).toBe(true);
    expect(p.purchasesEnabled()).toBe(true);
    expect(p.proUpsellAllowed()).toBe(true);
    expect(p.isStoreBillingActive()).toBe(true);
  });

  it('the config survives a restart via the local cache', async () => {
    // This test env has no working localStorage, so back safeStorage with a Map.
    const mem = new Map();
    vi.doMock('../utils/safeStorage', () => ({
      safeStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) },
    }));
    try {
      vi.resetModules();
      (await import('../utils/paymentsConfig')).setPaymentsConfig({ payments_enabled: true, ios_iap_enabled: true });
      vi.resetModules();   // "restart": fresh module reads the cache
      const m = await import('../utils/paymentsConfig');
      expect(m.getPaymentsConfig()).toMatchObject({ payments_enabled: true, ios_iap_enabled: true });
    } finally {
      vi.doUnmock('../utils/safeStorage');
    }
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
      expect(p.isPlayBillingActive()).toBe(false);   // server config: play_billing_enabled false
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
    const { PRO_PLAN_TO_PRODUCT_ID } = await import('../utils/iap');
    expect(PRO_PLAN_TO_PLAY_PRODUCT_ID).toEqual(PRO_PLAN_TO_PRODUCT_ID);
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
