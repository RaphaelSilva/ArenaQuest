# RFC 0026: Payment gateway: hosted checkout collection for invoices and event charges

**Date:** 2026-11-16
**Status:** Draft
**Author:** raphaelsilva
**Revised:** 2026-11-17 (a tenant may enable several providers and combine their methods — §8.1, R6; the single `PAYMENTS_PROVIDER` var became the `PAYMENTS_PROVIDERS` list and the secrets became provider-prefixed) · 2026-11-18 (the nine Open Questions answered by the owner — R7–R15; first adapter Mercado Pago; a *Pay* card on the student dashboard added to v1)
**Affected:**
- `apps/api/migrations/00NN_create_payment_gateway.sql` (new; next free number at implementation time) — `gateway_checkouts`, `gateway_events`, one system actor row in `users`, two **partial unique indexes** on the existing payment tables (`payments`, `event_charge_payments`) scoped to `method = 'gateway'`, and a rebuild of the operational `job_runs` table so its `job` CHECK admits `reconcile_payments`. No `ALTER` and no rebuild of any money table.
- `packages/shared/ports/i-payment-gateway.ts` (new) — `IPaymentGateway`, the provider port RFC 0013 #9 deferred "until a provider is in hand". Provider-neutral in shape, modelled on Mercado Pago, the first adapter (R7). No provider SDK type crosses it.
- `packages/shared/ports/i-gateway-repository.ts` (new) — persistence for checkouts and provider events; `i-billing-repository.ts` and `i-event-charge-repository.ts` each gain one read, `findGatewayPayment(externalReference)`, used only to answer a duplicate.
- `packages/shared/domain/billing/receivable.ts` — unchanged in shape; `(kind, id)` becomes the key of a checkout. `packages/shared/domain/billing/gateway-money.ts` (new, pure) — decimal-string → minor-units conversion against `currencies.exponent`, and the provider-capability table (which currencies and methods each adapter may offer).
- `packages/shared/types/entities.ts` — `Entities.Billing.GatewayCheckout`, `GatewayEvent`, and the `Entities.Config.CheckoutStatus` enum.
- `apps/api/src/adapters/payment/<provider>-gateway-adapter.ts` (new) — a thin `fetch` client over the provider's REST API plus webhook verification with Web Crypto (HMAC-SHA256) or a constant-time token compare, whichever the provider specifies. One file per provider — the first is `mercadopago-gateway-adapter.ts` (R7); a label may bind more than one (§8.1).
- `apps/api/src/adapters/db/d1-gateway-repository.ts` (new).
- `apps/api/src/core/payments/gateway-service.ts` (new) — checkout creation, the landing of a confirmed payment through `BillingService.recordPayment` / `EventChargeService.recordPayment`, refunds as reversals, reconciliation. `apps/api/src/core/payments/config.ts` (new) — `PAYMENTS_PROVIDERS` parsing (the enabled providers and the methods each offers, §8.1), the key-mode-vs-environment assertion, `500 PAYMENTS_CONFIG_INVALID`. `apps/api/src/core/payments/gateway-registry.ts` (new) — the adapters enabled for this label and environment, resolved by provider name; empty when the list is `none`.
- `apps/api/src/core/billing/billing-service.ts`, `event-charge-service.ts` — `recordPayment` and `reversePayment` keep their rules; each gains a sibling entry point that accepts the system actor and a provider reference, and refuses `method <> 'gateway'`.
- `apps/api/src/routes/webhooks/payments.router.ts` (new) — `POST /v1/webhooks/payments/{provider}`, the second anonymous surface after the events board, mounted from `routes/index.ts` and **not** under `routes/public/`.
- `apps/api/src/routes/me/billing.ts` — gains `POST /v1/me/billing/checkouts` and `GET /v1/me/billing/checkouts/{id}`; the statement gains a `pendingCheckout` per receivable. `routes/admin/billing.ts`, `routes/admin/events.ts` (charges) — gain `POST …/checkouts` on behalf of a student and the gateway refund path behind the existing `reverse` routes.
- `apps/api/src/jobs/reconcile-payments.ts` (new) + `apps/api/src/index.ts` — the daily `scheduled()` run gains a fourth job, in its own `finally`, recorded in `job_runs`.
- `apps/api/src/container.ts` — a `payments: PaymentsContext` group (gateway registry, repository, service) and a per-user `checkouts` rate limiter plus an IP-keyed `webhooks` limiter in `infra.rateLimiters`.
- `apps/api/wrangler.jsonc`, `apps/api/.dev.vars.example`, `worker-configuration.d.ts` — var `PAYMENTS_PROVIDERS` in every `env.*` block; secrets `PAYMENTS_<PROVIDER>_SECRET_KEY`, `PAYMENTS_<PROVIDER>_WEBHOOK_SECRET`, one pair per enabled provider.
- `config/deployment.schema.jsonc`, `scripts/cloudflare/provision-label.mjs`, `scripts/label.mjs` — each provider's two secrets declared under `api-secrets` with a `requiredWhen` on the provider list, detected by name, never written (RFC 0012 contract); `infra-check` reports them with their fix command.
- `apps/web/src/app/(protected)/settings/billing/*` (Pay button, the provider choice when a label offers more than one, return page state), `(protected)/dashboard/*` (a *payment due* card with the same Pay action when a contract invoice is open — §7, R11), `(protected)/admin/billing/*` (provider reference on the ledger, "pending online payment" on roster and statement, refund confirmation), `src/lib/me-billing-api.ts`, `admin-billing-api.ts`, `src/i18n/dict-{en,pt}.ts`.
- `docs/onboarding.md`, `docs/operations/payments.md` (new) — webhook registration per label and environment, sandbox credentials, the reconciliation runbook.
- **Unchanged, deliberately:** every content route, `middleware/auth-guard.ts`, `d1-enrollment-repository.ts`, the catalog gate. Paying grants nothing and not paying revokes nothing (RFC 0013 #2).

---

## Summary

ArenaQuest knows what a student owes — RFC 0013's contract invoices and RFC 0015's event
charges — but cannot take the money: every payment is typed in by an admin after it arrived
in the instructor's bank. This RFC adds a **payment gateway as a collector**. A student
opens their statement, presses *Pay* on an open invoice or event charge, and is sent to the
provider's **hosted checkout** (Pix or card); when the provider confirms, a verified webhook
makes the API read the payment back from the provider and land it through the **existing**
`recordPayment` path as an ordinary ledger row with `method = 'gateway'` and the provider's
payment id in `external_reference`. A refund is an ordinary reversal. The single most
important consequence is where the truth stays: **the ledger remains the source of truth and
the subscription engine remains ours** — the provider never issues a charge ArenaQuest did
not already issue, never learns about contracts, and never becomes the place where "did
this student pay?" is answered. Everything new is additive: one pending-checkout table keyed
on the rail-tagged receivable `(kind, id)` from `receivable.ts`, one provider-event table for
webhook de-duplication, one system actor row so machine-written payments satisfy
`recorded_by NOT NULL`, and two partial unique indexes so a retried webhook cannot record the
same money twice. The first adapter is Mercado Pago (R7); the design holds for any
of the four candidates surveyed because the webhook is treated as a *trigger* and the payment is
always **fetched back** from the provider's API before a single row is written. A tenant is
not tied to one provider either: each label and environment lists the providers it enables
and the methods each offers, so a dojo can combine, say, Pix through one provider with card
through another (§8.1).

## Motivation

RFC 0013 built the ledger before the gateway on purpose ("a provider adopted before a ledger
exists tends to *become* the ledger", Alternative 4) and reserved `'gateway'` in the
`payments.method` CHECK for this day (#9). RFC 0015 listed "checkout / payment gateway" as a
Non-Goal and pointed here. M19 closed as Implemented on 2026-11-06 and has run on budo
production since 2026-10-11; the record exists and the one thing missing is the money
arriving through it.

| Case | Covered today? | Covered by this RFC? |
|---|---|---|
| A student reads "R$ 180,00 due on the 10th" on `/settings/billing` and wants to pay it right there | No. The statement is read-only (`GET /v1/me/billing`); the student pays by Pix to the instructor's own account, who later types it in. | **Yes.** *Pay* creates a checkout for the balance and sends the student to the provider's hosted page; Pix and card. |
| A seminar fee (RFC 0015 event charge) paid online | No. RFC 0015 defers to this RFC. | **Yes.** The same *Pay*, against an event charge, through `receivable.ts`'s `(kind, id)`. |
| A tenant wants Pix through one provider and card through another, or to add a second provider later without a migration | N/A | **Yes.** Each label and environment lists the providers it enables and the methods each offers; the student chooses on *Pay* (§8.1). |
| A student with a monthly fee to pay lands on the dashboard, not on the statement | Only the standing notice, a line of text linking to the statement. | **Yes.** The dashboard shows a *payment due* card for each open contract invoice with the same *Pay* action (§7). |
| The instructor wants to send a student a payment link over WhatsApp instead of their bank's Pix key | No. | **Yes.** An admin creates a checkout on the student's behalf and copies its URL; the student still pays, nothing is charged for them. |
| The admin refunds a student who paid twice | Only by writing a reversal *and* refunding by hand in the bank. | **Yes.** Reversing a `gateway` payment asks the provider to refund first and writes the reversal when the provider accepts. |
| A card payment is disputed weeks later | N/A — no card payments exist. | **Yes.** A lost dispute lands as a negative gateway row; an opened one raises an admin alert. |
| A webhook arrives twice, out of order, or for a payment nobody started | N/A | **Yes.** Event-id de-duplication plus a unique provider reference on the ledger; an unknown payment is recorded as an orphan for the admin and never lands as money. |
| The monthly fee charged automatically to a saved card | No. | **No.** Non-goal: nothing is charged without the student's action (Alternative 4). |
| A storefront, creator revenue splits, Stripe Connect payouts | No. | **No.** Out of scope; an earlier unmerged draft (see References) bundled them and is superseded by this narrower RFC. |

## Goals & Non-Goals

**Goals**
- **Collect** an open contract invoice or event charge online, at the student's request,
  through a **hosted** checkout, with **Pix** as a first-class method for Brazilian tenants
  and card alongside it.
- **Land** every confirmed payment through the existing `recordPayment` path of the rail it
  belongs to (`payments` for invoices, `event_charge_payments` for event charges), as
  `method = 'gateway'` with the provider's payment id in `external_reference`, written by a
  system actor. Rails stay apart (RFC 0015 Resolved #5).
- **Refund** as a reversal, initiated by the admin from the ledger, confirmed by the
  provider; chargebacks and provider-side refunds land through the same webhook.
- **Idempotency end to end**: at most one live checkout per receivable, one row per provider
  event id, and one ledger row per provider payment or refund id — enforced by indexes, not
  by code paths remembering to check.
- **Fetch-to-confirm**: a webhook body is never the source of an amount, a currency or a
  status. It names a payment; the API reads that payment from the provider and lands what the
  provider says.
- **PCI scope stays at SAQ A.** Card data is entered only on the provider's pages. The Worker
  never sees a PAN, CVC or expiry, and the web app loads no provider SDK.
- **Per label, per environment** credentials, detected by name by the provisioner like
  `RESEND_API_KEY`, never in argv, a log line or a repository file; staging runs on the
  provider's sandbox and the adapter refuses a live key on staging and a test key on
  production.
- **Combinable methods per tenant.** A label and environment may enable more than one
  provider and say which methods each offers; the student chooses among them on *Pay*, and a
  receivable still has at most one live checkout (§8.1).
- **Operability**: the daily run expires stale checkouts, recovers payments whose webhook
  never arrived, and records itself in `job_runs`; the admin sees pending online payments on
  the roster and statement and the provider reference on every gateway ledger row.
- **No new dependency.** The provider client is a `fetch` wrapper; signatures are verified
  with Web Crypto. The no-external-auth-deps rule extends to payments.

**Non-Goals**
- **Gating access on payment.** No `402`, no middleware on content routes, no read-only mode.
  RFC 0013 #2 is a product decision and this RFC does not reopen it.
- **The provider as subscription engine.** No Stripe Billing, no Mercado Pago *Suscripciones*,
  no provider-side invoices or customer portal. Contracts, periods, amendments, pauses and
  grace live in ArenaQuest; the provider is handed one amount to collect (Alternative 1).
- **Automatic charging.** No saved payment method charged off-session, no autopay, no "retry
  the card on the due date". A payment begins with a student (or an admin on their behalf)
  creating a checkout. Deferred to its own RFC, with a mandate design (Alternative 4).
- **Card data on the platform**, embedded card forms or the provider's JavaScript SDK
  (Alternative 3).
- **Fiscal documents** (NF-e, receipts with legal force) and **statutory bookkeeping**, as in
  RFC 0013.
- **Storefront products, creator revenue splits, Connect-style payouts** (Alternative 5).
- **Reconcile-only mode** — reading the dojo's bank statement to match Pix transfers against
  invoices (Alternative 2).
- **Partial payments chosen by the student.** A checkout is always for the receivable's
  full open balance; what *can* differ from that is settled in R14 (§5).
- **Splitting one receivable across methods.** Combining is about what a tenant *offers*. A
  checkout still collects the full open balance through one provider; half by Pix and half
  by card is not a case here.
- **A configuration screen.** Which providers and methods a tenant offers is deployment
  configuration set by the operator and validated before a deploy (§8). An admin page that
  shows or narrows that list is a follow-up; pasting provider keys into the backoffice is
  out of scope.
- **Multi-currency and crypto collection.** The adapter offers only currencies the provider
  can settle; BRL is the only active currency today (RFC 0013 #4).
- **Payer accounts outside the tenant.** A checkout belongs to a `users` row: the student who
  owes the receivable. Anonymous purchase is not a case here (every receivable already names
  its student).
- **A dunning sequence or new reminder e-mails.** The two existing reminders may carry a
  *Pay* link once Phase 4 ships (R11), nothing more.

## Current State (for reference)

**The landing point exists and is unused.** `payments.method` admits `'gateway'` and
`payments.external_reference` is documented as "receipt no. today; gateway charge id later"
(`apps/api/migrations/0026_create_billing_tables.sql`, table `payments`); the twin table
`event_charge_payments` has the same two columns (`0028_create_event_charges.sql`). No row on
any deployed database carries `method = 'gateway'`.

**`recordPayment` assumes a human actor.** `BillingService.recordPayment(invoiceId, command,
actorId)` (`apps/api/src/core/billing/billing-service.ts:1037`) writes `recordedBy: actorId`;
`EventChargeService.recordPayment` does the same for charges. Both tables declare
`recorded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT`. A webhook has no
logged-in user. SQLite cannot drop a `NOT NULL` without rebuilding the table, and these are
the two append-only money tables (R8).

**Nothing is unique on `external_reference`.** Both payment tables index `invoice_id` /
`charge_id` and have a partial unique index on `reverses_id` only. Two inserts with the same
provider id are accepted today; a retried webhook would double-record (R9).

**Reversals copy the original reference.** `reversePayment` writes
`externalReference: original.externalReference` (`billing-service.ts:1115`,
`event-charge-service.ts`), and `recordPayment` refuses `amountMinor <= 0`. A gateway refund
therefore cannot be expressed through those two methods as they stand: the reversal would
collide with the original on any reference index, and a partial refund has no entry point.

**The receivable is already one shape.** `packages/shared/domain/billing/receivable.ts`
tags every invoice and event charge with `rail`, `kind` and `id`, computes `balanceMinor`,
and `resolveRailStanding` throws on a mixed-rail input. A checkout keyed on `(kind, id)`
reaches both rails through one flow without a join across them.

**`/v1/me/billing` is GET-only and self-only by construction.** `routes/me/billing.ts`
declares no request at all; the subject is the token's `sub`. A *Pay* action needs a route
that names a receivable, so ownership must be checked rather than assumed (R11).

**One anonymous surface exists, and it is a precedent.** `/v1/events` is mounted from
`routes/index.ts:90` with the comment "Anonymous by design — mounted here rather than inside
`buildPublicRouter`, whose routes all carry `authGuard`"; `middleware/optional-auth.ts` is the
one middleware that never rejects; the router meters first (`KvRateLimiter`, keyed on
`CF-Connecting-IP`, 60 rpm) and resolves identity second. A webhook differs again: it
authenticates with a **signature**, not a token, and must reject rather than degrade (R12).

**Secrets follow RFC 0012.** `config/deployment.schema.jsonc` declares `api-secrets`;
`RESEND_API_KEY` is `required: false, requiredWhen: "MAIL_DRIVER=resend"`;
`provision-label.mjs#externalSecretNames` filters on that condition and `--check` reports
each name with `scripts/create-secrets.sh <NAME> --env <label>-<env>` as the fix. Previews
get no Worker secrets at all (RFC 0021). `WEB_BASE_URL` is already the base for activation
and OAuth return links (`container.ts:450`).

**Something periodic already runs.** `apps/api/src/index.ts#scheduled` runs billing, the
submission sweep and the mission reconcile daily, each in its own `finally`, recorded in
`job_runs` (migration 0032) whose `job` CHECK names `billing` and `sweep_submissions` only.

**Money parsing.** Every amount in the codebase is an integer in minor units against
`currencies.exponent`; `format-money.ts` renders with `style: 'decimal'`. No code path parses
a decimal money string, which at least one candidate provider returns (`transaction_amount:
180.5`).

**Provider landscape, as read on 2026-11-16.** Stripe's Pix documentation states that for
businesses based in Brazil, Pix is **invite-only**; Checkout supports `pix` in
`payment_method_types` with BRL line items and signs webhooks (`Stripe-Signature`,
HMAC-SHA256 over `${t}.${rawBody}`). Mercado Pago Checkout Pro offers Pix and card natively
in Brazil, signs notifications with `x-signature` (`ts=…,v1=…`, validated with `x-request-id`
and `data.id`), and its documentation notes that **QR-code notifications cannot be verified
with the secret signature**. Asaas offers Pix and boleto and does **not** sign payloads: it
sends a chosen `authToken` in the `asaas-access-token` header. Pagar.me's webhook and Pix
documentation did not surface in the check and is **unverified**. See References.

## Proposed Design

### 0. Vocabulary

- **Receivable** — an invoice or an event charge, as `receivable.ts` tags it:
  `{ rail, kind, id, userId, balanceMinor, currency, status }`.
- **Checkout** — one attempt to collect one receivable's open balance through the provider's
  hosted page. **Not money.** Money is a row in `payments` or `event_charge_payments`.
- **Provider payment** — the provider's own record of a captured payment (Stripe
  PaymentIntent, Mercado Pago payment, Asaas payment). Its id, qualified by its provider as
  `<provider>:<id>`, is what lands in `external_reference` (§2).
- **Provider event** — one webhook delivery, identified by the provider's event or
  notification id. A trigger to go and look, never a fact in itself.
- **System actor** — the `users` row that satisfies `recorded_by` on machine-written ledger
  rows.

### 1. The port (`packages/shared/ports/i-payment-gateway.ts`)

```ts
export interface CreateCheckoutRequest {
  /** gateway_checkouts.id — also the provider idempotency key and the metadata back-reference. */
  checkoutId: string;
  amountMinor: number;
  currency: string;                        // already checked against the capability table
  description: string;                     // "Mensalidade 2026-11" · "Seminário de verão"
  payer: { id: string; email: string; name: string };
  methods: ReadonlyArray<'pix' | 'card' | 'boleto'>;
  returnUrls: { success: string; cancel: string };
  /** Hard expiry the adapter must pass on; the reconcile job expires on it too. */
  expiresAt: string;
}

export interface ProviderPayment {
  id: string;                              // the id that lands in external_reference
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'refunded' | 'disputed';
  amountMinor: number;                     // converted at the adapter boundary (gateway-money.ts)
  currency: string;
  method: 'pix' | 'card' | 'boleto' | 'other';
  paidAt: string | null;
  /** Our checkout id, read back from the provider's metadata / external_reference field. */
  checkoutId: string | null;
  refunds: ReadonlyArray<{ id: string; amountMinor: number; createdAt: string }>;
}

export type ProviderEvent =
  | { kind: 'payment'; eventId: string; paymentId: string; occurredAt: string }
  | { kind: 'refund'; eventId: string; paymentId: string; refundId: string; occurredAt: string }
  | { kind: 'dispute'; eventId: string; paymentId: string; outcome: 'opened' | 'won' | 'lost'; occurredAt: string }
  | { kind: 'ignored'; eventId: string; type: string };

export interface IPaymentGateway {
  readonly provider: 'stripe' | 'mercadopago' | 'asaas' | 'pagarme';
  createCheckout(req: CreateCheckoutRequest): Promise<{ sessionId: string; url: string; expiresAt: string }>;
  getPayment(paymentId: string): Promise<ProviderPayment | null>;
  /** Locate the payment(s) a checkout produced when no webhook named one — reconciliation. */
  findPaymentsForCheckout(sessionId: string): Promise<ProviderPayment[]>;
  refund(paymentId: string, amountMinor: number, idempotencyKey: string): Promise<{ refundId: string }>;
  /**
   * Verify and parse one delivery. `null` means "not authentic": the router answers 401 and
   * writes nothing. Must run on the raw bytes, never on re-serialised JSON.
   */
  verifyWebhook(rawBody: string, headers: Headers, query: URLSearchParams): Promise<ProviderEvent | null>;
}
```

Three rules make the port safe across providers:

1. **The webhook is a trigger.** `verifyWebhook` yields *ids*. Amount, currency, status and
   the checkout back-reference come only from `getPayment`, over an authenticated call the
   adapter makes with the secret key. A provider whose notification cannot be signed (Mercado
   Pago's QR-code case, Asaas's token-only header) is therefore no weaker on money: a forged
   body can at most make the API look up a payment id, and an unknown or unpaid id lands
   nothing.
2. **Money crosses the boundary as integers.** `gateway-money.ts#decimalToMinor('180.50',
   2)` parses the provider's decimal string character by character against the currency's
   exponent and throws on more fraction digits than the exponent allows; no `parseFloat`
   anywhere. Stripe amounts are already minor units and pass through unchanged. Both paths
   are unit-tested with fixtures recorded from the sandbox.
3. **The capability table is data.** `gateway-money.ts` exports, per adapter, which
   currencies may be charged and which methods may be offered; `createCheckout` is refused
   (`409 PAYMENTS_UNSUPPORTED_CURRENCY`) before the provider is called when the tenant's
   active currency is not in it. BRL with `pix` and `card` is the only row every candidate
   fills.

Adapters are held in a **`GatewayRegistry`** (`core/payments/gateway-registry.ts`), built per
request from `PAYMENTS_PROVIDERS` and resolved by provider name (§8.1). With `none` (the
default, and what previews and the arenaquest label run) the registry is empty: the student
routes and the webhook return `404`, so the feature is invisible rather than broken.

### 2. Schema (migration `00NN_create_payment_gateway.sql`, additive)

```sql
-- The system actor. Satisfies recorded_by NOT NULL REFERENCES users(id) on both payment
-- tables (R8). status 'system' is a new value in a column with no CHECK, so
-- no rebuild; it is not UserStatus.ACTIVE, so auth-service.ts:44 refuses it a login. The
-- empty password hash can never verify; the .invalid TLD can never receive mail. It holds
-- no role row, so it passes no requireRole anywhere.
INSERT OR IGNORE INTO users (id, name, email, password_hash, status)
VALUES ('system:payment-gateway', 'Payment gateway', 'payment-gateway@system.invalid', '', 'system');

-- One attempt to collect one receivable. NOT money (RFC 0013 #9: "a pending charge would
-- live in its own table"). The receivable is receivable.ts's (kind, id), so both rails are
-- payable through one flow without a join across them.
CREATE TABLE IF NOT EXISTS gateway_checkouts (
  id                   TEXT NOT NULL PRIMARY KEY,
  provider             TEXT NOT NULL CHECK (provider IN ('stripe','mercadopago','asaas','pagarme')),
  receivable_kind      TEXT NOT NULL CHECK (receivable_kind IN ('invoice','event_charge')),
  receivable_id        TEXT NOT NULL,
  -- The student who owes it; RESTRICT like every money-adjacent FK (RFC 0013 §1).
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Who pressed the button: the student, or an admin creating a link on their behalf.
  created_by           TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- The balance at creation; what we asked the provider to collect.
  amount_minor         INTEGER NOT NULL CHECK (amount_minor > 0),
  currency             TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  status               TEXT NOT NULL CHECK (status IN ('open','paid','expired','cancelled','failed','mismatch')),
  provider_session_id  TEXT,                        -- the hosted session / preference id (bare)
  provider_payment_id  TEXT,                        -- set when a payment is confirmed (bare)
  -- Exactly one of these is set on a 'paid' row, and it matches receivable_kind.
  invoice_payment_id   TEXT REFERENCES payments(id) ON DELETE RESTRICT,
  charge_payment_id    TEXT REFERENCES event_charge_payments(id) ON DELETE RESTRICT,
  checkout_url         TEXT NOT NULL,
  expires_at           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at            TEXT,
  failure_detail       TEXT,                        -- provider status / mismatch description; never a body
  CHECK (NOT (invoice_payment_id IS NOT NULL AND charge_payment_id IS NOT NULL)),
  CHECK (receivable_kind <> 'invoice'      OR charge_payment_id  IS NULL),
  CHECK (receivable_kind <> 'event_charge' OR invoice_payment_id IS NULL)
);
-- At most one live attempt per receivable: a second Pay returns the open session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_checkouts_one_open
  ON gateway_checkouts(receivable_kind, receivable_id) WHERE status = 'open';
-- Provider ids are unique per provider, not globally: a label may bind several (§8.1).
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_checkouts_session
  ON gateway_checkouts(provider, provider_session_id) WHERE provider_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_checkouts_payment
  ON gateway_checkouts(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gateway_checkouts_user ON gateway_checkouts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_gateway_checkouts_expiry ON gateway_checkouts(expires_at) WHERE status = 'open';

-- Webhook de-duplication and audit. Providers deliver at least once; the event id is the
-- key. A row is written only AFTER the signature verified: an unauthentic delivery leaves
-- no trace here (it would let a stranger fill the table) and is counted in the rate
-- limiter only.
CREATE TABLE IF NOT EXISTS gateway_events (
  provider             TEXT NOT NULL,
  event_id             TEXT NOT NULL,
  type                 TEXT NOT NULL,
  provider_payment_id  TEXT,
  checkout_id          TEXT REFERENCES gateway_checkouts(id) ON DELETE RESTRICT,
  received_at          TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at         TEXT,
  outcome              TEXT NOT NULL CHECK (outcome IN ('applied','duplicate','ignored','orphan','mismatch','failed')),
  attempts             INTEGER NOT NULL DEFAULT 1,
  error                TEXT,                        -- message, truncated to 1024 chars; never a body
  PRIMARY KEY (provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_gateway_events_failed ON gateway_events(received_at) WHERE outcome = 'failed';

-- The money-level idempotency (R9). One ledger row per provider payment or
-- refund id, on each rail. The reference is written '<provider>:<id>', so ids from two
-- providers bound to the same label can never collide (§8.1). Partial: admin-typed rows keep external_reference free-form
-- (a receipt number may legitimately repeat), and NULL never collides.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_gateway_reference
  ON payments(external_reference) WHERE method = 'gateway';
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_charge_payments_gateway_reference
  ON event_charge_payments(external_reference) WHERE method = 'gateway';
```

Plus a rebuild of **`job_runs`** (operational, not money; migration 0032) so its `job` CHECK
reads `('billing','sweep_submissions','reconcile_payments')`. `job_runs` rows carry counts
only, so the twelve-step rebuild copies them verbatim.

Design notes:

- **Why two nullable FKs rather than one untyped `payment_id`.** The two rails have two
  payment tables, and a column that may point into either cannot be a foreign key. Two
  columns with three CHECKs keep referential integrity and make "which rail landed this" a
  constraint rather than a convention.
- **`status = 'mismatch'`** is a checkout whose provider payment came back `paid` with a
  currency other than the checkout's, or whose metadata named a checkout that does not exist
  for that receivable. **Nothing lands.** The row is the admin's to-do (§7).
- **The partial index is `WHERE method = 'gateway'` only**, not `AND reverses_id IS NULL`,
  because §5 gives every gateway reversal its own reference — the provider's **refund id** —
  rather than copying the original's. One index then covers charges, refunds and
  chargebacks alike. The existing `idx_*_one_reversal` keeps "at most one reversal per
  payment" for the full-refund case.
- **References are provider-qualified.** A label may bind more than one provider (§8.1), and
  two providers can issue the same bare id. Every gateway `external_reference` is therefore
  written as `<provider>:<id>` — `mercadopago:1327…`, `stripe:pi_3Q…`, and the same for
  refund and dispute ids — so the one partial index stays correct however many providers a
  label enables. The ledger tab strips the prefix for display and uses it to pick the
  dashboard link and, on a reversal, the adapter that refunds.
- **Why not a `gateway_customers` table.** Hosted checkout does not need a provider
  customer object; the payer's e-mail and name go on the session. A customer object is the
  seam for saved payment methods, which is Alternative 4's RFC, not this one.

### 3. Creating a checkout (`POST /v1/me/billing/checkouts`)

```ts
// request                                   // response 201 (or 200 when an open one is reused)
{ kind: 'invoice' | 'event_charge', id,      { checkoutId, provider, url, expiresAt, amountMinor, currency,
  provider? }                                  status: 'open' }
```

`GatewayService.createCheckout({ kind, id, provider? }, { userId, createdBy })`:

1. **Feature gate and provider.** `PAYMENTS_PROVIDERS = none` → `404`: the route does not
   exist for a tenant without a provider. `provider` may be omitted when exactly one provider
   offers a method; when several do it is required, and a missing one, or one that offers
   nothing on this label, is `400 PAYMENT_PROVIDER_REQUIRED` (§8.1).
2. **Resolve the receivable** through the rail's repository (`getInvoiceWithBalance` /
   `getChargeWithBalance`) into a `Receivable`. Not found, or `receivable.userId !== userId`
   → `404` (never `403`: a student must not learn that another student's invoice id exists).
3. **Payable?** `status !== 'open'` or `balanceMinor <= 0` → `409 RECEIVABLE_NOT_PAYABLE`.
   Currency not in the adapter's capability table → `409 PAYMENTS_UNSUPPORTED_CURRENCY`.
4. **One live attempt.** An `open` checkout for `(kind, id)` whose `expires_at > now`, on the
   provider resolved in step 1, is returned as-is with `200`. An expired one is closed
   (`status = 'expired'`) first. An open one on a **different** provider is closed as
   `cancelled` first — the student changed how they want to pay — and a new one is created
   (§8.1).
5. **Create** the row with `status = 'open'` and a placeholder URL, *then* call
   `gateway.createCheckout` — the methods being those this label enabled for that provider —
   with `checkoutId` as the idempotency key and metadata, *then*
   write `provider_session_id`, `checkout_url`, `expires_at`. If the provider call fails the
   row is set to `failed` — the unique index released — and the route answers `502
   PAYMENTS_PROVIDER_ERROR`. Row-first means a crash between the two calls can never leave a
   provider session we do not know about; the reconcile job finds the orphan row instead.
6. **Expiry** is the provider's maximum for hosted sessions, capped at 24 h (Pix QR codes
   are short-lived by nature; a card session rarely survives a day).
7. **Rate limit** per user, `rl:checkouts:<userId>`, 10 per hour: one Pay per minute is
   generous, and a loop of create-and-abandon is what it stops.
8. **Audit** one `payments.checkout_created` structured event, ids only.

**Return URLs** are `${WEB_BASE_URL}/settings/billing?checkout=<id>&outcome=success` and
`…&outcome=cancel`. The web page treats the query string as a *hint only*: on return it calls
`GET /v1/me/billing/checkouts/{id}` (self-only: a checkout whose `user_id` is not the caller
is `404`) and renders the row's status — `open` becomes "payment processing" (a Pix may be
confirmed minutes after the redirect), `paid` becomes the updated statement. A forged
`outcome=success` shows nothing a `GET /v1/me/billing` would not.

**On behalf of a student (admin).** `POST /v1/admin/billing/invoices/{id}/checkouts` and
`POST /v1/admin/events/{eventId}/charges/{chargeId}/checkouts`, behind the billing router's
`requireRole(ADMIN)`, call the same service with `createdBy = admin` and `userId = the
receivable's owner`, and take the same optional `provider`. The response is the URL the admin copies into WhatsApp. The student
pays; nothing is charged to anyone. This ships in v1 (R11).

### 4. The webhook (`POST /v1/webhooks/payments/{provider}`)

Mounted from `routes/index.ts` as `v1.route('/webhooks', buildWebhooksRouter(container))`,
beside `/events`, **not** under `routes/public/` — that directory means "authenticated
non-admin", and this surface is anonymous *and* must reject, which is a third posture, not
a flag on either existing one. The router's pipeline, in order:

1. **Meter.** `KvRateLimiter` keyed on `CF-Connecting-IP`, 120 rpm — providers burst on
   retry storms and the limit exists to bound CPU spent on signature checks, not to
   authenticate. Over budget → `429`, nothing read.
2. **Bound the body.** `Content-Length` above 64 KiB → `413`, nothing read. Providers' events
   are a few KiB.
3. **Route by `{provider}`.** The registry resolves the adapter for the path's provider; a
   provider this label and environment has not bound → `404`. Each bound provider has its
   own URL and its own webhook secret, so one provider's delivery is never verified with
   another's key (§8.1).
4. **Verify on raw bytes.** `await c.req.text()` once; `gateway.verifyWebhook(raw, headers,
   query)`. `null` → `401`, **no `gateway_events` row, no log line containing the body**, one
   counter. Signed providers enforce the timestamp tolerance of **5 minutes** inside the
   adapter (Stripe's `t`, Mercado Pago's `ts`); the token provider (Asaas) compares with a
   constant-time function. This is also the **replay window**: an authentic delivery replayed
   after five minutes is `401`; one replayed within it is a `duplicate` by event id.
5. **De-duplicate.** `INSERT … ON CONFLICT DO NOTHING` into `gateway_events`; `meta.changes
   === 0` → `200 { outcome: 'duplicate' }`. A `kind: 'ignored'` event is recorded as `ignored`
   and answered `200`.
6. **Fetch-to-confirm.** `gateway.getPayment(paymentId)`; `null` → `orphan`, `200`. The
   provider payment's `checkoutId` must name a row whose `provider_session_id` or prior
   `provider_payment_id` agrees and whose `provider` is the path's; otherwise `orphan`, `200`,
   admin alert (§7). Mismatched
   currency → checkout `mismatch`, event `mismatch`, `200`, alert. **Nothing lands in either
   case.** Always `200` once verified, so the provider stops retrying something we have
   recorded as ours to resolve.
7. **Land** (§5) inside one `db.batch` with the `gateway_events` update to `applied` and the
   checkout's flip to `paid`. A unique-constraint failure on the ledger index means another
   delivery landed it first: outcome `duplicate`, `200`.
8. **Our own failure** (D1 unavailable, provider API 5xx on the fetch) → `gateway_events.outcome
   = 'failed'`, `503`, so the provider retries; the reconcile job also retries (§6).

The handler sets `Cache-Control: no-store`, never sets `user` on the context, and is the only
router that reads the raw body. It carries no CORS semantics worth having — the global
middleware is harmless to a server-to-server POST — and `OPTIONS` is irrelevant to it.

### 5. Landing money, refunds and disputes

**A paid provider payment** lands through the rail's service: `BillingService.
recordGatewayPayment(invoiceId, { amountMinor, currency, paidAt, externalReference:
'<provider>:' + payment.id })` or the `EventChargeService` twin. Each is a sibling of `recordPayment` that
(a) fixes `method = 'gateway'` and `recordedBy = SYSTEM_ACTOR_ID`, (b) refuses to be called
with any other method, and (c) runs the same guards — positive amount, non-void receivable,
currency equal to the receivable's. The amount landed is **what the provider captured**, not
the checkout's `amount_minor`: if an adjustment changed the balance between Pay and
confirmation, the ledger must still say what was received (R14). The
`REFRESH_INVOICE_STATUS` batch step flips the invoice to `paid` when the balance reaches
zero exactly as it does for a cash payment; a `payments.gateway_landed` audit event carries
ids only. The checkout gets `status = 'paid'`, `provider_payment_id`, and the matching
`*_payment_id`. A payment confirmed for a checkout that is already `expired` or `cancelled`
lands all the same — the money was received — and that checkout becomes `paid`.

**An admin refund** is `POST /v1/admin/billing/payments/{id}/reverse` (and the charges
twin) on a row whose `method = 'gateway'`: the service resolves the adapter from the reference's
provider prefix (not bound on this label any more → `409 PAYMENTS_PROVIDER_NOT_ENABLED`,
nothing written, §8.1), then calls `gateway.refund(paymentId,
original.amountMinor, idempotencyKey = 'rev:' + original.id)` and, when the provider
*accepts*, writes the reversal with `reverses_id = original.id`, `method = 'gateway'` and
`external_reference = refundId`. A provider refusal (already refunded, funds unavailable) is
`409 PAYMENTS_REFUND_REFUSED` and writes nothing. The refund webhook that follows finds its
refund id already on the ledger and records `duplicate`. Full amount only through this route
(RFC 0013's reversal is a mirror row); a partial refund is made in the provider's
dashboard and lands as below (R14).

**A refund made in the provider's dashboard** (full or partial) arrives as a `refund` event.
Fetch-to-confirm yields the payment's `refunds[]`; each refund id not yet on the ledger is
written as a **negative gateway row with `reverses_id = NULL`** and `external_reference =
refundId` — money that left, keyed on the provider's own id. The balance arithmetic
(`amount + Σ adjustments − Σ payments`) needs nothing else. A full refund made this way is
*also* recorded with `reverses_id = NULL`, because "one reversal per payment" and "the
mirror row" are RFC 0013 invariants for the *admin* path; a dashboard refund is reported as
such on the ledger (`note = 'provider refund <id>'`).

**Disputes.** `dispute: opened` → checkout `failure_detail = 'dispute opened'`, admin alert,
**no ledger write** (the money is still ours until the provider says otherwise). `lost` →
a negative gateway row keyed on the dispute id, like a dashboard refund. `won` → alert
only. On the **contract rail**, an opened dispute also sets a `billing_standing_hold` with
reason "payment under dispute" ("stop chasing this one — a payment is being verified" is
RFC 0013's own example of the hold), written by the system actor and released when the
dispute closes, `won` or `lost`; an admin may lift it earlier. An event charge never gets a
hold (RFC 0015 #9): its dispute is the alert and the exceptions row only (R14).

### 6. The daily run (`jobs/reconcile-payments.ts`)

A fourth job in `scheduled()`, in its own `finally`, recorded in `job_runs` as
`reconcile_payments`, counts only:

1. **Expire** `open` checkouts past `expires_at` — after one `findPaymentsForCheckout` each,
   on the checkout's own provider:
   a payment the provider reports `paid` whose webhook never arrived is landed exactly as
   §5 would (idempotent on the reference index), then the checkout is `paid`; otherwise
   `expired`. Batches of 100. A checkout whose provider is no longer bound cannot be asked
   about: it is expired without a fetch, counted as `unreachable`, and a non-zero count
   records the run as `failed` (§8.1 says how to retire a provider without this).
2. **Retry** `gateway_events` with `outcome = 'failed'`, `attempts < 5`, older than one hour:
   re-run step 6–7 of §4; increment `attempts`.
3. **Sweep orphans.** `orphan` and `mismatch` events older than 7 days with no admin
   resolution stay — they are a report, not garbage — but the count is in the summary so a
   growing number shows up in the ops digest.
4. **Confirm the key mode** of every bound provider once per run (test key on production /
   live key on staging →
   `failed` run with a clear error), so a mis-provisioned secret is noticed within a day
   even if no student pays.

`POST /v1/admin/billing/payments/reconcile` (admin) runs the same job on demand, like the
missions reconcile, and `GET /v1/admin/billing/payments/exceptions` lists `orphan`,
`mismatch`, `failed` and disputed rows with their provider ids for the admin to resolve.

### 7. What the admin and the student see

**Ledger tab.** A gateway row shows method *Online*, the provider's payment or refund id, and
a deep link into the provider dashboard built from a per-adapter URL template
(`https://dashboard.stripe.com/payments/{id}` style — the id is public to the merchant, not a
secret). Reversing it opens the refund confirmation ("this asks <provider> to return R$ … to
the student; the reversal is written when the provider accepts").

**Roster and statement.** Every receivable gains `pendingCheckout: { checkoutId, provider,
createdAt, expiresAt, createdBy } | null`; the roster row shows "pending online payment" beside the
standing, and the admin statement lists it under the receivable. An admin may still record
a cash payment on a receivable with an open checkout (the student may well have paid at the
door); the form warns, and §6 then expires the checkout on its own.

**Exceptions panel.** `orphan`, `mismatch`, `failed` events and disputes, with provider ids,
oldest first, each with the action it wants: match to a receivable by hand (records through
the normal admin payment form with `method = 'gateway'` and the provider id — the partial
index protects that path too), refund, or dismiss with a note.

**Student statement** (`/settings/billing`). Each open invoice and event charge gets a *Pay*
button when at least one provider offers a method. With one such provider it goes straight to
the hosted page; with several it first asks how to pay, one choice per provider, labelled by
its methods (*Pix*, *Cartão*) and never by the provider's name alone (§8.1). The hosted page
is a link to a new tab, not an iframe. A
receivable with an open checkout shows "payment in progress · expires at …" with *Open
again*; a `paid` gateway payment shows as *Paid online* with the date. Nothing else on the
page changes, and the standing badge still gates nothing.

**Student dashboard** (`/dashboard`, R11). When the student's statement holds at least one
open **contract invoice** with a balance, the dashboard shows a *payment due* card: amount,
due date, and the same *Pay* action as the statement — same route, same provider choice,
same "payment in progress" state — plus a link to `/settings/billing`. One row per open
invoice, earliest due date first. It reads the `GET /v1/me/billing` response the standing
notice already fetches, so no new endpoint exists for it; with no open contract invoice, or
with no provider offering a method, the card is not rendered at all. Event charges stay on
the statement. Like the standing notice it is a prompt, not a gate: it hides, disables and
blocks nothing. If RFC 0008's widget dashboard lands first, the card ships as one of its
widgets rather than a fixed block.

### 8. Configuration and secrets

| Name | Kind | Per | Meaning |
|---|---|---|---|
| `PAYMENTS_PROVIDERS` | var, every `env.*` block | label × environment | `none` (default), or a comma-separated list of `provider:method+method` entries over `stripe` · `mercadopago` · `asaas` · `pagarme`. Selects the adapters and what each offers (§8.1). |
| `PAYMENTS_<PROVIDER>_SECRET_KEY` | secret | label × environment × provider | That provider's server-side key, e.g. `PAYMENTS_MERCADOPAGO_SECRET_KEY`. Sandbox/test on staging, live on production. |
| `PAYMENTS_<PROVIDER>_WEBHOOK_SECRET` | secret | label × environment × provider | Signing secret (Stripe, Mercado Pago) or the chosen auth token (Asaas). |

Provider-prefixed names, because two providers' keys must be able to sit on one Worker;
enabling a provider is a list entry and two `secret put`s. `config/deployment.schema.jsonc`
declares each pair under `api-secrets` with `required: false, requiredWhen:
"PAYMENTS_PROVIDERS~=<provider>"`; `requiredWhenActive` gains a **contains** operator, `~=`
(today it parses `NAME=value` only), true when the var's comma-separated list has an entry
for that provider, so `externalSecretNames` and `infra-check` report exactly the secrets a
label's bound providers need, the way they report `RESEND_API_KEY`. Provisioning **never
writes** any of them; the fix command is `scripts/create-secrets.sh
PAYMENTS_MERCADOPAGO_SECRET_KEY --env <label>-<env>`, which reads the value from the
terminal. Nothing reaches argv, disk or a log line (RFC 0012).

`core/payments/config.ts` parses the var at container build. A list that breaks a rule of
§8.1, or a listed provider with either secret absent, makes the payment routes answer `500
PAYMENTS_CONFIG_INVALID` — never a silent `none` (the `SUBMISSIONS_*` precedent). Each adapter
asserts **key mode against environment** on first use and in the daily run: a Stripe
`sk_live_` or a Mercado Pago `APP_USR-` key on a `*-staging` Worker, or a test-mode key on
production, is `PAYMENTS_CONFIG_INVALID`. Staging therefore collects nothing real by
construction, and the demo seed's students can walk the whole flow against the sandbox.

**Webhook registration** is an operator step in each bound provider's dashboard, per label
and environment: `https://<apiHost>/v1/webhooks/payments/<provider>`. `docs/operations/payments.md`
lists it beside the sandbox test cards and Pix simulators; `infra-check` cannot see the
provider's side and says so.

**Previews** (RFC 0021) inherit no Worker secret and set no `PAYMENTS_PROVIDERS`, so a
preview runs with an empty registry: *Pay* is absent and the webhook route is `404`.

#### 8.1 Combining providers and methods

A tenant is not tied to one provider (R6). `PAYMENTS_PROVIDERS` says, for one label and
environment, which providers are bound and which methods each one offers:

```text
none                            payments off (the default)
mercadopago:pix+card            one provider, two methods, one hosted page
mercadopago:pix,stripe:card     Pix through one provider, card through another
mercadopago:pix+card,asaas:     asaas retired: still bound, offers nothing new
```

The list is deployment configuration, written by the operator in the label's `env.*` block
and checked at container build. Any breach of the rules below is `PAYMENTS_CONFIG_INVALID`,
never a quiet fallback to fewer methods:

1. **A provider appears at most once**, and both the provider and every method must be known
   (`pix` · `card` · `boleto`).
2. **A method is offered by at most one provider.** The student chooses *how* to pay; who
   processes it must then have exactly one answer.
3. **A method must be in the provider's capability table** for the tenant's active currency
   (§1) — a list cannot enable what the adapter cannot settle.
4. **Every listed provider needs both its secrets**, including one listed with no method.
5. **An entry with no method** (`asaas:`) keeps a provider bound — its webhook URL answers, its
   past payments can be refunded, the daily run can ask it about open checkouts — while
   offering nothing new. That is how a provider is retired. Dropping the entry outright turns
   its webhook into `404`, makes a reversal of one of its payments `409
   PAYMENTS_PROVIDER_NOT_ENABLED`, and leaves its open checkouts `unreachable` (§6);
   `docs/operations/payments.md` says to keep the empty entry for as long as that provider's
   payments can still be refunded or disputed.

What combining changes in the flow, and what it does not:

- **Statements.** `GET /v1/me/billing` and the admin statement gain `payOptions: Array<{
  provider, methods }>` — the entries that offer at least one method, in list order. Empty
  means no *Pay* button.
- **Checkout.** `POST …/checkouts` takes an optional `provider`, for the student and for the
  admin acting on their behalf (§3 step 1). The adapter is handed that entry's methods, so the
  hosted page shows what the tenant enabled for that provider and nothing else.
- **Still one live checkout per receivable.** `idx_gateway_checkouts_one_open` is unchanged:
  choosing another provider while a checkout is open closes the first as `cancelled`. The
  provider's own session is not recalled — the port has no cancel — and lives until its
  expiry, so a student could still pay it. §5 lands that payment like any confirmed one; if
  both sessions end up paid, the receivable shows a credit, which is the overpayment case of
  R14 and is refunded by the admin from the ledger.
- **Never split.** A checkout collects the full open balance through one provider.
- **Everything downstream picks its adapter by provider**: the URL's `{provider}` for a
  delivery, `gateway_checkouts.provider` for a checkout, and the prefix of
  `external_reference` for a ledger row (§2). No other table changes.
- **No screen.** Changing what a tenant offers is a configuration change and a deploy. An
  admin page that shows the bound providers, or narrows the offered methods without a
  deploy, can sit on top of this list later without touching the schema.

The first milestone still ships **one** real adapter (R7). The list, the
registry and the choice on *Pay* ship with it and are proven against two stub adapters, so a
second provider is an adapter file, a list entry and two secrets — no migration.

### 9. Container, ports and roles

`container.ts` gains `payments: { gateways: GatewayRegistry; gatewayRepo: IGatewayRepository;
gatewayService: GatewayService }`, built per request like every adapter, and two limiters
(`checkouts` per user, `webhooks` per IP). `IGatewayRepository` exposes `createCheckout`,
`getCheckout`, `findOpenCheckout(kind, id)`, `closeCheckout`, `recordEvent`, `markEvent`,
`listExceptions`, `listExpiring` — plain records, no Cloudflare types. The two billing
repositories gain `findGatewayPayment(externalReference)` for the duplicate answer.

Roles are RFC 0013 #5's: `admin` alone sees or touches any of it; `content_creator` and
`tutor` see nothing; a student sees and pays only their own receivables. The webhook router
has no role at all — it has a signature.

## Alternatives Considered

1. **Let the provider be the subscription engine** (Stripe Billing, Mercado Pago
   *Suscripciones*). *Rejected.* It is the case RFC 0013 Alternative 4 was written against: the
   provider would own periods, amendments, pauses and grace, and the ledger would become a
   mirror of a vendor's objects. A dojo that records cash at the door and negotiates terms
   in person needs the engine on its side of the API.
2. **Reconcile-only: read the dojo's bank or Pix statement and match transfers to
   invoices.** *Rejected.* No candidate provider exposes the instructor's personal Pix inbox;
   an Open Finance integration is a different product, and matching free-text transfers to
   invoices is the spreadsheet RFC 0013 retired. The provider *collects*; the admin's manual
   form keeps covering money that arrived elsewhere.
3. **Embedded card form / provider JavaScript SDK in the web app.** *Rejected.* Expands PCI
   scope to SAQ A-EP, adds a front-end dependency per provider, and buys a slightly shorter
   path for the one method (card) that matters less than Pix here. Hosted checkout is also
   what makes the webhook, not the browser, the only writer.
4. **Autopay: a saved card charged off-session on the due date.** *Deferred to its own RFC,
   not rejected.* It needs a provider customer object, a mandate the student consents to,
   retry policy and a reminder story, and it crosses the product line "nothing is charged
   without the student's action". The checkout table and the system actor are its seam.
5. **Bundle a storefront, creator revenue splits and Connect payouts** (the unmerged draft
   `0019-stripe-payment-gateway-integration.md` on branch `claude/compassionate-rubin-11a6pn`,
   2026-09-29). *Rejected for this RFC.* Each is a product its own RFC should argue for; the
   draft also fixed Stripe before Pix eligibility for Brazilian merchants was checked. Its
   mechanics that survive here — row-first checkout creation, event-id de-duplication, the
   system actor — are credited in References. The branch is deleted once this RFC merges
   (R7).
6. **Rebuild `payments` and `event_charge_payments` to make `recorded_by` nullable.**
   *Rejected.* Two live append-only money tables on production, a twelve-step rebuild each,
   to remove a constraint whose whole point is that every ledger row names its author. A
   system actor keeps the constraint true and the audit column honest.
7. **Use the paying student as `recorded_by`.** *Rejected.* Zero schema, but the column
   would then mean "who caused this" on some rows and "who typed this" on others, a refund
   webhook has no student action behind it, and the admin reading the ledger would see
   students recording their own payments.
8. **Trust the webhook body for amount, currency and status.** *Rejected.* It makes the
   design only as strong as the weakest provider's signing (one candidate cannot sign its
   QR-code notifications, another does not sign at all) and ties the schema to each
   provider's payload. Fetch-to-confirm costs one authenticated `GET` per event and makes a
   forged body worth nothing.
9. **Mount the webhook under `routes/public/`, or reuse `optionalAuth`.** *Rejected.*
   `routes/public/` means "authenticated, non-admin"; `optionalAuth` degrades to anonymous
   where this router must reject. The events board already paid for the lesson that a third
   security posture gets its own mount with its own comment.
10. **Amend RFC 0013 instead of writing this RFC.** *Rejected by the owner (2026-11-06).*
    0013 #9 and Alternative 4 already prescribe a separate RFC "with a provider in hand", and
    0013 is closed as Implemented; amending a closed RFC to add an anonymous surface, two
    tables and a provider would make its status a lie.
11. **One checkout table per rail.** *Rejected.* `receivable.ts` exists precisely so the two
    rails share a shape without sharing arithmetic; one table keyed on `(kind, id)` with the
    two typed FK columns keeps the rails physically apart where it matters (the payment
    tables) and together where it is convenient (the Pay flow and the exceptions panel).
12. **A static Pix QR code on the statement, reconciled by hand.** *Rejected.* It is the
    status quo with a picture: nothing confirms the payment, the admin still types it in, and
    the key printed is the instructor's personal one.
13. **One provider per tenant** — a single `PAYMENTS_PROVIDER` var and two generic secret
    names, as the first draft of this RFC had it. *Rejected by the owner (2026-11-17).* It made
    "Pix here, card there" and "add a second provider next year" a rename across the
    provisioner plus a migration of the reference index. A list, provider-prefixed secrets
    and provider-qualified references cost a parser and a registry now, and nothing later.

## Implementation Plan

~12 dev days across six phases, each shippable behind `PAYMENTS_PROVIDERS = none`, which is
the default on every label until Phase 5 flips budo staging.

### Phase 0 — Domain, port, capability table and provider list (~2 d)
`i-payment-gateway.ts`, `i-gateway-repository.ts`, `gateway-money.ts` (`decimalToMinor`, the
capability table), entities and enums, the `PAYMENTS_PROVIDERS` parser and `GatewayRegistry`
(§8.1). Unit tests: decimal parsing against exponents 0, 2
and 8 with rejection of excess fraction digits; capability refusals; every list rule of §8.1, each as a refusal; `(kind, id)` resolution
through `receivable.ts` for both rails.

### Phase 1 — Persistence and the system actor (~1.5 d)
The migration (tables, partial indexes, system actor, `job_runs` rebuild), `D1GatewayRepository`,
`findGatewayPayment` on both billing repositories, `recordGatewayPayment` /
`recordGatewayReversal` siblings on both services. Tests prove: the system actor cannot log
in and appears in no admin user list (the list filters `status = 'system'`; the lockout
guards ignore it); a second insert with the same gateway reference fails on each rail; the
`CHECK`s refuse a cross-rail `*_payment_id`.

### Phase 2 — Adapter, webhook and landing (~3 d)
The Mercado Pago adapter (`fetch` client, `verifyWebhook` on raw bytes with the 5-minute
tolerance or constant-time compare, `getPayment` with decimal conversion), a second **stub**
adapter for the tests, `GatewayService.handleEvent`, `routes/webhooks/payments.router.ts`
with its limiter and body bound. Tests with recorded sandbox fixtures: good signature lands
once; replayed event → `duplicate`; tampered body → `401` with no row; unknown payment →
`orphan`; wrong currency → `mismatch` and no ledger row; two concurrent deliveries → one row; a
delivery on one provider's URL signed with another's secret → `401`.

### Phase 3 — Pay, admin links, refunds, reconcile (~2 d)
`POST /v1/me/billing/checkouts`, `GET …/checkouts/{id}`, the two admin on-behalf routes, the
gateway branch of both `reverse` routes, `jobs/reconcile-payments.ts`, the manual reconcile
and exceptions routes, `pendingCheckout` on the statements and roster. Tests: ownership
`404`s; one live checkout per receivable, including across two providers; `409` on a
non-payable receivable; the refund
refused by the provider writes nothing; the expiry sweep lands a missed payment.

### Phase 4 — Web (~2.5 d)
*Pay*, the provider choice when `payOptions` has more than one entry, and the return-page
state on `/settings/billing`; provider reference and deep link on
the ledger tab; refund confirmation; "pending online payment" on roster and statement; the
exceptions panel; i18n in both dictionaries; the *payment due* card on the student dashboard (§7); the two
reminder e-mails gain the *Pay* link (R11, copy only). Playwright at 390 px for the student flow against the sandbox.

### Phase 5 — Configuration, provisioning, rollout (~1 d)
`PAYMENTS_PROVIDERS` in every `env.*` block (`none` everywhere), `.dev.vars.example`, schema
`api-secrets` with `requiredWhen: "PAYMENTS_PROVIDERS~=<provider>"` per provider and the
`~=` operator in `requiredWhenActive`, `infra-check` output, `docs/operations/payments.md`. Budo **staging**
first: sandbox keys, webhook registered, a demo student pays a demo invoice by simulated Pix
and the ledger row appears with the system actor; the daily run records `reconcile_payments`
`ok`. Budo production flips only after the owner's live check with a real R$ 1,00 charge and
its refund.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| The chosen provider cannot offer Pix to this merchant (Stripe is invite-only for Brazil-based businesses as of 2026-11-16) | The first adapter is Mercado Pago (R7), whose Checkout Pro offers Pix natively in Brazil, and the port is provider-neutral; the first adapter is the one whose Pix the tenant can actually enable, and a second adapter is a new file plus a list entry, not a schema change — and it can run beside the first (§8.1). |
| A webhook is forged or replayed | Signature or token verified on raw bytes before anything is written; 5-minute tolerance; event-id primary key; **fetch-to-confirm** means a body carries no money facts; partial unique index on the ledger means even a logic slip cannot double-record. |
| A payment is confirmed but the webhook never arrives (provider outage, our 5xx exhausted retries) | The daily run asks the provider about every expiring checkout and lands what it finds; `job_runs` records the count. |
| The amount or currency captured differs from the receivable | Currency mismatch lands nothing and surfaces in the exceptions panel; an amount difference lands what was captured (truthful ledger) and the statement shows the remaining balance or the credit. |
| The system actor is mistaken for a person or counted by a guard | `status = 'system'`, no role rows, empty hash, `.invalid` e-mail; admin user lists filter it; tests pin the lockout guards and the no-dev-seed guard (which keys on `*.demo.invalid`) to ignore it. |
| A live key lands on staging, or a test key on production | Key-mode-vs-environment assertion on first use and in every daily run → `PAYMENTS_CONFIG_INVALID`; staging profiles never hold live keys by process (`docs/operations/payments.md`). |
| A student opens a checkout on a second provider and then pays both sessions | One live checkout per receivable; the first is `cancelled` on our side; a late payment on it still lands (truthful ledger) and the surplus shows as a credit the admin refunds — never a silently lost payment. |
| A provider is removed from the list while it has open checkouts or refundable payments | An entry with no method keeps it bound for webhooks, refunds and reconcile; outright removal is loud — `unreachable` fails the daily run and a reversal answers `409 PAYMENTS_PROVIDER_NOT_ENABLED`. |
| Two providers issue the same payment id | References are stored `<provider>:<id>` and the checkout id columns are unique per provider. |
| Secrets leak through argv, logs or the repository | RFC 0012 contract reused verbatim: declared by name, set through `create-secrets.sh` from the terminal, `infra-check` reports names only; the webhook handler never logs a body; `gateway_events.error` is a truncated message. |
| Decimal money from a provider is parsed with floating point | `decimalToMinor` is string-based, exponent-aware, throws on excess digits, and is the only conversion path; fixtures cover `180.5`, `180.50`, `0.01`, `1000000.00`. |
| Refund semantics drift from RFC 0013's ledger invariants | Admin refunds keep the mirror-row-plus-`reverses_id` shape; dashboard refunds and lost disputes are negative gateway rows keyed on the provider's refund or dispute id, documented as such; both are idempotent on the same index. |
| Scope creep toward autopay, storefront or splits | Each is a named Alternative with its own future RFC; the schema deliberately has no customer, product or split table. |
| The anonymous POST surface becomes a DoS vector for signature verification | IP-keyed limiter runs before the body is read; body bound at 64 KiB; `401` paths do no I/O. |
| A student creates and abandons checkouts in a loop | Per-user limiter (10/h) and one live checkout per receivable; abandoned sessions expire by the provider's clock and ours. |

## Success Criteria

- **S1 (Phase 1).** On a local replica, inserting two `payments` rows with the same
  `external_reference` and `method = 'gateway'` fails on the second; the same with
  `method = 'pix'` succeeds; the same on `event_charge_payments`. The system actor row exists,
  `POST /v1/auth/login` with its e-mail is `401`, and `GET /v1/admin/users` does not list it.
- **S2 (Phase 2).** With the sandbox fixtures: a verified `payment` event lands exactly one
  ledger row with `method = 'gateway'`, `recorded_by = 'system:payment-gateway'` and the
  provider payment id; the same event delivered three times leaves one ledger row and three
  `gateway_events` rows (`applied`, `duplicate`, `duplicate`); a tampered body is `401` and
  leaves no row anywhere; an event for an unknown payment is `200` and an `orphan`; an event
  whose payment is in another currency is `200`, a `mismatch`, and no ledger row.
- **S3 (Phase 3).** A student creating a checkout for another student's invoice gets `404`;
  for a `paid` invoice `409`; twice for the same open invoice gets the same `checkoutId`;
  with `PAYMENTS_PROVIDERS = none` the route is `404`. Reversing a gateway payment writes the
  reversal only after the provider accepts, with the refund id as `external_reference`.
- **S4 (Phase 3).** A checkout whose webhook is dropped in the test harness is landed by
  `reconcile-payments` on the next run; `job_runs` holds a `reconcile_payments` row with
  `landed: 1`.
- **S5 (Phase 4).** At 390 px a demo student on budo staging sees *Pay* on an open invoice,
  completes a simulated Pix in the sandbox, returns, sees "payment processing" then *Paid
  online*; the same invoice shows on `/dashboard` as a *payment due* card with *Pay* before
  the payment and is gone after it; the admin ledger shows the row with the provider id and a working dashboard link.
- **S6 (Phase 5).** `make infra-check-staging LABEL=budo` lists the bound provider's
  `PAYMENTS_<PROVIDER>_SECRET_KEY` and `PAYMENTS_<PROVIDER>_WEBHOOK_SECRET` as present on budo
  staging and names none for arenaquest staging (`PAYMENTS_PROVIDERS = none`, so not required); no secret value appears in any CI
  log or in `git grep`.
- **S7 (Phase 5).** Deploying budo staging with a live-mode key makes the daily run `failed`
  with `PAYMENTS_CONFIG_INVALID` and makes `POST /v1/me/billing/checkouts` answer `500`
  `PAYMENTS_CONFIG_INVALID`, not a live charge.
- **S8 (invariant).** `git diff main` touches no file under `routes/topics*`, `routes/public/`,
  `middleware/auth-guard.ts` or `d1-enrollment-repository.ts`, and no test asserting
  "delinquent student keeps access" changes.
- **S9 (Phases 0–3, combining).** In the API tests, with two stub adapters and
  `PAYMENTS_PROVIDERS = a:pix,b:card`: the statement lists two `payOptions`; a checkout
  without `provider` is `400`; choosing `b` while a checkout on `a` is open leaves exactly one
  `open` row and one `cancelled`; a late payment on the cancelled one still lands; the same
  bare payment id from `a` and from `b` lands as two ledger rows. `a:pix,b:pix`, an unknown
  method, and a listed provider missing a secret are each `PAYMENTS_CONFIG_INVALID`; with
  `a:pix+card,b:` the statement offers only `a` and a delivery for `b` is still verified.

## Open Questions

None. The nine questions this RFC opened with — numbered after the friction list of the
RFC 0013 closeout — were answered by the owner on 2026-11-18 and are recorded as R7–R15
below, in the same order.

## Resolved Decisions

| # | Decision | Date | Decider |
|---|---|---|---|
| R1 | **A new RFC, not an amendment to RFC 0013.** 0013 closed as Implemented on 2026-11-06; its #9 and Alternative 4 prescribe a separate RFC "with a provider in hand". | 2026-11-06 | Product owner |
| R2 | **The ledger stays the source of truth; the provider is a collector.** Payments land through the existing `recordPayment` path with `method = 'gateway'` and the provider id in `external_reference`; a refund is a reversal; no provider-side subscriptions, invoices or customer portal. | 2026-11-06 | Product owner |
| R3 | **Billing never gates access** (RFC 0013 #2): no `402`, no middleware on content routes, nothing in this RFC touches the catalog gate. | 2026-11-06 | Product owner |
| R4 | **Money is integer minor units against `currencies.exponent`; BRL is the only active currency.** Provider decimals are converted at the adapter boundary, string-based. | 2026-11-06 | Product owner |
| R5 | **Hosted checkout only; no card data on the platform; no fiscal documents; no automatic charging without the student's action.** | 2026-11-16 | Product owner (brief) |
| R6 | **A tenant may combine payment methods across providers.** Each label and environment lists the providers it binds and the methods each offers (`PAYMENTS_PROVIDERS`, §8.1); a method belongs to one provider, a receivable has one live checkout, a checkout is never split. Configuration is the operator's, in the deployment config — no configuration screen in this RFC. | 2026-11-17 | Product owner |
| R7 | **Charge through the provider; first adapter Mercado Pago.** ArenaQuest collects through a hosted checkout — reconcile-only stays a Non-Goal (Alternative 2). The first adapter is **Mercado Pago** Checkout Pro (Pix and card natively in Brazil, signed notifications; unsigned QR-code notifications are covered by fetch-to-confirm). The port stays provider-neutral, so a second provider is an adapter file that runs beside the first (R6). The stale branch `claude/compassionate-rubin-11a6pn` is deleted once this RFC merges. *(Open Question 1.)* | 2026-11-18 | Product owner |
| R8 | **Machine-written payments are recorded by a per-label system actor.** One `users` row (`system:payment-gateway`, `status = 'system'`, no role, empty hash, `.invalid` e-mail), inserted by the migration with `INSERT OR IGNORE`; no money table is rebuilt. *(Open Question 2.)* | 2026-11-18 | Product owner |
| R9 | **Idempotency in two layers.** `gateway_events` keyed on `(provider, event_id)` for deliveries, and a partial unique index on `external_reference WHERE method = 'gateway'` on each payment table for money. Every gateway reversal carries the **refund id**, not the original's reference, so one index covers charges, refunds and chargebacks; references are provider-qualified (`<provider>:<id>`). *(Open Question 3.)* | 2026-11-18 | Product owner |
| R10 | **One `gateway_checkouts` table.** Additive, keyed on `receivable.ts`'s `(kind, id)`, one open row per receivable, two typed nullable FKs to the rail payment tables with CHECKs, `status ∈ {open, paid, expired, cancelled, failed, mismatch}`. *(Open Question 4.)* | 2026-11-18 | Product owner |
| R11 | **The student's Pay action, and where it appears.** `POST /v1/me/billing/checkouts { kind, id, provider? }` + `GET /v1/me/billing/checkouts/{id}`; return URLs on `/settings/billing?checkout=…&outcome=…` are hints only. v1 includes (a) the **admin on-behalf** link routes, (b) the *Pay* link in the two existing reminder e-mails (copy only), and (c) — added by the owner — a ***payment due* card on the student dashboard** whenever a contract invoice is open, with the same Pay action (§7). *(Open Question 5.)* | 2026-11-18 | Product owner |
| R12 | **The webhook surface.** `POST /v1/webhooks/payments/{provider}` mounted from `routes/index.ts` beside `/events`, not under `routes/public/`; IP limiter 120 rpm → 64 KiB body bound → signature on raw bytes with a **5-minute** tolerance (also the replay window) → event-id de-dup → fetch-to-confirm → land in one batch; `401` writes nothing, verified-but-unusable is `200` + an exception row, our own failure is `503`. *(Open Question 6.)* | 2026-11-18 | Product owner |
| R13 | **Configuration and secrets.** Var `PAYMENTS_PROVIDERS` (default `none`, otherwise the list of §8.1) plus two secrets per bound provider, `PAYMENTS_<PROVIDER>_SECRET_KEY` / `PAYMENTS_<PROVIDER>_WEBHOOK_SECRET`, declared in `deployment.schema.jsonc` with `requiredWhen: "PAYMENTS_PROVIDERS~=<provider>"` — `requiredWhenActive` gains the contains operator `~=` — detected by name, never written by provisioning; sandbox keys on staging enforced by the key-mode assertion; the webhook URL registered by the operator per label × environment. *(Open Question 7.)* | 2026-11-18 | Product owner |
| R14 | **Edge money cases.** A checkout is for the full balance; the ledger lands **what the provider captured**; an overpayment shows as a credit and is the admin's to refund; a **currency mismatch lands nothing** (`mismatch` + alert); **partial refunds** and **lost disputes** land as negative gateway rows keyed on the refund/dispute id (`reverses_id = NULL`); an **opened dispute** alerts and sets a `billing_standing_hold` ("payment under dispute") on the **contract rail only**, never on extras (RFC 0015 #9). The daily run expires checkouts after fetch-to-confirm, retries failed events up to 5 times, and asserts the key mode. *(Open Question 8.)* | 2026-11-18 | Product owner |
| R15 | **What the admin sees.** Gateway rows on the ledger with the provider id and a dashboard deep link; `pendingCheckout` on roster and both statements as "pending online payment"; refund confirmation on reverse; an **exceptions panel in v1** for orphans, mismatches, failed events and disputes, where a manual match records through the ordinary admin payment form with `method = 'gateway'`. Content creators and tutors see nothing (RFC 0013 #5). *(Open Question 9.)* | 2026-11-18 | Product owner |

## References

- RFC 0013 — `docs/product/RFCs/0013-student-billing-contracts-and-receivables-accounting.md`:
  §1 schema (`payments`), §4 "No payment-gateway port is declared", Alternative 4, Resolved
  #2, #4, #5, #8, #9. Closed as Implemented in `docs/rfc-0013-status-closeout`.
- RFC 0015 — `docs/product/RFCs/0015-event-extras-one-off-charges-for-events.md`: §2 "Two
  rails, and the `Receivable` shape that keeps them apart", Resolved #5 and #9; Non-Goal
  "self-service purchase / checkout / payment gateway".
- RFC 0012 — tenant provisioning and the external-secret contract (`RESEND_API_KEY`
  precedent). RFC 0014 §6 — the anonymous events board as the mount precedent. RFC 0021 —
  previews inherit no secrets. RFC 0025 §3.1 — `job_runs`.
- Code: `packages/shared/domain/billing/receivable.ts`;
  `apps/api/migrations/0026_create_billing_tables.sql` (`payments`),
  `0028_create_event_charges.sql` (`event_charge_payments`), `0032_create_job_runs.sql`;
  `apps/api/src/core/billing/billing-service.ts:1037` (`recordPayment`), `:1088`
  (`reversePayment`); `apps/api/src/core/billing/event-charge-service.ts` (the twins);
  `apps/api/src/adapters/db/d1-billing-repository.ts:284` (`REFRESH_INVOICE_STATUS`), `:810`
  (`recordPayment`); `apps/api/src/routes/me/billing.ts`; `apps/api/src/routes/index.ts:90`
  (`/events` mount); `apps/api/src/middleware/optional-auth.ts`;
  `apps/api/src/routes/events.router.ts:216-225` (meter first, identify second);
  `apps/api/src/core/auth/auth-service.ts:44` (`UserStatus.ACTIVE` login check);
  `apps/api/src/index.ts#scheduled`; `scripts/cloudflare/provision-label.mjs#externalSecretNames`;
  `scripts/label.mjs#requiredWhenActive`; `config/deployment.schema.jsonc` (`api-secrets`);
  `apps/api/src/container.ts:450` (`WEB_BASE_URL`).
- Superseded draft: `docs/product/RFCs/0019-stripe-payment-gateway-integration.md` on the
  unmerged branch `origin/claude/compassionate-rubin-11a6pn` (2026-09-29) — Stripe-first,
  bundling autopay, a storefront and creator splits. Never indexed in the README; this RFC
  takes the number 0026 rather than reuse 0019 while that branch exists.
- Provider documentation consulted on 2026-11-16: Stripe —
  [Pix](https://docs.stripe.com/payments/pix), [accept a Pix payment with
  Checkout](https://docs.stripe.com/payments/pix/accept-a-payment), [how to enable Pix in
  Brazil](https://support.stripe.com/questions/how-to-enable-pix-as-a-payment-method-in-brazil);
  Mercado Pago — [Checkout Pro payment
  notifications](https://www.mercadopago.com.br/developers/en/docs/checkout-pro-orders/notifications),
  [webhooks](https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks);
  Asaas — [receive events at your webhook
  endpoint](https://docs.asaas.com/docs/receive-asaas-events-at-your-webhook-endpoint),
  [create a webhook via the API](https://docs.asaas.com/docs/create-new-webhook-via-api),
  [token requirement changelog](https://docs.asaas.com/changelog/obrigatoriedade-e-auto-geração-de-tokens-para-webhooks).
- Memory of the closeout session: `rfc-0013-billing-closeout-and-gateway-next.md` (the
  friction list this RFC's Open Questions — now R7–R15 — followed).
