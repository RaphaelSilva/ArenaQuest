-- Migration 0026: billing, contracts and receivables accounting
-- Milestone 19 — Student billing, contracts and receivables (Task 02)
-- Derived from RFC 0013 section 1. Purely additive: it creates seven tables,
-- their indexes and the currencies reference rows, and issues no ALTER against
-- any table that existed before it.
-- Apply locally with: make db-migrate-local

-- Reference data, seeded by this migration. It exists so that a currency code is
-- validated by the database rather than by convention, and so that an amount's
-- exponent is a fact the schema knows: 2 for BRL, 0 for JPY, 8 for BTC.
CREATE TABLE IF NOT EXISTS currencies (
  code      TEXT NOT NULL PRIMARY KEY,                        -- 'BRL', 'JPY', 'BTC'
  exponent  INTEGER NOT NULL CHECK (exponent BETWEEN 0 AND 18),
  symbol    TEXT NOT NULL,
  name      TEXT NOT NULL DEFAULT '',
  active    INTEGER NOT NULL DEFAULT 0
);

-- Seeded by this migration: BRL active, the rest available to flip on. JPY (exponent 0)
-- and BTC (exponent 8) are seeded deliberately, so the non-2-exponent path is exercised
-- by tests and dev without anyone having to insert a currency first.
INSERT OR IGNORE INTO currencies (code, exponent, symbol, name, active) VALUES
  ('BRL', 2, 'R$',  'Brazilian real', 1),
  ('USD', 2, 'US$', 'US dollar',      0),
  ('EUR', 2, '€',   'Euro',           0),
  ('JPY', 0, '¥',   'Japanese yen',   0),
  ('BTC', 8, '₿',   'Bitcoin',        0);

-- One tenant, one live currency. A tenant that ever switches flips the flag and the
-- old row stays, so an invoice issued years ago can still resolve its own exponent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_currencies_one_active
  ON currencies(active) WHERE active = 1;

-- The shelf: what a student can be sold. Freely editable, because it is a catalogue
-- and not a contract — nothing here is read once a subscription has copied it.
CREATE TABLE IF NOT EXISTS billing_plans (
  id              TEXT NOT NULL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  -- Minor units. Zero is a first-class plan.
  amount_minor    INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency        TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  cycle           TEXT NOT NULL CHECK (cycle IN ('monthly','quarterly','yearly')),
  grace_days      INTEGER NOT NULL DEFAULT 5 CHECK (grace_days >= 0),
  -- Reserved for per-topic pricing, which is a milestone Non-Goal. Unread in v1.
  scope_topic_id  TEXT REFERENCES topic_nodes(id) ON DELETE SET NULL,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The executed contract. Terms are SNAPSHOT from the plan at signature, and a negotiated
-- contract is this same row with different terms and terms_source='negotiated'.
CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT NOT NULL PRIMARY KEY,
  -- RESTRICT, not CASCADE: a student with financial history cannot be deleted.
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Provenance only. The terms below are the contract.
  plan_id       TEXT NOT NULL REFERENCES billing_plans(id) ON DELETE RESTRICT,
  -- Contract versioning. The first version sets contract_group_id to its own id, so
  -- every report groups on one column with no COALESCE. An amendment supersedes.
  contract_group_id TEXT NOT NULL,
  supersedes_id     TEXT REFERENCES subscriptions(id) ON DELETE RESTRICT,
  terms_source  TEXT NOT NULL DEFAULT 'standard'
                  CHECK (terms_source IN ('standard','negotiated')),
  amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),   -- snapshot
  currency      TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT, -- snapshot
  cycle         TEXT NOT NULL CHECK (cycle IN ('monthly','quarterly','yearly')), -- snapshot
  grace_days    INTEGER NOT NULL CHECK (grace_days >= 0),     -- snapshot
  due_day       INTEGER NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
  -- 'paused' suppresses future issuance only: invoices already open keep their due
  -- dates and keep counting toward standing, totals and aging.
  status        TEXT NOT NULL
                  CHECK (status IN ('active','paused','cancelled','superseded')),
  start_date    TEXT NOT NULL,              -- YYYY-MM-DD, THIS VERSION's start
  end_date      TEXT,                       -- set on cancel or supersede, no invoice past it
  terms_note    TEXT NOT NULL DEFAULT '',   -- why the terms differ, or why amended
  signed_by     TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  signed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_active
  ON subscriptions(user_id) WHERE status = 'active';
-- No forked chains: one version is superseded by at most one successor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_successor
  ON subscriptions(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_group
  ON subscriptions(contract_group_id);

-- A charge for one period, snapshot from the contract. The period is the idempotency
-- key of the invoice run. An amount of 0 is issued like any other and settles at once.
CREATE TABLE IF NOT EXISTS invoices (
  id               TEXT NOT NULL PRIMARY KEY,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  -- Denormalised so a student's receivables survive a contract chain rewrite.
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period_start     TEXT NOT NULL,          -- YYYY-MM-DD, inclusive
  period_end       TEXT NOT NULL,          -- YYYY-MM-DD, exclusive
  due_date         TEXT NOT NULL,
  -- Snapshot, in the currency's minor unit.
  amount_minor     INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency         TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT, -- snapshot
  grace_days       INTEGER NOT NULL CHECK (grace_days >= 0),     -- snapshot, standing reads THIS
  status           TEXT NOT NULL CHECK (status IN ('open','paid','void')),
  issued_at        TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at        TEXT,
  void_reason      TEXT,
  UNIQUE (subscription_id, period_start)   -- makes the monthly run idempotent
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_status ON invoices(user_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date) WHERE status = 'open';

-- Per-invoice overrides: a discount, a credit, a waiver, a late fee. APPEND-ONLY and
-- signed, so "change what this student owes" is an entry, not an UPDATE of the charge.
-- Every kind is applied BY HAND: nothing in this system accrues a fee on its own.
CREATE TABLE IF NOT EXISTS invoice_adjustments (
  id            TEXT NOT NULL PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL CHECK (kind IN ('discount','credit','waiver','surcharge')),
  amount_minor  INTEGER NOT NULL CHECK (amount_minor <> 0),  -- negative reduces what is owed
  reason        TEXT NOT NULL,
  applied_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  applied_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_adjustments_invoice
  ON invoice_adjustments(invoice_id);

-- Money actually received. APPEND-ONLY: no UPDATE, no DELETE.
-- A mistake is corrected by a reversing row whose amount is negative.
CREATE TABLE IF NOT EXISTS payments (
  id                 TEXT NOT NULL PRIMARY KEY,
  invoice_id         TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_minor       INTEGER NOT NULL CHECK (amount_minor <> 0),   -- negative = reversal
  currency           TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  method             TEXT NOT NULL CHECK (method IN ('cash','pix','bank_transfer','card','gateway','other')),
  paid_at            TEXT NOT NULL,        -- when the money moved, not when it was typed in
  external_reference TEXT,                 -- receipt no. today, gateway charge id later
  note               TEXT NOT NULL DEFAULT '',
  -- Set on a reversal row, naming the payment being reversed.
  reverses_id        TEXT REFERENCES payments(id) ON DELETE RESTRICT,
  recorded_by        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_reversal ON payments(reverses_id)
  WHERE reverses_id IS NOT NULL;

-- "Stop chasing this one." An open dispute, a payment being verified, an arrangement
-- made in person: the student still owes, but must not appear in the delinquency list
-- or receive a reminder. Since standing is only ever reported, this suppresses a
-- report and an email — it grants nothing and revokes nothing.
-- A scholarship is a FREE PLAN, not a hold.
-- CASCADE here is deliberate: a hold is an operational note, not accounting data.
CREATE TABLE IF NOT EXISTS billing_standing_holds (
  user_id     TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  expires_at  TEXT,
  set_by      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  set_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
