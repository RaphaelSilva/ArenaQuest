CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon_emoji TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  xp_reward INTEGER NOT NULL DEFAULT 0,
  rule_kind TEXT NOT NULL,
  rule_params TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_badges (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, badge_id),
  FOREIGN KEY (badge_id) REFERENCES badges(id)
);
