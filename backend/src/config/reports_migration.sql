-- Reports / Content Moderation Table
-- Run once against your existing database:
--   psql $DATABASE_URL -f src/config/reports_migration.sql

CREATE TABLE IF NOT EXISTS reports (
    id              SERIAL PRIMARY KEY,
    reporter_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_type   VARCHAR(20) NOT NULL
                      CHECK (reported_type IN ('user', 'group', 'message')),
    reported_id     INTEGER NOT NULL,
    reason          VARCHAR(50) NOT NULL
                      CHECK (reason IN ('spam', 'inappropriate', 'harassment', 'fake', 'other')),
    details         TEXT,
    status          VARCHAR(20) DEFAULT 'pending'
                      CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
    reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- One report per reporter per target (prevents spam-reporting)
    UNIQUE(reporter_id, reported_type, reported_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status   ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_type, reported_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
