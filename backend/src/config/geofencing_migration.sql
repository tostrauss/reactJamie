-- Run once against production DB.
-- Adds: waitlist, country_votes, pioneer_claims, is_pioneer column on users.

-- ==========================================
-- WAITLIST (international users)
-- ==========================================
CREATE TABLE IF NOT EXISTS waitlist (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) NOT NULL UNIQUE,
  country    VARCHAR(10),
  ip         VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_waitlist_country ON waitlist(country);

-- ==========================================
-- COUNTRY VOTES (denormalized tally)
-- ==========================================
CREATE TABLE IF NOT EXISTS country_votes (
  country VARCHAR(10) PRIMARY KEY,
  votes   INTEGER NOT NULL DEFAULT 0
);

-- ==========================================
-- PIONEER SYSTEM
-- ==========================================

-- Badge flag on the user
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pioneer BOOLEAN NOT NULL DEFAULT FALSE;

-- One pioneer claim per ~50 km grid cell (0.5° steps).
-- lat_cell = FLOOR(lat / 0.5) * 0.5, same for lng_cell.
-- UNIQUE(lat_cell, lng_cell) ensures only the very first group creator wins.
CREATE TABLE IF NOT EXISTS pioneer_claims (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id   INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  lat_cell   NUMERIC(6,2) NOT NULL,
  lng_cell   NUMERIC(6,2) NOT NULL,
  claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(lat_cell, lng_cell)
);

CREATE INDEX IF NOT EXISTS idx_pioneer_claims_cell ON pioneer_claims(lat_cell, lng_cell);
CREATE INDEX IF NOT EXISTS idx_pioneer_claims_user ON pioneer_claims(user_id);
