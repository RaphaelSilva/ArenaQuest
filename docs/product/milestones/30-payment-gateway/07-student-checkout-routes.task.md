# Task 07 — Backend: Student checkout routes and pay options (Phase 3)

**Status:** ✅ Done
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API
**Depends On:** [Task 06](./06-webhook-route-and-payment-landing.task.md)

## Summary

Lets a student start a payment and see where it stands: **`POST /v1/me/billing/checkouts`**
creates (or reuses) the one live hosted checkout for an open invoice or event charge of the
caller's own, and **`GET /v1/me/billing/checkouts/{id}`** reports its status from the database
alone. The statements gain **`payOptions`** (which providers offer which methods, in list order)
and a **`pendingCheckout`** on every receivable. `GatewayService.createCheckout` carries the rules
of RFC §3 — full open balance only, one live attempt per receivable across providers, the row
written before the provider is called, a stored expiry never later than 24 hours. The web tasks
10 and 11 call exactly this contract.

## Dependencies

- [Task 06](./06-webhook-route-and-payment-landing.task.md) — hard code dependency:
  `GatewayService`, and a landing path that closes the checkouts created here.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/routes/me/billing.ts`, `apps/api/src/controllers/me-billing.controller.ts`.
  - `apps/api/src/core/payments/gateway-service.ts` — `createCheckout`, `getCheckoutStatus`.
  - `apps/api/src/core/billing/accounting-service.ts`, `event-charge-service.ts` —
    `pendingCheckout` on the statement's receivables.
  - `apps/api/src/routes/admin/billing.ts` — the shared statement schema only (new fields).
  - `apps/api/src/container.ts` — the per-user `checkouts` limiter.
  - `apps/api/src/openapi/components/**`, `apps/api/openapi.json`.
  - `apps/api/test/routes/{me-billing,me-billing-extras}.router.spec.ts`,
    `apps/api/test/core/payments/gateway-service.spec.ts`,
    `apps/api/test/routes/billing-no-gating.spec.ts` (new routes added to its matrix).
- **Self-only by construction.** The subject is the token's `sub`; the body names a receivable
  (`kind`, `id`) and optionally a `provider`, never a user. Anything not the caller's own is
  `404`, indistinguishable from a missing receivable.
- **Order of refusals** (RFC §3): empty registry → `404`; invalid configuration →
  `500 PAYMENTS_CONFIG_INVALID`; several providers and none named, or one named that offers no
  method → `400 PAYMENT_PROVIDER_REQUIRED`; receivable missing or not the caller's → `404`; void,
  settled or zero balance → `409 RECEIVABLE_NOT_PAYABLE`; currency outside the capability table →
  `409 PAYMENTS_UNSUPPORTED_CURRENCY` **before the provider is called**; limiter
  `rl:checkouts:<userId>` at 10 per hour → `429`.
- **Row first, provider second.** A provider failure marks the row `failed` and answers
  `502 PAYMENTS_PROVIDER_ERROR`; an open row left without a session is retried under the same
  checkout id. The stored expiry is the earlier of the provider's and the requested one.
- **The status route never calls the provider** and both routes send `Cache-Control: private, no-store`.
- **Statements keep answering.** `GET /v1/me/billing` never fails because of payments: with an
  empty registry or an invalid configuration it carries `payOptions: []` (milestone §6, decision 24).
- **Never gates.** No middleware is added to any content route; a `delinquent` student can open a
  checkout like anyone else.
- **Validation & results.** `createRoute` with Zod schemas; controllers return `ControllerResult<T>`.

## Scope

**In:**
- The two routes and their OpenAPI documentation, including every refusal above.
- One live attempt: an open checkout on the same provider is returned as `200` when more than
  five minutes remain, otherwise closed `expired` and replaced; choosing another provider closes
  the first as `cancelled`; a new one answers `201`.
- The amount is the receivable's full open balance at creation; return URLs point at
  `/settings/billing` with `checkout` and `outcome` query hints built from `WEB_BASE_URL`.
- `payOptions` on `GET /v1/me/billing` and on the admin student statement;
  `pendingCheckout: { checkoutId, provider, createdAt, expiresAt, createdBy } | null` on every
  invoice and event charge in both.
- Audit `payments.checkout_created`.
- Tests: the refusal order; another student's invoice and another student's checkout id are
  `404`; reuse, the five-minute boundary, the provider switch (exactly one `open` row and one
  `cancelled`); the stored expiry with a provider that returns 30 minutes; a provider failure
  leaves a `failed` row and no open one; the limiter; statements with `none`, one provider, two
  stub providers and an invalid list.

**Out:**
- Checkouts on behalf of a student, refunds, roster flags (Task 08); the reconcile run (Task 09).
- Any page or component (Tasks 10, 11) and the e-mail link (Task 14).

## Acceptance Criteria

- [x] A student with one open invoice gets a hosted URL; calling again returns the same checkout.
- [x] No request to either route can read or create a checkout for another user (`404`).
- [x] At most one `open` checkout exists per receivable after any sequence of calls, including
      across two providers.
- [x] `GET /v1/me/billing/checkouts/{id}` issues no provider call (asserted on the stub).
- [x] `GET /v1/me/billing` answers `200` under `none`, under a valid list and under an invalid one.
- [x] `apps/api/openapi.json` documents both routes, `payOptions` and `pendingCheckout`.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/api && pnpm test test/routes/me-billing.router.spec.ts test/routes/me-billing-extras.router.spec.ts`.
2. `cd apps/api && pnpm dump-openapi` — commit the regenerated `openapi.json`.
3. `make test-api` — green.
4. `make dev-api`, log in as a seeded student, `curl -i -X POST localhost:8787/v1/me/billing/checkouts` — `404` under `none`.
5. `git diff --stat` confirms only scope-guardrail files changed.
