# Task 04 — Backend: Two-rail standing and roster (Phase 3)

**Status:** 📝 Open
**Milestone:** [22 — Event extras: one-off charges on a separate billing rail](./milestone.md)
**RFC:** [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-event-charge-schema-d1-repository-and-seed.task.md)

## Summary

Puts the **two rails** on the screen the administrator reads before a manual access decision
(RFC 0015 §4, Resolved #5). Contract standing stays exactly RFC 0013's — computed from contract
invoices only — and gains **no** input from charges. A new extras standing is computed from
event charges only, through `resolveRailStanding('extras', …)`, with the same four labels. The
roster (`GET /v1/admin/billing/students`) now lists every user with a contract **or** any
charge, so a buyer of extras with no contract appears; each entry carries a `contract` block
(its contract fields plus contract standing, oldest overdue date and outstanding amount, or
`null`) and an `extras` block (extras standing, oldest overdue date, outstanding amount, open
and overdue charge counts, or `null`), and **no top-level standing or total**, so nothing can
read one number as both. Two independent filters, `contractStanding` and `extrasStanding`,
replace the single one; the legacy `standing` filter is kept as an alias of `contractStanding`
so its meaning does not silently change. A hold keeps its RFC 0013 meaning and affects the
contract rail only (Resolved #9). The roster still performs a constant number of aggregate
reads — four instead of three — regardless of how many students exist. This reshapes an API
contract whose only consumer is the admin console, so it must reach `main` together with
Task 08.

## Dependencies

- [Task 02](./02-event-charge-schema-d1-repository-and-seed.task.md) — hard code dependency:
  the extras rail reads charges through the adapter.
- [Task 01](./01-event-charge-domain-port-and-receivable.task.md) — transitively, for
  `resolveRailStanding`.
- **Release coupling:** ships in the same candidate merge as
  [Task 08](./08-two-rail-roster-reports-and-statement.task.md).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/billing/billing-service.ts` — `listStudentRoster`, `RosterEntry`,
    `RosterFilter`; `getStanding` is only refactored to go through `resolveRailStanding`
    with the contract rail, with identical output.
  - `apps/api/src/core/billing/event-charge-service.ts` — add the extras-standing reader.
  - `apps/api/src/controllers/admin-billing.controller.ts` and
    `apps/api/src/routes/admin/billing.ts` — the roster response schema and its filters only.
  - `apps/api/src/index.ts` — only if the roster needs the charge adapter injected.
  - `apps/api/test/**` — standing, roster and query-count tests.
- **No merged standing.** No code path in this task concatenates invoices and charges before
  resolving a standing; `resolveRailStanding`'s mixed-input throw is the backstop.
- **Holds are contract-only.** The hold is passed to the contract rail's resolution and never
  to the extras rail's.
- **Query budget.** Invoices, charges, contracts and holds are each fetched once and joined in
  memory; calling a per-student standing in a loop is the regression the query-count test
  exists to catch.

## Scope

In:
- Contract standing unchanged in value; extras standing added.
- Roster over the union of **user ids** (never of receivables), with the two blocks per entry.
- `contractStanding` / `extrasStanding` filters and the `standing` alias.
- Default sort: contract outstanding, then extras outstanding, then user id.
- Tests for rail isolation, the extras-only buyer, the hold scope, the legacy filter and the
  four-query budget.

Out:
- Reports, statement and `/v1/me/billing` — Task 05.
- Reminders and digest — Task 06.
- The roster UI — Task 08.

## Acceptance Criteria

- [ ] Contract paid-up + one overdue charge ⇒ `contract.standing = good`,
      `extras.standing = delinquent`.
- [ ] Late invoice + every charge paid ⇒ `contract.standing = delinquent`,
      `extras.standing = good`.
- [ ] A user with no contract and one overdue charge appears with `contract: null` and
      `extras.standing = delinquent`.
- [ ] With charges seeded, `?contractStanding=delinquent` and the legacy `?standing=delinquent`
      return exactly the users they return with the charge tables empty.
- [ ] A hold turns `contract.standing` to `exempt` and leaves `extras.standing` unchanged.
- [ ] `getStanding` returns identical output to before this task for every existing test input.
- [ ] The roster query-count test asserts 4 queries for 1 and for N students.
- [ ] The roster response has no top-level `standing` or `outstandingMinor`.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — standing, roster and query-count specs pass, including every pre-existing
   RFC 0013 roster test adapted only for the reshaped entry.
2. `make dev-api` with the local seed — call the roster with each filter combination and
   confirm the extras-only buyer and the two isolation scenarios.
3. `git diff --stat` confirms only scope-guardrail files changed.
