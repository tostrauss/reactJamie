// Screenshot harness mock: pretend to be the native iOS app with IAP live,
// so the ProModal renders the full App-Store paywall (tiles + CTA + terms).
export const isNative = () => true;
export const isNativeIOS = () => true;
export const isNativeAndroid = () => false;
export const isTWA = () => false;
export const isIOSWeb = () => false;
export const isIOSWebStandalone = () => false;
export const isAndroidWeb = () => false;
export const displayMode = () => 'standalone';
export const pushSettingsLocation = () => 'native';
export const isAppShell = () => true;
export const NATIVE_API_ORIGIN = 'https://api.jamie-app.com';
export const paymentsEnabled = () => true;
export const isIosIapActive = () => true;
export const isPlayBillingSupported = () => false;
export const isPlayBillingActive = () => false;
export const isStoreBillingActive = () => true;
export const purchasesEnabled = () => true;
export const proUpsellAllowed = () => true;
export const paymentsComingSoon = () => false;
