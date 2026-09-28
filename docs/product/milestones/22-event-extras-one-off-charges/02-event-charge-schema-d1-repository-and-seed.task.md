# Task 02 — Backend: Event-charge schema, D1 repository and local seed (Phase 1)

**Status:** ✅ Done
**Milestone:** [22 — Event extras: one-off charges on a separate billing rail](./milestone.md)
**RFC:** [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-event-charge-domain-port-and-receivable.task.md)

## Summary

Makes the extras ledger real. A new, purely additive migration creates four tables exactly
as RFC 0015 §1 specifies — `event_prices` (the optional price tag, keyed by event, kept out of
`events` so it stays money-free), `event_charges` (one user's participation in one event, with
amount, currency, due date and grace **snapshot** at issue, a `terms_source` / `terms_note`
pair, and a cached `status`), `event_charge_adjustments` and `event_charge_payments` (the same
append-only, signed, reversal-by-mirror-row rules as RFC 0013's ledger) — plus their indexes,
most importantly the **partial unique index of one live charge per `(event_id, user_id)`**,
which is the idempotency key and deliberately lets a voided charge be re-issued. Every
foreign key to `users` and `events` is `RESTRICT`. `D1EventChargeRepository` implements
Task 01's port: balances computed in SQL, the cached status refreshed **in the same batch**
as each ledger write (the pattern `D1BillingRepository` already uses), and bulk issue as an
insert-or-ignore batch that returns what it created and which pairs it absorbed. A local seed
gives the developer a priced, published event, one paid charge, one overdue charge, and one
**extras-only** buyer with no contract. Task 03 builds the service on this adapter.

## Dependencies

- [Task 01](./01-event-charge-domain-port-and-receivable.task.md) — hard code dependency: the
  adapter implements the port and returns the records defined there.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/0028_create_event_charges.sql` (new) — **renumbered to the next free
    number** if RFC 0016's `0028_create_topic_notes.sql` is already on `main` when this task
    starts. Additive: four `CREATE TABLE`, their indexes, no `ALTER`/`DROP`/`UPDATE` of any
    existing table, no backfill. Rollback: drop the four tables.
  - `apps/api/src/adapters/db/d1-event-charge-repository.ts` (new).
  - `apps/api/src/index.ts` — **only** to instantiate the adapter per request inside
    `buildApp(env)`, next to `D1BillingRepository`.
  - `apps/api/migrations/seed/` — one new local-only seed file, wired into the existing
    `db-seed-local` flow without touching other seed files' content.
  - `apps/api/test/**` — adapter tests.
- **Ports & Adapters.** Only this adapter knows D1; no D1 symbol reaches the port or a service.
- **Never in module scope.** The adapter is created per request (Workers share no memory).
- **Money safety.** Integer minor units only; currency validated by the `currencies` foreign
  key, not by a hardcoded list.
- **Status is a cache.** It is written only by the in-batch refresh; no caller sets it
  directly except voiding, and a void is never resurrected by a later ledger row.
- **No-dev-seed guard.** The seed must remain local-only and pass
  `apps/api/scripts/check-no-dev-seed.ts`.

## Scope

In:
- The migration with the four tables and the indexes named in RFC 0015 §1.
- `D1EventChargeRepository`: price get/set/clear; charge list (filters by event, user,
  status) and get, both with balance; idempotent bulk issue; void; record payment and apply
  adjustment, each with the in-batch status refresh; get payment; list ledger.
- Container wiring in `buildApp(env)`.
- The local seed described above.
- Adapter tests.

Out:
- Business rules (published-only events, negotiated-amount note, void-with-payments guard,
  audience check) — Task 03.
- Any route, standing, roster, report or run change — Tasks 03–06.
- Any frontend change.

## Acceptance Criteria

- [x] The migration applies cleanly to a fresh local D1 after `0027`, and contains no
      statement against a pre-existing table.
- [x] Issuing the same `(event, users)` twice creates each charge once; the second call
      reports every pair as absorbed and the row count is unchanged.
- [x] After a voided charge, issuing again for the same `(event, user)` creates a new live charge.
- [x] A payment equal to the balance leaves the charge `paid` in the same batch; a negative
      reversal row brings it back to `open`; a second reversal of the same payment is rejected
      by the unique index.
- [x] A ledger write on a `void` charge does not change its status.
- [x] Balances returned by list/get equal amount + Σ adjustments − Σ payments.
- [x] Deleting a user or an event referenced by a charge fails (`RESTRICT`).
- [x] `make db-reset-local` succeeds and the seed produces the four scenarios listed in the
      Summary; the no-dev-seed guard still passes.
- [x] No D1 import leaks into a port or service.
- [x] Changed files lint clean; `make test-api` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`; inspect the schema for the four tables, the partial unique index and
   the `RESTRICT` foreign keys.
2. `make test-api` — the adapter spec passes, including the idempotency, reversal and
   void-is-final cases.
3. Query the seeded rows locally and confirm the paid, overdue and extras-only scenarios.
4. `git diff --stat` confirms only scope-guardrail files changed.
