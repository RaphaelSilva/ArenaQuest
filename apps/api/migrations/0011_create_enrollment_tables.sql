-- Migration 0011: user groups and enrollment tables
-- Milestone 5 — Engagement & Student Progress (Task 02)
-- user_groups and user_group_members are a scope-slip from M2; added here
-- because enrollments depend on them.

CREATE TABLE IF NOT EXISTS user_groups (
  id          TEXT NOT NULL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_group_members (
  group_id   TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_group_members_user
  ON user_group_members(user_id);

-- Direct per-user topic grants.
CREATE TABLE IF NOT EXISTS enrollments_user (
  id            TEXT NOT NULL PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
  granted_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, topic_node_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_user_user
  ON enrollments_user(user_id);

-- Group-level topic grants; all group members inherit access.
CREATE TABLE IF NOT EXISTS enrollments_user_group (
  id            TEXT NOT NULL PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
  granted_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, topic_node_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_group_group
  ON enrollments_user_group(group_id);
