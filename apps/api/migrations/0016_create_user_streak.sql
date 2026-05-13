-- Migration 0016: streak read model
-- Milestone 7 — Gamification Data Layer (Task 01)
-- Upserted by the streak evaluator (Task 07). last_activity_date is a local YYYY-MM-DD date string.

CREATE TABLE IF NOT EXISTS user_streak (
  user_id             TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak      INTEGER NOT NULL DEFAULT 0,
  longest_streak      INTEGER NOT NULL DEFAULT 0,
  last_activity_date  TEXT,
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
