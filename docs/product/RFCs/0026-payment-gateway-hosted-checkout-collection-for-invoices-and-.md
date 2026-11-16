# RFC 0026: Payment gateway: hosted checkout collection for invoices and event charges

**Date:** 2026-11-16
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/00NN_create_payment_gateway.sql` (new; next free number at implementation time) — `gateway_checkouts`, `gateway_events`, one system actor row in `users`, two **partial unique indexes** on the existing payment tables (`payments`, `event_charge_payments`) scoped to `method = 'gateway'`, and a rebuild of the operational `job_runs` table so its `job` CHECK admits `reconcile_payments`. No `ALTER` and no rebuild of any money table.
- `packages/shared/ports/i-payment-gateway.ts` (new) — `IPaymentGateway`, the provider port RFC 0013 #9 deferred "until a provider is in hand". Provider-neutral in shape, modelled on the provider chosen in Open Question 1. No provider SDK type crosses it.
- `packages/shared/ports/i-gateway-repository.ts` (new) — persistence for checkouts and provider events; `i-billing-repository.ts` and `i-event-charge-repository.ts` each gain one read, `findGatewayPayment(externalReference)`, used only to answer a duplicate.
- `packages/shared/domain/billing/receivable.ts` — unchanged in shape; `(kind, id)` becomes the key of a checkout. `packages/shared/domain/billing/gateway-money.ts` (new, pure) — decimal-string → minor-units conversion against `currencies.exponent`, and the provider-capability table (which currencies and methods each adapter may offer).
- `packages/shared/types/entities.ts` — `Entities.Billing.GatewayCheckout`, `GatewayEvent`, and the `Entities.Config.CheckoutStatus` enum.
- `apps/api/src/adapters/payment/<provider>-gateway-adapter.ts` (new) — a thin `fetch` client over the provider's REST API plus webhook verification with Web Crypto (HMAC-SHA256) or a constant-time token compare, whichever the provider specifies. `apps/api/src/adapters/payment/disabled-gateway-adapter.ts` (new) — the adapter bound when `PAYMENTS_PROVIDER` is `none`; every call answers "payments disabled".
- `apps/api/src/adapters/db/d1-gateway-repository.ts` (new).
- `apps/api/src/core/payments/gateway-service.ts` (new) — checkout creation, the landing of a confirmed payment through `BillingService.recordPayment` / `EventChargeService.recordPayment`, refunds as reversals, reconciliation. `apps/api/src/core/payments/config.ts` (new) — `PAYMENTS_PROVIDER` parsing, the key-mode-vs-environment assertion, `500 PAYMENTS_CONFIG_INVALID`.
- `apps/api/src/core/billing/billing-service.ts`, `event-charge-service.ts` — `recordPayment` and `reversePayment` keep their rules; each gains a sibling entry point that accepts the system actor and a provider reference, and refuses `method <> 'gateway'`.
- `apps/api/src/routes/webhooks/payments.router.ts` (new) — `POST /v1/webhooks/payments/{provider}`, the second anonymous surface after the events board, mounted from `routes/index.ts` and **not** under `routes/public/`.
- `apps/api/src/routes/me/billing.ts` — gains `POST /v1/me/billing/checkouts` and `GET /v1/me/billing/checkouts/{id}`; the statement gains a `pendingCheckout` per receivable. `routes/admin/billing.ts`, `routes/admin/events.ts` (charges) — gain `POST …/checkouts` on behalf of a student and the gateway refund path behind the existing `reverse` routes.
- `apps/api/src/jobs/reconcile-payments.ts` (new) + `apps/api/src/index.ts` — the daily `scheduled()` run gains a fourth job, in its own `finally`, recorded in `job_runs`.
- `apps/api/src/container.ts` — a `payments: PaymentsContext` group (gateway adapter, repository, service) and a per-user `checkouts` rate limiter plus an IP-keyed `webhooks` limiter in `infra.rateLimiters`.
- `apps/api/wrangler.jsonc`, `apps/api/.dev.vars.example`, `worker-configuration.d.ts` — var `PAYMENTS_PROVIDER` in every `env.*` block; secrets `PAYMENT_GATEWAY_SECRET_KEY`, `PAYMENT_GATEWAY_WEBHOOK_SECRET`.
- `config/deployment.schema.jsonc`, `scripts/cloudflare/provision-label.mjs`, `scripts/label.mjs` — the two secrets declared under `api-secrets` with a `requiredWhen` on the provider var, detected by name, never written (RFC 0012 contract); `infra-check` reports them with their fix command.
- `apps/web/src/app/(protected)/settings/billing/*` (Pay button, return page state), `(protected)/admin/billing/*` (provider reference on the ledger, "pending online payment" on roster and statement, refund confirmation), `src/lib/me-billing-api.ts`, `admin-billing-api.ts`, `src/i18n/dict-{en,pt}.ts`.
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
same money twice. The provider itself is the first Open Question; the design holds for any
of the four candidates because the webhook is treated as a *trigger* and the payment is
always **fetched back** from the provider's API before a single row is written.

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
  full open balance; what *can* differ from that is settled in Open Question 8.
- **Multi-currency and crypto collection.** The adapter offers only currencies the provider
  can settle; BRL is the only active currency today (RFC 0013 #4).
- **Payer accounts outside the tenant.** A checkout belongs to a `users` row: the student who
  owes the receivable. Anonymous purchase is not a case here (every receivable already names
  its student).
- **A dunning sequence or new reminder e-mails.** The two existing reminders may carry a
  *Pay* link once Phase 4 ships (Open Question 5), nothing more.

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
the two append-only money tables (Open Question 2).

**Nothing is unique on `external_reference`.** Both payment tables index `invoice_id` /
`charge_id` and have a partial unique index on `reverses_id` only. Two inserts with the same
provider id are accepted today; a retried webhook would double-record (Open Question 3).

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
that names a receivable, so ownership must be checked rather than assumed (Open Question 5).

**One anonymous surface exists, and it is a precedent.** `/v1/events` is mounted from
`routes/index.ts:90` with the comment "Anonymous by design — mounted here rather than inside
`buildPublicRouter`, whose routes all carry `authGuard`"; `middleware/optional-auth.ts` is the
one middleware that never rejects; the router meters first (`KvRateLimiter`, keyed on
`CF-Connecting-IP`, 60 rpm) and resolves identity second. A webhook differs again: it
authenticates with a **signature**, not a token, and must reject rather than degrade (Open
Question 6).

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
  PaymentIntent, Mercado Pago payment, Asaas payment). Its id is what lands in
  `external_reference`.
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

A fifth adapter, `DisabledGatewayAdapter`, is bound when `PAYMENTS_PROVIDER = none` (the
default, and what previews and the arenaquest label run). Every method answers a
`ControllerResult`-friendly "payments disabled" and the student routes return `404` so the
feature is invisible rather than broken.

### 2. Schema (migration `00NN_create_payment_gateway.sql`, additive)

```sql
-- The system actor. Satisfies recorded_by NOT NULL REFERENCES users(id) on both payment
-- tables (Open Question 2). status 'system' is a new value in a column with no CHECK, so
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
  provider_session_id  TEXT UNIQUE,                 -- the hosted session / preference id
  provider_payment_id  TEXT UNIQUE,                 -- set when a payment is confirmed
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

-- The money-level idempotency (Open Question 3). One ledger row per provider payment or
-- refund id, on each rail. Partial: admin-typed rows keep external_reference free-form
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
- **Why not a `gateway_customers` table.** Hosted checkout does not need a provider
  customer object; the payer's e-mail and name go on the session. A customer object is the
  seam for saved payment methods, which is Alternative 4's RFC, not this one.

### 3. Creating a checkout (`POST /v1/me/billing/checkouts`)

```ts
// request                                   // response 201 (or 200 when an open one is reused)
{ kind: 'invoice' | 'event_charge', id }     { checkoutId, url, expiresAt, amountMinor, currency, status: 'open' }
```

`GatewayService.createCheckout({ kind, id }, { userId, createdBy })`:

1. **Feature gate.** `PAYMENTS_PROVIDER = none` → `404`. The route does not exist for a tenant
   without a provider.
2. **Resolve the receivable** through the rail's repository (`getInvoiceWithBalance` /
   `getChargeWithBalance`) into a `Receivable`. Not found, or `receivable.userId !== userId`
   → `404` (never `403`: a student must not learn that another student's invoice id exists).
3. **Payable?** `status !== 'open'` or `balanceMinor <= 0` → `409 RECEIVABLE_NOT_PAYABLE`.
   Currency not in the adapter's capability table → `409 PAYMENTS_UNSUPPORTED_CURRENCY`.
4. **One live attempt.** An `open` checkout for `(kind, id)` whose `expires_at > now` is
   returned as-is with `200`. An expired one is closed (`status = 'expired'`) first.
5. **Create** the row with `status = 'open'` and a placeholder URL, *then* call
   `gateway.createCheckout` with `checkoutId` as the idempotency key and metadata, *then*
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
receivable's owner`. The response is the URL the admin copies into WhatsApp. The student
pays; nothing is charged to anyone. Open Question 5 confirms this is wanted in v1.

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
3. **Route by `{provider}`.** A path provider other than the bound adapter's → `404` (one
   tenant, one provider; the path exists so a future second adapter is a mount, not a
   migration).
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
   `provider_payment_id` agrees; otherwise `orphan`, `200`, admin alert (§7). Mismatched
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
payment.id })` or the `EventChargeService` twin. Each is a sibling of `recordPayment` that
(a) fixes `method = 'gateway'` and `recordedBy = SYSTEM_ACTOR_ID`, (b) refuses to be called
with any other method, and (c) runs the same guards — positive amount, non-void receivable,
currency equal to the receivable's. The amount landed is **what the provider captured**, not
the checkout's `amount_minor`: if an adjustment changed the balance between Pay and
confirmation, the ledger must still say what was received (Open Question 8). The
`REFRESH_INVOICE_STATUS` batch step flips the invoice to `paid` when the balance reaches
zero exactly as it does for a cash payment; a `payments.gateway_landed` audit event carries
ids only. The checkout gets `status = 'paid'`, `provider_payment_id`, and the matching
`*_payment_id`.

**An admin refund** is `POST /v1/admin/billing/payments/{id}/reverse` (and the charges
twin) on a row whose `method = 'gateway'`: the service first calls `gateway.refund(paymentId,
original.amountMinor, idempotencyKey = 'rev:' + original.id)` and, when the provider
*accepts*, writes the reversal with `reverses_id = original.id`, `method = 'gateway'` and
`external_reference = refundId`. A provider refusal (already refunded, funds unavailable) is
`409 PAYMENTS_REFUND_REFUSED` and writes nothing. The refund webhook that follows finds its
refund id already on the ledger and records `duplicate`. Full amount only through this route
(RFC 0013's reversal is a mirror row); Open Question 8 settles partial refunds.

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
only. Whether an opened dispute also sets a `billing_standing_hold` ("stop chasing this
one — a payment is being verified", RFC 0013's own example) is Open Question 8.

### 6. The daily run (`jobs/reconcile-payments.ts`)

A fourth job in `scheduled()`, in its own `finally`, recorded in `job_runs` as
`reconcile_payments`, counts only:

1. **Expire** `open` checkouts past `expires_at` — after one `findPaymentsForCheckout` each:
   a payment the provider reports `paid` whose webhook never arrived is landed exactly as
   §5 would (idempotent on the reference index), then the checkout is `paid`; otherwise
   `expired`. Batches of 100.
2. **Retry** `gateway_events` with `outcome = 'failed'`, `attempts < 5`, older than one hour:
   re-run step 6–7 of §4; increment `attempts`.
3. **Sweep orphans.** `orphan` and `mismatch` events older than 7 days with no admin
   resolution stay — they are a report, not garbage — but the count is in the summary so a
   growing number shows up in the ops digest.
4. **Confirm the key mode** once per run (test key on production / live key on staging →
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

**Roster and statement.** Every receivable gains `pendingCheckout: { checkoutId, createdAt,
expiresAt, createdBy } | null`; the roster row shows "pending online payment" beside the
standing, and the admin statement lists it under the receivable. An admin may still record
a cash payment on a receivable with an open checkout (the student may well have paid at the
door); the form warns, and §6 then expires the checkout on its own.

**Exceptions panel.** `orphan`, `mismatch`, `failed` events and disputes, with provider ids,
oldest first, each with the action it wants: match to a receivable by hand (records through
the normal admin payment form with `method = 'gateway'` and the provider id — the partial
index protects that path too), refund, or dismiss with a note.

**Student statement** (`/settings/billing`). Each open invoice and event charge gets a *Pay*
button when `PAYMENTS_PROVIDER` is set; it is a link to a new tab, not an iframe. A
receivable with an open checkout shows "payment in progress · expires at …" with *Open
again*; a `paid` gateway payment shows as *Paid online* with the date. Nothing else on the
page changes, and the standing badge still gates nothing.

### 8. Configuration and secrets

| Name | Kind | Per | Meaning |
|---|---|---|---|
| `PAYMENTS_PROVIDER` | var, every `env.*` block | label × environment | `none` (default) · `stripe` · `mercadopago` · `asaas` · `pagarme`. Selects the adapter. |
| `PAYMENT_GATEWAY_SECRET_KEY` | secret | label × environment | The provider's server-side key. Sandbox/test on staging, live on production. |
| `PAYMENT_GATEWAY_WEBHOOK_SECRET` | secret | label × environment | Signing secret (Stripe, Mercado Pago) or the chosen auth token (Asaas). |

Generic names, so switching provider is a var change and two `secret put`s, not a rename
across the provisioner. `config/deployment.schema.jsonc` declares both under `api-secrets`
with `required: false, requiredWhen: "PAYMENTS_PROVIDER!=none"`; `requiredWhenActive` gains
the `!=` operator (today it parses `NAME=value` only), so `externalSecretNames` and
`infra-check` report them exactly as they report `RESEND_API_KEY`. Provisioning **never
writes** either; the fix command is `scripts/create-secrets.sh PAYMENT_GATEWAY_SECRET_KEY
--env <label>-<env>`, which reads the value from the terminal. Nothing reaches argv, disk or
a log line (RFC 0012).

`core/payments/config.ts` parses the var at container build. A present-but-unknown value, or
a provider set with either secret absent, makes the payment routes answer `500
PAYMENTS_CONFIG_INVALID` — never a silent `none` (the `SUBMISSIONS_*` precedent). The adapter
asserts **key mode against environment** on first use and in the daily run: a Stripe
`sk_live_` or a Mercado Pago `APP_USR-` key on a `*-staging` Worker, or a test-mode key on
production, is `PAYMENTS_CONFIG_INVALID`. Staging therefore collects nothing real by
construction, and the demo seed's students can walk the whole flow against the sandbox.

**Webhook registration** is an operator step in the provider dashboard, per label and
environment: `https://<apiHost>/v1/webhooks/payments/<provider>`. `docs/operations/payments.md`
lists it beside the sandbox test cards and Pix simulators; `infra-check` cannot see the
provider's side and says so.

**Previews** (RFC 0021) inherit no Worker secret and set no `PAYMENTS_PROVIDER`, so a
preview runs with the disabled adapter: *Pay* is absent and the webhook route is `404`.

### 9. Container, ports and roles

`container.ts` gains `payments: { gateway: IPaymentGateway; gatewayRepo: IGatewayRepository;
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
   system actor — are credited in References. The owner decides whether the branch is
   deleted (Open Question 1).
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

## Implementation Plan

~11 dev days across six phases, each shippable behind `PAYMENTS_PROVIDER = none`, which is
the default on every label until Phase 5 flips budo staging.

### Phase 0 — Domain, port and capability table (~1.5 d)
`i-payment-gateway.ts`, `i-gateway-repository.ts`, `gateway-money.ts` (`decimalToMinor`, the
capability table), entities and enums. Unit tests: decimal parsing against exponents 0, 2
and 8 with rejection of excess fraction digits; capability refusals; `(kind, id)` resolution
through `receivable.ts` for both rails.

### Phase 1 — Persistence and the system actor (~1.5 d)
The migration (tables, partial indexes, system actor, `job_runs` rebuild), `D1GatewayRepository`,
`findGatewayPayment` on both billing repositories, `recordGatewayPayment` /
`recordGatewayReversal` siblings on both services. Tests prove: the system actor cannot log
in and appears in no admin user list (the list filters `status = 'system'`; the lockout
guards ignore it); a second insert with the same gateway reference fails on each rail; the
`CHECK`s refuse a cross-rail `*_payment_id`.

### Phase 2 — Adapter, webhook and landing (~3 d)
The chosen provider's adapter (`fetch` client, `verifyWebhook` on raw bytes with the 5-minute
tolerance or constant-time compare, `getPayment` with decimal conversion), the
`DisabledGatewayAdapter`, `GatewayService.handleEvent`, `routes/webhooks/payments.router.ts`
with its limiter and body bound. Tests with recorded sandbox fixtures: good signature lands
once; replayed event → `duplicate`; tampered body → `401` with no row; unknown payment →
`orphan`; wrong currency → `mismatch` and no ledger row; two concurrent deliveries → one row.

### Phase 3 — Pay, admin links, refunds, reconcile (~2 d)
`POST /v1/me/billing/checkouts`, `GET …/checkouts/{id}`, the two admin on-behalf routes, the
gateway branch of both `reverse` routes, `jobs/reconcile-payments.ts`, the manual reconcile
and exceptions routes, `pendingCheckout` on the statements and roster. Tests: ownership
`404`s; one live checkout per receivable; `409` on a non-payable receivable; the refund
refused by the provider writes nothing; the expiry sweep lands a missed payment.

### Phase 4 — Web (~2 d)
*Pay* and the return-page state on `/settings/billing`; provider reference and deep link on
the ledger tab; refund confirmation; "pending online payment" on roster and statement; the
exceptions panel; i18n in both dictionaries; the two reminder e-mails gain the *Pay* link
when Open Question 5 says so. Playwright at 390 px for the student flow against the sandbox.

### Phase 5 — Configuration, provisioning, rollout (~1 d)
`PAYMENTS_PROVIDER` in every `env.*` block (`none` everywhere), `.dev.vars.example`, schema
`api-secrets` with `requiredWhen: "PAYMENTS_PROVIDER!=none"` and the `!=` operator in
`requiredWhenActive`, `infra-check` output, `docs/operations/payments.md`. Budo **staging**
first: sandbox keys, webhook registered, a demo student pays a demo invoice by simulated Pix
and the ledger row appears with the system actor; the daily run records `reconcile_payments`
`ok`. Budo production flips only after the owner's live check with a real R$ 1,00 charge and
its refund.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| The chosen provider cannot offer Pix to this merchant (Stripe is invite-only for Brazil-based businesses as of 2026-11-16) | Provider is Open Question 1 and the port is provider-neutral; the first adapter is the one whose Pix the tenant can actually enable, and a second adapter is a new file plus a var value, not a schema change. |
| A webhook is forged or replayed | Signature or token verified on raw bytes before anything is written; 5-minute tolerance; event-id primary key; **fetch-to-confirm** means a body carries no money facts; partial unique index on the ledger means even a logic slip cannot double-record. |
| A payment is confirmed but the webhook never arrives (provider outage, our 5xx exhausted retries) | The daily run asks the provider about every expiring checkout and lands what it finds; `job_runs` records the count. |
| The amount or currency captured differs from the receivable | Currency mismatch lands nothing and surfaces in the exceptions panel; an amount difference lands what was captured (truthful ledger) and the statement shows the remaining balance or the credit. |
| The system actor is mistaken for a person or counted by a guard | `status = 'system'`, no role rows, empty hash, `.invalid` e-mail; admin user lists filter it; tests pin the lockout guards and the no-dev-seed guard (which keys on `*.demo.invalid`) to ignore it. |
| A live key lands on staging, or a test key on production | Key-mode-vs-environment assertion on first use and in every daily run → `PAYMENTS_CONFIG_INVALID`; staging profiles never hold live keys by process (`docs/operations/payments.md`). |
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
  with `PAYMENTS_PROVIDER = none` the route is `404`. Reversing a gateway payment writes the
  reversal only after the provider accepts, with the refund id as `external_reference`.
- **S4 (Phase 3).** A checkout whose webhook is dropped in the test harness is landed by
  `reconcile-payments` on the next run; `job_runs` holds a `reconcile_payments` row with
  `landed: 1`.
- **S5 (Phase 4).** At 390 px a demo student on budo staging sees *Pay* on an open invoice,
  completes a simulated Pix in the sandbox, returns, sees "payment processing" then *Paid
  online*; the admin ledger shows the row with the provider id and a working dashboard link.
- **S6 (Phase 5).** `make infra-check-staging LABEL=budo` lists `PAYMENT_GATEWAY_SECRET_KEY`
  and `PAYMENT_GATEWAY_WEBHOOK_SECRET` as present on budo staging and absent on arenaquest
  staging (`PAYMENTS_PROVIDER = none`, so not required); no secret value appears in any CI
  log or in `git grep`.
- **S7 (Phase 5).** Deploying budo staging with a live-mode key makes the daily run `failed`
  with `PAYMENTS_CONFIG_INVALID` and makes `POST /v1/me/billing/checkouts` answer `500`
  `PAYMENTS_CONFIG_INVALID`, not a live charge.
- **S8 (invariant).** `git diff main` touches no file under `routes/topics*`, `routes/public/`,
  `middleware/auth-guard.ts` or `d1-enrollment-repository.ts`, and no test asserting
  "delinquent student keeps access" changes.

## Open Questions

Each question is numbered after the friction it resolves; the recommendation is the
author's, and the owner's answer moves the row to Resolved Decisions with its date.

1. **Provider, and charge vs reconcile-only.** Pix is the decisive criterion. As read on
   2026-11-16: **Stripe** supports Pix on Checkout for BRL but lists Pix as *invite-only for
   businesses based in Brazil*; **Mercado Pago** Checkout Pro offers Pix and card natively in
   Brazil with signed notifications (QR-code notifications excepted, which fetch-to-confirm
   covers); **Asaas** offers Pix and boleto with a token header rather than a signature;
   **Pagar.me** is unverified. *Recommendation:* **charge** (collect through the provider),
   never reconcile-only; first adapter **Mercado Pago**, unless the tenant already holds a
   Stripe Pix invite — in which case Stripe, whose signing and Checkout are the most
   thoroughly documented. The port is written so the second is an adapter file. Also:
   delete the stale `claude/compassionate-rubin-11a6pn` branch once this RFC merges? —
   *Owner.*
2. **Actor for machine-written payments.** *Recommendation:* the per-label **system actor**
   row (`system:payment-gateway`, `status = 'system'`, no role, empty hash, `.invalid`
   e-mail), inserted by the migration with `INSERT OR IGNORE`; no table rebuild. — *Owner.*
3. **Webhook idempotency.** *Recommendation:* two layers — `gateway_events` keyed on
   `(provider, event_id)` for deliveries, and a **partial unique index on
   `external_reference WHERE method = 'gateway'`** on each payment table for money, with
   every gateway reversal carrying the **refund id** rather than the original's reference so
   one index covers charges, refunds and chargebacks. — *Owner / lead architect.*
4. **The pending-checkout table.** *Recommendation:* one additive `gateway_checkouts` keyed
   on `receivable.ts`'s `(kind, id)`, one open row per receivable, two typed nullable FKs to
   the rail payment tables with CHECKs, `status ∈ {open, paid, expired, cancelled, failed,
   mismatch}`. — *Lead architect.*
5. **The student's Pay action.** *Recommendation:* `POST /v1/me/billing/checkouts { kind, id }`
   + `GET /v1/me/billing/checkouts/{id}`, return URLs on `/settings/billing?checkout=…&outcome=…`
   treated as hints only. Two sub-questions: (a) include the **admin on-behalf** link routes
   in v1 (yes — the WhatsApp payment link is the dojo's everyday case); (b) add the *Pay*
   link to the two existing reminder e-mails (yes, Phase 4, copy only). — *Owner.*
6. **The webhook surface.** *Recommendation:* `POST /v1/webhooks/payments/{provider}` mounted
   from `routes/index.ts` beside `/events`, not under `routes/public/`; IP limiter 120 rpm →
   64 KiB body bound → signature on raw bytes with a **5-minute** tolerance (also the replay
   window) → event-id de-dup → fetch-to-confirm → land in one batch; `401` writes nothing,
   verified-but-unusable is `200` + an exception row, our own failure is `503`. — *Lead
   architect.*
7. **Secrets per label and environment.** *Recommendation:* var `PAYMENTS_PROVIDER` (default
   `none`) plus two generic secrets `PAYMENT_GATEWAY_SECRET_KEY` /
   `PAYMENT_GATEWAY_WEBHOOK_SECRET`, declared in `deployment.schema.jsonc` with
   `requiredWhen: "PAYMENTS_PROVIDER!=none"` (adding `!=` to `requiredWhenActive`), detected
   by name, never written by provisioning; sandbox keys on staging enforced by the key-mode
   assertion; webhook URL registered by the operator per label × env. — *Owner / lead
   architect.*
8. **Edge money cases.** *Recommendation:* a checkout is for the full balance; the ledger
   lands **what the provider captured**; an overpayment shows as a credit and is the admin's
   to refund; a **currency mismatch lands nothing** (`mismatch` + alert); **partial refunds**
   and **lost disputes** land as negative gateway rows keyed on the refund/dispute id
   (`reverses_id = NULL`); an **opened dispute** alerts and — sub-question — sets a
   `billing_standing_hold` with reason "payment under dispute" on the contract rail (yes:
   it is the hold's own documented use), never on extras (RFC 0015 #9). The daily run
   expires checkouts after fetch-to-confirm, retries failed events up to 5 times, and asserts
   the key mode. — *Owner.*
9. **What the admin sees.** *Recommendation:* gateway rows on the ledger with the provider id
   and a dashboard deep link; `pendingCheckout` on roster and both statements as "pending
   online payment"; refund confirmation on reverse; an exceptions panel for orphans,
   mismatches, failed events and disputes, where a manual match records through the
   ordinary admin payment form with `method = 'gateway'`. Content creators and tutors see
   nothing (RFC 0013 #5). — *Owner.*

## Resolved Decisions

| # | Decision | Date | Decider |
|---|---|---|---|
| R1 | **A new RFC, not an amendment to RFC 0013.** 0013 closed as Implemented on 2026-11-06; its #9 and Alternative 4 prescribe a separate RFC "with a provider in hand". | 2026-11-06 | Product owner |
| R2 | **The ledger stays the source of truth; the provider is a collector.** Payments land through the existing `recordPayment` path with `method = 'gateway'` and the provider id in `external_reference`; a refund is a reversal; no provider-side subscriptions, invoices or customer portal. | 2026-11-06 | Product owner |
| R3 | **Billing never gates access** (RFC 0013 #2): no `402`, no middleware on content routes, nothing in this RFC touches the catalog gate. | 2026-11-06 | Product owner |
| R4 | **Money is integer minor units against `currencies.exponent`; BRL is the only active currency.** Provider decimals are converted at the adapter boundary, string-based. | 2026-11-06 | Product owner |
| R5 | **Hosted checkout only; no card data on the platform; no fiscal documents; no automatic charging without the student's action.** | 2026-11-16 | Product owner (brief) |

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
  friction list this RFC's Open Questions follow).
