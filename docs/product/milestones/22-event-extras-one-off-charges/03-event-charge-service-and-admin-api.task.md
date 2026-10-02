# Task 03 — Backend: Event-charge service and admin API (Phase 2)

**Status:** ✅ Done
**Milestone:** [22 — Event extras: one-off charges on a separate billing rail](./milestone.md)
**RFC:** [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-event-charge-schema-d1-repository-and-seed.task.md)

## Summary

Makes an extra sellable and collectable entirely over the API. `EventChargeService` owns every
write rule of the extras rail (RFC 0015 §3), mirroring `BillingService` method for method:
a price must be in the tenant's active currency; a charge can be issued **only on a
`published` event** (`draft` and `archived` → `409`, Resolved #6); without an explicit amount
the event price is snapshot as `standard`, and any amount that differs from it — or any amount
when the event has no price — is `negotiated` and requires a note; due date defaults to issue
date + the price's due-in days, grace to the price's grace; payments must be positive and in
the charge's currency, never on a void charge; a reversal appends the mirror row with a
mandatory reason, cannot itself be reversed, and happens at most once; adjustments are signed,
non-zero and reasoned; a void needs a reason and is refused (`409`) while net payments are
positive. For a `restricted` event it computes **`outsideAudience`** — the charged users who
are neither granted directly nor through a group — and returns it as a **warning only**: the
charge is still issued and no audience row is ever written (Resolved #7). Every write emits a
`billing.charge.*` audit line. The routes in RFC 0015 §7 (prices, charges, ledger actions,
per-event summary, audience check) mount on the existing billing sub-router under its
`requireRole(ROLES.ADMIN)`; nothing is added to `routes/admin/events.ts`. Task 07 wraps these
endpoints in the Extras tab; Tasks 04–06 read the same data for standing, reports and the run.

## Dependencies

- [Task 02](./02-event-charge-schema-d1-repository-and-seed.task.md) — hard code dependency:
  the service calls the adapter; the per-event summary and audience check read its data.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/billing/event-charge-service.ts` (new).
  - `apps/api/src/controllers/admin-billing.controller.ts` — new handlers for the extras routes.
  - `apps/api/src/routes/admin/billing.ts` — new `createRoute` definitions and their
    registration; existing routes unchanged.
  - `apps/api/src/index.ts` — **only** to wire the service per request.
  - `apps/api/test/**` — service and route tests.
- **Reading events and audience.** The service needs an event's status and, for a restricted
  event, its audience grants. It reads them through the existing `IEventRepository` port (or a
  narrow read-only method added to it, if one is missing) — never by querying event tables
  from the billing adapter, and **never writing** to them.
- **Validation & results.** Request schemas are `@hono/zod-openapi` `createRoute` definitions,
  as the rest of the billing router (the `@ValidateBody` decorator mentioned in older docs is
  not the pattern in use); services return `ControllerResult<T>` with explicit `400` / `404` /
  `409` branches.
- **Authorization.** Every new route sits behind the billing sub-router's own
  `requireRole(ROLES.ADMIN)`; `content_creator` gets `403`.
- **No access side-effects.** No path writes `enrollments_*` or `event_audience_*` or reads
  `getEffectiveAccessTopicIds`.
- **Bulk bound.** `userIds` accepts 1–200 distinct ids per request.

## Scope

In:
- `EventChargeService` with every rule listed in the Summary.
- Routes: price `GET`/`PUT`/`DELETE` by event; charge list (filters `eventId`, `userId`,
  `status`) and bulk issue returning `{ created, absorbed, outsideAudience }`; void;
  adjustments; payments; payment reversal; per-event summary (charged, received,
  outstanding, counts by status); audience check (read-only).
- Audit lines for each write.
- Service and route tests covering every branch, including a test that asserts no
  `enrollments_*` / `event_audience_*` row changes across the whole flow.

Out:
- Standing, roster, reports, statement and `/v1/me/billing` — Tasks 04 and 05.
- Reminders and the daily run — Task 06.
- Any frontend change — Tasks 07–09.

## Acceptance Criteria

- [x] `POST /v1/admin/billing/charges` twice with the same body returns every pair in
      `created`, then every pair in `absorbed`.
- [x] Issuing on a `draft` or `archived` event returns `409` and writes nothing.
- [x] An amount differing from the event price without `termsNote` returns `400`; with it,
      the charge is stored as `negotiated`.
- [x] A price or charge in a non-active currency returns `400`/`409` per the existing billing
      convention.
- [x] Recording a payment, reversing it, and reversing the reversal return `201`, `201`, `409`.
- [x] A payment on a void charge returns `409`; voiding a charge with positive net payments
      returns `409`; voiding without a reason returns `400`.
- [x] Charging users outside a `restricted` event's audience lists them in `outsideAudience`;
      audience row counts are unchanged; for `public`/`members` events the list is empty.
- [x] The per-event summary's charged − adjustments − received equals the sum of the
      charges' balances.
- [x] A `content_creator` token receives `403` on every new route.
- [x] Validation, auth, not-found and conflict branches each return the correct status and
      are covered by a test.
- [x] Changed files lint clean; `make test-api` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — service and route specs pass.
2. `make dev-api` against the seeded local D1 — price the seeded event, charge two users
   (one outside a restricted audience), record a payment, reverse it, try to void a paid
   charge; confirm each response and status.
3. Inspect the audit log lines for each write.
4. `git diff --stat` confirms only scope-guardrail files changed.
