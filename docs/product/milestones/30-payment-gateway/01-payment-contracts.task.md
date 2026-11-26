# Task 01 — Backend: Payment contracts: ports, money conversion and entities (Phase 0)

**Status:** 📝 Open
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API

## Summary

Declares the contracts every later task implements, with no behaviour wired to a route: the
provider port **`IPaymentGateway`** (`createCheckout`, `getPayment`, `findPaymentsForCheckout`,
`refund`, `verifyWebhook`) with its plain records (`CreateCheckoutRequest`, `ProviderPayment`,
`ProviderEvent`), the persistence port **`IGatewayRepository`**, the pure money helper
**`decimalToMinor`** and the **provider capability table** (methods and currencies each provider
can settle, plus the provider-dashboard URL template for a payment id), and the entities and
enums the API and the web share (`GatewayCheckout`, `GatewayEvent`, `CheckoutStatus`, the
`system` user status, the `reconcile_payments` job name). Everything in RFC §1 and §9 that is a
type or pure data lands here, so Tasks 02–09 never invent a shape.

## Dependencies

None — independent. First task of the milestone.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/ports/i-payment-gateway.ts` (new) — the provider port and its records.
  - `packages/shared/ports/i-gateway-repository.ts` (new) — the checkout / event repository port.
  - `packages/shared/ports/i-billing-repository.ts`, `i-event-charge-repository.ts` — declare
    `findGatewayPayment(externalReference)` only (implemented in Task 03).
  - `packages/shared/ports/index.ts` — exports.
  - `packages/shared/domain/billing/gateway-money.ts` (new), `gateway-money.spec.ts` (new),
    `packages/shared/domain/billing/index.ts` — conversion, capability table, exports.
  - `packages/shared/types/entities.ts` — `Entities.Billing.GatewayCheckout`, `GatewayEvent`,
    `Entities.Config.CheckoutStatus`, the gateway event outcome enum, `UserStatus.SYSTEM`,
    `JobName.RECONCILE_PAYMENTS`.
  - Any `packages/shared` or `apps/api` file that fails to compile only because an enum gained a
    member (exhaustive switches) — the minimal branch, nothing else.
- **Ports & Adapters.** Plain records only: no Cloudflare type, no `Request`/`Headers` object in
  the port (`verifyWebhook` takes the raw body string, a header map and a query map), no provider
  SDK type. The provider name union is `stripe | mercadopago | asaas | pagarme` (RFC §1).
- **Money.** Amounts cross the port as **integer minor units** plus an ISO currency code.
  `decimalToMinor` parses a provider's decimal string character by character against
  `currencies.exponent`, rejects more fraction digits than the exponent, a sign, a blank or a
  non-digit, and never uses floating point.
- **The capability table is data**, not adapter behaviour: per provider, the methods
  (`pix` · `card` · `boleto`) it can settle per currency, and the dashboard URL template for a
  payment id (RFC §7's deep link, `null` when a provider has none).
- **No behaviour change.** No route, no migration, no adapter. The repository ports gain a
  method signature; the D1 classes implement it in Task 03, so this task adds whatever minimal
  placeholder keeps `tsc` green without changing a query.

## Scope

**In:**
- `IPaymentGateway`, `CreateCheckoutRequest` (the checkout id doubles as the provider
  idempotency key and the metadata back-reference; `expiresAt` requested by the caller),
  `ProviderPayment` (status `pending | paid | failed | expired | refunded | disputed`, its
  `refunds` list, nullable `checkoutId`), and `ProviderEvent` as the four-way union
  `payment | refund | dispute | ignored` exactly as RFC §1 lists the fields.
- `IGatewayRepository` with the ten methods of RFC §9 — `createCheckout`, `getCheckout`,
  `findOpenCheckout`, `closeCheckout`, `recordEvent` (returns the stored outcome when the event
  already exists), `markEvent`, `listExceptions`, `listCheckoutsToConfirm`, `markChecked`,
  `listUnsettledEvents` — plus `dismissException` (milestone §6, decision 20).
- `decimalToMinor`, the capability table with a lookup that answers "may this provider settle
  this method in this currency", and the reference helpers that build and split
  `<provider>:<id>`.
- Unit tests: exponents 0, 2 and 8; excess fraction digits, signs, blanks and separators
  refused; capability refusals per provider; reference round-trip, including an id that itself
  contains a colon.

**Out:**
- The `PAYMENTS_PROVIDERS` parser and the registry (Task 02); the schema and the D1 repository
  (Task 03); any provider call (Task 05).

## Acceptance Criteria

- [ ] `IPaymentGateway` and `IGatewayRepository` are exported from `packages/shared/ports` and
      reference no Cloudflare or provider-SDK type.
- [ ] `decimalToMinor('180.50', 2)` is `18050`, `decimalToMinor('180', 2)` is `18000`, and
      `'180.505'` at exponent 2, `'-1.00'`, `''`, `'1,50'` and `'1e3'` each throw.
- [ ] The capability lookup refuses a method or a currency the table does not list, for every
      provider name.
- [ ] `UserStatus` has `system`, `JobName` has `reconcile_payments`, and no existing test changes
      its expectation.
- [ ] Changed files lint clean; `make test-api` green (and the shared specs with it).
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make lint` — clean.
2. `cd packages/shared && pnpm test domain/billing/gateway-money.spec.ts` — the new unit suite passes.
3. `make test-api` — green; no existing spec touched beyond an exhaustive-switch branch.
4. `make build` — every workspace still compiles against the widened enums.
5. `git diff --stat` confirms only scope-guardrail files changed.
