import webpush from 'web-push';
import db from '../config/database.js';
import { createSemaphore } from '../utils/semaphore.js';
import { Sentry } from '../config/sentry.js';

// Cap concurrent outbound push sends (audit 2026-09-02, risk #8): before this,
// dispatch fired every FCM/APNs TLS request at once without awaiting — a
// 200-member club message was an unbounded outbound burst competing with the
// event loop and DB pool. TWO pools so a 500-subscription bulk blast can never
// head-of-line-block a latency-critical 1:1 push (DM banner, friend request):
// bulk fan-outs queue in their own lane.
const bulkPushSlots = createSemaphore(6);
const userPushSlots = createSemaphore(4);

// Configure VAPID once on first import
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@jamie-app.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ──────────────────────────────────────────────────────────────────────────
// APNs (Apple Push Notification service) — lazy init
// Uses JWT-based provider auth (modern .p8 key) instead of legacy .pem certs.
// Required env vars:
//   APNS_KEY_ID       — 10-char key id from developer.apple.com → Keys
//   APNS_TEAM_ID      — 10-char Apple Developer Team ID (from Membership)
//   APNS_KEY          — full contents of AuthKey_XXXXXXXXXX.p8 (literal \n
//                       escapes are converted to real newlines so the key
//                       can live as a single-line Railway env var)
//   APNS_BUNDLE_ID    — iOS bundle identifier, used as the APNs topic
// Dynamic import keeps the boot loop alive if @parse/node-apn is not yet
// installed (degrades gracefully — iOS push silently no-ops, web still works).
// ──────────────────────────────────────────────────────────────────────────
// Promise-memoized: the FIRST caller starts init and every CONCURRENT caller
// awaits the same promise (dispatch fans out via Promise.all since the risk-#8
// fix). The previous boolean `_apnInitTried` guard made concurrent callers get
// null while call #1 was still importing the module — their iOS pushes were
// silently dropped (review 2026-09-02). A null result (env unset, module
// missing) is memoized too, matching the old degrade-gracefully behavior.
let _apnCtxPromise = null;

function getApnContext() {
  if (!_apnCtxPromise) {
    _apnCtxPromise = (async () => {
      const { APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY, APNS_BUNDLE_ID } = process.env;
      if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_KEY || !APNS_BUNDLE_ID) {
        return null;
      }
      try {
        const imported = await import('@parse/node-apn');
        const apn = imported.default || imported;
        // .trim(): these go verbatim into the JWT (kid / iss) and the
        // apns-topic header. A trailing newline from a dashboard paste turns
        // a valid key into InvalidProviderToken / BadTopic with no other clue.
        const keyId = APNS_KEY_ID.trim();
        const teamId = APNS_TEAM_ID.trim();
        const production = process.env.NODE_ENV === 'production';
        const provider = new apn.Provider({
          token: {
            key: APNS_KEY.replace(/\\n/g, '\n'),
            keyId,
            teamId,
          },
          production,
        });
        // Key id / team id are public identifiers, not secrets — logging them
        // is what lets a team-id mismatch be spotted from Railway.
        console.log(`[APNs] Provider initialized key=${keyId} team=${teamId} gateway=${production ? 'production' : 'sandbox'}`);
        return { apn, provider };
      } catch (err) {
        console.error('[APNs] Init failed (is @parse/node-apn installed?):', err.message);
        return null;
      }
    })();
  }
  return _apnCtxPromise;
}

// ==========================================
// GET VAPID PUBLIC KEY
// ==========================================
export const getVapidKey = (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: key });
};

// ==========================================
// SAVE WEB PUSH SUBSCRIPTION
// ==========================================
export const subscribe = async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || typeof endpoint !== 'string' || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }
  // Real VAPID-protocol values: endpoint ~150B, p256dh ~88 chars, auth ~24 chars.
  // Reject anything wildly oversized so no one can flood the DB.
  if (endpoint.length > 1024 || keys.p256dh.length > 256 || keys.auth.length > 128) {
    return res.status(400).json({ error: 'Subscription object too large' });
  }

  try {
    // Cap subscriptions per user — one device should never produce >10 active ones
    const count = await db.query(
      `SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = $1 AND platform = 'web'`,
      [req.userId]
    );
    if ((count.rows[0]?.n ?? 0) >= 25) {
      return res.status(429).json({ error: 'Zu viele Push-Subscriptions. Lösche alte zuerst.' });
    }
    // One endpoint = one browser profile on one device. If it's still
    // registered under ANOTHER account (previous user of a shared device who
    // logged out without unsubscribing), that row must go — otherwise both
    // accounts' notifications (incl. DM content) pop on this device.
    await db.query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id <> $2`,
      [endpoint, req.userId]
    );
    await db.query(
      `INSERT INTO push_subscriptions (user_id, platform, endpoint, p256dh, auth_key)
       VALUES ($1, 'web', $2, $3, $4)
       ON CONFLICT (user_id, endpoint) DO UPDATE
         SET p256dh = EXCLUDED.p256dh,
             auth_key = EXCLUDED.auth_key`,
      [req.userId, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// REMOVE WEB PUSH SUBSCRIPTION
// ==========================================
export const unsubscribe = async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

  try {
    await db.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.userId, endpoint]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Push unsubscribe error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// SAVE APNs DEVICE TOKEN (iOS Capacitor)
// ==========================================
export const saveApnsToken = async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  try {
    // Same shared-device rule as web subscribe: a device token belongs to
    // exactly one phone — evict any row registered under a different account.
    await db.query(
      `DELETE FROM push_subscriptions WHERE device_token = $1 AND user_id <> $2`,
      [token, req.userId]
    );
    await db.query(
      `INSERT INTO push_subscriptions (user_id, platform, device_token)
       VALUES ($1, 'apns', $2)
       ON CONFLICT (user_id, device_token) DO NOTHING`,
      [req.userId, token]
    );
    // TEMP debug (2026-08-05): confirms the native iPhone reaches this
    // endpoint — needed until APNs goes live. Deliberately WITHOUT user id or
    // token material (the original line correlated both in the logs).
    console.log(`[APNs] token registered (len ${String(token).length})`);
    res.json({ success: true });
  } catch (err) {
    console.error('APNs token save error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// CLIENT-REPORTED PUSH DIAGNOSTICS (native iOS)
// ==========================================
// Exists because every device-side failure was invisible from the server:
// a denied permission returned silently, registrationError only reached the
// device console, a missing plugin was an unhandled rejection, and the token
// POST swallowed its own errors. "iOS push doesn't arrive" could only be
// debugged with a Mac and a cable (2026-09-04). Now the app reports what
// happened and the answer is one Railway log search away: `[APNs-diag]`.
// Deliberately log-only (no table): this is an incident tool, not analytics.
const DIAG_EVENTS = new Set([
  'permission',          // detail: granted | denied | prompt | prompt-with-rationale
  'registered',          // token reached the backend
  'registration_error',  // iOS refused registerForRemoteNotifications (entitlement / profile)
  'plugin_unavailable',  // "PushNotifications plugin is not implemented on ios" — not in the binary
  'import_failed',       // the JS chunk for the plugin did not load
  'token_save_failed',   // POST /push/apns-token failed (detail carries the HTTP status)
  'permission_error',    // checkPermissions/requestPermissions rejected (iOS UNUserNotificationCenter error)
]);
// Client strings go into a log line that Railway's viewer RENDERS: strip
// control chars (ESC → ANSI colour/cursor codes, C0/C1, DEL) and Unicode
// bidi/zero-width overrides before collapsing whitespace — otherwise a client
// can recolour or visually reorder the operator's log. sanitizeInputs upstream
// even decodes `&#27;` into a real ESC, so this must happen here.
const clip = (v, n = 160) => (v == null ? '' : String(v)
  .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .slice(0, n));

// Sentry gets at most ONE event per (user, kind) per hour. Without this, every
// POST became its own Sentry issue (the message embedded the per-request
// detail, and Sentry groups by text), so a single authenticated client could
// mint thousands of issues inside generalLimiter's budget. The log line is
// still written every time — Sentry is for "a build is broken", not a tally.
const DIAG_SENTRY_WINDOW_MS = 60 * 60 * 1000;
const DIAG_SENTRY_MAX_KEYS = 5000;
const diagSentryLast = new Map();
const shouldEscalate = (key, now) => {
  const last = diagSentryLast.get(key);
  if (last && now - last < DIAG_SENTRY_WINDOW_MS) return false;
  if (diagSentryLast.size >= DIAG_SENTRY_MAX_KEYS) {
    for (const [k, t] of diagSentryLast) { if (now - t >= DIAG_SENTRY_WINDOW_MS) diagSentryLast.delete(k); }
    if (diagSentryLast.size >= DIAG_SENTRY_MAX_KEYS) return false; // still full → log only
  }
  diagSentryLast.set(key, now);
  return true;
};

export const reportPushDiagnostics = (req, res) => {
  // Guests (ALLOW_GUEST_TOKEN) have no device row to diagnose and would only
  // add user=0 noise + Sentry events from an unauthenticated caller.
  if (req.isGuest || !req.userId) return res.status(403).json({ error: 'Guests cannot report diagnostics' });
  const { event, permission, detail, app_version, platform } = req.body || {};
  if (!DIAG_EVENTS.has(event)) return res.status(400).json({ error: 'invalid event' });
  const app = clip(app_version, 32) || '-';
  const line = `[APNs-diag] user=${req.userId} platform=${clip(platform, 16) || '-'} app=${app} event=${event} permission=${clip(permission, 32) || '-'} detail=${clip(detail) || '-'}`;
  const isProblem = event !== 'registered' && !(event === 'permission' && permission === 'granted');
  if (isProblem) {
    console.warn(line);
    // A denied permission is expected churn; the other four mean the build or
    // the server is broken for everyone on that version — surface them, but
    // with a STABLE fingerprint (event + app version) so they group into one
    // issue per broken build, and throttled per user.
    if (event !== 'permission' && shouldEscalate(`${req.userId}:${event}`, Date.now())) {
      Sentry.captureMessage?.(`[APNs-diag] ${event} app=${app}`, {
        level: 'warning',
        fingerprint: ['apns-diag', event, app],
        tags: { area: 'push', kind: event, app },
        extra: { userId: req.userId, detail: clip(detail), permission: clip(permission, 32) },
      });
    }
  } else {
    console.log(line);
  }
  res.json({ ok: true });
};

// ==========================================
// INTERNAL: SEND PUSH TO USER (called from notificationController)
// ==========================================
// Dispatch one already-fetched subscription row. RETURNS the send promise
// (errors handled inside, never rejects) so callers can drive real
// backpressure through the semaphore instead of fire-and-forget. The APNs
// context comes from the promise-memoized getApnContext() — safe under
// concurrent dispatch, no per-batch holder needed.
async function dispatchToSubscription(sub, title, body, url) {
  if (sub.platform === 'web' && sub.endpoint) {
    if (!process.env.VAPID_PUBLIC_KEY) return;
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } };
    return webpush.sendNotification(pushSub, JSON.stringify({ title, body, url })).catch((err) => {
      // 410 Gone = expired; FCM signals dead subscriptions with 404
      // ("NotRegistered") — both are permanent, clean them up.
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
      } else {
        console.error('Push send error:', err.statusCode, err.message);
      }
    });
  } else if (sub.platform === 'apns' && sub.device_token) {
    const ctx = await getApnContext();
    if (!ctx) return;
    const { apn, provider } = ctx;
    const notification = new apn.Notification();
    notification.alert = { title, body };
    notification.topic = (process.env.APNS_BUNDLE_ID || '').trim();
    notification.sound = 'default';
    notification.payload = { url };
    notification.priority = 10; // display immediately
    // apns-push-type is required on watchOS and "recommended, may be delayed
    // or dropped without it" on iOS 13+; node-apn only emits the header when
    // pushType is set. expiry lets APNs hold the push while the phone is
    // offline instead of discarding it (0 = deliver-now-or-never).
    notification.pushType = 'alert';
    notification.expiry = Math.floor(Date.now() / 1000) + 3600;
    return provider.send(notification, sub.device_token).then((result) => {
      // Every outcome logs. node-apn 8 never rejects — it resolves
      // {sent, failed} — so an un-logged branch here is a push that
      // vanished without trace (2026-09-04 incident: three of them did).
      if (result.sent?.length) console.log(`[APNs] sent sub=${sub.id}`);
      for (const failure of (result.failed || [])) {
        const reason = failure.response?.reason || '';
        const status = failure.status;
        // BadDeviceToken = token not valid for THIS gateway (sandbox token on
        // production, or garbage); Unregistered/410 = app uninstalled. All
        // permanent for this row — prune, but say so.
        if (reason === 'BadDeviceToken' || reason === 'Unregistered' || status === 410 || status === '410') {
          console.warn(`[APNs] pruning dead token sub=${sub.id} reason=${reason || status}`);
          db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
        } else if (reason) {
          console.error(`[APNs] send failure: ${reason} status ${status} sub=${sub.id}`);
        } else if (failure.error) {
          // Transport-level: timeout, TLS/HTTP2, JWT signing, DNS — no APNs
          // JSON body, so `reason` is empty and this used to be silent.
          console.error(`[APNs] transport failure: ${failure.error.message} status ${status ?? '-'} sub=${sub.id}`);
        } else {
          console.error('[APNs] send failure (unrecognised shape):', JSON.stringify(failure).slice(0, 300));
        }
      }
    }).catch((err) => console.error('[APNs] send error:', err.message));
  }
}

// `title` may be a plain string (with `body`) OR a builder function
// `(locale) => ({ title, body })` from utils/pushLocale.pushTexts — the
// recipient's users.locale rides along on the subscriptions SELECT (one JOIN,
// no extra round trip), so every push type localizes per recipient.
const resolveTexts = (titleOrBuilder, body, locale) =>
  typeof titleOrBuilder === 'function'
    ? titleOrBuilder(locale)
    : { title: titleOrBuilder, body };

export const sendPushToUser = async (userId, title, body, url = '/notifications') => {
  // No web AND no APNs configured — nothing to send. (If only one is configured
  // we still proceed; sends to the other platform will silently no-op.)
  if (!process.env.VAPID_PUBLIC_KEY && !process.env.APNS_KEY_ID) return;

  let subs;
  try {
    const result = await db.query(
      `SELECT ps.id, ps.platform, ps.endpoint, ps.p256dh, ps.auth_key, ps.device_token, u.locale
       FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
       WHERE ps.user_id = $1`,
      [userId]
    );
    subs = result.rows;
  } catch (err) {
    console.error('Push fetch error:', err);
    return;
  }
  if (!subs.length) return;

  const texts = resolveTexts(title, body, subs[0].locale);
  await Promise.all(subs.map((sub) =>
    userPushSlots.run(() => dispatchToSubscription(sub, texts.title, texts.body, url))
  ));
};

// Bulk variant: ONE subscriptions SELECT for all recipients instead of N
// (deal fan-out queried up to 500 users, then sendPushToUser ran its own
// SELECT per user → up to 500 sequential round trips). Same per-sub dispatch;
// builder texts are computed once per distinct locale, not per subscription.
export const sendPushToUsers = async (userIds, title, body, url = '/notifications') => {
  if (!process.env.VAPID_PUBLIC_KEY && !process.env.APNS_KEY_ID) return;
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return;

  let subs;
  try {
    const result = await db.query(
      `SELECT ps.id, ps.platform, ps.endpoint, ps.p256dh, ps.auth_key, ps.device_token, u.locale
       FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
       WHERE ps.user_id = ANY($1::int[])`,
      [ids]
    );
    subs = result.rows;
  } catch (err) {
    console.error('Push bulk fetch error:', err);
    return;
  }

  const textCache = new Map();
  // Bounded parallelism: up to 6 bulk sends in flight (semaphore), the rest
  // queue — in the BULK lane, so 1:1 pushes never wait behind a blast.
  // Each dispatch handles its own errors, so this Promise.all never rejects.
  await Promise.all(subs.map((sub) => {
    const key = sub.locale || 'de';
    let texts = textCache.get(key);
    if (!texts) { texts = resolveTexts(title, body, sub.locale); textCache.set(key, texts); }
    return bulkPushSlots.run(() => dispatchToSubscription(sub, texts.title, texts.body, url));
  }));
};
