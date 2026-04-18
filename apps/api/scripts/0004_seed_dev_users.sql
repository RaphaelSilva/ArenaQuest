-- Migration 0004: Seed development users
-- This file adds dummy users for local development.

-- 1. Admin User
-- Password: password123
INSERT OR IGNORE INTO users (id, name, email, password_hash, status)
VALUES (
  '00000000-0000-4000-a000-000000000001',
  'Admin',
  'admin@arenaquest.com',
  'pbkdf2:100000:e83835066ab015b5ed4449b68a349b38:8baf9add6396eb5845f571fd841541e6e5d4f4ecba167d9487cc59dc02f0a7e2',
  'active'
);

-- Assign Admin role
INSERT OR IGNORE INTO user_roles (user_id, role_id)
VALUES (
  '00000000-0000-4000-a000-000000000001',
  'bace0701-15e3-5144-97c5-47487d543032'
);

-- 2. Student User
-- Password: password123
INSERT OR IGNORE INTO users (id, name, email, password_hash, status)
VALUES (
  '00000000-0000-4000-a000-000000000002',
  'Student',
  'student@arenaquest.com',
  'pbkdf2:100000:e83835066ab015b5ed4449b68a349b38:8baf9add6396eb5845f571fd841541e6e5d4f4ecba167d9487cc59dc02f0a7e2',
  'active'
);

-- Assign Student role
INSERT OR IGNORE INTO user_roles (user_id, role_id)
VALUES (
  '00000000-0000-4000-a000-000000000002',
  'bf3d0f1d-7d77-5151-922e-b87dff0fa7ad'
);
