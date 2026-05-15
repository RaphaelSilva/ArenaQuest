-- Migration 0023: add timezone column to users table
-- Apply locally: wrangler d1 execute arenaquest-db --local --file ./migrations/0023_add_user_timezone.sql

ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
