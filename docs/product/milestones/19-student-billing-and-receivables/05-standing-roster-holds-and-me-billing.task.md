# Task 05 — Backend: Standing roster, holds and the student billing endpoint (Phase 3)

**Status:** 📝 Open
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-accounting-reports-and-per-student-statement.task.md)

## Summary

Puts billing standing in front of the two people who need it, and proves that doing so
gates nothing. `GET /v1/admin/billing/students?standing=` is the everyday admin screen's
data: every student with a contract, their resolved standing, outstanding balance, oldest
overdue date, next due date and a negotiated-terms flag, filterable by standing and
resolved in one query rather than per student. The holds endpoints let an admin say
"stop chasing this one" — a hold reports `exempt` and drops the student from the
delinquency list and the reminder mail, while leaving their debt in every total and in
the aging report, with an optional expiry, a reason and the admin who set it recorded so
a temporary hold cannot quietly become permanent. `GET /v1/me/billing` returns the caller
their own statement — the same shape the admin sees for them — so a student who wants to
pay never has to ask what they owe. The load-bearing part of this task is negative: no
middleware is added, `apps/api/src/routes/index.ts` is not modified, and the regression
test is that with a seeded student sitting `delinquent` the entire pre-existing API suite
passes unchanged and the content routes still answer `200`.

## Dependencies

- [Task 04](./04-accounting-reports-and-per-student-statement.task.md) — hard code
  dependency. `/v1/me/billing` returns the statement shape that task defines, and the
  roster reuses its outstanding-balance computation.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/admin-billing.controller.ts` — the roster and holds
    handlers only.
  - `apps/api/src/controllers/me-billing.controller.ts` (new).
  - `apps/api/src/routes/admin/billing.ts` — the roster and holds routes only.
  - `apps/api/src/routes/me/billing.ts` (new) and its mount line in the existing `me`
    sub-router.
  - `apps/api/src/core/billing/billing-service.ts` — the holds read/write and the roster
    resolution only.
  - `apps/api/src/adapters/db/d1-billing-repository.ts` and
    `packages/shared/ports/i-billing-repository.ts` — only the roster aggregate read, if
    the port does not already expose it.
  - `apps/api/test/**` — roster, holds, self-statement and the no-gating regression
    specs.
- **No middleware, and no new guard on any existing route.** `apps/api/src/middleware/**`
  and `apps/api/src/routes/index.ts` must come back with an empty `git diff`. This is the
  RFC's central non-goal, not a sequencing detail — there is no `402`, no read-only mode
  and no per-topic paywall anywhere in this task.
- **`getEffectiveAccessTopicIds` is untouched.** No query in this task reads or writes an
  enrollment grant, and `d1-enrollment-repository.ts` is unchanged. Grants answer what a
  student may see; billing answers what they owe; the two never meet in a query.
- **Standing is resolved, never stored.** The roster and the statement both call
  `resolveStanding` from Task 01; no standing column is added and no value is cached.
- **A hold suppresses an alert, never a permission, and never a total.** It changes the
  reported standing to `exempt` and the student's presence in the delinquency list and
  reminder mail — and nothing else. The outstanding balance still appears in the
  movement report, the aging report and the statement.
- **The roster resolves in one query,** not per student — this screen lists everyone with
  a contract.
- **`/v1/me/billing` is self-only.** It reads the authenticated caller's id from the
  token and never accepts a user id parameter; there is no path by which it returns
  another student's statement.
- **Same shapes as elsewhere.** `ControllerResult<T>`, `@ValidateBody` + `@Body()` on
  bodies, the admin routes behind the billing router's own `requireRole(ROLES.ADMIN)`.
- **Audit.** Setting and clearing a hold records the acting admin and emits its
  `billing.*` event.

## Scope

In:
- `GET /v1/admin/billing/students?standing=` — the roster with standing, outstanding,
  oldest overdue, next due and the negotiated-terms flag, filterable by standing
  including a held filter.
- `POST /v1/admin/billing/holds/{userId}` with an optional `expires_at` and a required
  reason, and `DELETE /v1/admin/billing/holds/{userId}`.
- `MeBillingController` and `GET /v1/me/billing` returning the caller's own standing,
  invoices, payments and outstanding total.
- The no-gating regression suite: with a seeded `delinquent` student, the pre-existing
  API tests and the content routes are asserted unchanged.
- The role matrix across all of the above.

Out:
- The scheduled run, the emails and the crossing-based digest — Task 06. This task
  provides the hold that suppresses them.
- Reports — Task 04.
- Any lifecycle mutation — Task 03.
- Any frontend surface — Tasks 07–08.

## Acceptance Criteria

- [ ] With a seeded student sitting `delinquent`, every pre-existing API test passes
      unchanged and `/v1/topics`, `/v1/me/progress` and the comments routes all return
      `200` for that student.
- [ ] `git diff` over `apps/api/src/middleware/`, `apps/api/src/routes/index.ts` and
      `apps/api/src/adapters/db/d1-enrollment-repository.ts` is empty.
- [ ] The roster lists that student under `standing=delinquent`, with the outstanding
      balance and oldest overdue date the statement reports for them.
- [ ] Setting a hold removes the student from the `standing=delinquent` listing and marks
      them `exempt`, while their outstanding balance is unchanged in the movement report,
      the aging report and their statement.
- [ ] An expired hold stops taking effect without anything having run — the same request
      the day after expiry reports the underlying standing again.
- [ ] A hold records its reason and the admin who set it; a request without a reason is
      refused.
- [ ] The roster resolves every student in one query — asserted by a test that fails on
      a per-student query count.
- [ ] `GET /v1/me/billing` returns only the caller's own statement; no parameter,
      header or body field makes it return another student's, and a request for a student
      with no contract returns an empty statement with standing `good` rather than `404`.
- [ ] A `content_creator` and a `tutor` each receive `403` from every
      `/v1/admin/billing/*` route; a student receives `403` from all of them while
      `GET /v1/me/billing` returns their own statement.
- [ ] Setting and clearing a hold each emit their `billing.*` audit event with the acting
      admin.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` and drive a student into `delinquent` through the Task 03
   endpoints (issue an invoice, backdate its due date past its grace days).
2. `make dev-api`, then call `/v1/topics`, `/v1/me/progress` and a comments route as that
   student and confirm `200` on each — the negative assertion, checked by hand as well as
   by test.
3. Call the roster with and without `standing=delinquent`; set a hold and confirm the
   student leaves the list while the aging report total is unchanged.
4. Call `GET /v1/me/billing` as that student, then attempt to reach another student's
   statement through it and confirm there is no such path.
5. `make test-api` — the full suite, including every pre-existing spec, green.
6. `make lint`.
7. `git diff --stat` and confirm the three fenced-out paths are absent from the list.
