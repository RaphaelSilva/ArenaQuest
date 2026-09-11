# Task 02 — Backend: Billing schema, D1 repository and local seed (Phase 1)

**Status:** 📝 Open
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-billing-domain-entities-and-repository-port.task.md)

## Summary

Lands the billing tables and the D1 implementation of the port Task 01 declared. One
additive migration, `0026_create_billing_tables.sql`, creates `currencies`,
`billing_plans`, `subscriptions`, `invoices`, `invoice_adjustments`, `payments` and
`billing_standing_holds`, and alters no existing table — so it ships behind no consumer
and carries no risk to anything already running. The schema is where most of this
milestone's invariants actually live, and they are enforced by the database rather than
by convention: an unknown currency code is refused by a foreign key, a second active
currency by a partial unique index, a duplicate period invoice by
`UNIQUE (subscription_id, period_start)` — which is what makes the invoice run
idempotent — a second active contract per student and a forked amendment chain each by
their own partial index, and the deletion of a student who holds any financial row by
`ON DELETE RESTRICT`. `D1BillingRepository` implements every method of
`IBillingRepository` over those tables, computing an invoice's balance from the signed
adjustment and payment rows rather than trusting the cached `invoices.status`. A local
seed extension adds one paid plan, one free plan and a student subscribed to each, so
every later task and every reviewer has a working ledger on `make db-reset-local`.

## Dependencies

- [Task 01](./01-billing-domain-entities-and-repository-port.task.md) — hard code
  dependency. This task implements `IBillingRepository` and returns the
  `Entities.Billing` records it defines; the column set mirrors those shapes.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/0026_create_billing_tables.sql` (new) — one additive,
    sequential migration. It creates tables and indexes and seeds `currencies` only; it
    issues no `ALTER` against any pre-existing table, so the rollback is dropping the new
    tables and nothing else is affected.
  - `apps/api/migrations/seed/**` — the local-only seed extension.
  - `apps/api/src/adapters/db/d1-billing-repository.ts` (new).
  - `apps/api/test/**` — migration-constraint and repository specs.
- **Ports & Adapters.** Only this adapter knows D1. It implements
  `IBillingRepository` exactly; no method is added to the port here, and no D1 symbol
  escapes the file.
- **Migration safety.** Additive and non-breaking. Every statement is `IF NOT EXISTS`
  so applying `0026` twice is a no-op. `billing_plans.scope_topic_id` is created
  nullable and read by no code in v1 (per-topic pricing is a milestone Non-Goal).
- **Money is integer minor units** in every column, each with a foreign key to
  `currencies(code)`. No column stores a decimal or a float.
- **Append-only ledger.** The adapter exposes no update or delete path for `payments`
  or `invoice_adjustments`; a correction is a new signed row. The only mutations it
  performs on an invoice are the `status` cache flip and the void fields.
- **Snapshot, never join for terms.** Reads of a contract's or an invoice's terms come
  from that row's own snapshotted columns; the adapter never resolves `amount_minor`,
  `currency`, `cycle` or `grace_days` by joining back to `billing_plans`.
- **Balance is recomputed, never read from a cache.** `invoices.status` is treated as a
  cache of "balance reached zero"; the balance itself is
  charge plus signed adjustments minus payments, from the rows.
- **The seed is local-only.** It lands under `apps/api/migrations/seed/`, guarded off
  every deployed path by the existing `apps/api/scripts/check-no-dev-seed.ts`.
- **Cloud-agnostic elsewhere.** No provider SDK call outside `apps/api/src/adapters/`.

## Scope

In:
- Migration `0026` creating the seven tables with the constraints RFC 0013 §1 specifies:
  the currency foreign keys, `idx_currencies_one_active`,
  `UNIQUE (subscription_id, period_start)` on invoices, `idx_subscriptions_one_active`,
  `idx_subscriptions_one_successor`, `idx_subscriptions_group`,
  `idx_invoices_user_status`, the partial `idx_invoices_due`, `ON DELETE RESTRICT` on
  every billing→`users` foreign key, and `CASCADE` on `billing_standing_holds` only.
- Seeding `currencies` with BRL active and USD, EUR, JPY and BTC inactive — JPY and BTC
  deliberately, so the non-2-exponent path is exercised without anyone inserting a
  currency first.
- `D1BillingRepository` implementing the whole port: plan CRUD, subscription create,
  lifecycle update and amendment, `listOpenInvoices`, `issueInvoices`, `recordPayment`,
  `applyAdjustment`, `listLedger` and the holds read/write.
- Invoice balance resolution from the signed rows, and the `status` cache flip to `paid`
  when it reaches zero.
- The local seed extension: one paid plan, one free plan, and a student subscribed to
  each.
- Tests under the Workers pool covering each constraint above by asserting the
  database rejects the violation, plus the adapter's read/write round trips.

Out:
- Any service, controller, route, container wiring or audit event — Task 03.
- Reports and statements — Task 04.
- The roster, holds endpoints and `/v1/me/billing` — Task 05.
- The scheduled run — Task 06. `issueInvoices` exists here as a repository method; the
  job that calls it on a schedule does not.
- Any frontend change.

## Acceptance Criteria

- [ ] `make db-migrate-local` applies `0026` to a fresh local D1 cleanly, and applying
      it a second time is a no-op.
- [ ] `git diff` on the migration shows only `CREATE` and the `currencies` seed — no
      `ALTER` against any table that existed before `0026`.
- [ ] Inserting the same `(subscription_id, period_start)` twice raises a constraint
      error.
- [ ] A second `active` subscription for one user is rejected by
      `idx_subscriptions_one_active`; a second successor for one version is rejected by
      `idx_subscriptions_one_successor`.
- [ ] Inserting a plan with an unknown currency code is rejected by the foreign key, and
      a second `active` currency by `idx_currencies_one_active`.
- [ ] `DELETE FROM users` for a student holding any invoice is rejected by
      `ON DELETE RESTRICT`, while updating that same row to an anonymised name and email
      succeeds with every billing row intact and still joined by `user_id`.
- [ ] Two amendments through the adapter leave a chain of three subscription rows
      sharing one `contract_group_id` with exactly one `active`.
- [ ] Editing a plan's `amount_minor` and `grace_days` afterwards leaves every existing
      subscription and invoice row byte-identical.
- [ ] The adapter computes an invoice's balance as charge plus signed adjustments minus
      payments, and a test proves a reversal moves it back above zero.
- [ ] `make db-reset-local` leaves a paid plan, a free plan and a student subscribed to
      each; `apps/api/scripts/check-no-dev-seed.ts` still refuses the seed on a deployed
      target.
- [ ] No D1 symbol appears outside `d1-billing-repository.ts`; no port method was added
      in this task.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail — in particular
      `apps/api/src/adapters/db/d1-enrollment-repository.ts` is unchanged.

## Verification Plan

1. `make db-reset-local` — the replica rebuilds, `0026` applies, the seed lands.
2. Re-run `make db-migrate-local` and confirm the second application reports nothing to
   do.
3. `make test-api` — the constraint specs pass, each asserting a rejection rather than a
   success.
4. Inspect the schema of the new tables in the local replica and confirm every money
   column is `INTEGER` with a `currencies(code)` foreign key.
5. `make lint`.
6. `git diff --stat` confirms only the guardrail files changed, and no file under
   `apps/api/src/middleware/`, `apps/api/src/routes/index.ts` or
   `d1-enrollment-repository.ts` appears.
