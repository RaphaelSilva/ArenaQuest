# Task 03 — Backend: Billing service and the admin lifecycle API (Phase 2)

**Status:** 📝 Open
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-billing-schema-d1-repository-and-local-seed.task.md)

## Summary

Makes the whole billing lifecycle operable over the API. `BillingService` owns the rules
the schema cannot state: signing a contract snapshots the plan's terms onto the
subscription, a negotiated contract carries different terms with `terms_source` and a
mandatory reason, amending closes the live version to `superseded` and opens a new
`active` one in the same contract group, a lifecycle change is only pause, resume or
cancel, an ad-hoc invoice snapshots the contract's terms again at issue, a void demands
a reason, an adjustment and a payment are appended rather than applied in place, and a
reversal is itself an appended row. `AdminBillingController` exposes each of those as a
`ControllerResult<T>` with explicit validation, not-found and conflict branches;
`routes/admin/billing.ts` handles only HTTP and carries **its own**
`requireRole(ROLES.ADMIN)` — the blanket `/v1/admin/*` guard admits `content_creator`,
and mounting billing under it unguarded would hand the dojo's finances to every content
creator. `container.ts` gains one `billing` bounded-context group, instantiated
per request inside `buildApp(env)` like every other adapter. Every mutation records the
acting admin on the row and emits the structured `billing.*` `console.info` event this
codebase already uses in `EnrollmentService`. After this task an admin can run the
entire billing lifecycle over the API, before any report or any screen exists.

## Dependencies

- [Task 02](./02-billing-schema-d1-repository-and-local-seed.task.md) — hard code
  dependency. The service calls `IBillingRepository` through the D1 adapter that task
  lands, and the amendment and idempotency rules rest on its indexes.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/billing/billing-service.ts` (new).
  - `apps/api/src/controllers/admin-billing.controller.ts` (new).
  - `apps/api/src/routes/admin/billing.ts` (new) and its mount line in
    `apps/api/src/routes/admin/index.ts`.
  - `apps/api/src/container.ts` — a new `billing: BillingContext` group only; no
    existing group changes shape.
  - `apps/api/test/**` — service, controller and route specs.
- **`apps/api/src/routes/index.ts` is not modified.** Billing mounts inside the admin
  sub-router, not at the top level. This file appearing in the diff is a review failure.
- **The billing sub-router carries its own `requireRole(ROLES.ADMIN)`**, following the
  precedent at `routes/admin/users.ts:279`, `levels.ts:82` and `progression.ts:158`. No
  role but `admin` reads any of it — the tutor role is given nothing here.
- **Routes vs controllers.** All business logic lives in the controller and returns
  `ControllerResult<T>`; the router parses, guards and shapes only. Bodies validate
  through `@ValidateBody(schema)` + `@Body()`.
- **Per-request adapters.** The `billing` group is built inside `buildApp(env)`; no
  adapter instance reaches module scope (Workers share no memory between requests).
- **Snapshot at signature and at issue.** The service copies `amount_minor`, `currency`,
  `cycle` and `grace_days` from the plan onto the subscription, and from the subscription
  onto each invoice. Editing a plan afterwards must leave both untouched.
- **Append-only corrections.** No path updates or deletes a `payments` or
  `invoice_adjustments` row. Voiding an invoice sets its void fields; changing what a
  student owes is an adjustment; undoing a payment is a reversal row.
- **No automatic money.** The service accrues nothing: no interest, no percentage late
  fee, no cap, no daily incidence. `surcharge` is only ever written from an explicit
  admin request (RFC #8).
- **No gateway anything** (RFC #9) — no port, adapter, webhook, card field or charge
  call. `method = 'gateway'` is an accepted input value and nothing more.
- **No access effect.** Nothing in this task reads or writes an enrollment grant, and no
  existing route gains a guard.
- **Audit.** Every mutation records the acting admin (`signed_by`, `recorded_by`,
  `created_by`) and emits a structured `billing.*` event.

## Scope

In:
- `BillingService`: plan create, list and edit; contract signature, standard and
  negotiated; lifecycle change limited to pause, resume and cancel; amendment by
  superseding; ad-hoc invoice issue; void with a mandatory reason; adjustment
  application; payment recording; payment reversal.
- `AdminBillingController` wrapping each with validation and explicit error branches —
  a plan referencing an unknown currency, a second active contract for one student, an
  amendment of a non-active version, a void without a reason, a payment against a void
  invoice, a reversal of an already-reversed payment.
- The `/v1/admin/billing` router covering `GET/POST /plans`, `PATCH /plans/{id}`,
  `GET/POST /subscriptions`, `PATCH /subscriptions/{id}`,
  `POST /subscriptions/{id}/amend`, `GET /invoices` with its `status`, `from`, `to` and
  `userId` filters, `POST /invoices`, `POST /invoices/{id}/void`,
  `POST /invoices/{id}/adjustments`, `POST /invoices/{id}/payments` and
  `POST /payments/{id}/reverse`.
- The `billing` container group and its per-request wiring.
- The structured `billing.*` audit events.
- Tests for each rule and each error branch, plus the role matrix on this router.

Out:
- Reports, aging and the per-student statement — Task 04.
- The roster, the holds endpoints and `/v1/me/billing` — Task 05.
- `POST /invoices/run` and the scheduled handler — Task 06.
- Any frontend change — Tasks 07–08.

## Acceptance Criteria

- [ ] An admin can create a plan, sign both a standard and a negotiated contract, and
      issue, adjust, void, pay and reverse — entirely over the API, with no screen and no
      report in existence.
- [ ] Signing snapshots the plan's `amount_minor`, `currency`, `cycle` and `grace_days`
      onto the subscription; editing the plan afterwards leaves that subscription and
      every invoice issued from it byte-identical.
- [ ] A negotiated contract stores `terms_source = 'negotiated'` and rejects a request
      that omits the reason.
- [ ] Amending closes the live version to `superseded` with its `end_date` set and opens
      one new `active` row carrying `supersedes_id` and the same `contract_group_id`; a
      second amendment of the superseded version is refused with a conflict.
- [ ] `PATCH /subscriptions/{id}` accepts only pause, resume and cancel — an attempt to
      change terms through it is refused, directing the caller to `/amend`.
- [ ] A void without a reason is refused; a recorded payment against a voided invoice is
      refused.
- [ ] A reversal appends a row rather than deleting the original, and the invoice's
      balance moves back accordingly; no code path issues an `UPDATE` or `DELETE` against
      `payments` or `invoice_adjustments`.
- [ ] Every mutation emits its `billing.*` structured audit event carrying the acting
      admin's id.
- [ ] A `content_creator`, a `tutor` and a student each receive `403` from every route in
      this router — asserted per route, not once.
- [ ] Validation, auth, not-found and conflict branches each return the correct
      `ControllerResult` status and are covered by a test.
- [ ] No provider-specific (D1/R2) import leaks into the controller or the service.
- [ ] `apps/api/src/routes/index.ts`, `apps/api/src/middleware/**` and
      `d1-enrollment-repository.ts` are unchanged, and every pre-existing API test still
      passes.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` then `make dev-api`, and walk the whole lifecycle with curl or
   Bruno: create a plan, sign a standard contract, sign a negotiated one for a second
   student, issue an ad-hoc invoice, apply a discount, record a payment, reverse it,
   void an invoice.
2. Repeat the terms-drift check by hand: `PATCH` the plan's amount and grace days, then
   re-read the subscription and its invoices and confirm nothing moved.
3. Call each route with a `content_creator`, a `tutor` and a student token and confirm
   `403` on every one.
4. `make test-api` — the service, controller, route and role-matrix specs pass, and the
   pre-existing suite passes unchanged.
5. `make lint`.
6. `git diff --stat` confirms only the guardrail files changed and that
   `apps/api/src/routes/index.ts` is absent from the list.
