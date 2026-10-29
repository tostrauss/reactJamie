// One-off config for the paywall screenshot harness (shot/run.cjs).
// Aliases swap the platform/IAP/api modules for mocks so the ProModal renders
// the full iOS App-Store paywall in a desktop browser. Not used by the app.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const m = (f) => fileURLToPath(new URL(`./shot/mocks/${f}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@stripe\/stripe-js$/, replacement: m('stripe.js') },
      { find: /^@stripe\/react-stripe-js$/, replacement: m('react-stripe.js') },
      { find: /.*[\\/]utils[\\/]platform(\.js)?$/, replacement: m('platform.js') },
      { find: /.*[\\/]utils[\\/]iap(\.js)?$/, replacement: m('iap.js') },
      { find: /.*[\\/]utils[\\/]playBilling(\.js)?$/, replacement: m('playBilling.js') },
      { find: /.*[\\/]utils[\\/]api(\.js)?$/, replacement: m('api.js') },
      { find: /.*[\\/]utils[\\/]paymentsConfig(\.js)?$/, replacement: m('paymentsConfig.js') },
      { find: /.*[\\/]context[\\/]ToastContext(\.jsx)?$/, replacement: m('toast.js') },
    ],
  },
});
