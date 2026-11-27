# Task 05 — Backend: Mercado Pago adapter (Phase 2)

**Status:** ✅ Done
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-provider-list-and-gateway-registry.task.md)

## Summary

The first real provider behind the port: **`MercadoPagoGatewayAdapter`** implements
`IPaymentGateway` for Checkout Pro using `fetch` and Web Crypto only — a hosted checkout that
carries the checkout id as idempotency key and back-reference, payment lookup with the provider's
decimal amounts converted through `decimalToMinor`, payment search for a session, refunds with an
idempotency key, and **webhook verification** of the `x-signature` header. It is registered in the
production adapter-factory map, which makes `mercadopago:…` a valid `PAYMENTS_PROVIDERS` entry.
Its tests replay **recorded sandbox responses and deliveries**, so the field mapping is pinned to
what the provider actually sends rather than to its documentation.

## Dependencies

- [Task 02](./02-provider-list-and-gateway-registry.task.md) — hard code dependency: the registry
  and the adapter-factory map this adapter joins.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/adapters/payment/mercadopago-gateway-adapter.ts` (new).
  - `apps/api/src/core/payments/gateway-registry.ts` or `apps/api/src/container.ts` — the one
    line that registers the factory under `mercadopago`.
  - `packages/shared/domain/billing/gateway-money.ts` and its spec — only to correct the
    Mercado Pago rows of the capability table (methods, dashboard URL template) against what the
    sandbox shows.
  - `apps/api/test/adapters/payment/mercadopago-gateway-adapter.spec.ts` (new).
  - `apps/api/test/fixtures/mercadopago/**` (new) — recorded responses and deliveries, plus a
    short `README.md` saying how each was recorded.
- **No SDK, no new dependency.** `fetch` with a **10-second timeout** per call, HMAC-SHA256
  through Web Crypto, a constant-time comparison of the signature.
- **Hosted checkout only.** The adapter never sees a card number; it asks for a hosted page and
  returns its URL. QR-code-only notifications are not used: they cannot be signature-verified.
- **Fixtures are recorded, never written from documentation.** They come from the sandbox with
  the operator's **test** credentials read from the environment, and are scrubbed of access
  tokens, e-mails and names before commit. If no sandbox credentials are available when the task
  opens, the task stops and says so — it does not ship a mapping it could not observe.
- **Secrets.** The secret key and the webhook secret arrive through the factory; neither appears
  in an error, a log line, a fixture or a test name. Errors carry the HTTP status and the
  provider's error code, never a response body.
- **Money.** Amounts leave as exact decimal strings built from integer minor units and come back
  through `decimalToMinor`; a provider amount with more fraction digits than the currency allows
  is an adapter error, not a rounded value.
- **Ports & Adapters.** Only this file knows a Mercado Pago field name.

## Scope

**In:**
- `createCheckout`: one hosted session offering exactly the methods it was handed (the others
  excluded), the description, the payer's e-mail and name, both return URLs, the requested
  expiry, the checkout id as external reference and as idempotency key; returns the session id,
  the hosted URL and the expiry the provider accepted.
- `getPayment`: maps the provider's statuses onto `pending | paid | failed | expired | refunded |
  disputed`, the method onto `pix | card | boleto | other`, the back-reference onto `checkoutId`,
  and the refund list onto `refunds`; an unknown payment is `null`.
- `findPaymentsForCheckout`: every payment made against one session, through whichever provider
  lookup the recorded responses show to be reliable.
- `refund`: full or partial by amount, with the idempotency key; a refusal is a typed error that
  carries the provider's reason code.
- `verifyWebhook`: recomputes the signature over the signed fields (`data.id`, `x-request-id`,
  `ts`) with this provider's webhook secret; a missing or wrong signature is `null`; a verified
  delivery becomes a `payment`, `dispute` or `ignored` event whose `eventId` is the
  notification's own id — never the payment id.
- Tests against fixtures: an approved Pix payment, an approved card payment, a pending one, a
  rejected one, a refunded one (full and partial), a charged-back one, an unknown id; a good
  delivery, a tampered body, a tampered `ts`, a delivery signed with another secret, an unknown
  topic; a provider `5xx` and a timeout.

**Out:**
- Any decision about what a payment means for the ledger (Task 06).
- Stripe, Asaas and Pagar.me adapters — not in this milestone.

## Acceptance Criteria

- [x] With the adapter bound, `mercadopago:pix+card` is a valid list (given both secrets) and
      `GatewayRegistry.get('mercadopago')` returns the adapter.
- [x] Every fixture payment maps to the expected `ProviderPayment`, amounts as integers.
- [x] A tampered delivery, and a good delivery checked against another secret, both verify to `null`.
- [x] A verified delivery's `eventId` differs from its `paymentId`, and two deliveries about the
      same payment carry two event ids.
- [x] No fixture contains an access token, a webhook secret or a real person's e-mail
      (`grep -rE "APP_USR-|TEST-[0-9]" apps/api/test/fixtures/mercadopago` returns nothing).
- [x] A provider call that exceeds 10 seconds fails as a timeout the caller can tell from a refusal.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Record the fixtures from the sandbox (credentials from the environment only), scrub, commit.
2. `cd apps/api && pnpm test test/adapters/payment` — the adapter suite passes offline.
3. `make test-api` — green.
4. `make build` — no new dependency in `apps/api/package.json`.
5. `git diff --stat` confirms only scope-guardrail files changed.
