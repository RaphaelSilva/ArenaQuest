-- Migration 0010: progress tracking tables
-- Milestone 5 — Engagement & Student Progress (Task 01)
-- Three tables: topic_progress (upsert), task_progress (upsert), task_stage_progress (append-only).

CREATE TABLE IF NOT EXISTS topic_progress (
  id            TEXT NOT NULL PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'not_started',
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_topic_progress_user_topic
  ON topic_progress(user_id, topic_node_id);

CREATE INDEX IF NOT EXISTS idx_topic_progress_user
  ON topic_progress(user_id);

CREATE TABLE IF NOT EXISTS task_progress (
  id               TEXT NOT NULL PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'not_started',
  current_stage_id TEXT REFERENCES task_stages(id) ON DELETE SET NULL,
  completed_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_progress_user_task
  ON task_progress(user_id, task_id);

CREATE INDEX IF NOT EXISTS idx_task_progress_user
  ON task_progress(user_id);

-- Append-only check-in log: one row per (user, stage). No updates, no deletes.
CREATE TABLE IF NOT EXISTS task_stage_progress (
  id            TEXT NOT NULL PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  stage_id      TEXT NOT NULL REFERENCES task_stages(id) ON DELETE CASCADE,
  checked_in_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_stage_progress_user_stage
  ON task_stage_progress(user_id, stage_id);

CREATE INDEX IF NOT EXISTS idx_task_stage_progress_user_task
  ON task_stage_progress(user_id, task_id);
