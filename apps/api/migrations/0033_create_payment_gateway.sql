-- Migration 0033: payment gateway persistence (RFC 0026 section 2, M30 Task 03)
-- Additive. Adds the system actor, gateway_checkouts, gateway_events and the
-- two money-level idempotency indexes, and rebuilds job_runs so its job CHECK
-- admits reconcile_payments. No money table is altered or rebuilt, and no
-- existing column changes meaning.
-- Safe to replay: every CREATE uses IF NOT EXISTS, the actor is INSERT OR
-- IGNORE, and the job_runs rebuild copies whatever rows it finds verbatim.
-- Rollback: drop the two indexes on the payment tables, then gateway_events,
-- then gateway_checkouts; the system actor row and the wider job CHECK are
-- harmless to keep.
--
-- @contract: job_runs is rebuilt (create, copy, drop, rename) only to widen its job CHECK with 'reconcile_payments' - same columns, same index, every row copied, so code reading the old shape keeps working

-- ---------------------------------------------------------------------------
-- The system actor. Satisfies recorded_by NOT NULL REFERENCES users(id) on both
-- payment tables for a machine-written payment (R8), so no money table has to
-- be rebuilt to make that column nullable. status 'system' is a new value in a
-- column with no CHECK; it is not 'active', so it is refused a login. The empty
-- password hash can never verify and the .invalid TLD can never receive mail.
-- It holds no role row, so it passes no role guard anywhere.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO users (id, name, email, password_hash, status)
VALUES ('system:payment-gateway', 'Payment gateway', 'payment-gateway@system.invalid', '', 'system');

-- ---------------------------------------------------------------------------
-- gateway_checkouts: one attempt to collect one receivable through a provider's
-- hosted page. NOT money - money stays a row in payments or
-- event_charge_payments. The receivable is (receivable_kind, receivable_id), so
-- both rails are payable through one flow without a join across them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gateway_checkouts (
  id                   TEXT NOT NULL PRIMARY KEY,
  provider             TEXT NOT NULL CHECK (provider IN ('stripe','mercadopago','asaas','pagarme')),
  receivable_kind      TEXT NOT NULL CHECK (receivable_kind IN ('invoice','event_charge')),
  receivable_id        TEXT NOT NULL,
  -- The student who owes it. RESTRICT like every money-adjacent foreign key.
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Who pressed the button: the student, or an admin acting on their behalf.
  created_by           TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- The balance at creation - what the provider was asked to collect.
  amount_minor         INTEGER NOT NULL CHECK (amount_minor > 0),
  currency             TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  status               TEXT NOT NULL CHECK (status IN ('open','paid','expired','cancelled','failed','mismatch')),
  -- The hosted session / preference id (bare).
  provider_session_id  TEXT,
  -- Set when a payment is confirmed (bare).
  provider_payment_id  TEXT,
  -- Exactly one of these is set on a 'paid' row, and it matches receivable_kind.
  invoice_payment_id   TEXT REFERENCES payments(id) ON DELETE RESTRICT,
  charge_payment_id    TEXT REFERENCES event_charge_payments(id) ON DELETE RESTRICT,
  checkout_url         TEXT NOT NULL,
  expires_at           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at            TEXT,
  -- Last time the reconcile run asked the provider about this checkout.
  last_checked_at      TEXT,
  -- Provider status / mismatch / dispute description - never a body.
  failure_detail       TEXT,
  -- Dismissal (milestone 30, decision 20): hides the row from the exceptions
  -- list. It changes neither status nor any ledger row.
  dismissed_at         TEXT,
  dismissed_by         TEXT REFERENCES users(id) ON DELETE RESTRICT,
  dismiss_note         TEXT,
  CHECK (NOT (invoice_payment_id IS NOT NULL AND charge_payment_id IS NOT NULL)),
  CHECK (receivable_kind <> 'invoice'      OR charge_payment_id  IS NULL),
  CHECK (receivable_kind <> 'event_charge' OR invoice_payment_id IS NULL)
);

-- At most one live attempt per receivable: a second Pay returns the open session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_checkouts_one_open
  ON gateway_checkouts(receivable_kind, receivable_id) WHERE status = 'open';
-- Provider ids are unique per provider, not globally: a label may bind several.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_checkouts_session
  ON gateway_checkouts(provider, provider_session_id) WHERE provider_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_checkouts_payment
  ON gateway_checkouts(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gateway_checkouts_user ON gateway_checkouts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_gateway_checkouts_expiry ON gateway_checkouts(expires_at) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- gateway_events: webhook de-duplication and audit. Providers deliver at least
-- once; the event id is the key. A row is written only after the signature
-- verified. One row per event, however many times it is delivered. outcome is
-- the row's CURRENT state: 'received' (written before processing) and 'failed'
-- are not final, every other value is. attempts counts every processing
-- attempt, whoever made it. error is a message truncated to 1024 characters by
-- the adapter - never a body.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gateway_events (
  provider             TEXT NOT NULL,
  event_id             TEXT NOT NULL,
  type                 TEXT NOT NULL,
  provider_payment_id  TEXT,
  checkout_id          TEXT REFERENCES gateway_checkouts(id) ON DELETE RESTRICT,
  received_at          TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at         TEXT,
  outcome              TEXT NOT NULL CHECK (outcome IN ('received','applied','duplicate','ignored','orphan','mismatch','failed')),
  attempts             INTEGER NOT NULL DEFAULT 1,
  error                TEXT CHECK (error IS NULL OR length(error) <= 1024),
  -- Dismissal (milestone 30, decision 20): changes no outcome.
  dismissed_at         TEXT,
  dismissed_by         TEXT REFERENCES users(id) ON DELETE RESTRICT,
  dismiss_note         TEXT,
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_gateway_events_unsettled
  ON gateway_events(received_at) WHERE outcome IN ('received','failed');

-- ---------------------------------------------------------------------------
-- Money-level idempotency (R9): one ledger row per provider payment or refund
-- id, on each rail. The reference is written '<provider>:<id>', so ids from two
-- providers bound to the same label can never collide. Partial: admin-typed
-- rows keep external_reference free-form (a receipt number may legitimately
-- repeat), and NULL never collides.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_gateway_reference
  ON payments(external_reference) WHERE method = 'gateway';
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_charge_payments_gateway_reference
  ON event_charge_payments(external_reference) WHERE method = 'gateway';

-- ---------------------------------------------------------------------------
-- job_runs rebuild (operational, not money; migration 0032): SQLite cannot
-- alter a CHECK, so the table is rebuilt the documented way - new table, copy,
-- drop, rename, recreate the index - with 'reconcile_payments' admitted. Rows
-- carry counts only and are copied verbatim, column by column. Nothing
-- references job_runs (actor_id is deliberately not a foreign key) and it has
-- no trigger or view.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS job_runs_new;

CREATE TABLE job_runs_new (
  id          TEXT PRIMARY KEY,
  job         TEXT NOT NULL CHECK (job IN ('billing', 'sweep_submissions', 'reconcile_payments')),
  trigger     TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  actor_id    TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  summary     TEXT,
  error       TEXT
);

INSERT INTO job_runs_new
  (id, job, trigger, status, actor_id, started_at, finished_at, duration_ms, summary, error)
SELECT id, job, trigger, status, actor_id, started_at, finished_at, duration_ms, summary, error
  FROM job_runs;

DROP TABLE job_runs;

ALTER TABLE job_runs_new RENAME TO job_runs;

CREATE INDEX IF NOT EXISTS idx_job_runs_job_started ON job_runs (job, started_at DESC);
