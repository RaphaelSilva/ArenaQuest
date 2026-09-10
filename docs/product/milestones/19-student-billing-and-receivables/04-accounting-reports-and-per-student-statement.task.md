# Task 04 — Backend: Accounting reports and per-student statement (Phase 2)

**Status:** 📝 Open
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md)

## Summary

Delivers the three views the spreadsheet was providing, as `AccountingService` behind
three admin endpoints. Monthly movement answers "how much was billed, received and is
still outstanding in August" by recomputing from the ledger rows in that month —
adjustments included — rather than reading any cached total. Receivables aging buckets
every open balance into 0–30 / 31–60 / 61–90 / 90+ by days past its own due date. The
per-student statement reconciles one student's contracts, invoices, adjustments and
payments row for row, and carries the two membership dates the RFC settled as derived
rather than stored: "student since" is the earliest contract start across every contract
group, and "current membership since" is the active group's root — so a student of ten
years who took a break still reads as a student of ten years. The reporting rules that
are easy to get wrong are the deliverable here: an amended student counts once, by
grouping on `contract_group_id` rather than counting contract rows; a report states one
currency and refuses to sum across two rather than silently converting; and every total
is recomputed from `payments` and `invoice_adjustments`, so a drifted `invoices.status`
cache can never make a report lie.

## Dependencies

- [Task 03](./03-billing-service-and-the-admin-lifecycle-api.task.md) — hard code
  dependency. The reports read the ledger that task's lifecycle writes, and mount on the
  admin billing router it creates, inside the container group it registers.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/billing/accounting-service.ts` (new).
  - `apps/api/src/controllers/admin-billing.controller.ts` — the three report handlers
    only.
  - `apps/api/src/routes/admin/billing.ts` — the three report routes only.
  - `apps/api/src/adapters/db/d1-billing-repository.ts` and
    `packages/shared/ports/i-billing-repository.ts` — only if a report needs an
    aggregate read the port does not already expose; any addition keeps the port free of
    Cloudflare types.
  - `apps/api/test/**` — accounting specs.
- **Read-only.** Nothing in this task writes a row. No report issues, adjusts, pays or
  voids anything, and none of them repairs a drifted cache — divergence is Task 06's
  assertion to log, not this task's to fix.
- **Recompute, never trust the cache.** Totals derive from `payments` and
  `invoice_adjustments`; `invoices.status` is not summed and not used as a filter that
  could hide a row from a total.
- **Group on `contract_group_id`.** Active-student counts and membership dates group on
  the contract chain, never on subscription rows — counting rows double-counts every
  renegotiated student.
- **Single currency, asserted not converted.** A report states the tenant's currency and
  refuses to produce a total that would span two, rather than applying any rate.
- **Money in minor units end to end.** The API returns integers plus the currency's
  exponent and symbol; no server-side formatting and no floating point.
- **Same guard, same shape.** These routes sit behind the router's own
  `requireRole(ROLES.ADMIN)`, return `ControllerResult<T>`, and validate their query
  parameters — a malformed `month` is a `400`, not an empty report.
- **`apps/api/src/routes/index.ts`, `middleware/**` and `d1-enrollment-repository.ts`
  stay unchanged.**

## Scope

In:
- `AccountingService` with the three report computations.
- `GET /v1/admin/billing/reports/movement?month=YYYY-MM` — billed, received and
  outstanding for the month, adjustments included, reconciling to the sum of that month's
  ledger rows.
- `GET /v1/admin/billing/reports/aging` — open balances in 0–30 / 31–60 / 61–90 / 90+
  buckets by days past each invoice's own due date.
- `GET /v1/admin/billing/students/{userId}/statement` — the student's contracts (with
  their chain), invoices, adjustments and payments, the outstanding total, and both
  derived membership dates.
- The active-students count grouped on `contract_group_id`.
- Query validation for `month` and any range parameter.
- Tests covering the reconciliation, the amended-student count, the returning-student
  membership dates, the aging boundaries, and the refusal to sum two currencies.

Out:
- The roster and the standing filter — Task 05, which reports standing rather than
  money.
- Holds and `/v1/me/billing` — Task 05, though the student's statement shape defined
  here is what that endpoint returns for the caller.
- The scheduled balance-vs-status assertion — Task 06.
- Any lifecycle mutation — Task 03 owns all of them.
- Any frontend change — Task 07 renders these.

## Acceptance Criteria

- [ ] `GET /reports/movement?month=…` reconciles to the sum of the ledger rows in that
      month, adjustments included, asserted against a fixture with a discount and a
      reversal in the same month.
- [ ] A payment recorded in September against an invoice issued in August appears in
      September's *received* and August's *billed* — the two are not conflated.
- [ ] An amended student counts **once** in the active-students report; a fixture with a
      three-version contract chain proves it.
- [ ] A student with a cancelled contract and a later new one reports "student since" as
      the earlier date and "current membership since" as the later one.
- [ ] The aging buckets are exclusive at their boundaries: an invoice exactly 30 days
      past due and one exactly 31 days past due land in different buckets, each measured
      from its own `due_date`.
- [ ] A voided invoice contributes to no bucket and to no outstanding total.
- [ ] The statement's outstanding total equals the sum of its listed invoice balances,
      each computed from the signed rows.
- [ ] An invoice whose cached `status` disagrees with its recomputed balance does not
      change any reported total — the report is computed from the rows.
- [ ] A request that would sum across two currencies is refused rather than converted.
- [ ] A malformed `month` returns `400`; a statement for an unknown user returns `404`.
- [ ] A `content_creator`, a `tutor` and a student each receive `403` from all three
      routes.
- [ ] No report path writes a row — asserted by a test that snapshots the tables before
      and after a full report sweep.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, then seed a month of activity through the Task 03 endpoints:
   two contracts, one amendment, a discount, a payment, a reversal and a void.
2. `make dev-api` and call the three reports; reconcile the movement figures by hand
   against the ledger listing from `GET /invoices`.
3. Query the aging report with invoices placed at 30, 31, 60, 61, 90 and 91 days past due
   and confirm each lands in the intended bucket.
4. Read the statement for the amended student and for a returning student and confirm
   both membership dates.
5. `make test-api` — accounting specs pass and the pre-existing suite is unchanged.
6. `make lint`.
7. `git diff --stat` confirms only the guardrail files changed.
