-- LOCAL DEVELOPMENT SEED — DO NOT RUN IN STAGING OR PRODUCTION
-- Provisions three test accounts for local development and manual testing.
-- Credentials are documented in CONTRIBUTING.md.
-- Run via: make db-seed-dev
--
-- Passwords (PBKDF2-SHA256, 100 000 iterations):
--   admin@arenaquest.dev     → Admin1234!
--   student@arenaquest.dev   → Student1234!
--   professor@arenaquest.dev → Professor1234!

-- Users
INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES
  (
    'seed-admin-00000000-0000-0000-0000-000000000001',
    'Admin Test',
    'admin@arenaquest.dev',
    'pbkdf2:100000:14987ad9c165000b3c1deb276aceb877:829f6ee1357f13811ab9c944fc1535da74f5ff8ab67215c79b45319b68ecb48a',
    'active'
  ),
  (
    'seed-student-0000-0000-0000-0000-000000000002',
    'Student Test',
    'student@arenaquest.dev',
    'pbkdf2:100000:fd6f1ec294b6ab4140128e8e417da852:a2bcfeaa95deb970cb74e273c99799eb3a6a25b02a18ed6759bb016bc9e47afc',
    'active'
  ),
  (
    'seed-professor-000-0000-0000-0000-000000000003',
    'Professor Test',
    'professor@arenaquest.dev',
    'pbkdf2:100000:eafc23fd552a682ad8f800dd8df7a027:9308fbe92ddf94090a1b39c9eae8341040b1eabee6028223f5e7aa346c389f86',
    'active'
  );

-- Role assignments
INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES
  -- Admin
  ('seed-admin-00000000-0000-0000-0000-000000000001', 'bace0701-15e3-5144-97c5-47487d543032'),
  -- Student
  ('seed-student-0000-0000-0000-0000-000000000002', 'bf3d0f1d-7d77-5151-922e-b87dff0fa7ad'),
  -- Professor: tutor + content_creator
  ('seed-professor-000-0000-0000-0000-000000000003', '32a5cab1-e66f-5d23-a80d-80cfa927d057'),
  ('seed-professor-000-0000-0000-0000-000000000003', '3318927d-8b5e-52d9-a145-2e4323919ed6');
