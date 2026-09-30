-- Migration 0028: event extras, one-off charges for events
-- Milestone 22 — Event extras: one-off charges on a separate billing rail (Task 02)
-- Derived from RFC 0015 section 1. Purely additive: it creates four tables and
-- their indexes, and issues no ALTER, DROP or UPDATE against any table that
-- existed before it. Rollback is dropping the four tables.
-- Apply locally with: make db-migrate-local

-- The price tag. Kept OUT of `events` so RFC 0014's invariant ("events has no money
-- column") survives: an event with no row here is simply not for sale. Like
-- billing_plans it is a catalogue — freely editable, never read once a charge copied it.
CREATE TABLE IF NOT EXISTS event_prices (
  event_id      TEXT NOT NULL PRIMARY KEY REFERENCES events(id) ON DELETE RESTRICT,
  amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency      TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  -- Days after issue the charge falls due, when the admin does not pick a date.
  due_in_days   INTEGER NOT NULL DEFAULT 0 CHECK (due_in_days >= 0),
  grace_days    INTEGER NOT NULL DEFAULT 5 CHECK (grace_days >= 0),
  updated_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One user's participation in one event, as money owed. The event-shaped twin of
-- `invoices`: amount, currency, due date and grace are SNAPSHOT at issue.
CREATE TABLE IF NOT EXISTS event_charges (
  id            TEXT NOT NULL PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  -- RESTRICT: a user with financial history cannot be deleted (RFC 0013 section 1).
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Snapshot of the event title at issue, so a renamed event does not rewrite a receipt.
  description   TEXT NOT NULL,
  amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency      TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  terms_source  TEXT NOT NULL DEFAULT 'standard'
                  CHECK (terms_source IN ('standard','negotiated')),
  -- Mandatory (service-enforced) when the terms are negotiated.
  terms_note    TEXT NOT NULL DEFAULT '',
  -- YYYY-MM-DD.
  due_date      TEXT NOT NULL,
  grace_days    INTEGER NOT NULL CHECK (grace_days >= 0),
  -- A cache of the balance, exactly as invoices.status. No report ever sums it.
  status        TEXT NOT NULL CHECK (status IN ('open','paid','void')),
  issued_by     TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at     TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at     TEXT,
  void_reason   TEXT
);

-- The idempotency key: one LIVE charge per buyer per event. Partial, so a voided
-- charge (issued by mistake) can be re-issued with the right terms.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_charges_one_live
  ON event_charges(event_id, user_id) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS idx_event_charges_user_status ON event_charges(user_id, status);
CREATE INDEX IF NOT EXISTS idx_event_charges_due ON event_charges(due_date) WHERE status = 'open';

-- Same shape and rules as invoice_adjustments: append-only, signed, by hand.
CREATE TABLE IF NOT EXISTS event_charge_adjustments (
  id            TEXT NOT NULL PRIMARY KEY,
  charge_id     TEXT NOT NULL REFERENCES event_charges(id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL CHECK (kind IN ('discount','credit','waiver','surcharge')),
  -- Negative reduces what is owed.
  amount_minor  INTEGER NOT NULL CHECK (amount_minor <> 0),
  reason        TEXT NOT NULL,
  applied_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  applied_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_charge_adjustments_charge
  ON event_charge_adjustments(charge_id);

-- Same shape and rules as payments: append-only, reversal by a negative mirror row.
CREATE TABLE IF NOT EXISTS event_charge_payments (
  id                 TEXT NOT NULL PRIMARY KEY,
  charge_id          TEXT NOT NULL REFERENCES event_charges(id) ON DELETE RESTRICT,
  -- Negative is a reversal.
  amount_minor       INTEGER NOT NULL CHECK (amount_minor <> 0),
  currency           TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  method             TEXT NOT NULL CHECK (method IN ('cash','pix','bank_transfer','card','gateway','other')),
  -- When the money moved, not when it was typed in.
  paid_at            TEXT NOT NULL,
  external_reference TEXT,
  note               TEXT NOT NULL DEFAULT '',
  -- Set on a reversal row, naming the payment being reversed.
  reverses_id        TEXT REFERENCES event_charge_payments(id) ON DELETE RESTRICT,
  recorded_by        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_charge_payments_charge ON event_charge_payments(charge_id);
-- At most one reversal per payment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_charge_payments_one_reversal
  ON event_charge_payments(reverses_id) WHERE reverses_id IS NOT NULL;
