-- Run this once against your production database to enable push notifications.
-- Stores both web-push (VAPID) subscriptions and native APNs tokens.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'web'  = Web Push / VAPID (Android TWA + browsers)
  -- 'apns' = Apple Push Notification service (Capacitor iOS)
  platform     VARCHAR(10) NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'apns')),
  -- Web Push fields
  endpoint     TEXT,
  p256dh       TEXT,
  auth_key     TEXT,
  -- APNs fields
  device_token TEXT,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- One subscription per user per endpoint/device
  UNIQUE(user_id, endpoint),
  UNIQUE(user_id, device_token)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);
