-- Migration 0001: users, roles, and user_roles tables
-- Apply locally: wrangler d1 execute arenaquest-db --local --file ./migrations/0001_create_users.sql

CREATE TABLE IF NOT EXISTS users (
  id           TEXT    NOT NULL PRIMARY KEY,
  name         TEXT    NOT NULL,
  email        TEXT    NOT NULL UNIQUE,
  password_hash TEXT   NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'active',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT NOT NULL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
