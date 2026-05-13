-- Migration 0014: append-only XP event log
-- Milestone 7 — Gamification Data Layer (Task 01)
-- unique(user_id, source_kind, idempotency_key) prevents double-crediting the same source event.

CREATE TABLE IF NOT EXISTS xp_events (
  id               TEXT    NOT NULL PRIMARY KEY,
  user_id          TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind      TEXT    NOT NULL,
  source_id        TEXT,
  points           INTEGER NOT NULL,
  idempotency_key  TEXT    NOT NULL,
  earned_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_xp_events_idempotency
  ON xp_events(user_id, source_kind, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_xp_events_user
  ON xp_events(user_id);
