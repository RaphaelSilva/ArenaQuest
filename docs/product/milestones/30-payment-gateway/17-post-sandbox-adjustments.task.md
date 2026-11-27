# Task 17 — Backend: Post-sandbox adjustments to the gateway (Phase 5)

**Status:** 📝 Open
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API

## Summary

Applies what the first real Mercado Pago sandbox payments taught (2026-11-27) and the owner's
decisions of that day, so the collection path can go to staging and then to sales: the provider's
**own method label** is kept beside the normalised method and shown on the admin ledger; the
reconcile run asks the provider **by reference** (one call per checkout); the **key-mode check no
longer reads the key** — `PAYMENTS_KEY_MODE` becomes a declaration the integrator owns; every
checkout carries its own **notification URL**, so staging, previews and production each receive
their own webhooks; a provider rate limit on a refund is **retryable**, not a refusal; a payment in
another currency is a **mismatch**; and three derived fixtures are replaced by recorded ones.

## Dependencies

- [Task 05](./05-mercadopago-adapter.task.md) — hard code dependency: the adapter and its fixtures.
- [Task 08](./08-admin-checkouts-and-gateway-refunds.task.md), [Task 09](./09-reconcile-run-and-exceptions-routes.task.md)
  — hard code dependency: the refund path and the reconcile run this task adjusts.
- [Task 12](./12-admin-ledger-online-payments.task.md) — the ledger row that gains the label.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/ports/i-payment-gateway.ts`, `i-gateway-repository.ts`,
    `packages/shared/types/entities.ts` — the method label, the notification URL, the lookup by reference.
  - `apps/api/migrations/0033_create_payment_gateway.sql` — two nullable columns on
    `gateway_checkouts` (the migration has not reached `main`; no second file, no money table).
  - `apps/api/src/adapters/payment/mercadopago-gateway-adapter.ts`,
    `apps/api/src/adapters/db/d1-gateway-repository.ts`.
  - `apps/api/src/core/payments/{config,gateway-service}.ts`, `apps/api/src/jobs/reconcile-payments.ts`.
  - `apps/api/src/core/billing/{billing-service,event-charge-service,accounting-service}.ts`,
    `apps/api/src/controllers/{me-billing,admin-billing}.controller.ts`,
    `apps/api/src/routes/{me,admin}/billing.ts` — only to pass the request origin to checkout
    creation and to expose the label on the admin ledger rows.
  - `apps/api/src/openapi/components/**`, `apps/api/openapi.json`, `apps/web/src/lib/api-types.gen.ts`.
  - `apps/web/src/app/(protected)/admin/billing/**`, `apps/web/src/i18n/dict-{en,pt}.ts` — the
    label on the ledger row only.
  - `scripts/label.mjs`, `scripts/cloudflare/provision-label.mjs`, `config/deployment.schema.jsonc`
    and their tests — only where they describe `PAYMENTS_KEY_MODE` or the webhook reminder.
  - `apps/api/test/**`, `apps/api/test/fixtures/mercadopago/**` and its `README.md`.
  - This milestone folder (decision 19 rewritten, S7 reworded, the deferred list below).
- **Key mode is a declaration (owner decision, replaces milestone §6 decision 19).** No code reads
  a secret key's content to infer its mode, for any provider. `PAYMENTS_KEY_MODE` (`test` | `live`,
  absent = `test`) stays in every environment block as the integrator's reminder; an invalid value
  is still `PAYMENTS_CONFIG_INVALID`. It is reported in the reconcile summary and by `infra-check`.
  Using the right key in the right environment is the integrator's responsibility (runbook, Task 16).
- **Reconcile asks by reference.** `findPaymentsForCheckout` receives the checkout id (the
  `external_reference` sent at creation) with the session id; the Mercado Pago adapter makes
  **one** provider call per checkout, restoring the 35-call worst case of milestone §6 decision 17.
- **Notification URL per checkout.** `CreateCheckoutRequest` gains `notificationUrl`; the service
  builds it from the origin of the API request that creates the checkout
  (`<origin>/v1/webhooks/payments/<provider>`); the adapter sends it with the preference. No new
  environment variable. Signature verification is unchanged.
- **Method label.** `ProviderPayment` gains `methodLabel` — the provider's own words (for Mercado
  Pago `payment_type_id` and `payment_method_id`, e.g. `account_money`, `credit_card/visa`), capped
  and never free text from a payer. It is stored on the paid checkout (`paid_method`,
  `paid_method_label`) and returned on admin ledger rows; the student statement is unchanged.
- **No money table is altered**; no new dependency; no gate on access.

## Scope

**In:**
- The four port/adapter changes above, with the stub adapter and every caller updated.
- A provider `429` (and any retryable provider error) on the admin refund path answers
  `503 PAYMENTS_PROVIDER_BUSY` with nothing written — never `409 PAYMENTS_REFUND_REFUSED`.
- A fetched payment whose currency differs from the checkout's settles as `mismatch` with `200`
  (RFC §4), not as an adapter error and a `503`.
- Recorded fixtures replace `derived-payment-rejected-card`, `derived-payment-in-process-card` and
  `derived-search-two-payments` (recordings of 2026-11-27 under
  `.arenaquest/mercadopago-recordings/walk/`, scrubbed); the README's RECORDED / DERIVED lists follow.
- A test proving two payments on one checkout land as two ledger rows, the second as a credit (R14).
- Admin ledger: *Online · <label>* on a gateway row that has one.
- Milestone text: decision 19 rewritten, S7 reworded, this task in §5, and the deferred list.

**Out — deferred, to be filed in the backlog by Task 16:**
- Cloudflare Queues (or another queue) behind the webhook and the reconcile run.
- Expiring the provider's preference as soon as its payment lands, and flagging a second payment
  on one checkout as an exception instead of a silent credit.
- The dispute lifecycle for Mercado Pago (won / lost never observed; the hold is released by hand).
- A provider-side test-account check (`test_user`) as an optional adapter capability.
- Pix verified on a seller with a Pix key; Pix through the transparent API (QR on the statement).
- A *test mode* badge in Admin → Billing; the reminder e-mails in Portuguese.
- A `created` flag on the reverse routes; the provider-dashboard deep link for Mercado Pago.

## Acceptance Criteria

- [ ] No file under `apps/api/src` or `scripts/` matches a secret key against a prefix or pattern;
      `PAYMENTS_KEY_MODE=banana` is `PAYMENTS_CONFIG_INVALID`; any key passes under `test` and under `live`.
- [ ] A reconcile run over 25 due checkouts makes 25 provider calls with the Mercado Pago adapter.
- [ ] A checkout created through `https://api.example.test` sends
      `https://api.example.test/v1/webhooks/payments/mercadopago` as its notification URL.
- [ ] A payment made with the buyer's Mercado Pago balance lands with method `other` and label
      `account_money`, and the admin ledger row shows it; the student statement shows no label.
- [ ] A refund answered `429` by the provider is `503 PAYMENTS_PROVIDER_BUSY`, writes nothing, and
      the same request repeated afterwards completes.
- [ ] A payment in another currency is `200` `mismatch` with no ledger row.
- [ ] `grep -rE "APP_USR-|TEST-[0-9]|testuser\.com" apps/api/test/fixtures/mercadopago` returns nothing.
- [ ] `apps/api/openapi.json` and `apps/web/src/lib/api-types.gen.ts` are regenerated and committed.
- [ ] `make lint`, `make test-api` and `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/api && pnpm test test/adapters/payment test/core/payments test/core/jobs` — green.
2. `make db-reset-local` — migration `0033` applies from scratch with the two new columns.
3. `make lint`, `make test-api`, `make test-web` — green.
4. `node --test scripts/label.test.mjs scripts/cloudflare/provision-label.test.mjs` — green.
5. `git diff --stat` confirms only scope-guardrail files changed.
