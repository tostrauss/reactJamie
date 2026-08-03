// Custom Service Worker — processed by vite-plugin-pwa (injectManifest strategy).
// vite-plugin-pwa injects self.__WB_MANIFEST (the precache manifest) at build time.

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, setCatchHandler, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Precache all build assets (manifest injected by vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── Cross-account cache safety ──────────────────────────────────────────────
// The runtime API caches key entries by URL only (auth travels via cookie /
// Authorization header, neither of which is in the cache key). On a SHARED
// device that let user B be served user A's cached /api responses (joined
// groups, DM previews). The app posts CLEAR_API_CACHE on logout AND on login;
// we drop every runtime API cache so nothing leaks across accounts.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_API_CACHE') {
    event.waitUntil(Promise.all([
      caches.delete('api-cache'),
      caches.delete('request-bubbles-cache'),
    ]));
  }
});

// Take over immediately on every update. Without this a redeploy left returning
// visitors on the OLD worker until all tabs closed — and because the cached
// index.html referenced eager chunk hashes (vendor-sentry/-socket) that no
// longer existed on the server, the entry module 404'd and the app booted to a
// blank screen (only the cached CSS painted the background). skipWaiting + claim
// make each new worker activate and control open pages on the next load.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Runtime: Unsplash images — long-lived, cache-first
registerRoute(
  ({ url }) => url.origin === 'https://images.unsplash.com',
  new CacheFirst({
    cacheName: 'unsplash-images',
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 })]
  })
);

// Owner join-request bubbles are per-user AND time-sensitive: they must reflect
// a brand-new pending request immediately. The /api/map SWR route below would
// otherwise serve them stale — the classic "map shows no bubble even though the
// request is pending" (Tobi 2026-07-31: SWR returned the old empty list from
// cache while the fresh one only landed in the background). MUST be registered
// BEFORE the feed route (Workbox = first matching route wins). Network-first so
// online is always fresh; the tiny cache is just an offline courtesy.
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname === '/api/map/request-bubbles',
  new NetworkFirst({
    cacheName: 'request-bubbles-cache',
    networkTimeoutSeconds: 8,
    plugins: [new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 60 })]
  })
);

// Runtime: read-only API endpoints — NETWORK-FIRST (was stale-while-revalidate
// for groups/map/deals). SWR served ≤2-min-old data first and the fresh copy
// only landed in the cache, so the page that fetched never saw it — that's what
// kept the nav unread badge stale ("die 1 bleibt stehen") even after read, and
// showed pre-join rosters / pre-redeem deal CTAs. It was also user-specific data
// keyed by URL (the feed is age/country/Pro-filtered per caller), so SWR could
// serve one user's feed to another. Network-first: online is ALWAYS fresh; the
// cache is only an offline fallback (and is purged on logout, above).
// IMPORTANT: only GET — never cache POST/PUT/DELETE (mutations must reach the server).
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 8,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 5 })]
  })
);

// ── Offline navigation fallback ─────────────────────────────────────────────
// Serve the precached app shell for ANY navigation (deep routes included) when
// offline. Without a NavigationRoute, a navigation to /chats etc. matched no
// route and fell through to the browser's "no internet" page even though the
// whole build is precached. createHandlerBoundToURL resolves the revisioned
// precache entry correctly (a plain caches.match('/index.html') misses it).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// ==========================================
// OFFLINE FALLBACK
// ==========================================
// When a navigation request (page load) fails because we're offline,
// serve the cached index.html so the React app can render an offline state
// instead of the browser's "no internet" error page.
setCatchHandler(async ({ event, request }) => {
  const req = request || event?.request;
  if (req?.destination === 'document') {
    // Resolve the REVISIONED precache entry (a bare caches.match('/index.html')
    // misses it) and await it — the old `caches.match(...) ?? Response.error()`
    // returned a Promise (always truthy), so the fallback never triggered.
    const shell = await createHandlerBoundToURL('/index.html')({ event, request: req }).catch(() => null);
    return shell || Response.error();
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
  const tag = `jamie-${url.replace(/\//g, '-').replace(/^-/, '')}`;

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
