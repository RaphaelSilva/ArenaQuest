-- Migration 0015: denormalized XP read model
-- Milestone 7 — Gamification Data Layer (Task 01)
-- Kept in sync atomically when an xp_events row is successfully inserted.

CREATE TABLE IF NOT EXISTS user_xp (
  user_id    TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_xp   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
