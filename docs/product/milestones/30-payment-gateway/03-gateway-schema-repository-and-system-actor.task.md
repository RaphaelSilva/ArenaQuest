# Task 03 — Backend: Gateway schema, repository and system actor (Phase 1)

**Status:** ✅ Done
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-payment-contracts.task.md)

## Summary

Adds the persistence of RFC §2 in **one additive migration** — `gateway_checkouts`,
`gateway_events`, the two partial unique indexes on `external_reference WHERE method = 'gateway'`
(one per rail), the rebuilt `job_runs` whose `job` CHECK admits `reconcile_payments`, and the
**system actor** `system:payment-gateway` — together with `D1GatewayRepository`, the
`findGatewayPayment` lookups on both billing repositories, and the guards that keep the system
actor out of every human surface: it cannot log in, is not listed among users, is ignored by the
admin lockout guards and by the production deploy guard. After this task the database can hold a
checkout and an event idempotently; nothing writes to them yet.

## Dependencies

- [Task 01](./01-payment-contracts.task.md) — hard code dependency: `IGatewayRepository`, the
  entities, `UserStatus.SYSTEM`, `JobName.RECONCILE_PAYMENTS`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/00NN_create_payment_gateway.sql` (new) — `NN` is the next free number
    when this task opens (`0033` today; M29 plans `0033` and `0034`, so re-check `origin/main`).
  - `apps/api/src/adapters/db/d1-gateway-repository.ts` (new).
  - `apps/api/src/adapters/db/d1-billing-repository.ts`, `d1-event-charge-repository.ts` —
    `findGatewayPayment` only.
  - `apps/api/src/adapters/db/d1-user-repository.ts`, `apps/api/src/controllers/admin-users.controller.ts`,
    `apps/api/src/controllers/auth.controller.ts` — the system-actor guards.
  - `apps/api/scripts/check-no-dev-seed.ts` — ignores the system actor.
  - `apps/api/src/container.ts` — `payments.gatewayRepo`.
  - `apps/api/test/db/**`, `apps/api/test/routes/{admin-users,auth}.router.spec.ts`,
    `apps/api/test/core/check-no-dev-seed.spec.ts`.
  - `scripts/demo/**` and `apps/api/scripts/sqls/**` — only if a seed or the demo CI check counts
    users and must account for the new row.
- **Additive, one file.** No existing column changes meaning. The `job_runs` rebuild follows
  SQLite's twelve-step table rebuild and copies every row verbatim (they carry counts only).
- **Schema as RFC §2 states it** — columns, CHECKs (provider names, receivable kind, status,
  amount `> 0`, not both payment ids, the payment id matching the kind), FKs with `RESTRICT`, and
  the five `gateway_checkouts` indexes including the one-open-per-receivable partial unique index;
  `gateway_events` keyed `(provider, event_id)` with `outcome`, `attempts` and an `error` capped
  at 1,024 characters that never holds a body.
- **Dismissal columns (milestone §6, decision 20).** Both tables carry nullable `dismissed_at`,
  `dismissed_by` (FK to users) and `dismiss_note`; a dismissal changes neither `status` nor
  `outcome`.
- **System actor.** Inserted with `INSERT OR IGNORE`, id `system:payment-gateway`, e-mail on
  `system.invalid`, an empty password hash, status `system`, **no role row**.
- **Idempotency lives in SQL.** `recordEvent` is one `INSERT … ON CONFLICT DO NOTHING` that
  reports whether it inserted and otherwise returns the stored outcome; `markEvent` and
  `closeCheckout` are conditional writes decided by the changed-row count; every timestamp
  comparison wraps both sides in `datetime()`.
- **Ports & Adapters.** No D1 type leaves the adapter.

## Scope

**In:**
- The migration and `D1GatewayRepository` implementing all eleven port methods, including the
  ordering rules the reconcile run relies on (`listCheckoutsToConfirm`: past expiry or closed
  first, then least recently asked, never-asked first; `listUnsettledEvents`: `failed` or
  `received`, 15 minutes to 72 hours old, fewest attempts first) and `listExceptions` (`orphan`,
  `mismatch`, `failed`, `received` older than an hour, checkouts in `mismatch` or under dispute —
  oldest first, dismissed rows excluded).
- `findGatewayPayment(externalReference)` on both rails.
- Guards: login refuses a `system` user like an unknown account; the admin user list and its
  count exclude it; no route can edit, deactivate or delete it; the last-admin lockout guards do
  not count it; `check-no-dev-seed.ts` does not flag it.
- Tests: migration applies on a fresh and on a seeded local D1; `job_runs` rows survive the
  rebuild; a second open checkout for the same receivable fails; a second insert with the same
  gateway reference fails **on each rail** while admin-typed duplicates and `NULL` still pass; the
  CHECKs refuse a cross-rail `*_payment_id`; `recordEvent` under two concurrent calls leaves one
  row; the system-actor guards above.

**Out:**
- Any service logic, landing or route (Tasks 04 and 06–09).
- The `reconcile_payments` job itself (Task 09) — only its name is admitted here.

## Acceptance Criteria

- [x] `make db-migrate-local` applies cleanly on a fresh replica and on one already holding
      billing data and `job_runs` rows; the row counts of `job_runs` are unchanged.
- [x] Two inserts with the same `<provider>:<id>` reference and `method = 'gateway'` fail on
      `payments` and on `event_charge_payments`; the same reference with another method passes.
- [x] The system actor cannot log in, is absent from `GET /v1/admin/users`, and deleting or
      deactivating the last human admin is still refused with it present.
- [x] The production deploy guard passes on a database that holds the system actor.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `git fetch origin && git ls-tree --name-only origin/main apps/api/migrations/ | tail -3` — pick the number.
2. `make db-reset-local` — migrate and seed from scratch; then `make db-migrate-local` again is a no-op.
3. `cd apps/api && pnpm test test/db` — repository, constraint and `job_runs` suites pass.
4. `make test-api` — green.
5. `node scripts/demo/ci-check.mjs` — the demo seed check still passes with the new row.
6. `git diff --stat` confirms only scope-guardrail files changed.
