-- Migration 0012: password reset tokens
-- One-time, time-limited tokens for the forgot-password flow.
-- The plaintext token is never stored; only its SHA-256 hex digest is persisted.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash   TEXT    NOT NULL PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens (user_id);
