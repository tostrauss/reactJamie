import { createHash } from 'crypto';
import webpush from 'web-push';
import db from '../config/database.js';
import { createSemaphore } from '../utils/semaphore.js';
import { Sentry } from '../config/sentry.js';
import { isValidRadius, normalizeRadius } from '../utils/geoRadius.js';

// Cap concurrent outbound push sends (audit 2026-09-02, risk #8): before this,
// dispatch fired every FCM/APNs TLS request at once without awaiting — a
// 200-member club message was an unbounded outbound burst competing with the
// event loop and DB pool. TWO pools so a 500-subscription bulk blast can never
// head-of-line-block a latency-critical 1:1 push (DM banner, friend request):
// bulk fan-outs queue in their own lane.
const bulkPushSlots = createSemaphore(6);
const userPushSlots = createSemaphore(4);

// Web subscriptions kept per user (see subscribe). One person rarely has more
// than a handful of live browsers; the rest is history.
const MAX_WEB_SUBSCRIPTIONS = 25;

// A web-push request with no timeout could hang for as long as the socket
// lived — and it held one of the semaphore slots above while it did, so a few
// stalled FCM/Mozilla connections froze ALL push dispatch, iOS included, with
// nothing in the logs.
const WEB_PUSH_TIMEOUT_MS = 10_000;

// Delivery options for pushes that announce a CONVERSATION (group chat, DM).
//   urgency 'high' — without it the Web Push default is 'normal', which FCM
//     maps to normal priority: Android in Doze holds those until the next
//     maintenance window, so a chat push could arrive tens of minutes late,
//     long after the conversation moved on. Read as "push doesn't work".
//   ttl 24 h — web default is four weeks (a push about a chat from last week
//     is noise); on APNs it raises the default 1 h expiry, after which a phone
//     that was offline for an hour (flight mode, no signal) never got it.
export const PUSH_CONVERSATION = Object.freeze({ urgency: 'high', ttl: 24 * 60 * 60 });
// The admin "Test-Push senden": urgency high like a chat push, or Android Doze
// holds it until the phone is unlocked and the test reads "device broken"
// although chat/DM pushes would arrive; a 10-minute TTL so a test nobody saw
// does not pop up hours later.
export const PUSH_TEST = Object.freeze({ urgency: 'high', ttl: 600 });

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
// DEAD WEB ENDPOINTS (push_dead_endpoints, migrations.js "Stream C")
// ==========================================
// A 404/410 from the push service is final for that endpoint, but the browser
// keeps handing the same PushSubscription back until someone unsubscribes it.
// The client re-posted it on every app start, the next push pruned it again —
// a loop with no way out (Lea, 18.10.2026: user 62 was pruned three times in
// one day). Remembered by hash: the endpoint URL is the device's push
// credential and must not sit in a table (or a log) longer than needed.
const endpointHash = (endpoint) => createHash('sha256').update(String(endpoint)).digest('hex');

// 42P01/42703: the table is not there yet — the server takes traffic before
// the startup migrations finish. Both helpers then behave exactly as before
// the table existed; anything else is worth a line, never a failed request.
const isMissingSchema = (err) => err?.code === '42P01' || err?.code === '42703';

// Resolves (never rejects) — the prune path fires it and moves on.
export const rememberDeadEndpoint = (endpoint) =>
  db.query(
    `INSERT INTO push_dead_endpoints (endpoint_hash) VALUES ($1)
     ON CONFLICT (endpoint_hash) DO UPDATE SET pruned_at = NOW()`,
    [endpointHash(endpoint)]
  ).then(() => true, (err) => {
    if (!isMissingSchema(err)) console.warn('[push] could not remember dead endpoint:', err?.message);
    return false;
  });

const isDeadEndpoint = async (endpoint) => {
  try {
    const { rows } = await db.query(
      'SELECT 1 FROM push_dead_endpoints WHERE endpoint_hash = $1',
      [endpointHash(endpoint)]
    );
    return rows.length > 0;
  } catch (err) {
    if (!isMissingSchema(err)) console.warn('[push] dead-endpoint check failed:', err?.message);
    return false;
  }
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

  // Checked BEFORE anything is written: a refused post must not evict rows
  // or move the endpoint between accounts. 409 + resubscribe tells the client
  // (utils/pushNotifications.js ensureSubscription) to unsubscribe this one
  // and post a fresh subscription instead — once, no prompt needed, the
  // permission is already granted.
  if (await isDeadEndpoint(endpoint)) {
    console.warn(`[push] refused dead web subscription user=${req.userId} host=${endpointHost(endpoint)} — client told to resubscribe`);
    return res.status(409).json({ error: 'Subscription expired', resubscribe: true });
  }

  try {
    // Cap web subscriptions per user by evicting the STALEST rows — never by
    // refusing the device registering right now. This used to answer 429 once
    // 25 rows existed, counting the endpoint being re-posted as well: a user
    // who had collected that many (browsers, reinstalls, rotated endpoints that
    // never failed a send and so were never pruned) could not register their
    // CURRENT phone any more, and syncPushSubscription only console.warns — push
    // was dead for them without a trace anywhere. created_at is refreshed on
    // every re-post below, so "oldest" means "not seen alive for longest".
    await db.query(
      `DELETE FROM push_subscriptions WHERE id IN (
         SELECT id FROM push_subscriptions
          WHERE user_id = $1 AND platform = 'web' AND endpoint IS DISTINCT FROM $2
          ORDER BY created_at DESC NULLS LAST, id DESC
          OFFSET $3
       )`,
      [req.userId, endpoint, MAX_WEB_SUBSCRIPTIONS - 1]
    );
    // One endpoint = one browser profile on one device. If it's still
    // registered under ANOTHER account (previous user of a shared device who
    // logged out without unsubscribing), that row must go — otherwise both
    // accounts' notifications (incl. DM content) pop on this device.
    await db.query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id <> $2`,
      [endpoint, req.userId]
    );
    // created_at doubles as "last registered": the client re-posts its
    // subscription on every app start (syncPushSubscription), so refreshing it
    // here is what lets the eviction above tell a live device from a dead one.
    // Nothing else reads the column.
    await db.query(
      `INSERT INTO push_subscriptions (user_id, platform, endpoint, p256dh, auth_key)
       VALUES ($1, 'web', $2, $3, $4)
       ON CONFLICT (user_id, endpoint) DO UPDATE
         SET p256dh = EXCLUDED.p256dh,
             auth_key = EXCLUDED.auth_key,
             created_at = CURRENT_TIMESTAMP`,
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
    // created_at = "last registered", as for web: the app posts its token on
    // every cold start, so refreshing it here is what makes the admin device
    // list ("zuletzt registriert") show an iPhone's last start, not its first.
    await db.query(
      `INSERT INTO push_subscriptions (user_id, platform, device_token)
       VALUES ($1, 'apns', $2)
       ON CONFLICT (user_id, device_token) DO UPDATE SET created_at = CURRENT_TIMESTAMP`,
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
// CLIENT-REPORTED PUSH DIAGNOSTICS (native iOS; web / TWA further down)
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
  // eslint-disable-next-line no-control-regex -- matching control chars IS the point here
  .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .slice(0, n));

// Sentry gets at most ONE event per (user, kind) per hour. Without this, every
// POST became its own Sentry issue (the message embedded the per-request
// detail, and Sentry groups by text), so a single authenticated client could
// mint thousands of issues inside generalLimiter's budget. The log line is
// still written every time (within the per-user log budget below) — Sentry
// is for "a build is broken", not a tally.
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

// Log budget per user, both platforms: the clients report at most a handful
// of lines per app start (iOS dedupes per start, web per page load + `start`
// once a day), so 30 an hour is never reached by a real device — it only
// stops one authenticated client from flooding the log viewer inside
// generalLimiter's much larger budget. Fixed window, cleared wholesale, so
// memory follows the traffic of ONE hour; the key cap is a backstop.
const DIAG_LOG_WINDOW_MS = 60 * 60 * 1000;
const DIAG_LOG_MAX_PER_USER = 30;
const DIAG_LOG_MAX_KEYS = 100_000;
let diagLogWindowStart = 0;
const diagLogCount = new Map();
const takeDiagLogBudget = (userId, now) => {
  if (now - diagLogWindowStart >= DIAG_LOG_WINDOW_MS) { diagLogCount.clear(); diagLogWindowStart = now; }
  const used = diagLogCount.get(userId) || 0;
  if (used >= DIAG_LOG_MAX_PER_USER) return false;
  if (!used && diagLogCount.size >= DIAG_LOG_MAX_KEYS) return false;
  diagLogCount.set(userId, used + 1);
  return true;
};

// ── Web / Play-app (TWA) counterpart of [APNs-diag] ────────────────────────
// Lea, 18.10.2026: „Bei vielen Android-Nutzern funktionieren die
// Push-Benachrichtigungen gar nicht" — and the logs could not say why: every
// web failure stayed in the browser console. The web client
// (utils/pushDiagnostics.js) now reports here too; its platform values route
// it to this branch, so the iOS contract above is untouched. Log-only, no
// Sentry: web failures are mostly device-specific (e.g. Chrome on a phone
// without Play services fails subscribe() with AbortError on every start) —
// that would burn the Sentry quota without pointing at a broken build. One
// line per event:
//   [push-diag] user=62 platform=twa ua=SamsungBrowser/26 android=14 display=standalone event=start permission=denied sub=no detail=-
const WEB_DIAG_PLATFORMS = new Set(['twa', 'android-web', 'ios-web', 'web']);
const WEB_DIAG_EVENTS = new Set([
  'start',             // once a day per device: permission + local subscription as found at app start
  'permission',        // answer to an explicit Notification.requestPermission()
  'subscribed',        // a subscription reached the backend (detail: created | resubscribed | key-rotated, "optin …" after a tap)
  'subscribe_failed',  // detail: <stage>:<error> <message> (stage: sw | vapid | subscribe | post | resubscribe)
]);
const WEB_PERMISSIONS = new Set(['granted', 'denied', 'default', 'unsupported']);
const DISPLAY_MODES = new Set(['standalone', 'fullscreen', 'minimal-ui', 'browser', 'window-controls-overlay']);

// Browser family + major version from the request's own User-Agent. Order
// matters: Samsung Internet, Edge and Opera all ALSO say "Chrome/…". Samsung
// Internet hosts the TWA on some Galaxys, where notification permission is
// not Chrome's — exactly what a log line has to tell apart.
const BROWSER_PATTERNS = [
  ['SamsungBrowser', /SamsungBrowser\/(\d+)/],
  ['Edge', /Edg(?:A|iOS)?\/(\d+)/],
  ['Opera', /OPR\/(\d+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ['Safari', /Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//],
  // The iPhone home-screen web app drops "Version/… Safari/…" from its UA.
  ['iOS', /(?:iPhone|iPad|iPod).*? OS (\d+)_/],
];
export const browserFamily = (ua) => {
  const s = String(ua || '');
  for (const [name, re] of BROWSER_PATTERNS) {
    const m = s.match(re);
    if (m) return `${name}/${m[1]}`;
  }
  return '-';
};

const reportWebPushDiagnostics = (req, res, body) => {
  if (!WEB_DIAG_EVENTS.has(body.event)) return res.status(400).json({ error: 'invalid event' });
  if (!takeDiagLogBudget(req.userId, Date.now())) return res.status(429).json({ error: 'too many diagnostics' });
  // Every client value is allowlisted or clipped — this line is RENDERED by
  // Railway's log viewer (see clip()).
  const permission = WEB_PERMISSIONS.has(body.permission) ? body.permission : '-';
  const sub = typeof body.has_subscription === 'boolean' ? (body.has_subscription ? 'yes' : 'no') : '-';
  const display = DISPLAY_MODES.has(body.display_mode) ? body.display_mode : '-';
  // Chrome's reduced UA says "Android 10" on every phone; the client reads the
  // real major version from userAgentData. 13+ is where Android's own
  // notification dialog (POST_NOTIFICATIONS) comes in — the suspected opt-in
  // gap in the Play app.
  const android = /^\d{1,2}$/.test(String(body.android ?? '')) ? String(body.android) : '-';
  const ua = browserFamily(req.get?.('user-agent') ?? req.headers?.['user-agent']);
  const line = `[push-diag] user=${req.userId} platform=${body.platform} ua=${ua} android=${android} display=${display} event=${body.event} permission=${permission} sub=${sub} detail=${clip(body.detail) || '-'}`;
  const healthy = body.event === 'subscribed'
    || (body.event === 'permission' && permission === 'granted')
    || (body.event === 'start' && permission === 'granted' && sub === 'yes');
  if (healthy) console.log(line); else console.warn(line);
  res.json({ ok: true });
};

export const reportPushDiagnostics = (req, res) => {
  // Guests (ALLOW_GUEST_TOKEN) have no device row to diagnose and would only
  // add user=0 noise + Sentry events from an unauthenticated caller.
  if (req.isGuest || !req.userId) return res.status(403).json({ error: 'Guests cannot report diagnostics' });
  if (WEB_DIAG_PLATFORMS.has(req.body?.platform)) return reportWebPushDiagnostics(req, res, req.body);
  const { event, permission, detail, app_version, platform } = req.body || {};
  if (!DIAG_EVENTS.has(event)) return res.status(400).json({ error: 'invalid event' });
  if (!takeDiagLogBudget(req.userId, Date.now())) return res.status(429).json({ error: 'too many diagnostics' });
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

// Per-user push preference toggles (Settings → Benachrichtigungen). Server-side
// flags so they govern APNs on iOS too, not just web push. Column names come
// from this allowlist — never from the body — and only keys sent as REAL
// booleans are written, so a one-key PUT can't reset the others. Honoured by
// the recipient SELECTs in jobs/eventReminders.js + utils/friendActivity.js,
// and push_news (the opt-in for JAMIE news & deals, 18.10.2026) by
// controllers/newsController.js.
const PUSH_PREF_KEYS = ['push_reminders', 'push_friends', 'push_recommendations', 'push_news'];
// push_news is NOT in SAFE_USER_COLS and must not be read where the others
// are: the server takes traffic before its migrations finish, and a column the
// database does not have yet would 500 every profile load (house rule). It is
// only named in SQL when the request is about it — see the RETURNING list.
const PREF_UNAVAILABLE = {
  error: 'Diese Einstellung ist gleich wieder verfügbar. Bitte versuche es in einer Minute erneut.',
  code: 'PREF_UNAVAILABLE',
};
export const updatePushPreferences = async (req, res) => {
  if (req.isGuest || !req.userId) return res.status(403).json({ error: 'Guests have no push preferences' });
  const keys = PUSH_PREF_KEYS.filter(k => typeof req.body?.[k] === 'boolean');

  // Umkreis rides on the same endpoint as the boolean toggles — it is a
  // notification preference and lives next to them in Settings. It is NOT a
  // boolean, so it is collected separately rather than bent into PUSH_PREF_KEYS.
  const values = keys.map(k => req.body[k]);
  const hasRadius = 'notify_radius_km' in (req.body || {});
  if (hasRadius && !isValidRadius(req.body.notify_radius_km)) {
    // Rejected rather than clamped: the picker can only produce the offered
    // values, so anything else is a crafted request — and silently accepting
    // an arbitrary "1 km" would turn the push fan-out into a presence oracle
    // for guessing where someone lives.
    return res.status(400).json({ error: 'Ungültiger Umkreis' });
  }
  if (hasRadius) {
    keys.push('notify_radius_km');
    values.push(normalizeRadius(req.body.notify_radius_km));
  }

  if (!keys.length) return res.status(400).json({ error: 'Keine gültige Einstellung übergeben' });
  const withNews = keys.includes('push_news');
  try {
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await db.query(
      `UPDATE users SET ${sets}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING push_reminders, push_friends, push_recommendations, notify_radius_km${withNews ? ', push_news' : ''}`,
      [req.userId, ...values]
    );
    if (!rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    res.json(rows[0]);
  } catch (err) {
    // Only a push_news write can hit a missing column (the others are covered
    // by CRITICAL_SCHEMA_PROBES) — that is the boot window, not a failure.
    if (withNews && err?.code === '42703') return res.status(503).json(PREF_UNAVAILABLE);
    console.error('Error updating push preferences:', err);
    res.status(500).json({ error: 'Einstellung konnte nicht gespeichert werden' });
  }
};

// GET /push/preferences — what Settings needs beyond the profile: the news
// opt-in, read here and nowhere hot (see PREF_UNAVAILABLE above). The other
// toggles keep coming from the profile. `push_news: null` means this server
// cannot store the choice yet (column missing) — the client then hides the
// switch instead of showing one that cannot save.
export const getPushPreferences = async (req, res) => {
  if (req.isGuest || !req.userId) return res.status(403).json({ error: 'Guests have no push preferences' });
  try {
    const { rows } = await db.query('SELECT push_news FROM users WHERE id = $1', [req.userId]);
    if (!rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    res.json({ push_news: rows[0].push_news === true });
  } catch (err) {
    if (err?.code === '42703') return res.json({ push_news: null });
    console.error('Error reading push preferences:', err);
    res.status(500).json({ error: 'Einstellungen konnten nicht geladen werden' });
  }
};

// ==========================================
// INTERNAL: SEND PUSH TO USER (called from notificationController)
// ==========================================
// The push service's host only (fcm.googleapis.com, web.push.apple.com,
// updates.push.services.mozilla.com …) — identifies the browser family in a
// log line without writing the capability URL itself into the logs.
const endpointHost = (endpoint) => {
  try { return new URL(endpoint).host; } catch { return '-'; }
};

// Dispatch one already-fetched subscription row. RETURNS the send promise
// (errors handled inside, never rejects) so callers can drive real
// backpressure through the semaphore instead of fire-and-forget. The APNs
// context comes from the promise-memoized getApnContext() — safe under
// concurrent dispatch, no per-batch holder needed.
//
// The promise resolves to what happened to this one subscription — { id,
// platform, host, ok, status?, reason?, pruned? }. Fan-out callers ignore the
// value; the admin "Test-Push senden" shows it per device, which is the only
// way to see from the outside whether a push actually left for a given phone.
async function dispatchToSubscription(sub, title, body, url, opts = {}) {
  if (sub.platform === 'web' && sub.endpoint) {
    const result = { id: sub.id, platform: 'web', host: endpointHost(sub.endpoint) };
    if (!process.env.VAPID_PUBLIC_KEY) return { ...result, ok: false, reason: 'vapid-not-configured' };
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } };
    const options = { timeout: WEB_PUSH_TIMEOUT_MS };
    if (opts.urgency) options.urgency = opts.urgency;
    if (opts.ttl != null) options.TTL = opts.ttl;
    return webpush.sendNotification(pushSub, JSON.stringify({ title, body, url }), options).then(
      (res) => ({ ...result, ok: true, status: res?.statusCode ?? null }),
      (err) => {
        // 410 Gone = expired; FCM signals dead subscriptions with 404
        // ("NotRegistered") — both are permanent, clean them up. Logged now:
        // the prune used to be silent, so "this user's web push died" left no
        // trace at all. user + host, never the endpoint (it is a credential).
        const where = `sub=${sub.id} user=${sub.user_id ?? '-'} host=${result.host}`;
        const status = err?.statusCode ?? null;
        if (status === 410 || status === 404) {
          console.warn(`[push] pruning dead web subscription ${where} status=${status}`);
          db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
          // …and remember it, or the browser re-posts this very endpoint on
          // its next start and the prune repeats forever (see subscribe).
          rememberDeadEndpoint(sub.endpoint);
          return { ...result, ok: false, status, pruned: true };
        }
        // 403 here almost always means a VAPID key mismatch (the subscription
        // was created under a different key) — the client heals that on its
        // next start via syncPushSubscription, so it is logged, not pruned.
        // The body carries the push service's own reason — Apple's Web Push
        // answers e.g. {"reason":"BadJwtToken"} where err.message only says
        // "Received unexpected response code".
        console.error(`[push] web send failed ${where} status=${status ?? '-'}: ${err?.message} ${String(err?.body ?? '').slice(0, 160)}`.trim());
        return { ...result, ok: false, status, reason: err?.message || 'send-failed' };
      }
    );
  }
  if (sub.platform === 'apns' && sub.device_token) {
    const result = { id: sub.id, platform: 'apns', host: 'apns' };
    const ctx = await getApnContext();
    if (!ctx) return { ...result, ok: false, reason: 'apns-not-configured' };
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
    notification.expiry = Math.floor(Date.now() / 1000) + (opts.ttl ?? 3600);
    return provider.send(notification, sub.device_token).then((sent) => {
      // Every outcome logs. node-apn 8 never rejects — it resolves
      // {sent, failed} — so an un-logged branch here is a push that
      // vanished without trace (2026-09-04 incident: three of them did).
      if (sent.sent?.length) {
        console.log(`[APNs] sent sub=${sub.id} user=${sub.user_id ?? '-'}`);
        return { ...result, ok: true };
      }
      let outcome = { ...result, ok: false, reason: 'no-result' };
      for (const failure of (sent.failed || [])) {
        const reason = failure.response?.reason || '';
        const status = failure.status;
        // BadDeviceToken = token not valid for THIS gateway (sandbox token on
        // production, or garbage); Unregistered/410 = app uninstalled. All
        // permanent for this row — prune, but say so.
        if (reason === 'BadDeviceToken' || reason === 'Unregistered' || status === 410 || status === '410') {
          console.warn(`[APNs] pruning dead token sub=${sub.id} user=${sub.user_id ?? '-'} reason=${reason || status}`);
          db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
          outcome = { ...result, ok: false, status: status ?? null, reason: reason || String(status), pruned: true };
        } else if (reason) {
          console.error(`[APNs] send failure: ${reason} status ${status} sub=${sub.id} user=${sub.user_id ?? '-'}`);
          outcome = { ...result, ok: false, status: status ?? null, reason };
        } else if (failure.error) {
          // Transport-level: timeout, TLS/HTTP2, JWT signing, DNS — no APNs
          // JSON body, so `reason` is empty and this used to be silent.
          console.error(`[APNs] transport failure: ${failure.error.message} status ${status ?? '-'} sub=${sub.id} user=${sub.user_id ?? '-'}`);
          outcome = { ...result, ok: false, status: status ?? null, reason: failure.error.message };
        } else {
          console.error('[APNs] send failure (unrecognised shape):', JSON.stringify(failure).slice(0, 300));
        }
      }
      return outcome;
    }).catch((err) => {
      console.error('[APNs] send error:', err.message);
      return { ...result, ok: false, reason: err.message };
    });
  }
  return { id: sub.id, platform: sub.platform, host: null, ok: false, reason: 'incomplete-subscription' };
}

// ONE line per send call summing up its WEB rows. Successful web sends logged
// nothing per device (only failures do), so "do Android pushes go out at
// all?" had no answer in the logs — 534 `[APNs] sent` lines a day and not a
// single web line (Lea, 18.10.2026). Counts and push-service hosts only
// (fcm.googleapis.com = Chrome/Android), never an endpoint; `kind` is the
// first segment of the tap target (chat, dm, …), not the full route — that
// would put who-wrote-to-whom into the logs.
const logWebSendOutcome = (scope, url, results) => {
  const web = results.filter((r) => r?.platform === 'web');
  if (!web.length) return;
  const ok = web.filter((r) => r.ok).length;
  const pruned = web.filter((r) => r.pruned).length;
  const hosts = new Map();
  for (const r of web) hosts.set(r.host, (hosts.get(r.host) || 0) + 1);
  const hostList = [...hosts].map(([h, n]) => `${h}:${n}`).join(',');
  const kind = String(url || '').split(/[/?#]/)[1] || '-';
  const vapid = web.some((r) => r.reason === 'vapid-not-configured') ? ' vapid=missing' : '';
  console.log(`[push] web sent ${scope} kind=${kind} subs=${web.length} ok=${ok} failed=${web.length - ok - pruned} pruned=${pruned} hosts=${hostList}${vapid}`);
};

// `title` may be a plain string (with `body`) OR a builder function
// `(locale) => ({ title, body })` from utils/pushLocale.pushTexts — the
// recipient's users.locale rides along on the subscriptions SELECT (one JOIN,
// no extra round trip), so every push type localizes per recipient.
const resolveTexts = (titleOrBuilder, body, locale) =>
  typeof titleOrBuilder === 'function'
    ? titleOrBuilder(locale)
    : { title: titleOrBuilder, body };

// Resolves to one dispatch result per subscription ([] when there is nothing
// to send to) — see dispatchToSubscription. Fan-out callers fire and forget.
export const sendPushToUser = async (userId, title, body, url = '/notifications', opts = {}) => {
  // No web AND no APNs configured — nothing to send. (If only one is configured
  // we still proceed; sends to the other platform will silently no-op.)
  if (!process.env.VAPID_PUBLIC_KEY && !process.env.APNS_KEY_ID) return [];

  let subs;
  try {
    const result = await db.query(
      `SELECT ps.id, ps.user_id, ps.platform, ps.endpoint, ps.p256dh, ps.auth_key, ps.device_token, u.locale
       FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
       WHERE ps.user_id = $1`,
      [userId]
    );
    subs = result.rows;
  } catch (err) {
    console.error('Push fetch error:', err);
    return [];
  }
  if (!subs.length) return [];

  const texts = resolveTexts(title, body, subs[0].locale);
  const results = await Promise.all(subs.map((sub) =>
    userPushSlots.run(() => dispatchToSubscription(sub, texts.title, texts.body, url, opts))
  ));
  logWebSendOutcome(`user=${userId}`, url, results);
  return results;
};

// The push devices registered for one user, as an admin may see them: platform,
// the push service's host for web rows, and when the device last registered
// (see subscribe — created_at is refreshed on every re-post). Never the
// endpoint or the device token: both are credentials for that device's push
// channel.
export const listPushDevices = async (userId) => {
  const { rows } = await db.query(
    `SELECT id, platform, endpoint, created_at
       FROM push_subscriptions WHERE user_id = $1
      ORDER BY created_at DESC NULLS LAST, id DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    host: r.platform === 'web' ? endpointHost(r.endpoint) : 'apns',
    registered_at: r.created_at,
  }));
};

// Bulk variant: ONE subscriptions SELECT for all recipients instead of N
// (deal fan-out queried up to 500 users, then sendPushToUser ran its own
// SELECT per user → up to 500 sequential round trips). Same per-sub dispatch;
// builder texts are computed once per distinct locale, not per subscription.
export const sendPushToUsers = async (userIds, title, body, url = '/notifications', opts = {}) => {
  if (!process.env.VAPID_PUBLIC_KEY && !process.env.APNS_KEY_ID) return;
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return;

  let subs;
  try {
    const result = await db.query(
      `SELECT ps.id, ps.user_id, ps.platform, ps.endpoint, ps.p256dh, ps.auth_key, ps.device_token, u.locale
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
  const results = await Promise.all(subs.map((sub) => {
    const key = sub.locale || 'de';
    let texts = textCache.get(key);
    if (!texts) { texts = resolveTexts(title, body, sub.locale); textCache.set(key, texts); }
    return bulkPushSlots.run(() => dispatchToSubscription(sub, texts.title, texts.body, url, opts));
  }));
  logWebSendOutcome(`bulk users=${ids.length}`, url, results);
};

// Ops fan-out (Batch 3): push every admin (Tobi/Tina/Robert/Arno). Used for
// "new club awaiting approval" and "new report" — the team isn't always in the
// app. Self-contained + best-effort: never throws into its caller.
export const sendPushToAdmins = async (titleOrBuilder, body = null, url = '/admin') => {
  try {
    const { rows } = await db.query('SELECT id FROM users WHERE is_admin = TRUE');
    if (rows.length) await sendPushToUsers(rows.map(r => r.id), titleOrBuilder, body, url);
  } catch (err) {
    console.error('admin push failed:', err.message);
  }
};
