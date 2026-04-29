-- Migration 0006: media table
-- Idempotent: uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS media (
  id            TEXT    NOT NULL PRIMARY KEY,
  topic_node_id TEXT    NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
  uploaded_by   TEXT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key   TEXT    NOT NULL,
  original_name TEXT    NOT NULL,
  type          TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'pending',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
