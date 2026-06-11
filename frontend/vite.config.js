import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.js',
    css: false,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['icon.svg', 'favicon.ico', 'pwa-64x64.png', 'pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png', 'apple-touch-icon-180x180.png'],
      manifest: false, // Use our custom manifest.json in public/
      injectManifest: {
        // Only precache the shell: HTML + CSS + React core + main entry
        // All page chunks are lazy-loaded on-demand — no need to prefetch 900 kB upfront
        globPatterns: [
          '**/*.{html,css}',
          'assets/vendor-react-*.js',
          'assets/index-*.js',
        ],
        maximumFileSizeToCacheInBytes: 500 * 1024, // skip files >500 kB (main bundle is ~360 kB)
      }
    }),
    // Uploads source maps to Sentry during CI builds — no-op if auth token absent
    ...(process.env.SENTRY_AUTH_TOKEN ? [sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
    })] : []),
  ],
  build: {
    // Target browsers from ~2020: covers iOS 14+, Android Chrome 87+, Firefox 78 (ESR).
    // Avoids the esnext default which breaks on older WebViews (Android 8/9, iOS 13).
    target: ['chrome87', 'firefox78', 'safari14', 'edge88'],
    sourcemap: 'hidden', // generates maps for Sentry upload but does NOT embed URL in bundle
    rollupOptions: {
      // iap.js dynamically imports this StoreKit plugin, but the package does
      // not exist on npm yet (plugin choice pending — store/STOREKIT-SETUP.md).
      // Externalize so Rollup skips resolution; the import only runs behind an
      // isNativeIOS() guard and its .catch degrades to IapUnavailableError.
      external: ['@capacitor-community/in-app-purchases'],
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-socket': ['socket.io-client'],
          'vendor-stripe': ['@stripe/stripe-js', '@stripe/react-stripe-js'],
          'vendor-map': ['@react-google-maps/api'],
          'vendor-sentry': ['@sentry/react'],
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
      // Proxy local uploads in dev (cloud storage is used in production)
      '/uploads': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
