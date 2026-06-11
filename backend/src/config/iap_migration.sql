-- IAP receipt ledger.
-- Stores every Apple StoreKit transaction we've already credited so a
-- repeat verify (network retry, restore flow, replay attack) is a no-op.

CREATE TABLE IF NOT EXISTS iap_receipts (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform          TEXT   NOT NULL CHECK (platform IN ('apple', 'google')),
  product_id        TEXT   NOT NULL,
  product_type      TEXT   NOT NULL CHECK (product_type IN ('boost', 'subscription')),
  transaction_id    TEXT   NOT NULL,
  original_transaction_id TEXT,   -- subscriptions: identifies the renewable purchase
  environment       TEXT,          -- 'Production' | 'Sandbox' from Apple's payload
  raw_receipt       TEXT NOT NULL, -- store JWS so we can re-verify in audits
  payload           JSONB NOT NULL,-- decoded receipt body
  credited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ                       -- subscriptions only
);

-- Dedup: each Apple transaction_id is processed exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS iap_receipts_platform_txid_idx
  ON iap_receipts (platform, transaction_id);

-- Fast lookup of a user's active subscription receipts.
CREATE INDEX IF NOT EXISTS iap_receipts_user_idx
  ON iap_receipts (user_id, product_type, credited_at DESC);

-- Fast lookup of a subscription chain for renewal verification.
CREATE INDEX IF NOT EXISTS iap_receipts_origtx_idx
  ON iap_receipts (original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;
