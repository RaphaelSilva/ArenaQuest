# Task 05 — Backend: Per-rail reports, statement and `/v1/me/billing` (Phase 3)

**Status:** 📝 Open
**Milestone:** [22 — Event extras: one-off charges on a separate billing rail](./milestone.md)
**RFC:** [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-two-rail-standing-and-roster.task.md)

## Summary

Brings extras into the accounting views without ever folding them into the contract numbers
(RFC 0015 §7). `AccountingService` reads receivables tagged by rail and **partitions by rail
before any arithmetic**. The movement report keeps every existing field with its current,
contracts-only meaning and gains a sibling `extras` block (charged, adjustments, received,
charges issued, receivable at close) plus one explicitly named cross-rail figure,
`cashReceivedMinor` — the money that entered the till across both rails — named so nobody
reads it as a standing or a receivable. The aging report accepts `?rail=contract|extras`,
defaulting to `contract` so the existing screen means exactly what it meant; the two are never
bucketed together. The admin per-student statement and the student's own `GET /v1/me/billing`
keep `standing` and `outstandingMinor` as **contract-only** and gain a sibling
`extras: { standing, outstandingMinor, charges[] }`, where each charge carries its event title,
event date, due date, amount, balance and ledger. A member with no contract and no charge
still gets an empty statement with standing `good`, not a 404. Tasks 08 and 09 render these
shapes.

## Dependencies

- [Task 04](./04-two-rail-standing-and-roster.task.md) — hard code dependency: the statement
  and `/v1/me/billing` reuse its per-rail standing readers.
- [Task 02](./02-event-charge-schema-d1-repository-and-seed.task.md) — transitively, for the
  charge ledger reads.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/billing/accounting-service.ts` — rail-partitioned movement, aging and
    statement.
  - `apps/api/src/controllers/{admin-billing.controller.ts,me-billing.controller.ts}` and
    `apps/api/src/routes/{admin/billing.ts,me/billing.ts}` — response schemas and the
    `rail` query parameter only.
  - `apps/api/src/index.ts` — only if `AccountingService` needs the charge adapter injected.
  - `apps/api/test/**` — report and statement tests.
- **Accounting rules carry over** (the five rules at the top of `accounting-service.ts`):
  recompute from ledger rows, never sum the cached status; billed keyed on issue/applied
  dates, received on `paid_at`; one currency asserted, never converted; minor units end to end.
- **No merged figure** other than `cashReceivedMinor`.
- **`/v1/me/billing` stays subject-bound.** It takes no parameters; the subject is the token's
  `sub`, and it never returns another user's charge.

## Scope

In:
- Movement: unchanged contract fields, new `extras` block, `cashReceivedMinor`.
- Aging: `rail` parameter, default `contract`, extras buckets computed from charges only.
- Statement (admin) and `/v1/me/billing`: contract fields unchanged in meaning; new `extras`
  object with the charge list and its ledger entries.
- Tests for each report and both statements.

Out:
- The roster — Task 04. Reminders and digest — Task 06. Any UI — Tasks 08 and 09.

## Acceptance Criteria

- [ ] For a month with 30000 fees and 15000 extras received, movement returns
      `receivedMinor = 30000`, `extras.receivedMinor = 15000`, `cashReceivedMinor = 45000`.
- [ ] Every pre-existing movement field returns the same value as before this task when the
      charge tables hold data (contracts-only meaning preserved).
- [ ] `aging` with no parameter equals `?rail=contract` and equals the pre-task output;
      `?rail=extras` buckets only charges.
- [ ] A voided charge contributes to no report total and no bucket.
- [ ] `/v1/me/billing` for a student with a paid-up contract and one overdue charge returns
      contract `standing = good` and `extras.standing = delinquent`, with the charge's event title.
- [ ] `/v1/me/billing` never returns a charge belonging to another user (test with two users).
- [ ] A report spanning two currencies returns `409`, as today.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — report and statement specs pass, including the pre-existing RFC 0013
   report tests unchanged in expectation.
2. `make dev-api` with the local seed — call movement for the seed month, aging for both rails,
   the admin statement of the extras-only buyer, and `/v1/me/billing` as that buyer.
3. `git diff --stat` confirms only scope-guardrail files changed.
