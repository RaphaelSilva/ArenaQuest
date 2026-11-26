# Milestone 30 — Payment Gateway

**Status:** 📝 Planning
**Scope:** `packages/shared` (provider port, gateway repository port, decimal-to-minor conversion and the provider capability table, checkout and event entities), `apps/api` (one additive migration with the system actor, the Mercado Pago adapter, provider list parsing and the gateway registry, the webhook surface, checkout / refund / reconcile / exceptions routes, the hourly Cron Trigger), `apps/web` (*Pay* on the student statement with its return state, the *payment due* dashboard card, provider reference / pending online payment / refund confirmation / exceptions panel in Admin → Billing), `config` + `scripts` (provider secrets declared by name, the `~=` operator, `infra-check`), `docs` (operations runbook, onboarding). Derived from [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md).

> **Hard scope guardrail — read before opening any task.** This milestone may touch **only**: one new migration `apps/api/migrations/00NN_create_payment_gateway.sql` (the next free number when its task opens — `0033` today, later if M29's `0033`/`0034` land first — holding `gateway_checkouts`, `gateway_events`, the `INSERT OR IGNORE` of the system actor into `users`, the two partial unique indexes `… WHERE method = 'gateway'` on `payments` and `event_charge_payments`, and the rebuild of the operational `job_runs` table so its `job` CHECK admits `reconcile_payments`); in `packages/shared`: new `ports/i-payment-gateway.ts` and `ports/i-gateway-repository.ts`, `ports/index.ts`, **one added read** (`findGatewayPayment`) on each of `ports/i-billing-repository.ts` and `ports/i-event-charge-repository.ts`, new `domain/billing/gateway-money.ts` with its spec and `domain/billing/index.ts`, and `types/entities.ts` (`Entities.Billing.GatewayCheckout`, `GatewayEvent`, `Entities.Config.CheckoutStatus`, the `system` user status and the `reconcile_payments` job name); on the API: new `src/adapters/payment/**` (the Mercado Pago adapter only — the stub adapter the tests bind lives under `apps/api/test/adapters/payment/` and never ships, §6 decision 21), new `src/adapters/db/d1-gateway-repository.ts`, the `findGatewayPayment` read in `d1-billing-repository.ts` and `d1-event-charge-repository.ts`, the `status = 'system'` filter in the admin user listing (`d1-user-repository.ts` / `admin-users.controller.ts`) with the system actor's login refusal in `src/controllers/auth.controller.ts` and its exemption in `apps/api/scripts/check-no-dev-seed.ts`, new `src/core/payments/**` (`gateway-service.ts`, `config.ts`, `gateway-registry.ts`), the gateway sibling entry points and the *Pay* link in the existing reminder e-mails (§6 decision 27) in `src/core/billing/{billing-service,event-charge-service}.ts`, `pendingCheckout` on the statements in `src/core/billing/accounting-service.ts`, new `src/routes/webhooks/**` mounted from `src/routes/index.ts`, `src/routes/me/billing.ts`, `src/routes/admin/billing.ts`, `src/controllers/{me-billing,admin-billing}.controller.ts` and a payments controller (event charges are already served from the billing router — §6 decision 22 — so no file under the events router changes), new `src/jobs/reconcile-payments.ts`, the `scheduled()` dispatch in `src/index.ts`, `src/container.ts`, `src/openapi/components/**`, `apps/api/openapi.json`, `wrangler.jsonc`, `.dev.vars.example`, `worker-configuration.d.ts`, and the matching specs and fixtures under `apps/api/test/**`; on the web: `src/app/(protected)/settings/billing/**`, `src/app/(protected)/dashboard/**` and `src/components/dashboard/**` (the *payment due* card only), `src/app/(protected)/admin/billing/**`, `src/app/(protected)/admin/events/[eventId]/event-charges-panel.tsx` (the event-charge ledger rows only), `src/app/(protected)/__tests__/no-withholding.test.tsx` (extended, never relaxed), `src/components/billing/**`, `src/lib/{me-billing-api,admin-billing-api}.ts`, the regenerated `src/lib/api-types.gen.ts`, and `src/i18n/dict-{en,pt}.ts`; on tooling and docs: `config/deployment.schema.jsonc`, `scripts/label.mjs` + `scripts/label.test.mjs`, `scripts/cloudflare/provision-label.mjs` and its tests, `docs/onboarding.md`, new `docs/operations/payments.md`, `docs/ReleaseNotes.md`, `CLAUDE.md`, the RFC 0026 status line with its `docs/product/RFCs/README.md` row (closeout only), `scripts/demo/**` and `apps/api/scripts/sqls/**` **only** where a seed or a CI row count must account for the system actor, and this milestone folder. **Deliberately unchanged** (RFC 0026 "Affected", S8): every content route (`routes/topics*`, `routes/public/**`), `middleware/auth-guard.ts`, `d1-enrollment-repository.ts`, the catalog gate, and every test asserting that a delinquent student keeps access — paying grants nothing and not paying revokes nothing. The existing `recordPayment` and `reversePayment` keep their rules and signatures; the shape of `domain/billing/receivable.ts` does not change; **no money table is altered or rebuilt**. It is **not** an opportunity to: gate anything on payment (`402`, a read-only mode, a middleware on a content route); use the provider as a subscription engine (Stripe Billing, Mercado Pago *Suscripciones*, provider-side invoices, a customer portal); charge automatically (saved methods, autopay, retries on the due date); put card data, an embedded card form or a provider JavaScript SDK on the platform; issue fiscal documents or do statutory bookkeeping; build a storefront, creator splits or Connect-style payouts; add a reconcile-only (bank statement matching) mode; let a student choose a partial amount or split one receivable across methods; build a configuration screen or accept provider keys in the backoffice; collect in another currency or in crypto; create payer accounts outside the tenant; add a dunning sequence or a new reminder e-mail; add a second **real** provider adapter (v1 ships Mercado Pago and stubs — R7), a BTCPay adapter, an `apps/payments` package or a separate database; or add any npm dependency (the provider client is `fetch`, signatures are Web Crypto). If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **A student pays an open receivable online.** *Pay* on an open contract invoice or event charge sends the student to the provider's hosted checkout — Pix first-class, card beside it — for the receivable's full open balance (RFC Goals, §3).
- **Confirmed money lands on the existing ledger.** Every confirmed provider payment is written through the rail's own service as `method = 'gateway'` with `<provider>:<id>` in `external_reference`, recorded by the system actor `system:payment-gateway`; the two rails stay apart and the ledger stays the source of truth (RFC §2, §5, R2, R8).
- **A webhook is a trigger, never a fact.** The anonymous `POST /v1/webhooks/payments/{provider}` verifies the delivery on raw bytes, then reads the payment back from the provider and acts on the **fetched** status; no amount, currency or status is taken from a request body (RFC §1, §4, R12).
- **Idempotency is enforced by indexes.** At most one open checkout per receivable, one `gateway_events` row per provider event id, one ledger row per provider payment, refund or dispute id — and an event answered `503` is processed again on its next delivery rather than swallowed as a duplicate (RFC §2, §4 step 5, R9, R16).
- **A refund is an ordinary reversal.** An admin reverses a gateway payment from the ledger; the reversal is written when the provider accepts, a retry never refunds twice, and refunds or lost disputes made on the provider's side land through the same webhook (RFC §5, R14).
- **Recovery does not depend on the provider's retries.** An hourly, capped reconcile run on its own Cron Trigger asks the provider about open checkouts — including unexpired ones — lands what it finds, retries unsettled events and records itself in `job_runs` (RFC §6, R16).
- **A tenant combines providers and methods by configuration.** `PAYMENTS_PROVIDERS` lists, per label and environment, the bound providers and the methods each offers; the student chooses how to pay; v1 ships one real adapter (Mercado Pago) and proves the list against a test-only stub bound under two provider names (RFC §8, §8.1, R6, R7).
- **Credentials follow the RFC 0012 contract.** Two secrets per bound provider, detected by name, never written by provisioning, never in argv, on disk or in a log line; a live key on staging or a test key on production is a loud configuration error, not a charge (RFC §8, R13).
- **The admin sees what is pending and what went wrong.** Provider reference and deep link on the ledger, "pending online payment" on roster and statements, a refund confirmation, and an exceptions panel for orphans, mismatches, failed or stuck events and disputes (RFC §7, R15).
- **Shippable dark.** Every phase merges behind `PAYMENTS_PROVIDERS = none`, the default on every label, where the student routes and the webhook answer `404` and no *Pay* affordance renders (RFC Implementation Plan).

Out of scope (explicit, from RFC 0026 Non-Goals):
- **Gating access on payment** — RFC 0013 #2 stands: no `402`, no content middleware, no read-only mode. Not reopened here.
- **The provider as subscription engine** — contracts, periods, amendments, pauses and grace stay in ArenaQuest (RFC Alternative 1).
- **Automatic charging** — saved methods, autopay, off-session retries; a future RFC with a mandate design (Alternative 4).
- **Card data on the platform**, embedded card forms, the provider's JavaScript SDK — PCI scope stays at SAQ A (Alternative 3).
- **Fiscal documents and statutory bookkeeping** — as in RFC 0013.
- **Storefront products, creator revenue splits, Connect-style payouts** — a future RFC (Alternative 5).
- **Reconcile-only mode** — matching Pix transfers against a bank statement (Alternative 2).
- **Partial payments chosen by the student** — a checkout is for the full open balance; what may still differ is settled by R14.
- **Splitting one receivable across methods** — combining is about what a tenant offers, never about one payment.
- **A configuration screen** — the provider list is deployment configuration; an admin page that shows or narrows it is a follow-up, self-service keys a separate RFC.
- **Multi-currency and crypto collection** — BRL is the only active currency (RFC 0013 #4).
- **Payer accounts outside the tenant** — a checkout belongs to the student who owes the receivable.
- **A dunning sequence or new reminder e-mails** — the two existing reminders gain a *Pay* link, nothing more (R11).
- **One provider only in v1 without the list** — recorded as RFC Alternative 14 and not adopted; R6 and R13 stand.

---

## 2. Functional Requirements

**Configuration and providers**
- `PAYMENTS_PROVIDERS` is `none` (also the meaning of an absent var) or a comma-separated list of `provider:method+method` entries over the providers `stripe` · `mercadopago` · `asaas` · `pagarme` and the methods `pix` · `card` · `boleto`.
- A provider appears at most once; a method is offered by at most one provider; a method must be in that provider's capability table for the tenant's active currency; every listed provider needs both its secrets; an entry with no method (`asaas:`) keeps a provider bound — webhook, refunds, reconcile — while offering nothing new.
- Any breach of those rules, or a key whose mode does not match the environment (live on `*-staging`, test on production), makes the payment routes answer `500 PAYMENTS_CONFIG_INVALID`; there is never a silent fallback to `none` or to fewer methods.
- With `none`, the registry is empty: the checkout routes and the webhook answer `404`, statements carry an empty `payOptions`, the hourly run returns before its first query and records nothing. Previews run this way.
- Only the Mercado Pago adapter is real in this milestone; the list accepts another provider name only once its adapter exists.

**Schema and the system actor**
- One additive migration creates `gateway_checkouts` (status `open | paid | expired | cancelled | failed | mismatch`, the receivable as `(receivable_kind, receivable_id)`, two typed nullable payment FKs guarded by CHECKs, `expires_at`, `closed_at`, `last_checked_at`, `failure_detail`) and `gateway_events` (primary key `(provider, event_id)`, outcome `received | applied | duplicate | ignored | orphan | mismatch | failed`, `attempts`, `error`).
- A unique partial index admits one `open` checkout per receivable; a unique partial index on `external_reference WHERE method = 'gateway'` exists on `payments` and on `event_charge_payments`; a non-gateway row may still repeat a reference.
- The system actor `system:payment-gateway` (`status = 'system'`, no role, empty hash, `.invalid` e-mail) exists on every label after the migration, cannot log in, is listed in no admin user list and is ignored by the admin lockout guards and the no-dev-seed guard.
- `job_runs` admits `reconcile_payments`; no money table is altered or rebuilt.

**Checkout (student and admin on behalf)**
- `POST /v1/me/billing/checkouts { kind: 'invoice' | 'event_charge', id, provider? }` answers `201` (or `200` when an open checkout is reused) with `{ checkoutId, provider, url, expiresAt, amountMinor, currency, status: 'open' }`; `GET /v1/me/billing/checkouts/{id}` reads the caller's own checkout.
- A receivable that does not exist or is not the caller's is `404`, never `403`; one that is paid, void or has no balance is `409 RECEIVABLE_NOT_PAYABLE`; with several offering providers and no `provider` the answer is `400 PAYMENT_PROVIDER_REQUIRED`; a currency the provider cannot settle is `409 PAYMENTS_UNSUPPORTED_CURRENCY`; a provider failure is `502 PAYMENTS_PROVIDER_ERROR` and the row is closed `failed`.
- A receivable has one live checkout: a second *Pay* returns the open one when it has more than 5 minutes left and a new one otherwise; choosing another provider closes the first as `cancelled`. The stored expiry is the earlier of the provider's and 24 hours from creation.
- Checkout creation is limited to 10 per hour per user and audited as `payments.checkout_created`.
- An admin creates a checkout on behalf of a student through `POST /v1/admin/billing/invoices/{id}/checkouts` and `POST /v1/admin/billing/charges/{id}/checkouts` (the path follows the router that already serves event charges — §6 decision 22).
- `GET /v1/me/billing` and the admin statement gain `payOptions: Array<{ provider, methods }>` and a `pendingCheckout` per receivable; the roster shows the same pending state.

**Webhook**
- `POST /v1/webhooks/payments/{provider}` is anonymous, mounted beside `/events` and not under `routes/public/`, and runs in this order: IP limiter (120 rpm, `429`) → body bound (64 KiB, `413`) → provider bound on this label (`404` otherwise) → signature or token verified on the raw bytes with a 5-minute tolerance (`401`, no row, no log line with the body) → de-duplication on `(provider, event_id)` → fetch-to-confirm → land.
- A known event whose outcome is settled is answered `200 { outcome: 'duplicate' }` and writes nothing; one stored as `failed` or `received` is processed again with `attempts + 1`.
- The fetched status decides: `paid` lands; `pending`, `failed` and `expired` are `ignored` and leave the checkout open; `refunded` lands the payment if it never landed, then its refunds; `disputed` follows the dispute rules. An unknown payment is an `orphan`, a currency mismatch a `mismatch`; both are `200`, land nothing and raise an admin alert. Our own failure is `503` with the event stored `failed`.
- Each bound provider has its own URL and its own secret; a delivery signed with another provider's secret is `401`.

**Landing, refunds and disputes**
- A landed payment is the amount the provider captured, on the rail the checkout names, with `recorded_by = 'system:payment-gateway'`; the invoice flips to `paid` exactly as for a cash payment; a payment confirmed for an `expired` or `cancelled` checkout still lands and that checkout becomes `paid`.
- Reversing a gateway payment through the existing `reverse` routes asks the provider for a full refund under the idempotency key `rev:<payment id>` and writes the mirror reversal (with the refund id as its reference) only when the provider accepts; a refusal is `409 PAYMENTS_REFUND_REFUSED`; a provider no longer bound is `409 PAYMENTS_PROVIDER_NOT_ENABLED`; a refund the provider already holds is not requested again and answers `200` with the existing row; an accepted refund whose reversal could not be written is `503 PAYMENTS_REFUND_UNRECORDED` naming the refund id.
- A refund made in the provider's dashboard (full or partial) and a lost dispute land as negative gateway rows keyed on the provider's refund or dispute id, with `reverses_id = NULL`.
- An opened dispute raises an alert and writes no ledger row; on the contract rail it sets a `billing_standing_hold` ("payment under dispute") released when the dispute closes; an event charge never gets a hold.

**Reconcile run**
- A second Cron Trigger, `17 * * * *`, runs `reconcile-payments` alone; the daily `0 6 * * *` keeps billing, the submission sweep and the mission reconcile unchanged; an unknown expression logs an error and runs nothing.
- Each run confirms at most 25 checkouts (past expiry, open for more than 30 minutes, or closed without a final ask), retries at most 10 unsettled events (15 minutes to 72 hours old, fewest attempts first), counts old orphans and mismatches, and checks the key mode of every bound provider; what does not fit is reported as `deferred`.
- A session-less open checkout older than 30 minutes is closed `failed`; a checkout whose provider is no longer bound is counted `unreachable` and fails the run.
- `POST /v1/admin/billing/payments/reconcile` runs the same job on demand; `GET /v1/admin/billing/payments/exceptions` lists orphans, mismatches, failed events, events stuck in `received` for more than an hour and disputes.

**Student UI**
- On `/settings/billing` each open invoice and event charge shows *Pay* when at least one provider offers a method; with several, the student first chooses how to pay, each choice labelled by its methods and never by the provider's name alone. The hosted page opens in a new tab, never an iframe.
- A receivable with an open checkout shows "payment in progress · expires at …" with *Open again*; a landed gateway payment shows as *Paid online* with its date. On return from the hosted page the statement updates by itself: bounded polling (at most 5 reads over about a minute, paused while the tab is hidden), with the return URL's `outcome` treated as a hint only.
- `/dashboard` shows a *payment due* card — amount, due date, the same *Pay* action, a link to the statement — for each open contract invoice, earliest due date first, read from the `GET /v1/me/billing` response the standing notice already fetches; with no open contract invoice or no offering provider the card is not rendered. Event charges stay on the statement.
- Nothing is hidden, disabled or blocked by a standing or by an unpaid receivable.

**Admin UI**
- The ledger shows a gateway row as method *Online* with the provider's payment or refund id and a deep link into the provider's dashboard; reversing it opens a confirmation that says the provider will return the money.
- Roster and statement show "pending online payment"; recording a cash payment on a receivable with an open checkout is allowed, with a warning.
- The exceptions panel lists its rows oldest first with provider ids and the action each wants — match by hand through the ordinary payment form with `method = 'gateway'`, refund, or dismiss with a note.
- Only `admin` sees or touches any of it; `content_creator` and `tutor` see nothing; a student sees and pays only their own receivables.

**Provisioning, i18n and docs**
- `config/deployment.schema.jsonc` declares each provider's two secrets under `api-secrets` with `requiredWhen: "PAYMENTS_PROVIDERS~=<provider>"`; `requiredWhenActive` gains the contains operator `~=`; `infra-check` reports exactly the secrets a label's bound providers need, by name, each gap with its `scripts/create-secrets.sh … --env <label>-<env>` fix command. Provisioning never writes them.
- Every new user-facing string exists in `dict-en.ts` and `dict-pt.ts` with identical keys.
- `docs/operations/payments.md` covers webhook registration per label and environment, sandbox credentials and simulators, retiring a provider with an empty entry, and the reconciliation runbook; the two existing reminder e-mails carry a *Pay* link (copy only).

---

## 3. Acceptance Criteria

- [ ] **S1.** On a local replica, a second `payments` row with the same `external_reference` and `method = 'gateway'` fails; the same pair with `method = 'pix'` succeeds; both hold on `event_charge_payments`. The system actor row exists, `POST /v1/auth/login` with its e-mail is `401`, and `GET /v1/admin/users` does not list it.
- [ ] The migration contains no `ALTER` and no rebuild of `payments`, `event_charge_payments`, `invoices` or any other money table; the CHECKs on `gateway_checkouts` refuse a cross-rail `*_payment_id`; the admin lockout guards and `check-no-dev-seed.ts` ignore the system actor.
- [ ] `decimalToMinor` converts `180.5`, `180.50`, `0.01` and `1000000.00` correctly against exponents 0, 2 and 8, throws on excess fraction digits, and no `parseFloat` appears in any payment path.
- [ ] **S2.** With the recorded sandbox fixtures: a verified `payment` event lands exactly one ledger row with `method = 'gateway'`, `recorded_by = 'system:payment-gateway'` and the provider payment id; the same event delivered three times leaves one ledger row and **one** `gateway_events` row (`applied`), the second and third answered `200` `duplicate`; an event whose first attempt answered `503` is processed on its next delivery and ends `applied` with `attempts = 2`; a `pending` event is `ignored` and the approval that follows lands; a tampered body is `401` and leaves no row anywhere; an unknown payment is `200` and an `orphan`; a payment in another currency is `200`, a `mismatch`, and no ledger row.
- [ ] Two concurrent deliveries of one event land one ledger row; a delivery on one provider's URL signed with another's secret is `401`; a refund reported as a payment update lands as a refund; a body above 64 KiB is `413` and a request over the limiter's budget is `429`, both before the body is read.
- [ ] **S3.** A student creating a checkout for another student's invoice gets `404`; for a `paid` invoice `409`; twice for the same open invoice gets the same `checkoutId`; with `PAYMENTS_PROVIDERS = none` the route is `404`. A checkout for which the provider granted 30 minutes is stored with that expiry, not 24 h, and a second *Pay* with under 5 minutes left returns a new checkout.
- [ ] Reversing a gateway payment writes the reversal only after the provider accepts, with the refund id as `external_reference`; a refund refused by the provider is `409 PAYMENTS_REFUND_REFUSED` and writes nothing; a refund retried after its notification already landed answers `200` with the existing row and writes nothing.
- [ ] **S4.** A checkout whose webhook is dropped in the test harness is landed by `reconcile-payments` on the next run, while the checkout is still unexpired, and `job_runs` holds a `reconcile_payments` row with `landed: 1`. With 30 checkouts due, one run asks the provider about 25 and records `deferred: 5`. `scheduled()` called with the hourly expression runs only `reconcile-payments`; called with the daily one it runs billing, the sweep and the mission reconcile and not `reconcile-payments`; a test reading `wrangler.jsonc` proves both expressions equal the dispatch constants.
- [ ] **S5.** At 390 px a demo student on budo staging sees *Pay* on an open invoice, completes a simulated Pix in the sandbox, returns, sees "payment processing" and then — without reloading — *Paid online*; the same invoice shows on `/dashboard` as a *payment due* card with *Pay* before the payment and is gone after it; the admin ledger shows the row with the provider id and a working dashboard link.
- [ ] **S6.** `make infra-check-staging LABEL=budo` lists the bound provider's `PAYMENTS_<PROVIDER>_SECRET_KEY` and `PAYMENTS_<PROVIDER>_WEBHOOK_SECRET` as present and names none for arenaquest staging (`PAYMENTS_PROVIDERS = none`); no secret value appears in any CI log or in `git grep`.
- [ ] **S7.** Deploying budo staging with a live-mode key makes the next reconcile run `failed` with `PAYMENTS_CONFIG_INVALID` and makes `POST /v1/me/billing/checkouts` answer `500 PAYMENTS_CONFIG_INVALID`, not a live charge.
- [ ] **S8.** `git diff origin/main` touches no file under `routes/topics*`, `routes/public/`, `middleware/auth-guard.ts` or `d1-enrollment-repository.ts`, and no test asserting "delinquent student keeps access" changes.
- [ ] **S9.** With two stub adapters and `PAYMENTS_PROVIDERS = a:pix,b:card`: the statement lists two `payOptions`; a checkout without `provider` is `400`; choosing `b` while a checkout on `a` is open leaves exactly one `open` row and one `cancelled`; a late payment on the cancelled one still lands; the same bare payment id from `a` and from `b` lands as two ledger rows. `a:pix,b:pix`, an unknown method, and a listed provider missing a secret are each `PAYMENTS_CONFIG_INVALID`; with `a:pix+card,b:` the statement offers only `a` and a delivery for `b` is still verified.
- [ ] A `content_creator` and a `tutor` get `403` on every admin payments route (checkouts on behalf, reconcile, exceptions), and the webhook handler never sets `user` on the context.
- [ ] `apps/api/package.json` and `apps/web/package.json` gain no dependency, and the web bundle loads no provider script.
- [ ] `check-i18n-coverage.js` passes; `NEXT_PUBLIC_LANGUAGE=en` and default `pt` both render the statement, the provider choice, the dashboard card and the exceptions panel with no hardcoded string.
- [ ] `apps/api/openapi.json` and `apps/web/src/lib/api-types.gen.ts` are regenerated and committed with the routes that change them.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the scope declared in the guardrail.

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono; per-request adapters built in `buildApp(env)`; `container.ts` gains a `payments` group (`gateways: GatewayRegistry`, `gatewayRepo`, `gatewayService`) and two `KvRateLimiter`s (`rl:checkouts:<userId>` 10/h, an IP-keyed `webhooks` limiter at 120 rpm). Controllers return `ControllerResult<T>` from `src/core/result.ts`. **Validation is `@hono/zod-openapi` `createRoute` + Zod at the route layer — not `@ValidateBody`/`@Body` decorators.** Admin payment routes carry `requireRole(ROLES.ADMIN)`; the webhook router has no auth middleware and is the only router that reads the raw body (`await c.req.text()` once).
- **Provider adapter:** a plain `fetch` client over Mercado Pago's REST API with a 10-second timeout; webhook verification with Web Crypto HMAC-SHA256 on the raw bytes (constant-time token compare for token providers); decimal strings converted by `decimalToMinor` only. No provider SDK, no new dependency.
- **Shared:** ports `i-payment-gateway.ts` (`createCheckout`, `getPayment`, `findPaymentsForCheckout`, `refund`, `verifyWebhook`) and `i-gateway-repository.ts` (`createCheckout`, `getCheckout`, `findOpenCheckout`, `closeCheckout`, `recordEvent`, `markEvent`, `listExceptions`, `listCheckoutsToConfirm`, `markChecked`, `listUnsettledEvents`, `dismissException`) — plain records, no Cloudflare types; `domain/billing/gateway-money.ts` (pure); `Entities.Billing.GatewayCheckout` / `GatewayEvent`, `Entities.Config.CheckoutStatus`; `domain/billing/receivable.ts` reused unchanged as the checkout key.
- **Database:** one D1 migration — two new tables, the system actor row, two partial unique indexes on the payment tables, the `job_runs` rebuild. Landing, the event outcome and the checkout flip go in one `db.batch`; every event outcome write is conditional (`WHERE outcome IN ('received','failed')`).
- **Scheduling:** two expressions in the top-level `triggers.crons` of `wrangler.jsonc`; `scheduled()` dispatches on `controller.cron` against constants shared with a test; runs are recorded through `recordJobRun`.
- **Frontend:** Next.js 15 App Router (React 19, Tailwind v4); client components for the *Pay* action, the provider choice and the polling return state; `me-billing-api.ts` / `admin-billing-api.ts` over the shared API client; types from the regenerated `api-types.gen.ts` (`pnpm gen:api-types`); both i18n dictionaries + `check-i18n-coverage.js`. The hosted page is a link to a new tab.
- **Tooling:** `scripts/label.mjs` (`requiredWhenActive` with `~=`), `scripts/cloudflare/provision-label.mjs` (`externalSecretNames`, `--check`), `config/deployment.schema.jsonc`; `node --test` for the script suites.
- **Tests:** Vitest unit tests for `gateway-money` and the provider-list rules (shared / API); Vitest + `@cloudflare/vitest-pool-workers` (API — webhook pipeline against recorded sandbox fixtures, ledger indexes, ownership and role matrix, refund recovery, reconcile caps and cron dispatch, the test-only stub adapter bound under two provider names for S9); Vitest + RTL (web — *Pay*, provider choice, polling states, dashboard card, exceptions panel). The 390 px student walk of S5 runs on the Playwright scaffold if backlog `test-debt/11-e2e-playwright-scaffold` has landed by Phase 4; otherwise it is a recorded manual walk with the `qa` skill, noted in the closeout.

---

## 5. Task Breakdown

Sixteen tasks over the RFC's six phases. Backend and frontend are separate files; every frontend
task depends on the backend task whose contract it calls and touches nothing under the API's
source. Task 14 is the one backend task of Phase 4 (reminder e-mail copy).

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Payment contracts: ports, money conversion and entities](./01-payment-contracts.task.md) | 0 | Backend | ✅ Done |
| 02 | [Provider list, gateway registry and stub adapter](./02-provider-list-and-gateway-registry.task.md) | 0 | Backend | ✅ Done |
| 03 | [Gateway schema, repository and system actor](./03-gateway-schema-repository-and-system-actor.task.md) | 1 | Backend | ✅ Done |
| 04 | [Gateway ledger entry points](./04-gateway-ledger-entry-points.task.md) | 1 | Backend | ✅ Done |
| 05 | [Mercado Pago adapter](./05-mercadopago-adapter.task.md) | 2 | Backend | ☐ Open |
| 06 | [Webhook route and payment landing](./06-webhook-route-and-payment-landing.task.md) | 2 | Backend | ☐ Open |
| 07 | [Student checkout routes and pay options](./07-student-checkout-routes.task.md) | 3 | Backend | ☐ Open |
| 08 | [Admin on-behalf checkouts and gateway refunds](./08-admin-checkouts-and-gateway-refunds.task.md) | 3 | Backend | ☐ Open |
| 09 | [Reconcile run, cron dispatch and exceptions routes](./09-reconcile-run-and-exceptions-routes.task.md) | 3 | Backend | ☐ Open |
| 10 | [Pay on the student statement](./10-student-statement-pay.task.md) | 4 | Frontend | ☐ Open |
| 11 | [Payment due card on the dashboard](./11-dashboard-payment-due-card.task.md) | 4 | Frontend | ☐ Open |
| 12 | [Admin ledger, pending online payment and refund confirmation](./12-admin-ledger-online-payments.task.md) | 4 | Frontend | ☐ Open |
| 13 | [Payment exceptions panel](./13-payment-exceptions-panel.task.md) | 4 | Frontend | ☐ Open |
| 14 | [Pay link in the reminder e-mails](./14-reminder-email-pay-link.task.md) | 4 | Backend | ☐ Open |
| 15 | [Provider configuration schema and provisioning](./15-provider-configuration-and-provisioning.task.md) | 5 | Backend | ☐ Open |
| 16 | [Operations runbook, staging rollout and closeout](./16-runbook-staging-rollout-and-closeout.task.md) | 5 | Backend | ☐ Open |

Dependency graph:

```
01 ──► 02 ──► 05 ──┐
 │      │          ├──► 06 ──► 07 ──► 10 ──► 11
 │      └──► 15    │     │      └──► 14
 └──► 03 ──► 04 ───┘     ├──► 08 ──► 12 ──┐
                         └──► 09 ─────────┴──► 13

09, 11, 12, 13, 14, 15 ──► 16
```

**Recommended execution order:** `01` → `02` → `03` → `04` → `05` → `06` → `07` → `08` → `09`
→ `10` → `11` → `12` → `13` → `14` → `15` → `16`. Numbers are file ids; this list is the
execution order. What can overlap: `02` and `03` once `01` is in; `05` beside `03`/`04`; the
three Phase 3 backend tasks (`07`, `08`, `09`) once the webhook path (`06`) has landed; each
frontend task as soon as its backend route has merged; `15` any time after `02`. `16` is last —
it flips budo staging and writes the closeout.

Sequencing facts the task files carry:

- **Migration number.** Task 03 takes the next free number when it opens — `0033` today, later
  if M29's `0033`/`0034` land first.
- **Dashboard card.** Task 11 ships the *payment due* card as a widget instead of a fixed block
  if M29's widget dashboard has merged by then (RFC §7); either way it reuses the statement the
  dashboard already fetched and adds no request.
- **Cron allowance.** Task 09 does not put the hourly expression on `main` before the account's
  Cron Trigger allowance and CPU limit are confirmed (§6 decision 18) — a merge deploys every
  label and environment.
- **The 390 px walk of S5.** Playwright if backlog `test-debt/11-e2e-playwright-scaffold` has
  landed by Task 10; otherwise a recorded manual walk with the `qa` skill, noted in the closeout.
- **Rollout.** Tasks 02 and 15 leave every label and environment on `PAYMENTS_PROVIDERS = none`.
  Task 16 flips exactly one — budo staging — after the operator has set the two sandbox secrets
  and registered the webhook URL. Budo production is an operator act after the owner's live
  check, never a task merge.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0026 "Resolved Decisions")

R1–R5 are the owner's brief (2026-11-06 / 2026-11-16), R6 the owner's revision of 2026-11-17, R7–R15 the owner's answers to the nine Open Questions on 2026-11-18, and R16 the design review relayed by the owner on 2026-11-26. The RFC has no open question left. Implementers do not reopen these.

1. **A new RFC, not an amendment to RFC 0013 (R1)** — 0013 closed as Implemented; its #9 prescribes a separate RFC once a provider is in hand.
2. **The ledger stays the source of truth; the provider is a collector (R2)** — payments land through the existing `recordPayment` path with `method = 'gateway'`; a refund is a reversal; no provider-side subscriptions, invoices or portal.
3. **Billing never gates access (R3)** — no `402`, no middleware on content routes, nothing touches the catalog gate.
4. **Integer minor units against `currencies.exponent`; BRL only (R4)** — provider decimals are converted at the adapter boundary, string-based.
5. **Hosted checkout only (R5)** — no card data on the platform, no fiscal documents, no charging without the student's action.
6. **A tenant may combine methods across providers (R6)** — `PAYMENTS_PROVIDERS` lists providers and their methods; a method belongs to one provider; one live checkout per receivable; never split; no configuration screen. Rules out a BTCPay adapter, an `apps/payments` package and a separate database in this milestone.
7. **Charge through the provider; first adapter Mercado Pago (R7)** — Checkout Pro has Pix and card natively in Brazil; reconcile-only stays a Non-Goal; the port stays provider-neutral. The stale branch `claude/compassionate-rubin-11a6pn` is deleted once the RFC merges.
8. **A per-label system actor records machine-written payments (R8)** — one `users` row, `status = 'system'`, inserted by the migration; no money table is rebuilt to make `recorded_by` nullable.
9. **Idempotency in two layers (R9)** — `gateway_events` on `(provider, event_id)` for deliveries; a partial unique index on `external_reference WHERE method = 'gateway'` for money; reversals carry the refund id; references are `<provider>:<id>`.
10. **One `gateway_checkouts` table (R10)** — keyed on `receivable.ts`'s `(kind, id)`, one open row per receivable, two typed nullable FKs with CHECKs — not one table per rail.
11. **Where Pay appears (R11)** — the student statement, the admin on-behalf routes, the two existing reminder e-mails (copy only) and, added by the owner, a *payment due* card on the student dashboard for open contract invoices. Return URLs are hints only.
12. **The webhook surface (R12)** — `POST /v1/webhooks/payments/{provider}` beside `/events`; limiter → body bound → signature with a 5-minute tolerance → de-dup → fetch-to-confirm → one batch; `401` writes nothing, verified-but-unusable is `200` plus an exception row, our own failure is `503`.
13. **Configuration and secrets (R13)** — the `PAYMENTS_PROVIDERS` var plus two provider-prefixed secrets per bound provider, declared with `requiredWhen: "PAYMENTS_PROVIDERS~=<provider>"`, detected by name, never written by provisioning; the key-mode assertion keeps staging on the sandbox; the operator registers the webhook URL.
14. **Edge money cases (R14)** — a checkout is for the full balance; the ledger lands what the provider captured; an overpayment is a credit the admin refunds; a currency mismatch lands nothing; partial refunds and lost disputes are negative gateway rows with `reverses_id = NULL`; an opened dispute sets a standing hold on the contract rail only.
15. **What the admin sees (R15)** — provider id and deep link on the ledger, `pendingCheckout` on roster and statements, refund confirmation, an exceptions panel in v1; content creators and tutors see nothing.
16. **Design review adopted, points 1–6 (R16)** — unsettled events are processed again; the fetched status decides and `eventId` is the notification's id; reconciliation runs hourly on its own Cron Trigger, capped at 25 checkouts and 10 events, and asks about unexpired checkouts; the stored expiry is `min(provider's, now + 24 h)` with no reuse under 5 minutes; refund recovery is an idempotent retry and a missing `reverses_id` link is accepted; the return page polls for about a minute. Point 7 — one provider in v1 without the list — is RFC Alternative 14 and **not** adopted.
17. **The caps and the timeout are constants, not configuration (RFC §6)** — 25 checkouts, 10 events, 10 seconds per provider call, 35 calls worst case, which fits Workers Free's 50 subrequests; a tenant that outgrows them shows it in `deferred`.
18. **If the account cannot carry a second Cron Trigger (RFC Risks)** — the fallback is one hourly trigger with the three daily jobs gated on the 06:00 UTC hour. The account's allowance and the CPU limit per Cron Trigger are confirmed **before the hourly expression reaches `main`** — a merge deploys every label and environment, so "in Phase 5" would be after the fact. Task 09 carries the check and its PR records the account plan, the triggers in use and the CPU limit; Task 16 records the outcome in the runbook. Never silently.

### Pinned while writing the task files

Decisions 19–27 are **not** RFC decisions. They close gaps the RFC leaves open and were pinned by
`write-tasks` so that sixteen task files agree with each other; the owner may veto any of them in
review, and the task that cites it changes with it. The RFC text is not modified.

19. **`PAYMENTS_KEY_MODE` (`test` | `live`; absent means `test`)** — the Worker has no var that tells staging from production, so the key-mode assertion (R13) compares this var with the mode the secret key declares by its prefix, without calling the provider. Task 02 pins it in every `env.*` block; Task 15 declares it in the deployment schema as an enum. A `live` key under `test`, or the reverse, is `500 PAYMENTS_CONFIG_INVALID` on payment routes.
20. **An exception is dismissed, not deleted** — `gateway_checkouts` and `gateway_events` carry nullable `dismissed_at`, `dismissed_by` and `dismiss_note` (Task 03); the repository port gains `dismissException` (Task 01); `POST /v1/admin/billing/payments/exceptions/dismiss` takes `{ ref, note }` with a note of 1–500 characters and is audited as `payments.exception_dismissed` (Task 09). Dismissal changes neither a status nor an outcome and writes no ledger row; it hides the row from the list and from the 7-day stale count. A new dispute state on a dismissed checkout clears the dismissal (Task 06).
21. **The stub adapter never ships** — it lives at `apps/api/test/adapters/payment/stub-gateway-adapter.ts` and tests bind it through the registry's adapter-factory map, twice under two provider names for S9. The production map is empty after Task 02 and holds only `mercadopago` after Task 05, so no deployed Worker can resolve a stub.
22. **The on-behalf route for an event charge follows the repository, not the RFC's sketch** — event charges are served by `routes/admin/billing.ts` (`/v1/admin/billing/charges/{id}/…`), so the route is `POST /v1/admin/billing/charges/{id}/checkouts`, beside `POST /v1/admin/billing/invoices/{id}/checkouts`. No file under the events router changes.
23. **The three exception actions (R15)** — *match by hand*: pick the student, then the open receivable, then the existing payment form opens with method *Online* and the provider reference prefilled; success dismisses the exception with a generated note; a reference that already landed says so and offers dismissal (the API side is Task 04's `400` on a malformed reference and `409 PAYMENT_REFERENCE_EXISTS`). *Refund*: with no ledger row it is a deep link into the provider's dashboard — the provider refund then arrives as another orphan to dismiss; with a ledger row it is a link to that row's ordinary reversal. The panel itself never calls a refund endpoint. *Dismiss*: decision 20, note required.
24. **A statement never fails on payment configuration** — `GET /v1/me/billing` and the admin statement answer `200` with `payOptions: []` under an empty registry or an invalid provider list; the failure is loud where it belongs — `500 PAYMENTS_CONFIG_INVALID` on the payment routes and a failed `reconcile_payments` run. The reminder e-mails likewise omit the *Pay* line (Task 14).
25. **The provider dashboard link is built on the web** — the URL template per provider lives in the shared capability table in `domain/billing/gateway-money.ts`; the web builds the deep link from `external_reference` (`<provider>:<id>`). No API field carries a provider URL.
26. **"Admin alert" in the RFC means a row on the exceptions list plus a count in the reconcile summary** — v1 sends no e-mail, push or other out-of-app notification to an admin.
27. **"The two existing reminder e-mails" are four builders** — the repository sends the two reminders (due date, grace lapsed) on each rail: `due_date` / `grace_lapsed` for contract invoices and `extras_due_date` / `extras_grace_lapsed` for event charges. Task 14 adds the same one line and link to all four; it adds no e-mail, no schedule and no new kind.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] The account's Cron Trigger allowance and CPU limit per Cron Trigger are confirmed against the plan the Workers run on **before** the second expression is deployed, and the outcome (two triggers, or the single-hourly fallback) is recorded in the closeout.
- [ ] Budo **staging** runs `PAYMENTS_PROVIDERS = mercadopago:…` on sandbox keys with the webhook registered: a demo student pays a demo invoice by simulated Pix, the ledger row carries the system actor, and the hourly run records `reconcile_payments` `ok`.
- [ ] Every other label and environment — budo production included — still deploys with `PAYMENTS_PROVIDERS = none`. The production flip is an operator act after the owner's live check (a real R$ 1,00 charge and its refund), recorded in the closeout; it is not a task merge.
- [ ] `docs/operations/payments.md` exists and `docs/onboarding.md` and `CLAUDE.md` describe the payments surface, its secrets and the hourly run.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0026 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
