-- DEV ONLY: Drops all tables so schema.sql can be re-applied from scratch.
-- NEVER run this against a production database.
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS user_pinnwand CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS dm_conversations CASCADE;
DROP TABLE IF EXISTS direct_messages CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS group_favorites CASCADE;
DROP TABLE IF EXISTS group_waitlist CASCADE;
DROP TABLE IF EXISTS group_join_requests CASCADE;
DROP TABLE IF EXISTS group_members CASCADE;
DROP TABLE IF EXISTS friendships CASCADE;
-- migrations.js-only table (2026-10). Dropped explicitly: CASCADE on groups
-- would remove only its FK and leave the table behind, and the next boot's
-- CREATE TABLE IF NOT EXISTS would then keep that FK-less copy.
DROP TABLE IF EXISTS group_join_log CASCADE;
DROP TABLE IF EXISTS featured_clubs CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS "session" CASCADE;
