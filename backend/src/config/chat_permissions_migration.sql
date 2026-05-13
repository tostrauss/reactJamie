-- Migration: add chat_only_owner flag to groups table
-- Run once on production DB
ALTER TABLE groups ADD COLUMN IF NOT EXISTS chat_only_owner BOOLEAN DEFAULT FALSE;
