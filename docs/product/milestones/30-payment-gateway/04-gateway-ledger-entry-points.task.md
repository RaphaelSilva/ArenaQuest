# Task 04 — Backend: Gateway ledger entry points (Phase 1)

**Status:** ✅ Done
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-gateway-schema-repository-and-system-actor.task.md)

## Summary

Gives each rail a narrow, typed way to write a provider-confirmed movement, so nothing above the
services ever chooses `method`, `recordedBy` or a reference format: **`recordGatewayPayment`** on
`BillingService` and on `EventChargeService` (fixes `method = 'gateway'`, the system actor as
recorder and the `<provider>:<id>` reference), and the **gateway reversal** entry points — one
that reverses a known gateway row with the provider's refund id as its own reference, one that
writes a provider-side refund or a lost dispute as a negative gateway row with no `reverses_id`.
Each is **idempotent on the reference**: a collision returns the row that already exists. The
existing admin `recordPayment` path learns to answer a duplicate gateway reference with a `409`
instead of an unhandled constraint error. Task 06 lands payments through these and nothing else.

## Dependencies

- [Task 03](./03-gateway-schema-repository-and-system-actor.task.md) — hard code dependency: the
  partial unique indexes, `findGatewayPayment` and the system actor.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/billing/billing-service.ts`, `event-charge-service.ts` — the new entry points.
  - `apps/api/src/adapters/db/d1-billing-repository.ts`, `d1-event-charge-repository.ts` and
    their ports under `packages/shared/ports/` — only if an entry point needs a statement the
    repositories do not expose yet.
  - `apps/api/src/controllers/admin-billing.controller.ts` — the duplicate-reference mapping.
  - `apps/api/src/openapi/components/**`, `apps/api/openapi.json` — the new `409` on the two
    admin payment routes.
  - `apps/api/test/core/billing/**`, `apps/api/test/db/event-charge-service.spec.ts`,
    `apps/api/test/routes/{admin-billing,admin-billing-extras}.router.spec.ts`.
- **One write path.** A gateway payment is an ordinary payment row written by the same code that
  writes an admin payment — same balance arithmetic, same standing recompute, same audit — so
  every invariant of RFC 0013 and RFC 0015 holds without a second implementation. The rails stay
  apart: no shared helper sums or mixes them.
- **Money.** Integer minor units; the currency must equal the receivable's currency or the entry
  point refuses, before any write.
- **A payment lands whatever the receivable's state allows today** — an overpayment becomes a
  credit exactly as it does for an admin payment (RFC R14); the entry points add no refusal the
  admin path does not have.
- **Never gates.** No entry point touches enrollment, access or a hold (holds are Task 06).
- **Validation & results.** Controllers keep returning `ControllerResult<T>`; the new `409`
  carries the code `PAYMENT_REFERENCE_EXISTS` and the existing row's id in `meta`.

## Scope

**In:**
- `recordGatewayPayment(receivableId, { amountMinor, currency, paidAt, externalReference })` on
  both services, returning the landed row and whether it was created now or already existed;
  audit action `payments.gateway_landed` by the system actor.
- Gateway reversal of a known row: reference = `<provider>:<refundId>`, `reverses_id` set, full
  amount of the original only (partial refunds stay out of v1).
- Provider-side refund / lost dispute with no local original link: a negative gateway row,
  `reverses_id` null, the note naming the provider refund or dispute id.
- Idempotency: a second call with the same reference returns the stored row and writes nothing;
  two concurrent calls leave one row.
- The admin payment form path (`POST …/invoices/{id}/payments`, `POST …/charges/{id}/payments`)
  with `method = 'gateway'`: a reference that is not `<known provider>:<id>` is a `400`; a
  duplicate is `409 PAYMENT_REFERENCE_EXISTS`.
- Tests: each entry point on each rail; the collision paths; the standing recomputes after a
  landed payment and after its reversal; an overpayment leaves a credit; the admin `409` and `400`.

**Out:**
- Calling a provider, checkouts, events, holds (Tasks 05–08).
- The admin refund route's provider call (Task 08) — it uses the reversal entry point from here.

## Acceptance Criteria

- [x] A gateway payment written through the entry point is indistinguishable in the statement and
      the reports from an admin payment of the same amount, apart from method, recorder and reference.
- [x] Calling an entry point twice with one reference yields one row and the same returned id.
- [x] A reversal's reference is the refund id, never the original's reference.
- [x] A currency other than the receivable's is refused with no row written.
- [x] An admin gateway payment with a duplicate reference answers `409 PAYMENT_REFERENCE_EXISTS`
      on both rails; `apps/api/openapi.json` documents it.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/api && pnpm test test/core/billing test/db/event-charge-service.spec.ts` — entry-point suites pass.
2. `cd apps/api && pnpm dump-openapi` — commit the regenerated `openapi.json`.
3. `make test-api` — green, including `billing-no-gating.spec.ts` untouched.
4. `git diff --stat` confirms only scope-guardrail files changed.
