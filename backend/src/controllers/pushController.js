import webpush from 'web-push';
import db from '../config/database.js';

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
let _apnModule = null;
let _apnProvider = null;
let _apnInitTried = false;

async function getApnContext() {
  if (_apnProvider) return { apn: _apnModule, provider: _apnProvider };
  if (_apnInitTried) return null;
  _apnInitTried = true;

  const { APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY, APNS_BUNDLE_ID } = process.env;
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_KEY || !APNS_BUNDLE_ID) {
    return null;
  }

  try {
    const imported = await import('@parse/node-apn');
    _apnModule = imported.default || imported;
    _apnProvider = new _apnModule.Provider({
      token: {
        key: APNS_KEY.replace(/\\n/g, '\n'),
        keyId: APNS_KEY_ID,
        teamId: APNS_TEAM_ID,
      },
      production: process.env.NODE_ENV === 'production',
    });
    console.log('[APNs] Provider initialized');
    return { apn: _apnModule, provider: _apnProvider };
  } catch (err) {
    console.error('[APNs] Init failed (is @parse/node-apn installed?):', err.message);
    return null;
  }
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
// INTERNAL: SEND PUSH TO USER (called from notificationController)
// ==========================================
// Dispatch one already-fetched subscription row. apnCtxRef is a holder object
// ({ ctx }) so a whole batch resolves the APNs provider at most once.
async function dispatchToSubscription(sub, title, body, url, apnCtxRef) {
  if (sub.platform === 'web' && sub.endpoint) {
    if (!process.env.VAPID_PUBLIC_KEY) return;
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } };
    webpush.sendNotification(pushSub, JSON.stringify({ title, body, url })).catch((err) => {
      // 410 Gone = expired; FCM signals dead subscriptions with 404
      // ("NotRegistered") — both are permanent, clean them up.
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
      } else {
        console.error('Push send error:', err.statusCode, err.message);
      }
    });
  } else if (sub.platform === 'apns' && sub.device_token) {
    if (apnCtxRef.ctx === undefined) apnCtxRef.ctx = await getApnContext();
    if (!apnCtxRef.ctx) return;
    const { apn, provider } = apnCtxRef.ctx;
    const notification = new apn.Notification();
    notification.alert = { title, body };
    notification.topic = process.env.APNS_BUNDLE_ID;
    notification.sound = 'default';
    notification.payload = { url };
    notification.priority = 10; // display immediately
    provider.send(notification, sub.device_token).then((result) => {
      for (const failure of (result.failed || [])) {
        const reason = failure.response?.reason || '';
        if (reason === 'BadDeviceToken' || reason === 'Unregistered' || failure.status === '410') {
          db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
        } else if (reason) {
          console.error('[APNs] send failure:', reason, 'status', failure.status);
        }
      }
    }).catch((err) => console.error('[APNs] send error:', err.message));
  }
}

export const sendPushToUser = async (userId, title, body, url = '/notifications') => {
  // No web AND no APNs configured — nothing to send. (If only one is configured
  // we still proceed; sends to the other platform will silently no-op.)
  if (!process.env.VAPID_PUBLIC_KEY && !process.env.APNS_KEY_ID) return;

  let subs;
  try {
    const result = await db.query(
      `SELECT id, platform, endpoint, p256dh, auth_key, device_token
       FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    subs = result.rows;
  } catch (err) {
    console.error('Push fetch error:', err);
    return;
  }

  const apnCtxRef = {};
  for (const sub of subs) await dispatchToSubscription(sub, title, body, url, apnCtxRef);
};

// Bulk variant: ONE subscriptions SELECT for all recipients instead of N
// (deal fan-out queried up to 500 users, then sendPushToUser ran its own
// SELECT per user → up to 500 sequential round trips). Same per-sub dispatch.
export const sendPushToUsers = async (userIds, title, body, url = '/notifications') => {
  if (!process.env.VAPID_PUBLIC_KEY && !process.env.APNS_KEY_ID) return;
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return;

  let subs;
  try {
    const result = await db.query(
      `SELECT id, platform, endpoint, p256dh, auth_key, device_token
       FROM push_subscriptions WHERE user_id = ANY($1::int[])`,
      [ids]
    );
    subs = result.rows;
  } catch (err) {
    console.error('Push bulk fetch error:', err);
    return;
  }

  const apnCtxRef = {};
  for (const sub of subs) await dispatchToSubscription(sub, title, body, url, apnCtxRef);
};
