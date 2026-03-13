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
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  try {
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
    await db.query(
      `INSERT INTO push_subscriptions (user_id, platform, device_token)
       VALUES ($1, 'apns', $2)
       ON CONFLICT (user_id, device_token) DO NOTHING`,
      [req.userId, token]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('APNs token save error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// INTERNAL: SEND PUSH TO USER (called from notificationController)
// ==========================================
export const sendPushToUser = async (userId, title, body, url = '/notifications') => {
  if (!process.env.VAPID_PUBLIC_KEY) return; // push not configured, skip silently

  let subs;
  try {
    const result = await db.query(
      `SELECT * FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    subs = result.rows;
  } catch (err) {
    console.error('Push fetch error:', err);
    return;
  }

  const payload = JSON.stringify({ title, body, url });

  for (const sub of subs) {
    if (sub.platform === 'web' && sub.endpoint) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key }
      };
      webpush.sendNotification(pushSub, payload).catch((err) => {
        // 410 Gone = subscription expired, clean it up
        if (err.statusCode === 410) {
          db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
        } else {
          console.error('Push send error:', err.statusCode, err.message);
        }
      });
    }
    // APNs sending requires Apple certificates — see README for setup instructions
    // For iOS native push: implement with node-apn or Firebase Cloud Messaging
  }
};
