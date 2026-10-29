// Screenshot harness mock: config is "everything on", no store subscription.
const CONFIG = Object.freeze({
  payments_enabled: true,
  ios_iap_enabled: true,
  play_billing_enabled: false,
  revenuecat: { ios_api_key: 'harness', entitlement: 'pro' },
});
export const DEFAULT_PAYMENTS_CONFIG = CONFIG;
export const getPaymentsConfig = () => CONFIG;
export const setPaymentsConfig = () => {};
export const usePaymentsConfig = () => CONFIG;
