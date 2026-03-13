-- Run once against production DB.
-- Covers: Telemetry (Epic 2), Event Reviews (Epic 4), Trusted User (Epic 5)

-- ==========================================
-- ANALYTICS EVENTS  (Epic 2)
-- ==========================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type  VARCHAR(50)  NOT NULL,   -- screen_view, screen_leave, app_open, app_close, account_delete
  screen_name VARCHAR(120),
  duration_ms INTEGER,
  metadata    JSONB,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_user    ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_type    ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_screen  ON analytics_events(screen_name);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);

-- ==========================================
-- CATEGORY SUGGESTIONS  (Epic 1)
-- ==========================================
CREATE TABLE IF NOT EXISTS category_suggestions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  suggestion  TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- EVENT ATTENDANCE REVIEWS  (Epic 4 + 5)
-- ==========================================
CREATE TABLE IF NOT EXISTS event_reviews (
  id               SERIAL PRIMARY KEY,
  group_id         INTEGER NOT NULL REFERENCES groups(id)  ON DELETE CASCADE,
  reviewer_id      INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  reviewed_user_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  was_present      BOOLEAN NOT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, reviewer_id, reviewed_user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_reviews_group    ON event_reviews(group_id);
CREATE INDEX IF NOT EXISTS idx_event_reviews_reviewed ON event_reviews(reviewed_user_id);

-- ==========================================
-- TRUSTED USER COLUMNS  (Epic 5)
-- ==========================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_trusted_user BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_count   INTEGER NOT NULL DEFAULT 0;
