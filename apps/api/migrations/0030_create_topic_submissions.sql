-- Migration 0030: topic_submissions (RFC 0020 section 1, M23 Task 02)
-- Student demonstrations: one file plus title and description per row, in its own
-- table so no reader of `media` can ever surface a student upload.
-- 0028 and 0029 are reserved for M21 (notes) and M22 (event charges).
-- Touches no existing table. Idempotent: every statement uses IF NOT EXISTS.
--
-- status: pending (presigned, not finalized) -> ready -> removed (admin tombstone:
-- object deleted, storage_key NULL, row kept for its author and the audit trail).
-- Removed rows are outside every quota and every non-author, non-staff listing.
-- moderated_by / removed_by are ON DELETE SET NULL: D1 enforces foreign keys, so a
-- plain reference would make deleting a staff account that once moderated fail.
-- storage_key is UNIQUE; SQLite allows many NULLs, one per tombstone.

CREATE TABLE IF NOT EXISTS topic_submissions (
  id             TEXT PRIMARY KEY,
  topic_node_id  TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
  author_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  storage_key    TEXT UNIQUE,
  original_name  TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'ready', 'removed')),
  visibility     TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'shared')),
  shared_at      TEXT,
  moderated_at   TEXT,
  moderated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  removed_at     TEXT,
  removed_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_topic_submissions_author ON topic_submissions (author_id, topic_node_id, status);
CREATE INDEX IF NOT EXISTS idx_topic_submissions_topic  ON topic_submissions (topic_node_id, status, visibility, shared_at);
CREATE INDEX IF NOT EXISTS idx_topic_submissions_sweep  ON topic_submissions (status, created_at);
