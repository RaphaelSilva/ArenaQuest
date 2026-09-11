-- LOCAL DEVELOPMENT SEED — DO NOT RUN IN STAGING OR PRODUCTION
-- Gives the local replica a working billing ledger: one paid plan, one free
-- plan, and a student subscribed to each (RFC 0013, Milestone 19 Task 02).
-- Run via: make db-seed-local
--
-- Depends on 0001_test_users.sql for the admin and student accounts, and on
-- migration 0026 for the currencies reference rows.
--
-- idx_subscriptions_one_active allows exactly one active contract per user, so
-- the free contract gets its own student rather than a second row on the first.
--
-- Every statement is INSERT OR IGNORE, so re-seeding is a no-op.
--
-- Password (PBKDF2-SHA256, 100 000 iterations):
--   student2@arenaquest.dev → Student1234!

-- The second student, owner of the free contract.
INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES
  (
    'seed-student-free-0000-0000-00000004',
    'Student Free Test',
    'student2@arenaquest.dev',
    'pbkdf2:100000:fd6f1ec294b6ab4140128e8e417da852:a2bcfeaa95deb970cb74e273c99799eb3a6a25b02a18ed6759bb016bc9e47afc',
    'active'
  );

INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES
  ('seed-student-free-0000-0000-00000004', 'bf3d0f1d-7d77-5151-922e-b87dff0fa7ad');

-- The shelf: one paid plan and one free plan, both in the active currency.
INSERT OR IGNORE INTO billing_plans
  (id, name, description, amount_minor, currency, cycle, grace_days, archived) VALUES
  (
    'seed-plan-monthly-0000-0000-00000001',
    'Monthly membership',
    'Standard monthly membership used by the local seed.',
    15000,
    'BRL',
    'monthly',
    5,
    0
  ),
  (
    'seed-plan-free-0000-0000-00000000002',
    'Scholarship',
    'Free plan. A scholarship is a free contract, never a standing hold.',
    0,
    'BRL',
    'monthly',
    0,
    0
  );

-- The signed contracts. Terms are snapshots of the plan at signature, so these
-- columns are written out in full rather than joined back to billing_plans.
-- The first version of a chain sets contract_group_id to its own id.
INSERT OR IGNORE INTO subscriptions
  (id, user_id, plan_id, contract_group_id, supersedes_id, terms_source,
   amount_minor, currency, cycle, grace_days, due_day, status,
   start_date, end_date, terms_note, signed_by) VALUES
  (
    'seed-sub-paid-0000-0000-000000000001',
    'seed-student-0000-0000-0000-0000-000000000002',
    'seed-plan-monthly-0000-0000-00000001',
    'seed-sub-paid-0000-0000-000000000001',
    NULL,
    'standard',
    15000,
    'BRL',
    'monthly',
    5,
    10,
    'active',
    '2026-01-01',
    NULL,
    '',
    'seed-admin-00000000-0000-0000-0000-000000000001'
  ),
  (
    'seed-sub-free-0000-0000-000000000002',
    'seed-student-free-0000-0000-00000004',
    'seed-plan-free-0000-0000-00000000002',
    'seed-sub-free-0000-0000-000000000002',
    NULL,
    'standard',
    0,
    'BRL',
    'monthly',
    0,
    10,
    'active',
    '2026-01-01',
    NULL,
    'Scholarship granted locally for development.',
    'seed-admin-00000000-0000-0000-0000-000000000001'
  );
