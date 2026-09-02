// backend/src/server.js
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import db from './config/database.js';
import { runStartupMigrations, getMigrationHealth } from './config/migrations.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import pinoHttp from 'pino-http';
import cron from 'node-cron';
import { initSentry, Sentry } from './config/sentry.js';
import { redisClient, redisSubscriber } from './config/redis.js';
import { createAdapter } from '@socket.io/redis-adapter';
import { generalLimiter, authLimiter } from './middleware/rateLimiter.js';
import { sanitizeInputs } from './middleware/sanitize.js';

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
initSentry(); // Must run before Express setup to capture all errors

// ── Production boot-time env var validation ───────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const REQUIRED = [
    ['JWT_SECRET',        'JWT token signing key'],
    ['DATABASE_URL',      'PostgreSQL connection string'],
    ['EMAIL_FROM',        'verified sender address (e.g. noreply@jamie-app.com)'],
    ['RESEND_API_KEY',    'Resend transactional email API key (used by utils/email.js via api.resend.com)'],
    ['FRONTEND_URL',      'public frontend URL for email links'],
    // Cloud storage — production has no local /uploads serving, so missing keys mean every upload returns a URL that 404s
    ['STORAGE_ENDPOINT',  'Cloudflare R2 / S3 endpoint URL'],
    ['STORAGE_ACCESS_KEY','Cloud storage access key'],
    ['STORAGE_SECRET_KEY','Cloud storage secret key'],
    ['STORAGE_BUCKET',    'Cloud storage bucket name'],
    ['STORAGE_PUBLIC_URL','Public-read base URL for uploaded files'],
    // Web push — missing keys cause sendPushToUser to silently return, so notifications die without warning
    ['VAPID_PUBLIC_KEY',  'Web Push VAPID public key'],
    ['VAPID_PRIVATE_KEY', 'Web Push VAPID private key'],
    // Observability — without DSN, captureException is a no-op and day-1 crashes are invisible
    ['SENTRY_DSN',        'Sentry error reporting DSN'],
  ];

  let fatal = false;

  // Secrets must have sufficient entropy and must not be placeholder values
  for (const key of ['JWT_SECRET']) {
    const val = process.env[key] || '';
    if (val.length < 32) {
      console.error(`FATAL: ${key} is too short (${val.length} chars) — use at least 32 random characters`);
      fatal = true;
    }
    if (val.includes('CHANGE_ME') || val.includes('change_me') || val.includes('your_secret')) {
      console.error(`FATAL: ${key} is still a placeholder — generate a real secret`);
      fatal = true;
    }
  }
  const WARNED = [
    ['SIGHTENGINE_API_USER',   'image moderation (nudity/gore) will be DISABLED'],
    ['SIGHTENGINE_API_SECRET', 'image moderation (nudity/gore) will be DISABLED'],
    ['OPENAI_API_KEY',         'text moderation will be DISABLED — unsafe content may pass through'],
    ['STRIPE_SUBSCRIPTION_WEBHOOK_SECRET', 'Stripe subscription webhook signature validation will FAIL'],
    // Boost credit purchases: without this secret the /api/boost webhook returns
    // 503, so a customer's card IS charged but credits are NEVER applied. Warned
    // (not required) so the app still boots when boosts aren't sold yet.
    ['STRIPE_WEBHOOK_SECRET',  'Boost credit purchases will be CHARGED but never credited — webhook signature validation will FAIL'],
    ['STRIPE_PUBLISHABLE_KEY', 'Stripe checkout cannot render on the client — boost + Pro purchases will be unbuyable'],
    ['GOOGLE_CLIENT_ID',                   'Google OAuth will use unverified userinfo endpoint (reduced security)'],
    // APNs (iOS push) — without these, all iOS Capacitor users get zero push notifications.
    // Listed in WARNED rather than REQUIRED so the backend can still boot before iOS keys are issued.
    ['APNS_KEY_ID',    'iOS push notifications will be DISABLED'],
    ['APNS_TEAM_ID',   'iOS push notifications will be DISABLED'],
    ['APNS_KEY',       'iOS push notifications will be DISABLED'],
    ['APNS_BUNDLE_ID', 'iOS push notifications will be DISABLED'],
  ];
  for (const [key, desc] of REQUIRED) {
    if (!process.env[key]) {
      console.error(`FATAL: Missing required env var ${key} — ${desc}`);
      fatal = true;
    }
  }
  if (process.env.DISABLE_RATE_LIMIT === 'true') {
    console.error('FATAL: DISABLE_RATE_LIMIT must not be set in production');
    fatal = true;
  }
  // Set REQUIRE_REDIS=true the moment replica count can exceed 1: without
  // Redis, every rate limit multiplies per replica and Socket.IO fan-out
  // splits per instance (chat silently stops across replicas) while health
  // still returns 200. Fail the boot rather than degrade invisibly.
  if (process.env.REQUIRE_REDIS === 'true' && !process.env.REDIS_URL) {
    console.error('FATAL: REQUIRE_REDIS=true but REDIS_URL is not set — refusing to boot without cross-replica Redis');
    fatal = true;
  }
  if (process.env.REQUIRE_REDIS !== 'true' && !process.env.REDIS_URL) {
    // Single-instance is legitimate today, but this must never be invisible in
    // an incident review — surface it in Sentry, not only a boot log line.
    Sentry.captureMessage('REDIS_URL not set — rate limits and socket fan-out are single-instance only; do NOT scale replicas', 'warning');
  }

  if (fatal) process.exit(1);

  for (const [key, warn] of WARNED) {
    if (!process.env[key]) {
      console.warn(`WARNING: Missing env var ${key} — ${warn}`);
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
// Railway sits one proxy hop in front of us; hop count 1 makes req.ip the real
// client for the per-IP credential limiters (authLimiter & co. key on req.ip).
// If the topology ever adds a layer (CDN, extra LB), req.ip silently becomes
// an edge IP and those limiters collapse into ONE shared budget for the whole
// audience — verify with GET /api/admin/ip-diagnostics on prod and correct via
// the TRUST_PROXY_HOPS env var instead of a code change.
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10);
app.set('trust proxy', Number.isNaN(trustProxyHops) ? 1 : trustProxyHops);
console.log(`[boot] trust proxy = ${app.get('trust proxy')}`);

// Which build is this instance running? Railway injects the deploy's git SHA;
// surfaced in the boot log (always) and the non-prod health body so a rollback
// or a mixed-replica deploy is verifiable in seconds. Prod health stays
// {status}-only by design (no infra fingerprinting).
const APP_VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev';
const server = http.createServer(app);
// Protect against slow-client / Slowloris attacks
server.keepAliveTimeout = 65_000; // 65s — must exceed Railway LB idle timeout (60s)
server.headersTimeout  = 66_000; // 1s > keepAliveTimeout

// ==========================================
// ROUTE IMPORTS
// ==========================================
import authRoutes from './routes/authRoutes.js';
import groupRoutes from './routes/groupRoutes.js';
import clubRoutes from './routes/clubRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import userRoutes from './routes/userRoutes.js';
import dmRoutes from './routes/dmRoutes.js';
import friendshipRoutes from './routes/friendshipRoutes.js';
import spotifyRoutes from './routes/spotifyRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import pushRoutes from './routes/pushRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import { subscriptionWebhook } from './controllers/subscriptionController.js';
import { runDailyRollup, backfillIfEmpty } from './jobs/analyticsRollup.js';
import { runDbBackup, isBackupConfigured, missingBackupEnv, getBackupConfig } from './jobs/backup.js';
import { runMediaBackupSync } from './jobs/mediaBackupSync.js';
import { stripeWebhook as boostStripeWebhook } from './controllers/boostController.js';
import { appleServerNotification } from './controllers/iapController.js';
import { sendPushToUser, sendPushToUsers } from './controllers/pushController.js';
import { categoryDigestText } from './utils/pushLocale.js';
import boostRoutes from './routes/boostRoutes.js';
import iapRoutes from './routes/iapRoutes.js';
import mapRoutes from './routes/mapRoutes.js';
import waitlistRoutes from './routes/waitlistRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import dealRoutes from './routes/dealRoutes.js';
import suggestionRoutes from './routes/suggestionRoutes.js';
import featureInterestRoutes from './routes/featureInterestRoutes.js';
import feedbackRoutes from './routes/feedbackRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import socketHandler from './socket.js';

// ==========================================
// SECURITY MIDDLEWARE
// ==========================================

// Helmet: security headers (XSS, clickjacking, MIME sniffing, etc.)
const storageOrigin = process.env.STORAGE_PUBLIC_URL || null;
// During a storage-domain migration (see the rewrite block in
// runStartupMigrations) clients briefly still hold OLD image URLs in cached
// API responses / the SW feed-cache — keep the previous origin CSP-allowed so
// those don't render as broken images mid-transition.
const oldStorageOrigin = process.env.OLD_STORAGE_PUBLIC_URL || null;
// SOCKET_CSP_ORIGIN: backend public URL used for WebSocket (wss:) in CSP.
// In monorepo deployments (frontend + backend same Railway service) this is the same as FRONTEND_URL.
// Set this env var if Socket.IO connects to a different domain than the frontend.
const socketOrigin = process.env.SOCKET_CSP_ORIGIN || null;

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // HSTS: tell browsers to ONLY connect via HTTPS for the next year.
  // Only active when NODE_ENV=production so localhost stays usable on http.
  // Without this an attacker on the same network can SSL-strip cookie/JWT.
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  // X-Frame-Options: prevent the app from being iframed (clickjacking).
  // CSP frame-ancestors is also set below as the modern replacement.
  frameguard: { action: 'deny' },
  // Referrer-Policy: don't send the full URL (which may contain ?token=...)
  // to other origins on cross-origin navigations.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'",
        'wss:', 'ws:', // Socket.IO WebSocket — allow any wss: since backend URL varies by deployment
        'https://api.spotify.com',
        'https://accounts.spotify.com',
        'https://api.stripe.com',
        'https://hooks.stripe.com',
        'https://nominatim.openstreetmap.org',
        // Google Maps JS API serves modules + XHR tiles from multiple subdomains
        // (khms*.googleapis.com, maps.googleapis.com, etc.) — wildcard required.
        'https://*.googleapis.com',
        'https://*.gstatic.com',
        'https://*.ggpht.com', // Street View imagery
        'https://images.unsplash.com',
        'https://sentry.io', 'https://*.sentry.io', // Sentry error reporting
        ...(storageOrigin ? [storageOrigin] : []),
        ...(oldStorageOrigin ? [oldStorageOrigin] : []),
        ...(socketOrigin ? [socketOrigin, socketOrigin.replace('https://', 'wss://')] : []),
      ],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://i.scdn.co',
        'https://images.unsplash.com',
        'https://*.tile.openstreetmap.org',
        'https://lh3.googleusercontent.com', // Google profile pictures
        // Map tiles + raster panes come from sharded subdomains
        // (khms*.googleapis.com, mts*.googleapis.com, etc.) — wildcard required.
        'https://*.googleapis.com',
        'https://*.gstatic.com',
        'https://*.ggpht.com',
        ...(storageOrigin ? [storageOrigin] : []),
        ...(oldStorageOrigin ? [oldStorageOrigin] : []),
      ],
      scriptSrc: [
        "'self'",
        "'unsafe-eval'", // required by Google OAuth GSI script + Google Maps internals
        'https://js.stripe.com',
        'https://accounts.google.com',
        'https://appleid.cdn-apple.com',
        'https://*.googleapis.com',
        'https://*.gstatic.com',
      ],
      frameSrc: [
        'https://js.stripe.com',
        'https://hooks.stripe.com',
        'https://accounts.google.com',
        'https://appleid.apple.com',
      ],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      mediaSrc: ["'self'", 'blob:', 'https://p.scdn.co'],
      workerSrc: ["'self'", 'blob:'], // Service worker + Workbox
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      ...(process.env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
    },
  },
}));

// CORS — supports comma-separated FRONTEND_URL for multiple origins (e.g. Vercel + custom domain)
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map(o => o.trim());

// Native app shells present non-web Origins on cross-origin XHR. CONFIRMED
// via Railway logs from the App Review session (2026-07-06 12:28:30, iPadOS
// 26.5, build 1.0(5)): the reviewer's WKWebView sent
//   Origin: capacitor://app.jamie-app.com
// (scheme falls back to capacitor:// despite iosScheme https on that WebKit),
// the old callback THREW on it → 500 without CORS headers → WebKit blocked
// the response → the app showed the client-generic "Login failed". Older/
// other WebKits may serialize the same origin as "null" or use the default
// capacitor://localhost. These are all OUR OWN clients — CORS is not an auth
// boundary (JWT/httpOnly cookie are), so allow every capacitor:// origin
// plus the known fallbacks explicitly.
const NATIVE_ORIGINS = ['null', 'https://localhost', 'http://localhost'];

const isAllowedOrigin = (origin) =>
  !origin // same-origin requests, curl, server-to-server
  || allowedOrigins.includes(origin)
  || NATIVE_ORIGINS.includes(origin)
  || origin.startsWith('capacitor://'); // Capacitor shell, any hostname/WebKit variant

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    // Deny WITHOUT throwing: a thrown error became a 500 with NO CORS headers,
    // which reads as a network failure in every client. callback(null, false)
    // answers normally but without ACAO — browsers still block cross-origin
    // readers, and we keep a log line to spot new legitimate origins.
    console.warn(`[CORS] denied origin: ${origin}`);
    callback(null, false);
  },
  // PATCH is required by PATCH /api/admin/users/:id/role (api.js → admin.setUserRole).
  // Omitting it only shows up off-origin: the web PWA is served same-origin so it
  // never preflights, but the Capacitor shells call the API cross-origin, so the
  // OPTIONS response advertised GET/POST/PUT/DELETE and the browser blocked the
  // role toggle before it left the device.
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true
}));

// Compression: gzip responses. Level 3 gives ~80% of level-6 savings at ~40% of the CPU cost.
app.use(compression({ level: 3, threshold: 1024 }));

// Request logging — structured JSON in production, human-readable in dev
app.use(pinoHttp({
  autoLogging: { ignore: req => req.url === '/api/health' },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
}));

// ==========================================
// FRONTEND STATIC SERVING — early, before session/body-parsing
// Static assets (JS/CSS/images) never need a session; serving them here
// avoids session-store errors aborting asset requests in production.
// ==========================================
if (process.env.NODE_ENV === 'production') {
  const publicPath = path.resolve(__dirname, '../public');

  // Explicit handlers for the two .well-known files used for app deep links.
  // express.static guesses Content-Type from extension — apple-app-site-association
  // has no extension, so it gets served as application/octet-stream and Apple's
  // CDN rejects it. assetlinks.json has the right extension but Google requires
  // utf-8 application/json with no transformation.
  app.get('/.well-known/apple-app-site-association', (_req, res) => {
    res.type('application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(publicPath, '.well-known', 'apple-app-site-association'));
  });
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    res.type('application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(publicPath, '.well-known', 'assetlinks.json'));
  });

  app.use(express.static(publicPath, {
    setHeaders(res, filePath) {
      // Vite emits hashed filenames (e.g. index-BdEtbxXM.js) — safe to cache forever
      if (/\.[a-f0-9]{8,}\.(js|css|woff2?)(\?.*)?$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('index.html')) {
        // Always revalidate the entry point so clients pick up new deployments immediately
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (filePath.endsWith('sw.js') || filePath.endsWith('sw.mjs') || filePath.endsWith('manifest.json') || filePath.endsWith('manifest.webmanifest')) {
        // The service worker + manifest must NEVER be served stale: a cached old
        // worker is exactly what strands returning visitors on a broken shell.
        // no-cache forces revalidation on every visit so worker updates (and the
        // skipWaiting fix) propagate on the next load instead of after ~24h.
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    }
  }));
}

// Stripe webhooks — must receive raw body BEFORE express.json() parses it
app.post('/api/subscription/stripe/webhook', express.raw({ type: 'application/json' }), subscriptionWebhook);
app.post('/api/boost/stripe/webhook', express.raw({ type: 'application/json' }), boostStripeWebhook);
// Apple Server Notifications V2 also need the raw body (the payload is itself a JWS).
app.post('/api/iap/apple/notifications', express.raw({ type: 'application/json', limit: '1mb' }), appleServerNotification);

// Body parsing — text/JSON only; image uploads use multipart (multer). 50 kB covers the largest
// legitimate payload (full profile update with photo URLs + interests array = ~10 kB).
app.use(express.json({ limit: '50kb' }));
// extended: false uses the built-in querystring parser — no prototype pollution via nested objects
app.use(express.urlencoded({ extended: false }));

// Parse cookies (required for httpOnly auth_token cookie)
app.use(cookieParser());

// Sanitize all inputs (strip HTML tags from body, query, params)
app.use(sanitizeInputs);

// General rate limit on all API routes — skip health check to avoid Redis overhead on every probe
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  return generalLimiter(req, res, next);
});

// Permissions-Policy: restrict browser features this app doesn't use
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'microphone=(), camera=(), display-capture=(), usb=(), serial=(), battery=()');
  next();
});

// Serve uploaded files statically — dev only (cloud storage is used in production)
if (process.env.NODE_ENV !== 'production') {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsDir));
}

// ==========================================
// API ROUTES — ALL MOUNTED
// ==========================================

// Auth routes with stricter rate limiting
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dm', dmRoutes);
app.use('/api/friends', friendshipRoutes);
app.use('/api/spotify', spotifyRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/boost', boostRoutes);
app.use('/api/iap', iapRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/suggestions', suggestionRoutes);
app.use('/api/feature-interest', featureInterestRoutes);
app.use('/api/feedback', feedbackRoutes);
// Same-origin image proxy (R2 passthrough) — deliberately OUTSIDE /api so the
// general API rate limiter never throttles image loads (a feed page renders
// dozens of them). Mounted before the SPA fallback so GET /media/* never
// resolves to index.html.
app.use('/media', mediaRoutes);

// Health check — verifies DB + optional services for Railway health probes.
// In production we return ONLY {status} so an attacker can't fingerprint
// our infra topology (which subsystem failed) from a public endpoint.
app.get('/api/health', async (_req, res) => {
  const checks = { db: 'error', redis: 'skipped' };
  let allOk = true;
  try {
    await db.query('SELECT 1');
    checks.db = 'ok';
  } catch {
    allOk = false;
  }
  if (redisClient) {
    try {
      await redisClient.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
      allOk = false;
    }
  } else if (process.env.REQUIRE_REDIS === 'true') {
    // Redis is declared load-bearing (replicas > 1) but absent — report
    // degraded so the orchestrator pulls this instance instead of letting it
    // serve with split rate limits and per-instance socket fan-out.
    checks.redis = 'missing';
    allOk = false;
  }
  // A failed post-migration schema assertion means this instance would serve
  // 500s on core paths — pull it from rotation instead (healthy until the
  // assertion actually FAILS, so the accepts-traffic-before-migrations boot
  // window stays green).
  const mig = getMigrationHealth();
  if (mig.schemaAssertionError) {
    checks.schema = 'error';
    allOk = false;
  }
  const status = allOk ? 'ok' : 'degraded';
  if (process.env.NODE_ENV === 'production') {
    return res.status(allOk ? 200 : 503).json({ status });
  }
  res.status(allOk ? 200 : 503).json({
    status,
    ...checks,
    version: APP_VERSION,
    migrationStepFailures: mig.stepFailures.length,
    ...(mig.schemaAssertionError ? { schemaAssertionError: mig.schemaAssertionError } : {}),
    timestamp: new Date().toISOString(),
  });
});
// HEAD /api/health — for cheap uptime monitors that only care about status code
app.head('/api/health', async (_req, res) => {
  try { await db.query('SELECT 1'); res.status(200).end(); }
  catch { res.status(503).end(); }
});

// .well-known files (assetlinks.json + apple-app-site-association) are served
// as static files from the frontend (frontend/public/.well-known/).
// The backend does not need to handle these routes.

// ==========================================
// SOCKET.IO
// ==========================================
const io = new Server(server, {
  cors: {
    // Same rules as the HTTP CORS above — incl. capacitor:// origins — or
    // the polling transport breaks in the iOS app the same way HTTP did.
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST']
  },
  // Detect dead mobile connections faster: default pingInterval=25s, pingTimeout=20s means
  // a dropped connection occupies a server slot for up to 45s. These values cut that to 15s.
  pingInterval: 10000,
  pingTimeout: 5000,
  // Limit message size — prevents a single client from sending a large payload and
  // hogging memory. 100 kB is more than enough for any chat message or event payload.
  maxHttpBufferSize: 1e5,
});

// Redis adapter for horizontal scaling — no-op when REDIS_URL is absent
if (redisClient && redisSubscriber) {
  io.adapter(createAdapter(redisClient, redisSubscriber));
  console.log('[Socket.IO] Redis adapter enabled');
}

// Initialize Socket logic
socketHandler(io);

// Make io accessible to controllers (for realtime notifications)
app.set('io', io);

// ==========================================
// ERROR HANDLING
// ==========================================
Sentry.setupExpressErrorHandler(app);

app.use((err, _req, res, _next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ error: 'Etwas ist schiefgelaufen!' });
});

// API 404 — fires for all unmatched /api/* routes (must be before the SPA fallback)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// SPA fallback — serves index.html for all non-API GET routes (React Router).
// Placed AFTER the API 404 handler so unknown API GETs return JSON, not HTML.
if (process.env.NODE_ENV === 'production') {
  const publicPath = path.resolve(__dirname, '../public');
  app.get('*', (_req, res) => {
    // Same no-store policy as express.static's index.html: sendFile bypasses
    // that setHeaders hook and defaulted to `public, max-age=0` — letting
    // intermediaries cache the shell on deep-link navigations (/club/77 is
    // how most TWA sessions start) and risk serving a stale index after a
    // deploy.
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    console.log('HTTP server closed.');
    try {
      await Promise.all([
        redisClient?.quit().catch(() => {}),
        redisSubscriber?.quit().catch(() => {}),
      ]);
    } catch { /* ignore */ }
    db.pool.end(() => {
      console.log('Database pool closed.');
      process.exit(0);
    });
  });
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch-all safety nets — report to Sentry so day-1 crashes aren't invisible
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
  try {
    Sentry?.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
      tags: { source: 'unhandledRejection' },
    });
  } catch { /* never let the reporter itself crash the process */ }
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception — shutting down:', error);
  try {
    Sentry?.captureException(error, { tags: { source: 'uncaughtException' } });
    // Block briefly so the event flushes before the process exits
    await Sentry?.flush?.(2000);
  } catch { /* ignore */ }
  gracefulShutdown('uncaughtException');
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 5000; // 5000 in dev so Vite dev server can use 3000 (see vite.config.js proxy)


server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT} — version ${APP_VERSION}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Socket.io ready`);
  // Warm up DB pool — acquires one connection so the first real request isn't the cold-start
  db.query('SELECT 1').catch(() => {});
  await runStartupMigrations();
  // Populate the permanent growth history on first boot (idempotent upsert, so
  // harmless if another instance already did it). Fire-and-forget — never block
  // startup on it.
  backfillIfEmpty().catch(err => console.error('[analytics-rollup] backfill error:', err.message));
});

// Self-ping every 14 minutes — prevents Railway from sleeping the container
// (Railway free tier idles after ~30 min without traffic)
if (process.env.NODE_ENV === 'production' && process.env.FRONTEND_URL) {
  const selfUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/health`
    : null;
  if (selfUrl) {
    cron.schedule('*/14 * * * *', () => {
      fetch(selfUrl).catch(() => {});
    });
  }
}

// Permanent growth rollup: aggregate the day's DAU/MAU/retention/engagement
// into analytics_daily. Runs at 02:30 — BEFORE the 03:00 event purge, and
// recomputes the trailing 31 days so retention cohorts fill in over time.
cron.schedule('30 2 * * *', () => {
  runDailyRollup().catch(err => console.error('[cron] analytics rollup failed:', err.message));
});

// Analytics retention: purge events older than 90 days, runs every day at 03:00
cron.schedule('0 3 * * *', async () => {
  try {
    const result = await db.query(
      `DELETE FROM analytics_events WHERE created_at < NOW() - INTERVAL '90 days'`
    );
    console.log(`[cron] analytics_events purged: ${result.rowCount} rows deleted`);
  } catch (err) {
    console.error('[cron] analytics purge failed:', err.message);
  }
});

// Category-push digest: flush the day's suppressed "Neue Gruppe" matches as
// ONE bundled push per user ("N weitere neue Gruppen für dich"), in the user's
// stored app language. 18:00 Vienna — evening reach, and late enough that the
// day's creations are in. The atomic UPDATE...RETURNING claims the rows, so a
// second Railway instance can never double-send, and a crash after claiming
// loses at worst one digest (never spams twice).
cron.schedule('0 18 * * *', async () => {
  try {
    // NB: RETURNING sees the post-UPDATE row (pending_count = 0), so the
    // pre-claim count must come from a self-join alias (`old`) — the standard
    // Postgres pattern for reading old values out of an UPDATE.
    const { rows } = await db.query(`
      UPDATE category_push_state s
      SET pending_count = 0, updated_at = CURRENT_TIMESTAMP
      FROM category_push_state old
      JOIN users u ON u.id = old.user_id
      WHERE old.user_id = s.user_id AND old.pending_count > 0
      RETURNING s.user_id, old.pending_count AS claimed_count, u.locale
    `);
    if (!rows.length) return;
    // Bucket by (locale, count) — identical text shares one bulk send.
    const buckets = new Map();
    for (const r of rows) {
      const key = `${r.locale || 'de'}:${r.claimed_count}`;
      if (!buckets.has(key)) buckets.set(key, { locale: r.locale, count: r.claimed_count, ids: [] });
      buckets.get(key).ids.push(r.user_id);
    }
    let sent = 0;
    for (const { locale, count, ids } of buckets.values()) {
      if (!count || count < 1) continue;
      const { title, body } = categoryDigestText(locale, count);
      sendPushToUsers(ids, title, body, '/home');
      sent += ids.length;
    }
    if (sent) console.log(`[cron] category digest sent to ${sent} users`);
  } catch (err) {
    console.error('[cron] category digest failed:', err.message);
  }
}, { timezone: 'Europe/Vienna' });

// JAMIE Moment push prompt: every 15 min, claim past events whose owner
// hasn't uploaded a moment photo yet and send them a one-shot reminder.
//
// Window: 2 h ≤ now − date ≤ 24 h
//   • For timed events (e.g. 18:00 start): fires 2h after — they're 1h into
//     the second drink, perfect "share your moment" timing.
//   • For date-only events (stored at midnight): fires later in the day; if
//     that falls into night, the OS quiet-hours handling defers delivery.
//
// Atomic UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) claims
// the rows so two Railway instances never fire the same push. The
// moment_prompt_sent_at flag stays set forever once written — even if the
// owner uploads + deletes, we never re-spam.
cron.schedule('*/15 * * * *', async () => {
  try {
    const claimed = await db.query(`
      UPDATE groups
      SET moment_prompt_sent_at = NOW()
      WHERE id IN (
        SELECT id FROM groups
        WHERE type = 'group'
          AND date IS NOT NULL
          AND moment_photo_url IS NULL
          AND moment_prompt_sent_at IS NULL
          AND deleted_at IS NULL
          AND date + INTERVAL '2 hours' <= NOW()
          AND date + INTERVAL '24 hours' >= NOW()
        FOR UPDATE SKIP LOCKED
        LIMIT 200
      )
      RETURNING id, owner_id, name
    `);
    for (const ev of claimed.rows) {
      try {
        await sendPushToUser(
          ev.owner_id,
          '📸 Teile deinen JAMIE Moment',
          `Wie war ${ev.name}? Lade jetzt dein Erinnerungsfoto hoch und hol's in die Hall of Fame.`,
          '/explore',
        );
      } catch (err) {
        console.error(`[cron] moment push failed for group ${ev.id}:`, err.message);
      }
    }
    if (claimed.rowCount > 0) {
      console.log(`[cron] moment prompts sent: ${claimed.rowCount}`);
    }
  } catch (err) {
    console.error('[cron] moment prompt cron failed:', err.message);
  }
});

// Friend request expiration: auto-reject pending requests older than 30 days, runs at 04:00
cron.schedule('0 4 * * *', async () => {
  try {
    const result = await db.query(
      `UPDATE friendships SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`
    );
    if (result.rowCount > 0) {
      console.log(`[cron] friendships expired: ${result.rowCount} requests auto-rejected`);
    }
  } catch (err) {
    console.error('[cron] friendship expiry failed:', err.message);
  }
});

// ── Offsite backup → WORM vault in the SEPARATE Cloudflare account ──────────
// (BACKUP-KONZEPT.md — the cyber-insurance obligation.) Entirely gated on the
// BACKUP_* env block: until Tobi provisions the backup account, the app logs
// exactly one line and does nothing. DB dump nightly 03:15 UTC (after the
// 03:00 analytics purge); media replication weekly Sunday 04:30 UTC.
// Double-run protection for 2 replicas: random start jitter (0–2 min) + pg
// advisory lock + "already succeeded recently" marker in backup_runs.
if (isBackupConfigured()) {
  const backupCfg = getBackupConfig();
  console.log(
    `[backup] ARMED — nightly encrypted DB dump → vault bucket "${backupCfg.bucket}" ` +
    `(03:15 UTC, WORM retention ${backupCfg.retentionDays}d, prune >${backupCfg.pruneAfterDays}d) + weekly media sync (So 04:30 UTC)`
  );
  cron.schedule('15 3 * * *', () => {
    runDbBackup({ jitterMs: Math.floor(Math.random() * 120000) })
      .catch(err => console.error('[cron] db backup failed:', err.message));
  });
  cron.schedule('30 4 * * 0', () => {
    runMediaBackupSync({ jitterMs: Math.floor(Math.random() * 120000) })
      .catch(err => console.error('[cron] media backup sync failed:', err.message));
  });
} else {
  console.log(`[backup] OFF — offsite backup vault not configured (missing: ${missingBackupEnv().join(', ')}). See BACKUP-KONZEPT.md.`);
}
