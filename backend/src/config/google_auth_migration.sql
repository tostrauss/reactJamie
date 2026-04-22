-- Run once to add Google OAuth support
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
