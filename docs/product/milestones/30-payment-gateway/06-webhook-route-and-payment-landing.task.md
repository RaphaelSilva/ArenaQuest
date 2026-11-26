# Task 06 — Backend: Webhook route and payment landing (Phase 2)

**Status:** ✅ Done
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-gateway-ledger-entry-points.task.md), [Task 05](./05-mercadopago-adapter.task.md)

## Summary

The collection path of RFC §4 and §5: an anonymous **`POST /v1/webhooks/payments/{provider}`**
that treats a delivery as a **trigger only**, and **`GatewayService.handleEvent`**, which records
the event idempotently, **fetches the payment from the provider** and lets the fetched state
decide — a `paid` payment lands once through Task 04's entry points and closes its checkout,
provider-side refunds land as negative gateway rows, a dispute raises (and later releases) a
contract-rail standing hold. Orphans, currency mismatches and the service's own failures are
recorded outcomes an admin can see, never silent drops. After this task a payment made on the
provider's page reaches the ledger with no human step.

## Dependencies

- [Task 04](./04-gateway-ledger-entry-points.task.md) — hard code dependency: the only way a row is written.
- [Task 05](./05-mercadopago-adapter.task.md) — hard code dependency: a real `verifyWebhook` and
  `getPayment` to replay recorded deliveries against.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/routes/webhooks/payments.router.ts` (new), `apps/api/src/routes/index.ts` —
    mounted at `/v1/webhooks/payments`, beside `/events`, outside `authGuard`.
  - `apps/api/src/controllers/payments-webhook.controller.ts` (new).
  - `apps/api/src/core/payments/gateway-service.ts` (new) — `handleEvent` and the landing.
  - `apps/api/src/core/billing/billing-service.ts` — the system-actor dispute hold and its release only.
  - `apps/api/src/container.ts` — `payments.gatewayService` and the per-IP `webhooks` limiter.
  - `apps/api/src/openapi/components/**`, `apps/api/openapi.json`.
  - `apps/api/test/routes/payments-webhook.router.spec.ts` (new),
    `apps/api/test/core/payments/gateway-service.spec.ts` (new).
- **Order of the pipeline is the contract** (RFC §4): limiter keyed on `CF-Connecting-IP`
  (120 rpm → `429`) → declared length above 64 KiB → `413` → provider not in the registry →
  `404` → invalid configuration → `500 PAYMENTS_CONFIG_INVALID` → the raw body read **once** and
  verified (`401`, **no row, no body in any log**) → the event recorded → processing.
- **Never trust the delivery.** Its body decides nothing but which payment to fetch. The fetched
  payment's back-reference must name a checkout of that provider, and its currency must equal the
  checkout's; the fetched **status** decides the outcome, not the event's name.
- **Idempotency.** A settled event answers `200` with outcome `duplicate`; an unsettled one
  (`received` or `failed`) is processed again with `attempts` incremented; outcome writes are
  conditional so two concurrent deliveries settle one row. The ledger write and the checkout
  close go in one batch.
- **Never gates.** The handler never sets `user`, never touches enrollment or access, and the
  only hold it may raise is the dispute hold below. Event charges never get a hold.
- **Validation & results.** `createRoute` with Zod path params; the controller returns
  `ControllerResult<T>`; every response carries `Cache-Control: no-store`. Logs carry ids and
  outcomes only.

## Scope

**In:**
- Outcomes: `applied` (a row landed now), `duplicate` (settled before, or the reference already
  existed), `ignored` (an event kind the adapter ignores; a payment still `pending`; a `failed`
  or `expired` payment, with the checkout's `failure_detail` noted), `orphan` (the provider does
  not know the payment, or its back-reference names no checkout of this provider), `mismatch`
  (currency differs — checkout set to `mismatch`, nothing lands), `failed` (the service's own
  error — answered `503` so the provider redelivers).
- A payment on a checkout already `expired` or `cancelled` **still lands**; the checkout is then `paid`.
- A fetched payment that is `refunded`: the payment lands first if it never did, then each refund
  not yet in the ledger lands as its own negative row.
- Disputes (contract rail): `opened` notes the checkout, raises the standing hold "payment under
  dispute" by the system actor and writes nothing to the ledger; `lost` writes a negative gateway
  row keyed on the dispute id and releases the hold; `won` releases the hold. An admin may lift
  the hold earlier through the existing route. A new dispute state on a dismissed checkout clears
  its dismissal, so it returns to the exceptions list.
- Audit `payments.gateway_landed` (from Task 04) plus `payments.dispute_opened` / `_closed`.
- Tests, replaying Task 05's fixtures through the route: a good delivery lands once; a replay is
  `duplicate` with **one** event row; a tampered one is `401` with no row; an unknown payment is
  `orphan`; a wrong currency is `mismatch`; two concurrent deliveries leave one ledger row; a
  delivery signed with another provider's secret is `401`; a `503` then a redelivery ends
  `applied` with `attempts = 2`; `pending` is `ignored` and the later approval lands; a refund
  reported as a payment update lands as a refund; the same bare payment id from two stub
  providers lands as two rows; `none` answers `404`; an oversized body `413`; the limiter `429`.

**Out:**
- Creating checkouts (Tasks 07, 08), admin-initiated refunds (Task 08), the reconcile run and the
  exceptions routes (Task 09).

## Acceptance Criteria

- [x] A verified delivery for a paid checkout leaves exactly one gateway payment row, the
      checkout `paid` with its payment id, and the event `applied`.
- [x] Replaying that delivery any number of times adds no row and no event.
- [x] No response, log line or `gateway_events.error` contains a request body or a secret.
- [x] An invalid signature writes nothing to any table.
- [x] A dispute `opened` on an invoice checkout makes the student's contract standing `hold`
      with the system actor as its author, and `won` or `lost` releases it.
- [x] With `PAYMENTS_PROVIDERS = none` the route answers `404` for every provider name.
- [x] `billing-no-gating.spec.ts` passes unchanged.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/api && pnpm test test/routes/payments-webhook.router.spec.ts test/core/payments` — passes.
2. `cd apps/api && pnpm dump-openapi` — commit the regenerated `openapi.json`.
3. `make test-api` — green.
4. `make dev-api`, then `curl -i -X POST localhost:8787/v1/webhooks/payments/mercadopago -d '{}'` —
   `404` with the default `none`.
5. `git diff --stat` confirms only scope-guardrail files changed.
