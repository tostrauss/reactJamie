import { describe, it, expect, vi, beforeEach } from 'vitest';

// Build 1.4.3 (12), Sentry 08.10.2026: "Purchases.then()" is not implemented
// on ios. A Capacitor plugin is a Proxy that answers EVERY property name with
// a native call, `then` included. Whenever utils/iap.js handed the plugin out
// as the resolution value of a promise, the promise machinery took it for a
// thenable, called Purchases.then(resolve, reject) — rejected natively — and
// never settled: RevenueCat was never configured and the Pro sheet spun
// forever. These tests push the REAL Capacitor proxy (registerPlugin with a
// web implementation; on the web it fails the same way as on iOS) through
// every iap.js entry point.
const native = vi.hoisted(() => ({
  calls: [], products: [], hang: false, purchaseError: null, logInError: null, platform: { ios: true },
}));

vi.mock('../utils/platform', () => ({ isNativeIOS: () => native.platform.ios }));
vi.mock('../utils/sentry', () => ({ captureException: vi.fn() }));
vi.mock('../utils/api', () => ({
  iap: {
    getConfig: vi.fn(async () => ({ data: { payments_enabled: true, ios_iap_enabled: true, revenuecat: { ios_api_key: 'appl_test' } } })),
    syncRevenueCat: vi.fn(async () => ({ data: { is_pro: true, status: 'active' } })),
  },
}));
vi.mock('@revenuecat/purchases-capacitor', async () => {
  const { registerPlugin } = await import('@capacitor/core');
  const impl = {
    isConfigured: async () => ({ isConfigured: native.calls.some(([m]) => m === 'configure') }),
    configure: async (opts) => { native.calls.push(['configure', opts]); },
    logIn: async (opts) => {
      native.calls.push(['logIn', opts]);
      if (native.logInError) throw native.logInError;
      return { customerInfo: {}, created: false };
    },
    getProducts: (opts) => {
      native.calls.push(['getProducts', opts]);
      return native.hang ? new Promise(() => {}) : Promise.resolve({ products: native.products });
    },
    checkTrialOrIntroductoryPriceEligibility: async () => ({}),
    purchaseStoreProduct: async (opts) => {
      native.calls.push(['purchaseStoreProduct', opts]);
      if (native.purchaseError) throw native.purchaseError;
      return { customerInfo: {} };
    },
    restorePurchases: async () => { native.calls.push(['restorePurchases']); return { customerInfo: {} }; },
  };
  return { Purchases: registerPlugin('Purchases', { web: () => impl }) };
});

const { setPaymentsConfig } = await import('../utils/paymentsConfig');
const iap = await import('../utils/iap');
const api = await import('../utils/api');
const { captureException } = await import('../utils/sentry');

// A promise that hangs is the bug — fail fast instead of at the test timeout.
const settles = (p, ms = 1500) => Promise.race([
  p.then(() => 'settled', () => 'settled'),
  new Promise((resolve) => setTimeout(() => resolve('NEVER SETTLED'), ms)),
]);

const storeProduct = (identifier, price, priceString) => ({
  identifier, price, priceString, pricePerMonth: price, pricePerMonthString: priceString,
  currencyCode: 'EUR', introPrice: null,
});

beforeEach(() => {
  native.platform.ios = true;
  native.hang = false;
  native.purchaseError = null;
  native.logInError = null;
  native.products = [
    storeProduct('pro_monthly', 6.99, '6,99 €'),
    storeProduct('pro_sixmonth', 29.99, '29,99 €'),
    storeProduct('pro_yearly', 49.99, '49,99 €'),
  ];
  setPaymentsConfig({ payments_enabled: true, ios_iap_enabled: true, revenuecat: { ios_api_key: 'appl_test' } });
});

describe('utils/iap.js through the real Capacitor plugin proxy', () => {
  it('the plugin object answers `then` — the trap the wrapper guards against', async () => {
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    expect(typeof Purchases.then).toBe('function');
  });

  it('identifyIapUser settles and configures RevenueCat with the JAMIE user id', async () => {
    expect(await settles(iap.identifyIapUser('42'))).toBe('settled');
    expect(native.calls).toContainEqual(['configure', { apiKey: 'appl_test', appUserID: '42' }]);
  });

  it('getIosProducts settles with the three plans from StoreKit', async () => {
    await iap.identifyIapUser('42');
    const result = iap.getIosProducts();
    expect(await settles(result)).toBe('settled');
    const byPlan = await result;
    expect(Object.keys(byPlan).sort()).toEqual(['monthly', 'sixmonth', 'yearly']);
    expect(byPlan.sixmonth).toMatchObject({ productId: 'pro_sixmonth', priceString: '29,99 €' });
  });

  it('subscribePro settles, buys the chosen StoreKit product and asks the server', async () => {
    await iap.identifyIapUser('42');
    api.iap.syncRevenueCat.mockClear();
    const result = iap.subscribePro('sixmonth');
    expect(await settles(result)).toBe('settled');
    expect(await result).toMatchObject({ is_pro: true });
    expect(native.calls).toContainEqual(
      ['purchaseStoreProduct', { product: expect.objectContaining({ identifier: 'pro_sixmonth' }) }]);
    expect(api.iap.syncRevenueCat).toHaveBeenCalled();
  });

  it('subscribePro rejects with "cancelled" when the user closes the Apple sheet', async () => {
    await iap.identifyIapUser('42');
    native.purchaseError = { userCancelled: true };
    const result = iap.subscribePro('monthly');
    expect(await settles(result)).toBe('settled');
    await expect(result).rejects.toThrow('cancelled');
  });

  it('a failed RevenueCat logIn on an account switch never buys for the previous account', async () => {
    await iap.identifyIapUser('50');
    native.logInError = new Error('network down');
    await iap.identifyIapUser('51');           // switch fails: RevenueCat would still be on 50
    native.calls.length = 0;
    await expect(iap.subscribePro('monthly')).rejects.toThrow(/neu starten/);
    expect(native.calls.some(([m]) => m === 'purchaseStoreProduct')).toBe(false);
    native.logInError = null;
    await iap.identifyIapUser('51');           // a later successful switch sells again
    await expect(iap.subscribePro('monthly')).resolves.toMatchObject({ is_pro: true });
  });

  it('restorePurchases settles and asks the server for the entitlement', async () => {
    await iap.identifyIapUser('42');
    const result = iap.restorePurchases();
    expect(await settles(result)).toBe('settled');
    expect(await result).toEqual({ restored: 1 });
    expect(native.calls).toContainEqual(['restorePurchases']);
  });

  it('a StoreKit answer without our subscriptions is reported and not cached', async () => {
    await iap.identifyIapUser('43');           // new user → fresh product cache
    native.products = [];
    expect(await iap.getIosProducts()).toEqual({});
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('pro_monthly') }),
      expect.anything(),
    );
    native.products = [storeProduct('pro_yearly', 49.99, '49,99 €')];
    expect(Object.keys(await iap.getIosProducts())).toEqual(['yearly']);   // asked StoreKit again
  });

  it('a StoreKit call that never answers gives up after 20 s instead of spinning forever', async () => {
    await iap.identifyIapUser('44');           // new user → fresh product cache
    native.hang = true;
    vi.useFakeTimers();
    try {
      const result = iap.getIosProducts();
      const outcome = result.then(() => 'resolved', (err) => err);
      await vi.advanceTimersByTimeAsync(20000);
      const err = await outcome;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/antworten gerade nicht/);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('products did not answer') }),
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('loadPaymentsConfig tells the server which purchase glue asks', () => {
  it('the iOS app sends its glue version (the server offers purchases only to fixed bundles)', async () => {
    api.iap.getConfig.mockClear();
    await iap.loadPaymentsConfig();
    expect(api.iap.getConfig).toHaveBeenCalledWith({ iap_client: 2 });
    expect(iap.IAP_CLIENT_VERSION).toBe(2);
  });

  it('web and Android send no build', async () => {
    native.platform.ios = false;
    api.iap.getConfig.mockClear();
    await iap.loadPaymentsConfig();
    expect(api.iap.getConfig).toHaveBeenCalledWith(undefined);
  });
});
