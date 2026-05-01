-- Single-use activation tokens for the public self-registration flow.
-- Storing only the SHA-256 hash mirrors the pattern used for refresh tokens
-- (0004_hash_refresh_tokens.sql): a DB dump can never be replayed because
-- the plaintext token only ever existed in the activation email.
CREATE TABLE IF NOT EXISTS user_activation_tokens (
  token_hash    TEXT    NOT NULL PRIMARY KEY,
  user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activation_tokens_user
  ON user_activation_tokens(user_id);
