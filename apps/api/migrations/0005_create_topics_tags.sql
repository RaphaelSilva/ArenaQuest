-- Migration 0005: topic_nodes, tags, and their join tables
-- Idempotent: all statements use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS topic_nodes (
  id                TEXT    NOT NULL PRIMARY KEY,
  parent_id         TEXT    REFERENCES topic_nodes(id) ON DELETE RESTRICT,
  title             TEXT    NOT NULL,
  content           TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL DEFAULT 'draft',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  archived          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id         TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS topic_node_tags (
  topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
  tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_node_id, tag_id)
);

CREATE TABLE IF NOT EXISTS topic_node_prerequisites (
  topic_node_id   TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
  prerequisite_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_node_id, prerequisite_id)
);
