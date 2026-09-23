/**
 * Runtime payments config from GET /api/iap/config.
 *
 * Until 23.09.2026 the purchase switches were consts in platform.js. The iOS
 * app bundles the web build, so a const froze the decision until the next App
 * Store release: flipping payments on would have needed a new iOS build plus
 * review. Now the server decides (Railway env: PAYMENTS_ENABLED,
 * IOS_IAP_ENABLED, PLAY_BILLING_ENABLED) and every client reads it at start.
 *
 * Fail-closed: until the config has loaded, and whenever it can't be fetched,
 * everything is OFF (the "Bald verfügbar" / neutral state). The last known
 * config is cached so a cold start can show it immediately; the fresh fetch
 * then confirms or corrects it.
 *
 * No app imports besides safeStorage on purpose: platform.js reads this
 * module, and api.js imports platform.js. The fetch lives in
 * loadPaymentsConfig (utils/iap.js).
 */
import { useSyncExternalStore } from 'react';
import { safeStorage } from './safeStorage';

const CACHE_KEY = 'jamie_payments_config_v1';

export const DEFAULT_PAYMENTS_CONFIG = Object.freeze({
  payments_enabled: false,
  ios_iap_enabled: false,
  play_billing_enabled: false,
  revenuecat: { ios_api_key: null, entitlement: 'pro' },
});

const normalize = (raw) => ({
  payments_enabled: raw?.payments_enabled === true,
  ios_iap_enabled: raw?.ios_iap_enabled === true,
  play_billing_enabled: raw?.play_billing_enabled === true,
  revenuecat: {
    ios_api_key: typeof raw?.revenuecat?.ios_api_key === 'string' ? raw.revenuecat.ios_api_key : null,
    entitlement: raw?.revenuecat?.entitlement || 'pro',
  },
});

let config = (() => {
  try {
    const cached = safeStorage.getItem(CACHE_KEY);
    return cached ? normalize(JSON.parse(cached)) : DEFAULT_PAYMENTS_CONFIG;
  } catch {
    return DEFAULT_PAYMENTS_CONFIG;   // corrupt JSON
  }
})();

const listeners = new Set();

export const getPaymentsConfig = () => config;

export function setPaymentsConfig(raw) {
  config = normalize(raw);
  safeStorage.setItem(CACHE_KEY, JSON.stringify(config));
  listeners.forEach((l) => l());
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Re-renders the calling component when the config changes. Call it at the
 * top of any component whose render reads purchasesEnabled() / iOS-IAP gates,
 * so a config that arrives after mount still shows the purchase UI.
 */
export const usePaymentsConfig = () => useSyncExternalStore(subscribe, getPaymentsConfig, getPaymentsConfig);
