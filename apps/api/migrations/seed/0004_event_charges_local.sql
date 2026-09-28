-- LOCAL DEVELOPMENT SEED — DO NOT RUN IN STAGING OR PRODUCTION
-- Gives the local replica a working extras ledger (RFC 0015, Milestone 22
-- Task 02): one priced, published event and three charges on it covering the
-- scenarios the extras rail turns on — a paid charge, an overdue charge, and a
-- buyer who holds no contract at all.
-- Run via: make db-seed-local
--
-- Depends on 0001_test_users.sql (admin, student), 0002_billing_local.sql
-- (student2 and both contracts), 0003_events_local.sql (the published public
-- event) and migration 0028 for the four event-charge tables.
--
-- Every INSERT is INSERT OR IGNORE and the closing UPDATE recomputes a cache,
-- so re-seeding is a no-op.
--
-- Dates are relative (date('now', ...)) so "overdue" stays overdue and "not
-- yet due" stays not yet due whenever the repository is cloned.
--
-- Password (PBKDF2-SHA256, 100 000 iterations):
--   student3@arenaquest.dev → Student1234!

-- ---------------------------------------------------------------------------
-- The extras-only buyer: a student with NO subscription. The roster must list
-- them on the extras rail although the contract rail knows nothing of them.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES
  (
    'seed-student-extras-0000-0000-00000005',
    'Student Extras Test',
    'student3@arenaquest.dev',
    'pbkdf2:100000:fd6f1ec294b6ab4140128e8e417da852:a2bcfeaa95deb970cb74e273c99799eb3a6a25b02a18ed6759bb016bc9e47afc',
    'active'
  );

INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES
  ('seed-student-extras-0000-0000-00000005', 'bf3d0f1d-7d77-5151-922e-b87dff0fa7ad');

-- ---------------------------------------------------------------------------
-- The price tag of the published, public Open Mat Seminar: R$ 80,00, due a
-- week after issue, five days of grace.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO event_prices
  (event_id, amount_minor, currency, due_in_days, grace_days, updated_by) VALUES
  (
    'seed-event-public-upcoming-00000001',
    8000,
    'BRL',
    7,
    5,
    'seed-admin-00000000-0000-0000-0000-000000000001'
  );

-- ---------------------------------------------------------------------------
-- The charges. Every one is inserted as 'open': the cached status is derived
-- from the ledger by the UPDATE at the end of this file, never typed here.
-- The description is the event title snapshot, as the adapter writes it.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO event_charges
  (id, event_id, user_id, description, amount_minor, currency,
   terms_source, terms_note, due_date, grace_days, status, issued_by, issued_at) VALUES

  -- 1. PAID — student@ (who also holds the paid monthly contract), settled in full.
  (
    'seed-charge-paid-0000-0000-000000000001',
    'seed-event-public-upcoming-00000001',
    'seed-student-0000-0000-0000-0000-000000000002',
    'Open Mat Seminar',
    8000,
    'BRL',
    'standard',
    '',
    date('now', '-10 days'),
    5,
    'open',
    'seed-admin-00000000-0000-0000-0000-000000000001',
    datetime('now', '-17 days')
  ),

  -- 2. OVERDUE — student2@ (free contract), due 20 days ago with 5 days of
  -- grace and nothing paid: delinquent on the extras rail while the contract
  -- rail stays good.
  (
    'seed-charge-overdue-0000-0000-00000002',
    'seed-event-public-upcoming-00000001',
    'seed-student-free-0000-0000-00000004',
    'Open Mat Seminar',
    8000,
    'BRL',
    'standard',
    '',
    date('now', '-20 days'),
    5,
    'open',
    'seed-admin-00000000-0000-0000-0000-000000000001',
    datetime('now', '-27 days')
  ),

  -- 3. EXTRAS-ONLY — student3@, no contract, a negotiated amount with its
  -- mandatory note, not yet due.
  (
    'seed-charge-extras-0000-0000-00000003',
    'seed-event-public-upcoming-00000001',
    'seed-student-extras-0000-0000-00000005',
    'Open Mat Seminar',
    5000,
    'BRL',
    'negotiated',
    'Guest rate agreed in person for a first seminar.',
    date('now', '+7 days'),
    5,
    'open',
    'seed-admin-00000000-0000-0000-0000-000000000001',
    datetime('now')
  );

-- The payment that settles charge 1.
INSERT OR IGNORE INTO event_charge_payments
  (id, charge_id, amount_minor, currency, method, paid_at,
   external_reference, note, reverses_id, recorded_by) VALUES
  (
    'seed-charge-payment-0000-0000-00000001',
    'seed-charge-paid-0000-0000-000000000001',
    8000,
    'BRL',
    'pix',
    date('now', '-12 days'),
    'PIX-SEED-0001',
    'Seed payment.',
    NULL,
    'seed-admin-00000000-0000-0000-0000-000000000001'
  );

-- ---------------------------------------------------------------------------
-- Refresh the status cache of the seeded charges with the same expression the
-- adapter runs after every ledger write. A voided charge is never touched.
-- ---------------------------------------------------------------------------
UPDATE event_charges
   SET status = CASE
     WHEN amount_minor
        + COALESCE((SELECT SUM(a.amount_minor) FROM event_charge_adjustments a WHERE a.charge_id = event_charges.id), 0)
        - COALESCE((SELECT SUM(p.amount_minor) FROM event_charge_payments p WHERE p.charge_id = event_charges.id), 0) <= 0
     THEN 'paid' ELSE 'open' END
 WHERE id IN (
     'seed-charge-paid-0000-0000-000000000001',
     'seed-charge-overdue-0000-0000-00000002',
     'seed-charge-extras-0000-0000-00000003'
   )
   AND status <> 'void';
