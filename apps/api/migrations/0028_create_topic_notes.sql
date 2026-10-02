-- Migration 0028: student notes, one per (topic, author)
-- Milestone 21 — Student notes: private and shared topic notes with staff moderation (Task 02)
-- Derived from RFC 0016 section 1. Purely additive: it creates one table and its
-- two indexes and issues no ALTER against any table that existed before it, so
-- the rollback is dropping topic_notes and no backfill exists to undo.
-- Apply locally with: make db-migrate-local

-- Notes are hard-deleted by their author (no thread to keep coherent, unlike
-- topic_comments). The UNIQUE pair makes "my note on this topic" a single row,
-- and it is what the create path's ON CONFLICT DO NOTHING arbitrates on.
-- revision is the optimistic-concurrency token of RFC 0016 section 4: every
-- write, by anyone (author or staff moderation), increments it; updated_at is
-- for display only, since datetime('now') cannot tell two same-second writes apart.
CREATE TABLE IF NOT EXISTS topic_notes (
  id             TEXT PRIMARY KEY,
  topic_node_id  TEXT NOT NULL REFERENCES topic_nodes(id),
  author_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  visibility     TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'shared')),
  revision       INTEGER NOT NULL DEFAULT 1,  -- +1 on every write, by anyone
  shared_at      TEXT,                         -- last time it became shared
  moderated_at   TEXT,                         -- set by a staff force-unshare, blocks re-sharing
  moderated_by   TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (topic_node_id, author_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_notes_author ON topic_notes (author_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_topic_notes_topic  ON topic_notes (topic_node_id, visibility);
