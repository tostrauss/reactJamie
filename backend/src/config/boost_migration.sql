-- Run once against production DB to enable the Boost & Referral system.

-- ==========================================
-- REFERRAL CODES
-- ==========================================
CREATE TABLE IF NOT EXISTS referral_codes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       VARCHAR(20) NOT NULL UNIQUE,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);

-- ==========================================
-- BOOST CREDITS (wallet per user)
-- ==========================================
CREATE TABLE IF NOT EXISTS boost_credits (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credits       INTEGER NOT NULL DEFAULT 0,
  total_earned  INTEGER NOT NULL DEFAULT 0
);

-- ==========================================
-- ACTIVE BOOSTS
-- ==========================================
CREATE TABLE IF NOT EXISTS boosts (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type   VARCHAR(10) NOT NULL CHECK (target_type IN ('group', 'club')),
  target_id     INTEGER NOT NULL,
  credits_spent INTEGER NOT NULL DEFAULT 1,
  boosted_until TIMESTAMP NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_boosts_target ON boosts(target_type, target_id);

-- ==========================================
-- BOOST TRANSACTIONS (payment history)
-- ==========================================
CREATE TABLE IF NOT EXISTS boost_transactions (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credits          INTEGER NOT NULL,
  amount_cents     INTEGER NOT NULL,
  currency         VARCHAR(3) NOT NULL DEFAULT 'EUR',
  payment_provider VARCHAR(20),           -- 'stripe', 'referral'
  payment_id       TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, completed, failed
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
