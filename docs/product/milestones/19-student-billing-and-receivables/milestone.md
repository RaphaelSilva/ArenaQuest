# Milestone 19 — Student billing, contracts and receivables accounting

**Status:** 🚧 In Progress
**Scope:** `packages/shared` (`types/entities.ts`, `ports/i-billing-repository.ts`, `domain/billing/`), `apps/api` (migration `0026`, `adapters/db/d1-billing-repository.ts`, `core/billing/`, `controllers/admin-billing.controller.ts` + `me-billing.controller.ts`, `routes/admin/billing.ts` + `routes/me/billing.ts`, `container.ts`, `index.ts` `scheduled` handler, `wrangler.jsonc`), `apps/web` (`admin/billing`, `settings/billing`, `lib/*-billing-api.ts`, both dictionaries). Derived from [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md).

> **Hard scope guardrail — read before opening any task.** This milestone may only touch the **billing bounded context** and its wiring: `packages/shared/types/entities.ts` (new `Entities.Billing` namespace + the seven new `Entities.Config` enums — no existing entity changes shape), `packages/shared/ports/i-billing-repository.ts` and `ports/index.ts`, the new pure `packages/shared/domain/billing/` (`billing-cycle.ts`, `standing-resolver.ts`, `format-money.ts`), `apps/api/migrations/0026_create_billing_tables.sql` (additive only — it alters no existing table) plus `apps/api/migrations/seed/`, `apps/api/src/adapters/db/d1-billing-repository.ts`, `apps/api/src/core/billing/{billing-service,accounting-service}.ts`, `apps/api/src/controllers/{admin-billing,me-billing}.controller.ts`, `apps/api/src/routes/admin/billing.ts` + `routes/me/billing.ts` and their mount lines, `apps/api/src/container.ts` (a new `billing` group only), the `scheduled` handler in `apps/api/src/index.ts` and `triggers.crons` in `apps/api/wrangler.jsonc`, `apps/web/src/app/(protected)/admin/billing/**` + `(protected)/settings/billing/**`, `apps/web/src/lib/{admin-billing-api,me-billing-api}.ts`, `apps/web/src/i18n/dict-en.ts` + `dict-pt.ts`, and tests for the above. **Extended 2026-09-12 for the admin write surface (tasks 09–13), by exactly three additions:** `apps/web/src/components/**` and `apps/web/src/hooks/**` — restricted to the pieces those screens introduce, which is what tasks 07–08 already did in practice — and `apps/web/src/i18n/types.ts` when a key is typed. `apps/web/src/lib/admin-users-api.ts` is **consumed unmodified** (the contract-signing picker needs the user list, which `admin/billing/page.tsx` already reads); adding to it is out of scope. Nothing in the extension reaches `apps/api/**` or `packages/**` at all. It **must not touch**: `apps/api/src/middleware/**`, `apps/api/src/routes/index.ts`, and `apps/api/src/adapters/db/d1-enrollment-repository.ts` — these three are the negative assertion of the whole RFC and a `git diff` over them must come back empty. It is explicitly **not** an opportunity to: gate, suspend, degrade or paywall access on payment in any form (RFC Non-Goal — no middleware, no `402`, no read-only mode, and not "phase 2"); declare or implement a payment-gateway port, adapter, webhook or card flow (#9); build the user anonymisation endpoint or remove `IUserRepository.delete()` (backlog, `docs/product/backlog/user-management/`); emit fiscal or tax documents; build a double-entry general ledger; implement per-topic pricing (`billing_plans.scope_topic_id` is written by the migration and read by nothing); implement proration; accrue late fees or interest automatically (`surcharge` is hand-applied only, #8); build a multi-step dunning sequence; convert between currencies; or build a currency admin screen. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

> **Why this milestone is `🚧 In Progress` with all of tasks 01–08 `✅ Done` (2026-09-12).**
> Local acceptance testing found that the admin billing console is **read-only**: the only
> write calls in the whole feature are set/clear hold and reverse payment. An administrator
> cannot create a plan, sign a contract, issue an invoice, record a payment or apply an
> adjustment from the product — each needs a hand-written `curl` with an admin bearer token
> — and a student with no contract does not even appear on the roster, since
> `billing-service.ts:173` defines a roster line as "a student with a contract".
> **This is not an implementation failure of tasks 07–08.** RFC 0013 §7 listed only the
> three read tabs, the nav badge, the student statement and the banner, and task 07
> implemented §7 as written. The defect was in §7 itself, incomplete against the rest of
> its own document — Phase 6 plans the `budo` backfill as "an admin task through the UI,
> not a script", and the Motivation promises an administrator who has retired a
> spreadsheet. §3's criterion "entirely over the API" (below) inherited the same gap: it
> measured the API, and nobody wrote the criterion that measured the administrator. That
> criterion stays true — it is now insufficient, not wrong. RFC 0013 §7 was amended on
> 2026-09-12 and tasks 09–13 close the gap; the milestone cannot be `✅ Implemented` until
> they land, along with task 07's still-owed `[~]` responsive/keyboard verification.

---

## 1. Objectives

- **The money is modelled, and a correction is an entry rather than an edit.** A plan catalogue, subscriptions that execute a contract by snapshotting its terms at signature, periodic invoices, and an append-only `payments` / `invoice_adjustments` ledger. The dojo's spreadsheet stops being the only place its receivables exist.
- **A free contract is first-class.** A zero-amount plan travels the whole pipeline and issues zero-value invoices that settle on arrival with no payment row, so a scholarship or trial student accrues the same record of time and membership a paying one does.
- **Billing standing is derived, never stored.** `resolveStanding` is a pure function of open invoices, a hold and a clock, returning `good · due · delinquent · exempt` — no flag that goes stale at midnight, and no state a manual DB fix can desynchronise from its inputs.
- **Standing is reported and alerted, never enforced.** No route gains a guard, no access query learns about money, and `getEffectiveAccessTopicIds` is not modified. A `delinquent` student keeps exactly the access they had the day before; the platform's whole response is a report and an alert.
- **A late payment is noticed in days, not months.** The admin roster with a standing filter, a delinquency count badge on the nav, and a daily digest of the students who *crossed* into `due` or `delinquent` since the previous run — transitions, not a standing list someone learns to ignore.
- **The student can resolve it without being asked.** `GET /v1/me/billing` returns their own statement, an informational banner links to it on `due` and `delinquent`, and two emails go out — one at the due date, one when grace lapses. All three are suppressed by a hold; none of them withholds anything.
- **The administrator gets the accounting views the spreadsheet was providing.** Monthly movement (billed · received · outstanding), receivables aging in 0–30 / 31–60 / 61–90 / 90+ buckets, and a per-student statement that reconciles to the ledger row for row.
- **The period run is idempotent and hand-recoverable.** A daily Workers cron issues each `active` contract's due period once — `UNIQUE (subscription_id, period_start)` absorbs a retry — and `POST /v1/admin/billing/invoices/run` is its manual twin, so a missed firing is recovered without a deploy.
- **Money is integer minor units against a recorded exponent.** No floating point touches an amount, and no currency is formatted by assuming two decimal places: `currencies` carries the exponent (0 for JPY, 8 for BTC) and a shared `format-money.ts` renders it — never `Intl.NumberFormat`'s currency style, which accepts `BTC` and silently rounds it to `BTC 0,00`.
- **Every mutation is attributable.** Acting admin on the row (`recorded_by`, `signed_by`, `created_by`) plus the structured `billing.*` `console.info` event this codebase already emits in `EnrollmentService`.
- **The administrator operates the whole lifecycle from the product, not from `curl`.** The plan catalogue, contract signature including the negotiated path, the contract lifecycle and its amendment, and the ledger's write actions are all reachable from `/admin/billing`. This is what makes RFC 0013's Phase 6 rollout executable — the `budo` backfill is an admin task through the UI, not a script — and what makes the Motivation's retired spreadsheet true. It adds **no** API: every screen calls an endpoint Phases 2–4 already shipped and tested.

Out of scope (explicit, from RFC 0013 Non-Goals):
- **Suspending, degrading or gating access on payment** — a product decision, not a sequencing one. The rejected design is recorded as RFC 0013 Alternative 5 and §3 names the seam it would use, so reversing it is a deliberate RFC rather than a patch.
- **A payment gateway, including its port** (#9) — integration is committed roadmap with no provider chosen; this milestone shapes the ledger as its landing point and stops. `payments.method` keeps `'gateway'` in its CHECK from day one because SQLite cannot alter a CHECK without rebuilding the table.
- **The user anonymisation flow** — #6 shapes the FKs for it (`ON DELETE RESTRICT` billing→`users`); building the endpoint, and removing or guarding the dormant `IUserRepository.delete()`, belong to user management (`docs/product/backlog/user-management/`).
- **Fiscal/tax documents (NF-e, receipts with legal force)** — "accounting" here is the administrator's management view, not statutory bookkeeping.
- **A double-entry general ledger** — invoices and payments are a subsidiary receivables ledger, not a chart of accounts.
- **Per-topic pricing** — a subscription buys standing, not a topic set; enrollment grants (RFC 0005) still decide that. `billing_plans.scope_topic_id` is reserved by the migration and read by no code in v1.
- **Proration** — a contract change takes effect at the next period boundary. Deferred, not rejected.
- **Automatic late fees or interest** — `surcharge` exists so a fee *can* be recorded by hand (#8); nothing accrues one and the daily job never writes money on its own. An accrual engine is its own RFC.
- **Dunning campaigns** — one reminder at the due date and one when grace lapses; no configurable sequence.
- **Currency conversion** — one `active` currency per tenant; reports assert a single currency and refuse to sum across two.
- **A currency admin screen** — `currencies` is reference data seeded by `0026`; adding one is a `wrangler d1 execute`, not a deploy and not a UI.
- **Collecting in a crypto currency** — the ledger is exponent-agnostic so a contract *can* be denominated in BTC; receiving it is a wallet and gateway concern.

---

## 2. Functional Requirements

**Domain (pure, no Worker in the loop)**
- `formatMoney(minor, { exponent, symbol })` renders `100000` as `R$ 1.000,00` at exponent 2, `JP¥ 100000` at exponent 0 and `₿ 0,00100000` at exponent 8.
- `resolveStanding({ openInvoices, hold, today })` returns `{ standing, oldestOverdueDate, outstandingMinor }` with this precedence: an unexpired hold → `exempt`; otherwise the oldest open invoice with a positive balance decides against **its own** snapshotted `graceDays` — `today < dueDate` → `good`, within `graceDays` past it → `due`, beyond → `delinquent`; no open invoice, or none with a positive balance → `good`.
- A hold changes the reported standing only. The debt still counts in every total, the aging report and the statement.
- An invoice's balance is `amount_minor + SUM(invoice_adjustments.amount_minor) − SUM(payments.amount_minor)`; `invoices.status` is a cache of "balance reached zero", never an independent truth.
- `billing-cycle.ts` computes period boundaries and due dates for `monthly | quarterly | yearly` against a `due_day` of 1–28, in the student's timezone via the existing `toLocalDateString`.

**Data**
- Migration `0026` creates `currencies`, `billing_plans`, `subscriptions`, `invoices`, `invoice_adjustments`, `payments`, `billing_standing_holds`, and alters no existing table.
- `currencies` is seeded with BRL `active`, plus USD, EUR, JPY and BTC inactive; `idx_currencies_one_active` permits exactly one active row.
- Every money column is an integer in minor units with a foreign key to `currencies(code)`.
- Signing a contract snapshots `amount_minor`, `currency`, `cycle` and `grace_days` from the plan onto the subscription; issuing an invoice snapshots them again onto the invoice. Editing a plan afterwards changes neither.
- A negotiated contract is the same row with different terms, `terms_source = 'negotiated'` and a `terms_note`.
- Amending supersedes: the live row moves to `status = 'superseded'` with `end_date` closed, and a new `active` row carries `supersedes_id` and the same `contract_group_id`. `idx_subscriptions_one_successor` forbids a forked chain; `idx_subscriptions_one_active` keeps one active contract per user.
- A returning student opens a **new** `contract_group_id`; the gap stays visible.
- `payments` and `invoice_adjustments` are append-only. A mistake is corrected by a reversal or a signed adjustment, never an `UPDATE` or `DELETE`.
- Every billing→`users` foreign key is `ON DELETE RESTRICT`; `billing_standing_holds` stays `CASCADE`.

**API** — all under `/v1/admin/billing/*` behind the sub-router's own `requireRole(ROLES.ADMIN)`, plus `GET /v1/me/billing`:
- Plans: `GET/POST /plans`, `PATCH /plans/{id}`.
- Contracts: `GET/POST /subscriptions` (standard or negotiated), `PATCH /subscriptions/{id}` (lifecycle only — pause, resume, cancel), `POST /subscriptions/{id}/amend`.
- Invoices: `GET /invoices?status&from&to&userId`, `POST /invoices` (ad-hoc), `POST /invoices/{id}/void` (mandatory reason), `POST /invoices/{id}/adjustments`, `POST /invoices/{id}/payments`, `POST /payments/{id}/reverse`, `POST /invoices/run`.
- Reports: `GET /reports/movement?month=YYYY-MM`, `GET /reports/aging`, `GET /students/{userId}/statement`, `GET /students?standing=`.
- Holds: `POST/DELETE /holds/{userId}`, with an optional `expires_at` and a reason.
- `GET /v1/me/billing` returns only the caller's own standing, invoices and payments.
- A `content_creator`, a `tutor` and a student each receive `403` from every `/v1/admin/billing/*` route.
- All business logic returns `ControllerResult<T>`; routers only parse, guard and shape; bodies validate through `@ValidateBody(schema)` + `@Body()`.
- `container.ts` gains one `billing: BillingContext` group, instantiated per request inside `buildApp(env)` like every other adapter.

**Scheduled run**
- `wrangler.jsonc` gains `"triggers": { "crons": ["0 6 * * *"] }` and the `scheduled` handler at `apps/api/src/index.ts:41` is enabled.
- Daily it: issues each `active` contract's started, unissued period (a `paused` contract is skipped, and nowhere else); sends the student's due-date reminder and grace-lapsed notice through `IMailer`, skipping anyone under a hold; emails admins a digest of the students who crossed into `due` or `delinquent` since the previous run; and asserts each open invoice's cached `status` against its recomputed balance, logging any divergence.
- The job writes no adjustment row of any kind, `surcharge` included.
- `POST /v1/admin/billing/invoices/run` performs the same work, so the job is testable without a cron and a missed firing is recoverable by hand.

**Web**
- `/(protected)/admin/billing` with three tabs: **Students** (standing, outstanding, next due, negotiated-terms flag), **Ledger** (invoices, adjustments and payments; filterable; client-side CSV export), **Reports** (monthly movement + aging).
- A delinquency count badge on the admin billing nav entry.
- `/(protected)/settings/billing` — the student's own statement.
- An informational banner for the student on `due` and `delinquent`, linking to that statement. It withholds no route and no screen, and dismissing it costs nothing.
- The ledger UI offers **Reverse**, never Delete, and shows a reversal inline under its original with the reason.
- Money renders only through the shared `format-money.ts`; no standing rule is duplicated client-side — the banner reads what `/v1/me/billing` reports.
- All copy lives in `dict-en.ts` and `dict-pt.ts` with identical keys; no hardcoded user-facing strings.

---

## 3. Acceptance Criteria

- [ ] `formatMoney` renders `100000` minor units as `R$ 1.000,00` (exponent 2), `JP¥ 100000` (exponent 0) and `₿ 0,00100000` (exponent 8) — the last being the case `Intl.NumberFormat` rounds to `BTC 0,00`.
- [ ] `resolveStanding` unit tests cover every precedence branch, both grace boundaries (`dueDate + graceDays` inclusive vs. exclusive) read from the **invoice's** snapshot, a month-end `due_day`, a discount clearing a balance, a reversal moving a student from `good` back to `delinquent`, and a zero-value invoice leaving standing `good` with no payment row. They run with no Worker in the loop.
- [ ] Applying `0026` twice is a no-op; `git diff` shows it alters no pre-existing table.
- [ ] Inserting the same `(subscription_id, period_start)` twice raises a constraint error; a second `active` subscription for one user is rejected by `idx_subscriptions_one_active`; a second successor for one version is rejected by `idx_subscriptions_one_successor`.
- [ ] A plan with an unknown currency code is rejected by the foreign key, and a second `active` currency by `idx_currencies_one_active`.
- [ ] `DELETE FROM users` for a student holding any invoice is rejected by `ON DELETE RESTRICT`, while the same row updates cleanly to an anonymised name and email with every billing row intact.
- [ ] Two amendments leave a chain of three rows sharing one `contract_group_id` with exactly one `active`; editing that plan's `amount_minor` and `grace_days` afterwards leaves every existing subscription and invoice byte-identical.
- [ ] An admin can create a plan, sign both a standard and a negotiated contract, and issue, adjust, void, pay and reverse — entirely over the API.
- [ ] `GET /reports/movement?month=…` reconciles to the sum of the ledger rows in that month, adjustments included; an amended student counts **once** in the active-students report.
- [ ] A student with a cancelled contract and a later new one reports "student since" as the earlier date and "current membership since" as the later one.
- [ ] Every billing mutation emits its `billing.*` structured audit event carrying the acting admin.
- [ ] With a seeded student sitting `delinquent`, every pre-existing API test passes unchanged and `/v1/topics`, `/v1/me/progress` and the comments routes all return `200`.
- [ ] The roster lists that student under `standing=delinquent`; setting a hold removes them from the list and from the reminder mail while leaving their outstanding balance in every total and in the aging report.
- [ ] A `content_creator` and a `tutor` each receive `403` from every `/v1/admin/billing/*` route; a student receives `403` from all of them while `GET /v1/me/billing` returns their own statement.
- [ ] Running the invoice job twice for one period issues each invoice exactly once; a free contract's period invoice is issued, lands `paid` with no payment row, and sends no mail.
- [ ] The job writes no `invoice_adjustments` row of any kind; the student's grace-lapsed notice fires exactly once per invoice; the admin digest names only students who crossed a boundary since the previous run, so a second run the same day reports nobody.
- [ ] `node apps/web/scripts/check-i18n-coverage.js` passes; `dict-en.ts` and `dict-pt.ts` have identical keys.
- [ ] The student banner renders from `/v1/me/billing` with no standing rule duplicated in the client, and no route or screen is withheld behind it.
- [ ] **No diff outside scope:** `git diff` for the whole milestone touches no file under `apps/api/src/middleware/`, does not modify `apps/api/src/routes/index.ts`, and does not modify `apps/api/src/adapters/db/d1-enrollment-repository.ts`.
- [ ] `make lint`, `make test-api` and `make test-web` pass green.

**Admin write surface (added 2026-09-12 with tasks 09–13).** The criterion above — "entirely over the API" — stays true and is no longer sufficient; these measure the administrator rather than the endpoint.

- [ ] An administrator completes the whole lifecycle from `/admin/billing` with **no `curl` and no bearer token pasted anywhere**: create a plan; sign one standard and one negotiated contract; pause, resume, cancel and amend a contract; issue, void, adjust and pay an invoice; reverse a payment; run the cycle by hand and read its report.
- [ ] A student who holds **no contract** — and therefore has no roster line — is reachable by the contract-signing form, which lists students from the admin user list rather than the roster.
- [ ] A negotiated contract's amount and its `terms_note` read back from the product afterwards, so "this student negotiated a different fee in March" is answerable without a database query.
- [ ] The plan form offers no non-recurring option, and its copy states that a plan is re-invoiced every period — a plan created to sell a one-off seminar would be billed monthly forever, since `cycle` admits only `monthly | quarterly | yearly`.
- [ ] Issuing an invoice names the contract and the period it writes; a second issue for the same `(subscription_id, period_start)` is reported, not silently duplicated or silently swallowed.
- [ ] Amending renders the resulting supersede chain, so the administrator sees that history was added rather than overwritten; no screen offers an in-place edit of signed terms.
- [ ] No screen offers Delete on a payment or an adjustment, and no screen offers any control that suspends, restricts, downgrades or paywalls a student's access.
- [ ] `git diff` for tasks 09–13 touches **no file** under `apps/api/` or `packages/` — the entire write surface is UI over the Phase 2–4 API, and `apps/web/src/lib/admin-users-api.ts` is unmodified.
- [ ] Every new amount renders through `format-money.ts`; `Intl.NumberFormat` appears in no new diff; `node apps/web/scripts/check-i18n-coverage.js` passes with the new keys in both dictionaries.
- [ ] Task 07's outstanding `[~]` criterion is discharged: the console — including the new screens — is verified responsive at mobile width and keyboard-usable in a real browser.

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono; per-request adapters in `buildApp(env)` (never module scope); a new `billing` bounded-context group in `container.ts`; controllers return `ControllerResult<T>`; validation via `@ValidateBody(schema)` + `@Body()`; the billing sub-router carries its own `requireRole(ROLES.ADMIN)`, following `routes/admin/users.ts:279`, `levels.ts:82` and `progression.ts:158`.
- **Persistence:** D1 + `wrangler d1 migrations`; migration `0026_create_billing_tables.sql` (additive); `D1BillingRepository` implementing `IBillingRepository`; local seed extension under `apps/api/migrations/seed/` (guarded off the deployed path by `apps/api/scripts/check-no-dev-seed.ts`).
- **Shared:** `Entities.Billing` + seven new `Entities.Config` enums (`BillingCycle`, `ContractStatus`, `ContractTermsSource`, `InvoiceStatus`, `PaymentMethod`, `BillingStanding`, `AdjustmentKind`) in `types/entities.ts`; `ports/i-billing-repository.ts` (no Cloudflare types); pure `domain/billing/{billing-cycle,standing-resolver,format-money}.ts`; date handling reuses `domain/time/local-date.ts` and `users.timezone`.
- **Scheduling & mail:** Workers `triggers.crons` + the `scheduled` handler in `apps/api/src/index.ts`; mail through the existing `IMailer` port (`ResendMailAdapter` / `ConsoleMailAdapter`) — no new mail dependency.
- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS v4 under `(protected)/admin/billing` and `(protected)/settings/billing`; API access through `src/lib/admin-billing-api.ts` and `me-billing-api.ts`; both dictionaries, enforced by `check-i18n-coverage.js`.
- **Tests:** plain Vitest for `packages/shared/domain/billing` (no Worker); Vitest + `@cloudflare/vitest-pool-workers` for the API (`vitest.config.mts`); Vitest + RTL for the web.

---

## 5. Task Breakdown

Each row is a `.task.md` file in this folder, authored with `write-tasks`. Backend and
frontend are separate tasks; each frontend task depends on the backend task whose
contract it consumes. Phases map to RFC 0013's Implementation Plan.

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Billing domain, entities and repository port](./01-billing-domain-entities-and-repository-port.task.md) | 0 | Backend | ✅ Done |
| 02 | [Billing schema, D1 repository and local seed](./02-billing-schema-d1-repository-and-local-seed.task.md) | 1 | Backend | ✅ Done |
| 03 | [Billing service and the admin lifecycle API](./03-billing-service-and-the-admin-lifecycle-api.task.md) | 2 | Backend | ✅ Done |
| 04 | [Accounting reports and per-student statement](./04-accounting-reports-and-per-student-statement.task.md) | 2 | Backend | ✅ Done |
| 05 | [Standing roster, holds and the student billing endpoint](./05-standing-roster-holds-and-me-billing.task.md) | 3 | Backend | ✅ Done |
| 06 | [Scheduled invoice run and billing alerts](./06-scheduled-invoice-run-and-billing-alerts.task.md) | 4 | Backend | ✅ Done |
| 07 | [Admin billing console](./07-admin-billing-console.task.md) | 5 | Frontend | ✅ Done |
| 08 | [Student statement and standing banner](./08-student-statement-and-standing-banner.task.md) | 5 | Frontend | ✅ Done |
| 09 | [Billing plan catalogue](./09-billing-plan-catalogue.task.md) | 5 | Frontend | ✅ Done |
| 10 | [Contract signing, standard and negotiated](./10-contract-signing-standard-and-negotiated.task.md) | 5 | Frontend | ✅ Done |
| 11 | [Contract lifecycle and amendment](./11-contract-lifecycle-and-amendment.task.md) | 5 | Frontend | ✅ Done |
| 12 | [Ledger write actions](./12-ledger-write-actions.task.md) | 5 | Frontend | ✅ Done |
| 13 | [Manual invoice cycle run](./13-manual-invoice-cycle-run.task.md) | 5 | Frontend | ✅ Done |

Tasks **09–13 were added on 2026-09-12** with the RFC 0013 §7 amendment. They are the
admin **write** surface: tasks 07–08 delivered §7's read surface as it was written, and
§7 did not specify the screens through which an administrator creates a plan, signs a
contract, issues an invoice or records a payment. All five are frontend-only over the
Phase 2–4 API — **none of them needs a backend change**, and each states why in its own
"Does this need a backend change?" section.

Dependency graph:

```
01 (independent — pure domain, ships with no consumer)
 │
 ▼
02 ──► 03 ──► 04 ──► 05 ──► 06
        │      │      │      │
        │      │      ├────► 07  (also needs 04)
        │      │      └────► 08
        │      │
        │      │        ── admin write surface ──
        ├──────┴───────► 09 ──► 10 ──┬──► 11  (also needs 04)
                                     │
                                     └──► 12 ──► 13  (also needs 06)
```

**Recommended execution order:** `01` → `02` → `03` → `04` → `05` → `06`, with `07` and
`08` runnable in parallel once `05` has landed (`07` additionally needs `04`'s reports).
`06` and the two frontend tasks share no files, so they can also overlap.

For the write surface: `09` → `10`, then `11` and `12` in parallel, then `13`. `09` comes
first because a contract cannot be signed against an empty catalogue, and `10` before both
of its successors because there is nothing to amend, pause or invoice before a contract
exists. `11` and `12` touch different files — the statement panel and the Ledger tab — so
they genuinely parallelise. `13` follows `12` for a file reason rather than a functional
one: both extend the Ledger tab and `admin-billing-api.ts`, and serialising them avoids a
conflict on files neither owns exclusively.

Phase 6 of RFC 0013 (rollout) is not a task: it is a deploy with no plans and no
contracts, and it is tracked in §7's Definition of Done.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0013 "Resolved Decisions")

1. **`grace_days` lives on the plan, snapshotted onto the subscription at signature and onto each invoice at issue** — the plan is the shelf, the subscription is the executed contract, and standing reads the *invoice's* copy. Editing the catalogue can never restate a signed contract or an issued charge. Individualising a student is a negotiated subscription; changing a single charge is an append-only adjustment.
2. **Billing never degrades access** — no middleware, no `402`, no read-only mode, no per-topic paywall, and `routes/index.ts` is not modified. Standing is a reported state, reaching people through the roster, the nav badge, the daily alert and the student's own statement. `billing_standing_holds` means one thing: stop chasing this one — it suppresses an alert, never a permission.
3. **A paused contract stops invoicing, and nothing else** — every already-open invoice keeps its due date, keeps counting toward the outstanding total and the aging report, and still moves standing on schedule. Forgiving a debt is a `waiver`; stopping reminders is a hold.
4. **One currency per tenant, in a `currencies` reference table** — `code` PK, `exponent`, `symbol`, `active`, with a foreign key from every money column, so an unknown code is rejected by the database rather than by convention. The exponent is recorded because it is 0 for JPY and 8 for BTC; money is therefore formatted by `format-money.ts` and never by `Intl.NumberFormat`'s currency style.
5. **Billing is admin-only; the tutor role gets nothing** — the sub-router carries its own `requireRole(ROLES.ADMIN)` because the blanket `/v1/admin/*` guard admits `content_creator`. The tutor role confers nothing anywhere in the codebase today, and the financial module should not be what first defines it.
6. **The ledger outlives the account** — `ON DELETE RESTRICT` on every billing→`users` FK; erasure is anonymisation in place. Belt-and-braces: the API's user delete is already soft and the hard `IUserRepository.delete()` is called by nothing, so the FK guards a manual `wrangler d1 execute`. Holds stay `CASCADE`, being operational notes rather than accounting data.
7. **Renegotiation supersedes; it never edits** — the live row closes to `superseded` and a new `active` row carries the new terms, `supersedes_id` and the reason. A chain shares one `contract_group_id`; a fork is rejected by index. Invoices point at the version that issued them, so an old charge explains itself.
8. **`surcharge` stays as an adjustment kind, applied only by hand** — nothing accrues it: no percentage, no cap, no daily incidence, and the scheduled job never writes an adjustment of any kind. Keeping the value costs a word in a `CHECK`; adding it later would cost a table rebuild.
9. **No payment-gateway port in this milestone** — the seam that matters is the ledger, not the signature: a future adapter calls the same `recordPayment` path an admin calls, and a chargeback is an ordinary reversal. `'gateway'` stays in the `payments.method` CHECK from day one, because SQLite cannot alter a CHECK without rebuilding the table.
10. **A returning student opens a new contract group, and both membership dates are derived** — `supersedes_id` means "this replaced that", so two contracts separated by a gap must not be chained. "Student since" is the earliest `start_date` across all contracts; "current membership since" is the active group's root. Two questions, two queries, no stored column to drift.
11. **The delinquency alert lands both in-app and by email** — roster filter and nav badge as the base, plus a daily digest of the students who *crossed* into `due` or `delinquent` since the previous run, so the mail stays news.
12. **The student is told too: banner and email** — an informational banner on `due` and `delinquent` linking to their statement, a reminder at the due date and one when grace lapses. All suppressed by a hold; none withholds anything.
13. **`0026` seeds BRL active, plus USD, EUR, JPY and BTC inactive** — changing a tenant currency becomes flipping a flag rather than hand-writing an `INSERT` in production, and the non-2-exponent path is exercised by tests and by dev without anyone having to insert a currency first.

No open questions remain in RFC 0013; new questions raised during implementation
continue from #14 in that RFC's Open Questions section.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Rollout verified as designed: deployed with no plans and no contracts, `resolveStanding` reports `good` for every student, and no alert fires until an admin signs the first contract. Data absence is the flag; no feature flag is added.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0013 status set to `Implemented` in its header and in `docs/product/RFCs/README.md`, with the Milestone column pointing at this folder; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail — specifically, `apps/api/src/middleware/**`, `apps/api/src/routes/index.ts` and `apps/api/src/adapters/db/d1-enrollment-repository.ts` are unchanged.
