// Custom Service Worker — processed by vite-plugin-pwa (injectManifest strategy).
// vite-plugin-pwa injects self.__WB_MANIFEST (the precache manifest) at build time.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Precache all build assets (manifest injected by vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Runtime: Unsplash images — long-lived, cache-first
registerRoute(
  ({ url }) => url.origin === 'https://images.unsplash.com',
  new CacheFirst({
    cacheName: 'unsplash-images',
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 })]
  })
);

// Runtime: groups/map/deals feed — stale-while-revalidate makes the home page feel instant.
// Serve cached version immediately, refresh in background. Only cache GET requests.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    (url.pathname.startsWith('/api/groups') ||
     url.pathname.startsWith('/api/map') ||
     url.pathname.startsWith('/api/deals')),
  new StaleWhileRevalidate({
    cacheName: 'feed-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 2 })]
  })
);

// Runtime: other read-only API endpoints — network-first with 5-min offline fallback.
// IMPORTANT: only cache GET — never cache POST/PUT/DELETE (mutations must reach the server).
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 8,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 5 })]
  })
);

// ==========================================
// OFFLINE FALLBACK
// ==========================================
// When a navigation request (page load) fails because we're offline,
// serve the cached index.html so the React app can render an offline state
// instead of the browser's "no internet" error page.
setCatchHandler(async ({ event }) => {
  if (event.request.destination === 'document') {
    return caches.match('/index.html') ?? Response.error();
  }
  return Response.error();
});

// ==========================================
// PUSH NOTIFICATIONS
// ==========================================
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: 'JAMIE', body: event.data.text() };
  }

  const { title = 'JAMIE', body = '', url = '/notifications' } = data;

  // Use the target URL as the tag so each distinct destination gets its own
  // notification slot — DMs to different users don't replace each other.
  const tag = `jamie-${url.replace(/\//g, '-').replace(/^-/, '')}` || 'jamie-notification';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      data: { url },
      vibrate: [200, 100, 200],
      renotify: true,
      tag,
    })
  );
});

// ==========================================
// NOTIFICATION CLICK → open / focus app
// ==========================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/notifications';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open a new window
      return clients.openWindow(url);
    })
  );
});
