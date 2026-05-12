CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider         TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_accounts_provider_user
  ON oauth_accounts (provider, user_id);
