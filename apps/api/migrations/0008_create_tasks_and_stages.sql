-- Migration 0008: tasks and task_stages
-- Backbone tables for Milestone 4 (Task Engine). Junction tables for topic
-- linking arrive in migration 0009.

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT NOT NULL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_stages (
  id         TEXT    NOT NULL PRIMARY KEY,
  task_id    TEXT    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_stages_task_order
  ON task_stages(task_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_task_stages_task ON task_stages(task_id);
