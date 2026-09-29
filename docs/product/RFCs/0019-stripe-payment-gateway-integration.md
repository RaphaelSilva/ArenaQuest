# RFC 0019: Stripe payment gateway integration — recurring, one-off and storefront charges, split-ready

**Date:** 2026-09-29
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/00NN_create_gateway_tables.sql` (new; next free number at implementation time, since `0028` is contested by RFCs 0015/0016) — `gateway_customers`, `gateway_checkouts`, `gateway_events`, `store_products`, `store_orders`, `sale_splits`, plus one reserved system user row. Purely additive: no `ALTER` of any RFC 0013 table.
- `packages/shared/ports/i-payment-gateway.ts` (new) — `IPaymentGateway`, the provider port RFC 0013 #9 deferred "until a provider is in hand". No Stripe types cross it.
- `packages/shared/ports/i-gateway-repository.ts` (new) — persistence for checkouts, customers, webhook events, orders and splits.
- `packages/shared/domain/billing/split.ts` (new, pure) — share rules → integer split with a deterministic remainder rule.
- `packages/shared/domain/billing/gateway-currency.ts` (new, pure) — which `currencies` rows the gateway may charge in, and why BTC may not.
- `apps/api/src/adapters/payment/stripe-gateway-adapter.ts` (new) — a thin `fetch` client over the Stripe REST API plus webhook signature verification with Web Crypto.
- `apps/api/src/core/billing/gateway-service.ts` (new) — checkout creation, webhook application, refunds, autopay, reconciliation.
- `apps/api/src/core/billing/billing-service.ts` — `recordPayment` / `reversePayment` gain a system-actor entry point; their rules are unchanged.
- `apps/api/src/routes/webhooks/stripe.ts` (new, mounted at `/v1/webhooks/stripe`), `routes/me/billing.ts` (checkout + autopay), `routes/store.ts` (new), `routes/admin/billing.ts` (gateway payments, refunds), `routes/admin/store.ts` (new).
- `apps/api/src/index.ts` — the existing `scheduled` handler additionally runs autopay attempts and checkout reconciliation.
- `apps/api/src/container.ts` — `billing` group gains `gateway` and `gatewayRepo`.
- `apps/api/wrangler.jsonc`, `worker-configuration.d.ts` — secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; var `STRIPE_PUBLISHABLE_KEY`.
- `scripts/cloudflare/provision-label.mjs` — detects the two Stripe secrets **by name** and reports their fix command (RFC 0012 contract; it never writes them).
- `config/labels/*.jsonc` — optional `payments` block (enabled, methods, autopay).
- `apps/web/src/app/(protected)/settings/billing/*` (Pay / autopay), `apps/web/src/app/(public)/store/*` (new — the sales gallery), `apps/web/src/app/(protected)/admin/billing/*` (gateway column, refund), `apps/web/src/app/(protected)/admin/store/*` (new), `src/lib/*-api.ts`, `src/i18n/dict-{en,pt}.ts`.

---

## Summary

ArenaQuest already knows what a student owes (RFC 0013's contract invoices, RFC 0015's
event charges) but cannot take the money: every payment is typed in by an admin after it
arrived somewhere else. This RFC chooses **Stripe** as the first payment gateway and
connects it to that existing ledger for three kinds of sale: **recurring** (a contract's
periodic invoices, paid by link or charged automatically to a saved card), **one-off** (a
single invoice, an event charge) and a **storefront**, the in-site sales gallery of
products a visitor or student can buy. Payment happens on **Stripe Checkout** (hosted), so
no card number ever touches the Worker. The most important consequence is where the truth
lives. **ArenaQuest stays the ledger and the scheduler, and Stripe is a way for money to
arrive.** A confirmed Stripe payment becomes an ordinary `payments` row
(`method = 'gateway'`, the PaymentIntent id in `external_reference`), written *only* by a
verified, de-duplicated webhook. A refund or chargeback becomes an ordinary reversal. The
second consequence is structural: **every gateway sale writes a split record from day
one** (`sale_splits`). In v1 that record always says "100 % to the platform". When revenue
sharing with **content creators** is turned on, the change is data plus Stripe Connect
transfers, not a new schema and not a rewrite of the payment path.

## Motivation

RFC 0013 deliberately built the ledger before the gateway ("a provider adopted before a
ledger exists tends to *become* the ledger", Alternative 4) and left `'gateway'` in the
`payments.method` CHECK for this day (#9). The ledger now exists, and three needs cannot
be met without a gateway:

| Case | Covered today? | Covered by this RFC? |
|---|---|---|
| A student sees "R$ 180,00 due on the 10th" on `/settings/billing` and wants to pay it right there | No. The statement is read-only; they pay by Pix to the instructor, who types it in. | Yes: **Pay** opens a Stripe Checkout for the invoice balance. |
| The student wants the monthly fee charged automatically | No. | Yes: **autopay**, meaning a saved card charged off-session by the daily run on the due date. |
| A seminar fee (RFC 0015 event charge) paid online | No. RFC 0015 lists "checkout / payment gateway" as a Non-Goal and defers to this RFC. | Yes: the same Checkout, against an event charge. |
| A visitor buys an item from a sales gallery on the site (a DVD, an e-book, a uniform, a seminar seat) | No product catalogue exists at all. | Yes: `store_products` + `store_orders`, sold through Checkout. |
| The admin refunds a student who paid twice | Only by recording a reversal *and* refunding by hand in the bank. | Yes: one **Refund** action, and the reversal is written when Stripe confirms. |
| A card payment is disputed weeks later | N/A | Yes: `charge.dispute.*` → reversal row + admin alert. |
| "This course was produced by a guest instructor; they get 70 % of each sale." | No. | **Designed and made reachable, not built** (§8): the split is recorded on every sale from v1, and payouts via Stripe Connect are Phase 5. |

The last row is the reason this RFC is written now rather than as a smaller adapter. A
payment integration that assumes one payee bakes "all money belongs to the tenant" into
checkout creation, webhook handling, refunds and reports. Taking that assumption out later
means touching every one of them. Recording the split from the first sale costs one small
table.

## Goals & Non-Goals

**Goals**
- Take money through Stripe for **three receivable sources**: contract invoices (RFC
  0013), event charges (RFC 0015, when it lands) and storefront orders (new here).
- **Recurring payment** of contract invoices in two modes: *pay by link* (each invoice
  gets a Checkout; the reminder email carries it) and *autopay* (the student saves a card
  once, and the daily run charges it off-session on the due date).
- **One-off payment** of any single open receivable, and **storefront purchases**.
- **PCI scope stays at SAQ A**: card data is entered only on Stripe-hosted pages. The
  Worker never sees a PAN, CVC or expiry.
- **One writer of gateway money: the webhook.** Returning from Checkout shows a pending
  state. Only `checkout.session.completed` / `payment_intent.succeeded`, with a verified
  signature and a de-duplicated event id, writes a `payments` row.
- **Idempotency end to end**: Stripe `Idempotency-Key` on every create, `gateway_events`
  primary key on Stripe's event id, and at most one live checkout per receivable.
- Refunds and disputes are **reversals** in the existing ledger, never edits.
- **Split-ready**: every succeeded gateway payment writes `sale_splits` rows. In v1 there
  is always one row, `payee = platform`, 100 %. Reports read splits from day one.
- **Per-tenant Stripe accounts**: each label is its own merchant, with its own keys per
  environment, detected by the provisioner like every other external secret.
- No new dependency for crypto or HTTP: the Stripe client is a thin `fetch` wrapper and
  webhook verification is HMAC-SHA256 via Web Crypto, consistent with the
  no-external-auth-deps rule.

**Non-Goals**
- **Access changes on payment.** Paying grants nothing and not paying revokes nothing
  (RFC 0013 #2, RFC 0015 Resolved #1). A storefront product that *unlocks content* needs
  an explicit fulfilment decision (Open Question #1) and is not built here.
- **Stripe Billing (Stripe-side Subscriptions, Invoices, Customer Portal).** ArenaQuest's
  contract model (snapshot terms, amendments, pause, negotiated terms, grace) stays the
  source of truth. Stripe only charges what ArenaQuest has already issued. See
  Alternative 1.
- **Building creator payouts** (Stripe Connect onboarding, transfers, creator dashboards).
  §8 designs them and names their seam. They are Phase 5, gated on Open Questions #2–#4.
- **Stripe Elements / an embedded card form.** It expands PCI scope to SAQ A-EP and adds
  a front-end SDK. Deferred, not rejected.
- **Cart with multiple products.** A storefront order is one product × quantity in v1.
  The schema holds lines, so a cart is additive later.
- **Shipping, stock control, tax calculation, fiscal documents (NF-e).** Physical
  fulfilment is recorded as a status the admin flips, and fiscal documents stay out, as
  in RFC 0013.
- **Guest checkout without an account.** A purchaser must be logged in, so every
  `payments` row resolves to a `users` row (RFC 0013's FKs are `NOT NULL`). Browsing the
  gallery is anonymous. Revisit with Open Question #5.
- **Currency conversion, multi-currency storefronts, crypto.** One active currency per
  tenant (RFC 0013 #4), and the gateway refuses currencies Stripe cannot charge (§6).
- **Automatic retries of a failed autopay beyond one per day, or dunning sequences.** The
  daily run retries at most once a day until grace lapses. RFC 0013's reminder emails
  stay as they are.

## Current State (for reference)

**The landing point exists and is unused.** `payments.method` already admits `'gateway'`
and `payments.external_reference` exists for "gateway charge id later"
(`apps/api/migrations/0026_create_billing_tables.sql`, table `payments`). The port says the
same thing in prose: "a future provider adapter calls the same `recordPayment` path an
admin calls" (`packages/shared/ports/i-billing-repository.ts:22-26`).

**`recordPayment` assumes a human actor.** `BillingService.recordPayment(invoiceId,
command, actorId)` (`apps/api/src/core/billing/billing-service.ts:900`) writes
`recordedBy: actorId`, and `payments.recorded_by` is `NOT NULL REFERENCES users(id)`. A
webhook has no logged-in user, so the gateway needs a **system actor** that satisfies
that FK (§1). Its other rules still hold as they are: it refuses non-positive amounts
(`:905`), void invoices (`:911`) and a currency mismatch (`:915`). The gateway path goes
through them rather than around them.

**Something periodic already runs.** `apps/api/src/index.ts:52` enables the `scheduled`
handler (`runScheduledBilling`), and `apps/api/wrangler.jsonc` fires it daily at
`0 6 * * *`. Autopay and reconciliation join that same run. No new cron is needed.

**No product catalogue exists.** Nothing on `main` models a sellable item other than a
`billing_plans` row (recurring by construction) and, once RFC 0015 lands, an
`event_prices` row.

**Routing.** `apps/api/src/routes/index.ts:78-86` mounts `public`, `comments`, `auth`,
`admin`, `me`, `topics` and `events` under `/v1`. `/v1/events` is the precedent for a
surface mounted **outside** `routes/public/`, because its security posture differs (see
CLAUDE.md, "Events board"). A webhook differs more: it authenticates with a *signature*,
not a token.

**Roles.** `ROLES.CONTENT_CREATOR` exists (`packages/shared/constants/roles.ts:3`) and
authors content, but it owns nothing financial. Billing is admin-only (RFC 0013 #5).

**Tenancy and secrets.** Each label owns its own D1 and Worker. RFC 0012 defines the
contract for external secrets (`RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`, …): detected by
name, reported with the fix command, never written by provisioning.

## Proposed Design

### 1. Schema (migration `00NN_create_gateway_tables.sql`, additive only)

```sql
-- A non-login system actor, so gateway-written ledger rows satisfy
-- payments.recorded_by NOT NULL REFERENCES users(id). status 'inactive' and no
-- password hash: it can never authenticate. Every row it writes is still traceable
-- to a Stripe event id in gateway_events.
INSERT OR IGNORE INTO users (id, name, email, password_hash, status)
VALUES ('system-gateway', 'Payment gateway', 'gateway@system.invalid', '', 'inactive');

-- One Stripe Customer per user, created lazily on first checkout.
CREATE TABLE IF NOT EXISTS gateway_customers (
  user_id                    TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  provider                   TEXT NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  provider_customer_id       TEXT NOT NULL UNIQUE,          -- cus_...
  -- Autopay: a saved card (pm_...) the daily run may charge off-session.
  default_payment_method_id  TEXT,
  autopay_enabled            INTEGER NOT NULL DEFAULT 0,
  autopay_consented_at       TEXT,                          -- mandate evidence
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

-- An attempt to collect one receivable. NOT money: money is a payments row, written
-- when this succeeds. This is the "pending charge in its own table keyed on the
-- receivable" that RFC 0013 #9 anticipated.
CREATE TABLE IF NOT EXISTS gateway_checkouts (
  id                        TEXT NOT NULL PRIMARY KEY,     -- also the Stripe Idempotency-Key
  provider                  TEXT NOT NULL DEFAULT 'stripe',
  receivable_kind           TEXT NOT NULL CHECK (receivable_kind IN ('invoice','event_charge','store_order')),
  receivable_id             TEXT NOT NULL,
  user_id                   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mode                      TEXT NOT NULL CHECK (mode IN ('checkout','off_session')),
  amount_minor              INTEGER NOT NULL CHECK (amount_minor > 0),  -- balance at creation
  currency                  TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  status                    TEXT NOT NULL
                              CHECK (status IN ('open','processing','succeeded','failed','expired','canceled')),
  provider_session_id       TEXT UNIQUE,                    -- cs_...  (checkout mode)
  provider_payment_intent_id TEXT UNIQUE,                   -- pi_...
  payment_id                TEXT REFERENCES payments(id) ON DELETE RESTRICT, -- set on success (invoice rail)
  failure_code              TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at                TEXT
);
-- At most one live attempt per receivable: a second "Pay" click reuses the open session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_checkouts_one_live
  ON gateway_checkouts(receivable_kind, receivable_id)
  WHERE status IN ('open','processing');

-- Webhook de-duplication and audit. Stripe delivers at least once, so the event id is the key.
CREATE TABLE IF NOT EXISTS gateway_events (
  id            TEXT NOT NULL PRIMARY KEY,                  -- evt_...
  provider      TEXT NOT NULL DEFAULT 'stripe',
  type          TEXT NOT NULL,
  livemode      INTEGER NOT NULL,
  received_at   TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT,
  outcome       TEXT NOT NULL DEFAULT 'pending'
                  CHECK (outcome IN ('pending','applied','ignored','failed')),
  error         TEXT
);

-- The sales gallery. A catalogue, freely editable. Orders snapshot from it (as
-- subscriptions snapshot plans).
CREATE TABLE IF NOT EXISTS store_products (
  id             TEXT NOT NULL PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',                  -- sanitised markdown
  image_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  amount_minor   INTEGER NOT NULL CHECK (amount_minor > 0),
  currency       TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  kind           TEXT NOT NULL CHECK (kind IN ('physical','digital','service')),
  -- Split rule for this product (see §8). NULL = 100 % platform.
  share_rule     TEXT,                                      -- JSON, validated by domain/billing/split.ts
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_by     TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A purchase. Title, price and share rule are snapshot at order time.
CREATE TABLE IF NOT EXISTS store_orders (
  id              TEXT NOT NULL PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id      TEXT NOT NULL REFERENCES store_products(id) ON DELETE RESTRICT,
  title           TEXT NOT NULL,                            -- snapshot
  unit_amount_minor INTEGER NOT NULL CHECK (unit_amount_minor > 0), -- snapshot
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0),
  currency        TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  share_rule      TEXT,                                     -- snapshot
  status          TEXT NOT NULL CHECK (status IN ('pending','paid','fulfilled','refunded','canceled')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at         TEXT,
  fulfilled_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_store_orders_user ON store_orders(user_id, status);

-- Who each gateway payment belongs to. APPEND-ONLY, signed like payments: a refund
-- writes negative mirror rows. The rows of one payment sum to its amount exactly.
CREATE TABLE IF NOT EXISTS sale_splits (
  id                 TEXT NOT NULL PRIMARY KEY,
  checkout_id        TEXT NOT NULL REFERENCES gateway_checkouts(id) ON DELETE RESTRICT,
  payee_kind         TEXT NOT NULL CHECK (payee_kind IN ('platform','creator')),
  payee_user_id      TEXT REFERENCES users(id) ON DELETE RESTRICT, -- NULL for platform
  amount_minor       INTEGER NOT NULL CHECK (amount_minor <> 0),   -- negative = refund share
  currency           TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  basis_points       INTEGER NOT NULL CHECK (basis_points BETWEEN 0 AND 10000), -- snapshot of the rule
  reverses_id        TEXT REFERENCES sale_splits(id) ON DELETE RESTRICT,
  -- Phase 5: the Stripe Connect transfer that paid this share out (tr_...).
  provider_transfer_id TEXT,
  transfer_status    TEXT NOT NULL DEFAULT 'not_applicable'
                       CHECK (transfer_status IN ('not_applicable','pending','paid','reversed','failed')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((payee_kind = 'platform') = (payee_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_sale_splits_payee ON sale_splits(payee_user_id);
```

Design notes:
- **`gateway_checkouts` is not money.** It is an *attempt*. Money exists only in
  `payments` (contract rail), `event_charge_payments` (extras rail, RFC 0015) or as a
  `store_orders.status = 'paid'` plus its `sale_splits`. That keeps RFC 0013's rule that
  reports recompute from the ledger.
- **Store orders are their own rail.** RFC 0015 established that rails are never merged.
  A storefront sale neither makes a student "late" nor settles their monthly fee. The
  roster and reports show the store as its own block, reusing the rail-tagged
  `Receivable` shape RFC 0015 introduces.
- **`store_orders` has no separate payment table** because an order is paid once, in
  full, by the gateway: the `gateway_checkouts` row plus `sale_splits` is its payment
  record. If an admin needs to record an out-of-band store payment, that is Open
  Question #6.

### 2. The port (`packages/shared/ports/i-payment-gateway.ts`)

```ts
export interface CheckoutRequest {
  idempotencyKey: string;            // gateway_checkouts.id
  customerRef: string;               // provider customer id
  amountMinor: number;
  currency: string;                  // already checked against gateway-currency.ts
  description: string;               // "Mensalidade 2026-10", "Seminário de março", product title
  successUrl: string;
  cancelUrl: string;
  methods: ('card' | 'pix' | 'boleto')[];   // from the label profile
  savePaymentMethod: boolean;        // autopay opt-in during a checkout
  metadata: Record<string, string>;  // { checkoutId, receivableKind, receivableId, label, env }
}

export interface IPaymentGateway {
  ensureCustomer(user: { id: string; email: string; name: string }, existing?: string): Promise<string>;
  createCheckout(req: CheckoutRequest): Promise<{ sessionId: string; url: string; expiresAt: string }>;
  createSetupSession(customerRef: string, idempotencyKey: string, urls: { successUrl: string; cancelUrl: string }):
    Promise<{ sessionId: string; url: string }>;
  chargeOffSession(req: Omit<CheckoutRequest, 'successUrl' | 'cancelUrl' | 'methods' | 'savePaymentMethod'>
    & { paymentMethodRef: string }): Promise<{ paymentIntentId: string; status: 'succeeded' | 'processing' | 'requires_action' | 'failed'; failureCode?: string }>;
  refund(paymentIntentId: string, amountMinor: number, idempotencyKey: string): Promise<{ refundId: string }>;
  retrieveCheckout(sessionId: string): Promise<{ status: 'open' | 'complete' | 'expired'; paymentIntentId: string | null; paid: boolean }>;
  /** Verifies the signature and timestamp tolerance, returns a provider-neutral event. Throws on a bad signature. */
  parseWebhook(rawBody: string, signatureHeader: string): Promise<GatewayEvent>;
  // Phase 5 (Connect). Declared then, not now.
}
```

The port is provider-neutral in shape, but deliberately modelled on one real provider
rather than guessed (the concern behind RFC 0013 #9). `GatewayEvent` is a discriminated
union of the handful of events §4 handles. Unknown types map to `{ kind: 'ignored' }`.

**Adapter.** `StripeGatewayAdapter` is a `fetch` wrapper over the ~8 REST endpoints used
(`/v1/customers`, `/v1/checkout/sessions`, `/v1/payment_intents`, `/v1/refunds`, …),
form-encoded with `Stripe-Version` pinned and `Idempotency-Key` on every `POST`. Webhook
verification recomputes `HMAC-SHA256(secret, "${t}.${rawBody}")` with
`crypto.subtle`, compares in constant time against every `v1=` signature, and rejects a
timestamp older than 300 s. It is instantiated per request inside `buildContainer(env)`,
like every adapter. When `STRIPE_SECRET_KEY` is absent, the container wires a
`DisabledPaymentGateway` whose every method returns a typed "payments not configured"
error. The API then answers `409 PaymentsDisabled`, and the web hides **Pay**. A tenant
without Stripe loses nothing it has today.

### 3. Payment flows

**a) Pay one receivable (invoice, event charge): *pay by link*.**

1. `POST /v1/me/billing/invoices/{id}/checkout` (or `/charges/{id}/checkout`). The service
   loads the receivable and refuses it if it is not the caller's, if it is `void` or `paid`,
   or if its balance is ≤ 0. It then reuses an `open` checkout for the same receivable if
   one exists *and* its amount still equals the current balance. Otherwise it cancels the
   stale one (expires the Stripe session) and opens a new one for the **current balance**.
2. The browser is redirected to Stripe Checkout. On return, `success_url` lands on
   `/settings/billing?checkout={id}`, which shows *"Payment processing"*. It **never**
   marks anything paid.
3. The webhook (§4) writes the payment.

The reminder emails RFC 0013 sends at the due date gain a **Pay** link to the statement,
not to a Stripe session, because sessions expire after 24 h and emails do not.

**b) Recurring: *autopay*.** From `/settings/billing`, **Enable autopay** runs Checkout in
`setup` mode (SetupIntent, which carries the off-session mandate and SCA). A student can
also tick "save this card for future charges" during a normal checkout. `setup_intent`
success stores `default_payment_method_id` and `autopay_consented_at`. From then on, the
daily run (`runScheduledBilling`, `index.ts:52`), after issuing invoices, charges every
**open contract invoice due today or overdue within grace** whose owner has
`autopay_enabled = 1` and no `open`/`processing` checkout. It creates a
`gateway_checkouts` row with `mode = 'off_session'` and calls `chargeOffSession` with that
row's id as the idempotency key, so a re-run on the same day cannot double-charge. The
outcomes:
- `succeeded` / `processing` → wait for the webhook, as always.
- `requires_action` (SCA re-authentication) or `failed` → the row goes `failed` with
  `failure_code`, the student gets **one** email with a Pay link, and the next day's run
  may retry once. Autopay never charges past the invoice's grace window, and never charges
  event charges or store orders (those were bought one at a time and are paid one at a
  time).

Disabling autopay clears `autopay_enabled` and detaches the payment method at Stripe.

Recurring is **ArenaQuest-scheduled, Stripe-executed**. The contract, its amendments,
pauses and negotiated terms stay entirely in RFC 0013's tables, and Stripe never learns
the word "subscription" (Alternative 1).

**c) Storefront purchase.** `GET /v1/store/products` is anonymous (optional-auth, like
`/v1/events`) and returns only `published` products. `POST /v1/store/orders
{ productId, quantity }` requires a token. It snapshots title, price and `share_rule` into
a `pending` order and opens a checkout for it. The webhook flips the order to `paid`. An
admin later marks `fulfilled` (physical/service). A pending order whose checkout expired
becomes `canceled` in reconciliation.

### 4. Webhook: the only writer of gateway money

`POST /v1/webhooks/stripe` is mounted beside `/v1/events` and **outside** `public/`,
`me/` and `admin/`. It has no `authGuard` and no CORS, and it reads the **raw body**
before any JSON parsing (signature verification needs the exact bytes). It is also
rate-limited per IP by the existing `KvRateLimiter`, as a backstop.

```
verify signature ──fail──▶ 400 (no DB write)
   │ ok
INSERT OR IGNORE gateway_events(id) ──already present & applied──▶ 200 (duplicate)
   │ new
apply(event) inside one D1 batch ──▶ outcome='applied' | 'ignored' ──▶ 200
   │ throws
outcome='failed', error=… ──▶ 500 (Stripe retries with backoff for 3 days)
```

| Stripe event | Effect |
|---|---|
| `checkout.session.completed` with `payment_status = 'paid'` | checkout → `succeeded`; post the payment to its rail (below); write `sale_splits` |
| `checkout.session.completed` with `payment_status = 'unpaid'` (Pix/boleto pending) | checkout → `processing`, nothing else |
| `checkout.session.async_payment_succeeded` | same as the paid case |
| `checkout.session.async_payment_failed`, `checkout.session.expired` | checkout → `failed` / `expired`; a pending store order → `canceled` |
| `payment_intent.succeeded` (off-session) | same as paid, located by `provider_payment_intent_id` |
| `payment_intent.payment_failed` | checkout → `failed`; autopay failure email |
| `setup_intent.succeeded` (via `checkout.session.completed` in setup mode) | store the payment method, enable autopay |
| `charge.refunded` | reversal for the refunded delta (below) |
| `charge.dispute.created` | admin alert email; **no ledger write yet** (the money is held, not lost) |
| `charge.dispute.closed` with `status = 'lost'` | reversal for the disputed amount; admin alert |
| anything else | `outcome = 'ignored'` |

**Posting to the rail** uses the existing services, not the repositories. That way RFC
0013's rules (positive amount, not void, same currency) still apply:
- `invoice` → `BillingService.recordPayment(invoiceId, { amountMinor, method: 'gateway',
  externalReference: pi_id, paidAt }, SYSTEM_GATEWAY_ACTOR)`.
- `event_charge` → the RFC 0015 service's equivalent, same shape.
- `store_order` → order `paid`, `paid_at`.

**A payment that arrives for an already-settled receivable is still recorded.** Money
moved, so the ledger must show it. Example: the student paid by Pix in person while a
Checkout was open. The result is a negative balance (an overpayment) and an admin alert
suggesting a refund. The one exception is a **void** invoice, which `recordPayment`
refuses (`billing-service.ts:911`). In that case the service issues an automatic full
refund and records nothing, and the event is `applied` with that explanation.

**Refunds** are started by an admin: `POST /v1/admin/billing/gateway/checkouts/{id}/refund
{ amountMinor, reason }` calls `IPaymentGateway.refund`, and **writes no ledger row**.
The ledger is written when `charge.refunded` arrives, through `reversePayment` (partial
refunds write a reversal for the delta between Stripe's cumulative `amount_refunded` and
what has already been reversed). The same path covers a refund made directly in the Stripe
Dashboard, so the ledger cannot drift from Stripe whichever side started it. RFC 0013's
`idx_payments_one_reversal` allows exactly one reversal per payment. A second *partial*
refund therefore needs Open Question #7 resolved before partial refunds are exposed in the
UI. v1 exposes **full refunds only**.

### 5. Reconciliation (webhook miss recovery)

The daily run, after autopay, lists `gateway_checkouts` still `open`/`processing` and
older than 1 h and calls `retrieveCheckout` for each. A `complete` + `paid` session is
applied through the **same** `apply` function as the webhook, keyed by a synthetic event
id `reconcile:<sessionId>`, so a late real webhook and the reconciliation never both
write. `expired` sessions close their row. The run logs counts, and a non-zero
"recovered" count is itself a signal that webhook delivery is broken. The admin can
trigger the same pass through `POST /v1/admin/billing/gateway/reconcile`, like the manual
invoice run.

### 6. Money and currency

Stripe amounts are in the smallest currency unit, which matches `amount_minor`. The
mapping is still **checked, not assumed**. `gateway-currency.ts` holds an allowlist of
codes whose `currencies.exponent` equals Stripe's decimal count (`BRL` 2, `USD` 2, `EUR` 2,
`JPY` 0). The service refuses to open a checkout in any other currency, because Stripe
treats some currencies (`HUF`, `TWD`, `ISK`, …) specially. `BTC` is refused outright
(RFC 0013 kept "collecting in crypto" for the gateway RFC; Stripe does not collect it).
`currency` on every Stripe object is lower-cased on the way out and compared upper-cased on
the way in. A webhook whose amount or currency does not match its `gateway_checkouts` row
is `failed`, not applied, and alerts the admin.

Payment methods are configured per label in `config/labels/<label>.jsonc`:

```jsonc
"payments": {
  "provider": "stripe",
  "methods": ["card", "pix", "boleto"],   // Checkout payment_method_types
  "autopay": true,                         // card only; Pix/boleto cannot be charged off-session
  "store": true                            // show the sales gallery
}
```

The deploy CLI bakes `NEXT_PUBLIC_PAYMENTS_*` flags from it, as it already does for
brand vars. A missing block means payments are off.

### 7. HTTP surface

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/webhooks/stripe` | Stripe signature | The only gateway money writer (§4) |
| `POST` | `/v1/me/billing/invoices/{id}/checkout` | student (owner) | Pay a contract invoice → `{ url }` |
| `POST` | `/v1/me/billing/charges/{id}/checkout` | student (owner) | Pay an event charge (after RFC 0015) |
| `GET` | `/v1/me/billing/checkouts/{id}` | student (owner) | Poll a checkout's status after return |
| `POST` / `DELETE` | `/v1/me/billing/autopay` | student | Start setup-mode Checkout / disable autopay |
| `GET` | `/v1/store/products`, `/v1/store/products/{slug}` | optional | The sales gallery (published only) |
| `POST` | `/v1/store/orders` | any authenticated role | Create an order + checkout → `{ url }` |
| `GET` | `/v1/me/store/orders` | authenticated | My purchases |
| `GET/POST/PATCH` | `/v1/admin/store/products[/{id}]` | admin | Catalogue CRUD (content_creator? Open Question #3) |
| `GET/PATCH` | `/v1/admin/store/orders[/{id}]` | admin | Orders; mark `fulfilled` |
| `GET` | `/v1/admin/billing/gateway/checkouts` | admin | Gateway attempts, filterable by status |
| `POST` | `/v1/admin/billing/gateway/checkouts/{id}/refund` | admin | Full refund (§4) |
| `POST` | `/v1/admin/billing/gateway/reconcile` | admin | Manual reconciliation (§5) |
| `GET` | `/v1/admin/billing/splits?payee&from&to` | admin | Split report: platform vs. each creator |

Every admin route sits under the billing sub-router's own `requireRole(ROLES.ADMIN)` (RFC
0013 #5). Every mutation emits the structured `console.info` audit event the billing
services already emit, carrying the Stripe object id.

### 8. Revenue split with content creators (the principle, designed now)

**The principle.** Any gateway sale may belong, in part, to someone other than the
tenant, typically a **content creator** who produced the course, the e-book or the
seminar being sold. The platform must therefore never assume *"a payment's amount is the
tenant's revenue"*. It must always answer *"whose is this money?"* from a record written
at the moment of sale.

**What v1 builds (Phases 1–4).**
- `sale_splits` is written for **every** succeeded gateway payment, in the same D1 batch as
  the ledger row. With no rule configured, that is one row: `payee_kind = 'platform'`,
  10 000 bp, the full amount. Refund and dispute reversals write mirror rows with
  negative amounts, pro rata.
- `store_products.share_rule` (and, later, the same column on `event_prices` /
  `billing_plans` via their own additive migrations) holds the rule. Orders snapshot it,
  exactly as subscriptions snapshot plan terms, so editing a product's split never
  restates a past sale.
- `domain/billing/split.ts` is the one pure function that turns
  `(amountMinor, rule)` into rows:

  ```ts
  type ShareRule = { payees: { userId: string; basisPoints: number }[] }; // platform gets the rest
  function splitAmount(amountMinor: number, rule: ShareRule | null):
    { payee: 'platform' | string; basisPoints: number; amountMinor: number }[];
  ```

  The rules: integer arithmetic only; `floor` each creator share; **the platform absorbs
  the remainder**; rows always sum exactly to `amountMinor`; Σ creator basis points ≤
  10 000; a payee must hold `ROLES.CONTENT_CREATOR`. Stripe's processing fee is **borne by
  the platform share** in v1 (Open Question #4 may change that, and the function signature
  already takes the rule, so it absorbs the change).
- The admin split report (`GET /v1/admin/billing/splits`) exists from Phase 4, so "how
  much of last month's sales belongs to whom" is answerable before any payout is
  automated. That makes a manual payout (bank transfer by the admin) possible on day one.

**What Phase 5 adds (Stripe Connect), and why the shape above is enough.**
- Each creator onboards a **Connect Express account** through an account link from their
  profile (`gateway_payees(user_id, provider_account_id, charges_enabled,
  payouts_enabled)`, additive). `account.updated` webhooks keep the flags current.
- Charges stay on the **platform** (the tenant's Stripe account is the merchant of record,
  so refunds and disputes land on one balance). Creator shares are paid with **separate
  charges and transfers**. Each checkout carries a `transfer_group = checkout.id`, and
  after `succeeded` the service creates one Transfer per `creator` split row, stores
  `provider_transfer_id` and moves `transfer_status` to `paid`. A refund reverses the
  transfer pro rata (`transfer_reversal`) and marks the row `reversed`.
- Why this charge type and not *destination charges* with `application_fee_amount`: a
  destination charge has exactly one recipient, and a product co-authored by two creators,
  or a future cart spanning creators, needs N. Separate transfers also let a share be
  paid *after* a hold period (e.g. after the refund window), which destination charges
  cannot.
- None of this touches §3–§5. The checkout, the webhook, the ledger post and the refund
  path already write and reverse `sale_splits`. Phase 5 only **adds a transfer step
  after them**, driven by rows that already exist.

This is the same move RFC 0013 made with `'gateway'` in the `method` CHECK: reserve the
seam where retrofitting it would mean rewriting live money paths, and build nothing
behind it until the product decision is made.

### 9. Web

- `/settings/billing`: a **Pay** button per open invoice / event charge, a processing
  state on return from Checkout (polls `GET /v1/me/billing/checkouts/{id}`), and
  **Enable / disable autopay** with the saved card's brand and last 4 digits (from Stripe,
  never stored beyond that display).
- `/(public)/store` and `/(public)/store/[slug]`: the **sales gallery**, server-rendered
  like the events board, with SEO metadata and the sitemap entry. **Buy** requires login
  and returns to the product after it.
- `/(protected)/settings/purchases`: my orders.
- Admin: `/admin/store` (products, orders, fulfil), a gateway column and **Refund** on the
  billing ledger, a **Splits** report tab.
- Money renders only through `format-money.ts`. Every string lives in both dictionaries.
- No Stripe.js is loaded: Checkout is a redirect to a URL the API returns.

## Alternatives Considered

1. **Stripe Billing: model contracts as Stripe Subscriptions, let Stripe issue invoices
   and run dunning.** *Rejected.* It is the fastest path to "recurring card charges", and
   it would make Stripe the ledger, which is exactly what RFC 0013 Alternative 4 warned
   against. Amendments by supersession, negotiated terms, `paused` meaning "stop issuing
   but keep counting", zero-value contracts, cash received at the door and a Pix to the
   instructor's bank would all have to be mirrored into Stripe objects or would disagree
   with them. Two schedulers issuing the same period is a reconciliation problem with no
   winner. Stripe's Smart Retries and Customer Portal are real losses, and are accepted.
2. **Stripe Elements (embedded card form) instead of hosted Checkout.** *Deferred.* It
   gives a more integrated UI at the cost of PCI SAQ A-EP, a front-end SDK in a
   next-on-pages build, and our own handling of SCA, Pix QR codes and boleto vouchers,
   all of which Checkout already does. Worth revisiting only if checkout conversion is
   measured as a problem.
3. **Mark paid on the success redirect.** *Rejected.* The redirect is user-controlled, can
   be replayed, and arrives before asynchronous methods (Pix, boleto) have settled. The
   webhook is the only authoritative signal. The redirect shows "processing".
4. **Official `stripe` npm SDK.** *Deferred, not rejected.* It runs on Workers with its
   fetch client and SubtleCrypto provider. We use ~8 endpoints and one signature scheme,
   so a thin client keeps the bundle small and matches the repo's no-external-crypto-deps
   rule. If the endpoint count grows (Connect, Phase 5), switching is contained in one
   adapter behind the port.
5. **A Brazil-first provider (Mercado Pago, Pagar.me, Asaas) instead of Stripe.**
   *Rejected by the product owner's choice of Stripe.* These have native Pix recurrence
   and marketplace splits well-proven in Brazil. The port in §2 is shaped so that a
   second adapter is possible. Pix availability and Connect capabilities for a Brazilian
   Stripe platform are Open Question #2, to be verified before Phase 1 is committed.
6. **Destination charges with `application_fee_amount` for the split.** *Rejected for
   Phase 5* (§8): one recipient per charge, and no deferred payout. Kept as a fallback if
   Open Question #2 shows separate charges and transfers are unavailable for the tenant's
   country.
7. **Build creator splits now.** *Deferred.* No creator is asking to be paid today, and
   Connect onboarding, KYC and payout timing are product decisions (Open Questions
   #2–#4). Recording the split now and paying it later keeps the option without the
   operational weight.
8. **A `gateway_payments` table beside `payments` as the money record.** *Rejected.* It
   would create a second source of truth for "was this invoice paid". The gateway posts
   into `payments`, and `gateway_checkouts` only tracks attempts.

## Implementation Plan

Total ≈ **13–16 dev days** for Phases 0–4. Phase 5 (Connect payouts) ≈ 5–7 days,
scheduled separately once Open Questions #2–#4 are resolved.

### Phase 0 — Prerequisites and domain (~2 d)
Verify Open Question #2 against a real Stripe BR test account (Pix/boleto in Checkout,
off-session cards, Connect transfer availability) and record the result in Resolved
Decisions. Then build `i-payment-gateway.ts`, `i-gateway-repository.ts`,
`domain/billing/split.ts` and `gateway-currency.ts`, with exhaustive unit tests (split
sums, remainder to platform, basis-point bounds, refund pro rata, currency allowlist).
No Worker needed.

### Phase 1 — Persistence, adapter and webhook (~4 d)
The migration (additive; the system user row); `D1GatewayRepository`;
`StripeGatewayAdapter` (thin client + Web Crypto signature verification, tested with
Stripe's documented test vectors); `DisabledPaymentGateway`; `/v1/webhooks/stripe` with
de-duplication; the system-actor entry point on `recordPayment`/`reversePayment`; secrets
in `wrangler.jsonc` / `worker-configuration.d.ts` / `.dev.vars.example`; provisioner
detection. Ships dark: no route opens a checkout yet.

### Phase 2 — Pay by link for invoices (~3 d)
`GatewayService.openCheckout`, the `/me/billing/.../checkout` and status routes, the
refund route, reconciliation in the daily run plus its manual twin, and the web Pay
button and processing state. Enable it on `arenaquest` staging with test keys, then on
the `budo` staging.

### Phase 3 — Autopay (~2 d)
Setup-mode Checkout, `gateway_customers` autopay fields, off-session charging in
`runScheduledBilling` (idempotent per invoice per day), the failure email, and the
enable/disable UI.

### Phase 4 — Storefront and split reporting (~3–4 d)
`store_products` / `store_orders` services and routes, the public gallery pages (SSR +
sitemap), the admin store screens, `sale_splits` rules on products, and the admin Splits
report. Event-charge checkout is wired here if RFC 0015 has landed; if not, it is one
route added when it does.

### Phase 5 — Creator payouts via Stripe Connect (~5–7 d, separate milestone)
`gateway_payees`, Express onboarding links, `account.updated`, transfers per creator
split after a hold period, transfer reversal on refund, and a creator's own earnings page.

### Rollout
Payments are **off unless the label profile enables them and the secrets exist**. Staging
uses Stripe test mode. Production keys are set by hand (`wrangler secret put`, the RFC
0012 contract). The webhook endpoint is registered in each tenant's Stripe Dashboard
against `https://<apiHost>/v1/webhooks/stripe`, subscribed only to the events in §4.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| **Webhook lost or delayed**, so a student paid and still shows as owing | Stripe retries for 3 days; the daily reconciliation (§5) recovers from the API; the return page says "processing", never "failed". |
| **Double payment** (Checkout open + cash at the door, two tabs) | One live checkout per receivable (partial unique index); checkout amount = balance at creation; an overpayment is recorded (money moved) and flagged to the admin for refund. |
| **Double charge on autopay** from a re-run of the daily job | `gateway_checkouts.id` is the Stripe `Idempotency-Key`; the run skips receivables with an `open`/`processing` attempt. |
| **Forged webhook** | HMAC-SHA256 over the raw body, constant-time comparison, 5-minute timestamp tolerance, IP rate limit, and the amount/currency cross-check against our own checkout row. |
| **Test-mode event hits production** (or vice versa) | Separate webhook secrets per environment; `livemode` stored and asserted against the environment. |
| Stripe becomes the ledger by the back door | Only webhooks post money, only through `BillingService` rules, only as `payments` rows; `gateway_checkouts` is explicitly not money; Stripe Billing is rejected (Alt. 1). |
| **Pix / boleto / Connect not available as assumed** for a Brazilian Stripe account | Phase 0 verifies against a real account before code is committed; the port leaves room for a second provider (Alt. 5). |
| `payments.recorded_by` needs a user, and a fake user could be abused | `system-gateway` is `inactive` with an empty hash, so it cannot log in; `AdminUsersController` already refuses non-active users; each of its rows ties to a `gateway_events` id. |
| **Partial refunds** collide with `idx_payments_one_reversal` | v1 offers full refunds only; Open Question #7 decides the model before partial refunds ship. A Dashboard partial refund is logged `failed` with an admin alert rather than silently mis-recorded. |
| Split rounding creates or loses a cent | Pure integer function, platform absorbs the remainder, invariant "rows sum to amount" asserted in tests and at write time. |
| Creators assume they are paid automatically before Phase 5 | The split report is admin-only and labelled "owed, not transferred"; `transfer_status = 'not_applicable'` makes the state explicit. |
| Stripe fees make small store items unprofitable | Product prices are the tenant's call; the admin split report shows gross amounts, and a fee column is added once Open Question #4 decides who bears fees. |
| PCI | SAQ A: no card data reaches our origin; only brand + last 4 digits are displayed, fetched from Stripe on demand. |
| Storefront drifts into content access control | Payment grants nothing (Non-Goals); unlocking content is Open Question #1 and, if accepted, a fulfilment step calling `EnrollmentService` explicitly, never a standing check. |

## Success Criteria

- **Phase 0**: `splitAmount` property tests: for random amounts and rules, rows sum to
  the amount, each creator gets `floor(amount × bp / 10000)`, the platform gets the
  remainder, and a rule over 10 000 bp is rejected. The currency allowlist refuses `BTC`
  and `HUF` and accepts `BRL`/`JPY` with matching exponents.
- **Phase 1**: a webhook with a bad signature, a stale timestamp or a tampered body returns
  `400` and writes nothing; the same valid event delivered twice produces one `payments`
  row; a payment for a `void` invoice produces a refund call and no ledger row; with no
  `STRIPE_SECRET_KEY`, every checkout route answers `409 PaymentsDisabled` and the existing
  billing suite is unchanged.
- **Phase 2**: in Stripe test mode, paying an invoice through Checkout moves it to `paid`,
  with `method = 'gateway'` and `external_reference = pi_…`, *only* after the webhook.
  Killing the webhook and running reconciliation produces the same end state. A full
  refund from the admin UI, or from the Stripe Dashboard, writes exactly one reversal.
  Clicking Pay twice returns the same session.
- **Phase 3**: with autopay on, running the daily job twice on a due date creates one
  PaymentIntent. A declined test card leaves the invoice open, sends one email, and the
  student's access is unchanged.
- **Phase 4**: an anonymous visitor can browse the published gallery (SSR HTML contains
  products; drafts are absent); a purchase creates a `paid` order and one `sale_splits`
  row for the platform (or N rows summing to the amount when a rule is set). The split
  report totals equal the gateway payments total for any period.
- **Throughout**: no `enrollments_*` table is written by any code in this RFC, and
  `getEffectiveAccessTopicIds` is untouched.

## Open Questions

| # | Question | Owner |
|---|---|---|
| 1 | **Does the storefront sell access to content** (a course = a topic subtree)? If yes, fulfilment on `paid` calls `EnrollmentService` to grant, and a refund does **not** automatically revoke (consistent with RFC 0013 #2), unless decided otherwise. This is a deliberate exception to "billing never touches access" and needs its own decision. | Product owner |
| 2 | **Stripe capabilities for the tenant's country (BR):** Pix and boleto in Checkout; off-session card charges with SCA; Connect Express + *separate charges and transfers* for a Brazilian platform (cross-border restrictions may force destination charges or a different provider for splits). Verified in Phase 0. | Lead architect |
| 3 | **Can a `content_creator` create store products and set their own share**, or only an admin? And who approves publication? | Product owner |
| 4 | **Split economics:** default creator share; who bears Stripe fees (platform, pro rata, creator); payout hold period (e.g. 7 days after sale, or after the refund window); what happens to a creator's share on a lost dispute. | Product owner |
| 5 | **Guest checkout** for storefront visitors without an account: create an account from the Checkout email, or require login? v1 requires login. | Product owner |
| 6 | **Out-of-band store payments** (someone pays cash for a uniform): record against the order by hand, or keep the store gateway-only? | Product owner |
| 7 | **Partial refunds**: RFC 0013's `idx_payments_one_reversal` permits one reversal per payment. Options: one reversal per refund with a relaxed index (a rebuild of `payments`, which RFC 0013 tried to avoid), or refund = negative *adjustment* plus reversal. Full refunds only until decided. | Lead architect |
| 8 | **Stripe account ownership per tenant**: does each dojo open its own Stripe account (it is the merchant; ArenaQuest never holds funds), or does ArenaQuest operate one platform account with tenants as connected accounts? This RFC assumes the former; the latter changes Phase 5 materially (tenant *and* creator payouts). | Product owner |

## References

- Ledger landing point: `apps/api/migrations/0026_create_billing_tables.sql` (`payments.method`, `external_reference`, `idx_payments_one_reversal`)
- Port note this RFC fulfils: `packages/shared/ports/i-billing-repository.ts:22-26`
- Payment service rules reused: `apps/api/src/core/billing/billing-service.ts:900-940`
- Daily run the gateway joins: `apps/api/src/index.ts:52`, `apps/api/wrangler.jsonc` (`triggers.crons`)
- Route mounts: `apps/api/src/routes/index.ts:78-86`
- Roles: `packages/shared/constants/roles.ts`
- Related RFCs: RFC 0013 (billing ledger; #2 no access gating, #5 admin-only, #9 gateway deferred), RFC 0015 (event charges and the two-rail rule; lists checkout as a Non-Goal deferred here), RFC 0014 (optional-auth public surface precedent), RFC 0012 (external secret contract), RFC 0006/0011 (label profiles and deploy-time vars)
- Stripe docs: Checkout Sessions, webhook signature verification, `Idempotency-Key`, SetupIntents / off-session payments, Connect "separate charges and transfers"
