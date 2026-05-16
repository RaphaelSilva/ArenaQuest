-- Migration 0024: missions + mission_progress tables (Task 03 — Mission Data Layer)
-- Apply locally: wrangler d1 execute arenaquest-db --local --file ./migrations/0024_create_missions.sql

CREATE TABLE IF NOT EXISTS missions (
  id               TEXT    NOT NULL PRIMARY KEY,
  title            TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  start_at         TEXT    NOT NULL,
  end_at           TEXT    NOT NULL,
  predicate_kind   TEXT    NOT NULL,
  predicate_params TEXT    NOT NULL DEFAULT '{}',
  xp_reward        INTEGER NOT NULL DEFAULT 0,
  badge_id         TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mission_progress (
  user_id       TEXT    NOT NULL,
  mission_id    TEXT    NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  target_value  INTEGER NOT NULL DEFAULT 1,
  completed     INTEGER NOT NULL DEFAULT 0,
  completed_at  TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, mission_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
);
