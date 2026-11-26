# Task 08 — Backend: Admin on-behalf checkouts and gateway refunds (Phase 3)

**Status:** 📝 Open
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API
**Depends On:** [Task 06](./06-webhook-route-and-payment-landing.task.md)

## Summary

The admin's side of the gateway (RFC §3, §5, §7): a checkout **on behalf of a student** for an
invoice or an event charge, whose link the admin hands over; the **gateway branch of both
`reverse` routes**, where reversing a gateway payment first asks the provider to return the money
and writes the reversal only when the provider accepts; and the **pending online payment** flag
on the roster and on the event-charge list. The refund path is safe to retry at every step — a
refund that already happened is recorded, not repeated.

## Dependencies

- [Task 06](./06-webhook-route-and-payment-landing.task.md) — hard code dependency:
  `GatewayService` and the reversal entry points it lands through.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/routes/admin/billing.ts`, `apps/api/src/controllers/admin-billing.controller.ts`
    (both controller classes in that file).
  - `apps/api/src/core/payments/gateway-service.ts` — on-behalf creation, `refundPayment`.
  - `apps/api/src/core/billing/billing-service.ts`, `event-charge-service.ts` — the pending flag
    on the roster and on the charge list.
  - `apps/api/src/openapi/components/**`, `apps/api/openapi.json`.
  - `apps/api/test/routes/{admin-billing,admin-billing-extras,admin-billing-roster}.router.spec.ts`,
    `apps/api/test/core/payments/gateway-service.spec.ts`.
- **Paths follow the repository (milestone §6, decision 22).** Event charges are served by the
  billing router, so the two routes are `POST /v1/admin/billing/invoices/{id}/checkouts` and
  `POST /v1/admin/billing/charges/{id}/checkouts`; no file under the events router changes.
- **Admin only.** Every route here sits behind `requireRole(ADMIN)`; a `content_creator` and a
  `tutor` get `403`.
- **Refund order is the contract** (RFC §5), for a row whose method is `gateway`: adapter from the
  reference's provider prefix (not bound → `409 PAYMENTS_PROVIDER_NOT_ENABLED`) → read the payment
  from the provider → already refunded there → record the reversal under that refund id, `200` →
  otherwise ask for a refund of the original's full amount with the idempotency key derived from
  the original row's id → refusal → `409 PAYMENTS_REFUND_REFUSED`, **nothing written** → accepted
  and written → `200` → accepted but the write failed → `503 PAYMENTS_REFUND_UNRECORDED`, and the
  same request repeated completes it.
- **Other methods are untouched.** Reversing a cash, transfer or card-machine payment behaves
  exactly as today, with no provider call.
- **Validation & results.** `createRoute` with Zod schemas; controllers return `ControllerResult<T>`.

## Scope

**In:**
- On-behalf checkouts: the same rules as Task 07 (`provider` optional, one live attempt, full
  balance, refusals) with `user_id` the receivable's student and `created_by` the admin; the
  response carries the hosted URL and the expiry; the student's own limiter is not consumed.
- The gateway branch of `POST /v1/admin/billing/payments/{id}/reverse` and
  `POST /v1/admin/billing/charge-payments/{id}/reverse`, as ordered above; audit
  `payments.refund_requested` and the existing reversal audit.
- The pending flag: each roster line and each charge in the admin list says whether an open
  checkout exists for one of the student's receivables (count and the earliest expiry).
- Recording a cash payment on a receivable with an open checkout stays allowed; the response
  says a checkout is open so the form can warn.
- Tests: the role matrix on every route; on-behalf creation for both rails; a refund accepted, a
  refund refused (no row), a refund already done at the provider (`200`, one row), the same
  request twice (`200`, one row), a write failure then a retry, an unbound provider; a
  non-gateway reversal makes no provider call; the roster and charge-list flags.

**Out:**
- Partial refunds from the admin (not in v1 — a partial refund made on the provider's dashboard
  still lands through Task 06).
- The reconcile run and the exceptions routes (Task 09); every page (Task 12).

## Acceptance Criteria

- [ ] An admin can create a checkout for a student's open invoice and for an open event charge;
      the row records the admin as `created_by`.
- [ ] A refused refund leaves the ledger byte-for-byte unchanged.
- [ ] Reversing the same gateway payment twice yields one reversal row and two `200` answers.
- [ ] A reversal's reference is the provider's refund id.
- [ ] A `content_creator` and a `tutor` get `403` on the two checkout routes and on both reverse routes.
- [ ] `apps/api/openapi.json` documents the new routes, the new error codes and the pending flag.
- [ ] Changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/api && pnpm test test/routes/admin-billing.router.spec.ts test/routes/admin-billing-extras.router.spec.ts`.
2. `cd apps/api && pnpm dump-openapi` — commit the regenerated `openapi.json`.
3. `make test-api` — green.
4. `git diff --stat` confirms only scope-guardrail files changed.
