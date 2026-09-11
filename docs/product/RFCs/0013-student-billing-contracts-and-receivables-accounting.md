# RFC 0013: Student billing, contracts and receivables accounting

**Date:** 2026-09-10
**Status:** Approved
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/0026_create_billing_tables.sql` (new) — `currencies`, `billing_plans`, `subscriptions`, `invoices`, `invoice_adjustments`, `payments`, `billing_standing_holds`. Money is integer minor units; `payments` and `invoice_adjustments` are append-only.
- `packages/shared/types/entities.ts` — new `Entities.Billing` namespace and seven `Entities.Config` enums (`BillingCycle`, `ContractStatus`, `ContractTermsSource`, `InvoiceStatus`, `PaymentMethod`, `BillingStanding`, `AdjustmentKind`).
- `packages/shared/ports/i-billing-repository.ts` (new) + `ports/index.ts` — `IBillingRepository`, the only contract the API talks to. No Cloudflare types.
- `packages/shared/domain/billing/` (new) — pure `billing-cycle.ts` (period arithmetic, due dates), `standing-resolver.ts` (invoices + clock → standing) and `format-money.ts` (minor units + exponent + symbol → string). Cloud-free, unit-testable without a Worker.
- `apps/api/src/adapters/db/d1-billing-repository.ts` (new) — D1 implementation.
- `apps/api/src/core/billing/billing-service.ts` (new) — plans, subscriptions, invoice issue/void, payment recording and reversal, all returning `ControllerResult`.
- `apps/api/src/core/billing/accounting-service.ts` (new) — the admin's reports: monthly movement, receivables aging, per-student statement.
- `apps/api/src/controllers/admin-billing.controller.ts`, `me-billing.controller.ts` (new) + `routes/admin/billing.ts`, `routes/me/billing.ts` (new).
- `apps/api/src/container.ts` — new `billing` bounded-context group, wired per-request like every other adapter.
- `apps/api/src/index.ts:41` — the commented-out `scheduled` handler is enabled to run the invoice run and the delinquency alerts; `apps/api/wrangler.jsonc` gains a `triggers.crons` entry.
- `apps/web/src/app/(protected)/admin/billing/` (new), `(protected)/settings/billing` (new), `src/lib/admin-billing-api.ts`, `me-billing-api.ts`, `src/i18n/dict-en.ts` + `dict-pt.ts`.
- `apps/api/src/routes/index.ts`, `apps/api/src/middleware/*`, `apps/api/src/adapters/db/d1-enrollment-repository.ts` — **all unchanged**, deliberately. No route gains a billing guard and no access query learns about money: billing is a reporting context, not an authorization one.

---

## Summary

ArenaQuest can say what a student is allowed to see (enrollment grants) but has no idea
whether that student has paid for it, so the dojo's money lives in a spreadsheet that
nobody can reconcile against the platform. This RFC adds a first-class billing
context — a plan catalogue, subscriptions that **execute a contract** by snapshotting
the plan's terms at signature, periodic invoices, and an append-only ledger where a
correction is a signed entry rather than an edit — and turns it into the two things the
administrator actually lacks: **reports** (monthly movement, receivables aging, a
per-student statement) and **alerts** (who fell behind, and when). A free plan is a
first-class contract at amount zero, so a scholarship or trial student travels the same
pipeline and still accrues the record of time and membership.

The important consequence is what this RFC does **not** do: billing never touches
access. Being behind on tuition is a fact the platform reports, not a permission it
revokes — no route gains a guard, no access query learns about money, and
`getEffectiveAccessTopicIds` is not modified. Chasing a late payment stays a
conversation between a person and a student, now with the numbers in front of them.
A payment gateway is not chosen here, but the ledger is designed as its landing point
rather than as something it would replace.

## Motivation

The `budo` tenant is a dojo billing monthly tuition. Today its administrator runs the
money side in a spreadsheet and the membership side in ArenaQuest, and reconciles the
two by hand — which in practice means not reconciling them at all. Every failure below
is reachable from the current `main`:

| Case | Covered today? |
|---|---|
| "Which students are behind on tuition?" | No. There is no money model at all — `grep -ri payment apps/ packages/` returns nothing outside a Portuguese dictionary string. |
| "Tell me the day someone falls behind, instead of me noticing in three months." | Nothing periodic runs; the `scheduled` handler is commented out (`apps/api/src/index.ts:41`). |
| "How much was billed, received and is still outstanding in August?" | No data to answer from. |
| "This student negotiated a different fee in March — what did they actually agree to?" | Nowhere to record it, so it lives in someone's memory. |
| "This payment was entered twice — fix it." | No ledger, so no notion of a correcting entry versus an edit. |
| "Since when has this student been with us?" | Only the `users.created_at` of their login, which says when an account was made, not when a membership began. |
| "Show the student their own balance so they stop asking the instructor." | Nothing to show. |

Every row is a **visibility** failure, and that is the whole of the gap. The
administrator does not need the platform to punish anyone — chasing a late payment at a
dojo is a conversation, and it already works. What does not work is having the
conversation blind, three months late, from a spreadsheet that disagrees with the
platform about who is even still a student.

It is worth naming what the platform would otherwise be tempted into. The only levers
that exist today are revoking enrollment grants (`EnrollmentService.revokeUser`) and
setting `users.status = 'inactive'`, and both are destructive: revoking loses which
topics a student had earned, and `inactive` blocks login — locking someone out of the
very page that would tell them what they owe. Reaching for either as a collections tool
is how a billing feature quietly becomes an access-control feature. This RFC declines
that, on purpose and on the record: see Non-Goals, and Alternative 5.

## Goals & Non-Goals

**Goals**
- Model the money: a plan catalogue, subscriptions that execute a contract by
  snapshotting its terms, periodic invoices, and an **append-only** ledger where a
  correction is a signed entry rather than an edit.
- Make a **free contract first-class** — a zero-amount plan travels the whole pipeline
  and issues zero-value invoices, so a scholarship or trial accrues the same record of
  time and membership a paying student does.
- Shape the ledger as the place a future provider lands — one `recordPayment` path,
  `method` and `external_reference` already on the row — so the gateway RFC adds an
  adapter rather than a second source of truth. **No port is declared here** (#9): an
  interface designed for an unnamed provider is a guess, and the seam that matters is
  the ledger, not the signature.
- Derive **billing standing** (`good` · `due` · `delinquent` · `exempt`) from invoices
  and a clock — a pure function, not a stored flag that can drift. Standing is a
  *reported* state, never an enforced one.
- Surface standing where a person will act on it: a per-student badge on the admin
  roster, a delinquency list, and a periodic alert — so a late payment is noticed in
  days rather than months.
- Give the administrator the accounting views the spreadsheet was providing: monthly
  movement (billed / received / outstanding), receivables aging, and a per-student
  statement that reconciles to the ledger.
- Issue each period's invoices idempotently from a Workers cron trigger, re-runnable
  by hand without producing duplicates.
- Keep every amount an **integer in minor units**, against a currency whose exponent is
  recorded data rather than an assumed 2. No floating point touches money, and no
  currency — ISO or otherwise — is formatted by guessing its decimal places.
- Full audit trail: every mutation records the acting admin and emits the structured
  `console.info` event this codebase already uses in `EnrollmentService`.

**Non-Goals**
- **Suspending, degrading or gating access on payment.** No middleware guard, no `402`,
  no read-only mode, no per-topic paywall. A `delinquent` student keeps exactly the
  access they had the day before, and the platform's response is a report and an alert.
  This is a product decision, not a sequencing one — it is not "phase 2". Alternative 5
  records the design that was considered and where its seam would go, so that a future
  decision to reverse this is a deliberate RFC rather than a patch.
- **A payment gateway, including its port.** Integration *is* committed roadmap and the
  provider is still undecided, so this RFC shapes the ledger as its landing point and
  stops there — no port, no adapter, no card data, no webhook handler, no PCI scope, and
  no decision yet on whether the provider charges the student or only reconciles money
  that arrived elsewhere (#9 defers that with the port it would shape). Until an
  adapter exists, money arrives out of band (cash, transfer, Pix in the instructor's own
  bank) and an admin records it through the very rows a gateway will later write;
  `payments.method` and `payments.external_reference` exist for that day.
- **Building the anonymisation flow.** #6 settles that an erasure request is served by
  anonymising the user row rather than deleting it, and the billing FKs are shaped for
  that. The actual "anonymise this user" endpoint belongs to user management, not here;
  this RFC only guarantees it will not have to fight the ledger. Until it exists, the
  path is a manual one, and `IUserRepository.delete()` (`d1-user-repository.ts:148`,
  currently called by nothing) should be removed or guarded — flagged as a backlog item
  under `docs/product/backlog/user-management/`, not changed here.
- **Fiscal/tax documents.** No NF-e, no receipts with legal force. "Accounting" here
  means the administrator's management view, not statutory bookkeeping.
- **Double-entry general ledger.** Invoices and payments are a subsidiary receivables
  ledger, not a chart of accounts.
- **Per-topic pricing.** A subscription buys *standing*, not a specific topic set;
  enrollment grants still decide the topic set. Selling individual courses is deferred
  — the schema leaves room (`plans.scope_topic_id`, nullable, unused in v1) but no code
  reads it.
- **Proration.** A contract change takes effect at the next period boundary; no
  partial-period arithmetic. Deferred, not rejected.
- **Automatic late fees or interest.** `surcharge` exists as an adjustment kind so that a
  fee *can* be recorded (#8), but nothing accrues one: no percentage, no cap, no daily
  incidence. The daily job never writes money on its own. An accrual engine is a separate
  RFC, and a deliberate one — a system that charges people without being asked is a
  different kind of system.
- **Dunning campaigns.** One reminder email at the due date and one at suspension; no
  configurable multi-step sequence.
- **Currency conversion.** One `active` currency per tenant; the reports assert a single
  currency rather than converting, and refuse to sum across two if historical rows ever
  make that possible.
- **A currency admin screen.** `currencies` is reference data seeded by migration `0026`;
  adding one is a data operation (`wrangler d1 execute`), not a Worker deploy and not a
  UI. Self-service currency management is deferred until a tenant asks.
- **Collecting in a crypto currency.** The ledger being exponent-agnostic means a tenant
  *can denominate* a contract in BTC; actually receiving it is a wallet and a gateway
  concern, and belongs to the gateway RFC.

## Current State (for reference)

**Access is resolved in exactly one place, and it is purely grant-based.**
`D1EnrollmentRepository.getEffectiveAccessTopicIds`
(`apps/api/src/adapters/db/d1-enrollment-repository.ts:52`) returns
`(allow_tree ∪ public_set) − private_set` from one recursive CTE. Every consumer —
`TopicsController.listPublished` and `.getPublishedById`
(`apps/api/src/controllers/topics.controller.ts:44,61`), `PublicTasksController`
(`:49,98`), `ProgressService` (six call sites), `comments.router.ts:100,112` — filters
against that set. There is no dimension in it that could express "paid" — and after
this RFC there still is not one, which is the point of citing it.

**Authentication and authorization are two thin middlewares.** `authGuard`
(`apps/api/src/middleware/auth-guard.ts`) verifies the token and sets `c.get('user')`;
`requireRole` (`apps/api/src/middleware/require-role.ts`) checks the role list. Both
are mounted per sub-app in `apps/api/src/routes/index.ts:75-83`. A third, orthogonal
check would have an obvious place to live here — which is exactly the temptation this
RFC declines; the file is listed so a reviewer can confirm it stays untouched.

**The blunt instruments that exist, and go unused.** `Entities.Config.UserStatus`
(`packages/shared/types/entities.ts:4-9`) has `ACTIVE | INACTIVE | PENDING | BANNED`,
and `AdminUsersController` already refuses operations on non-`ACTIVE` users
(`apps/api/src/controllers/admin-users.controller.ts:72`) — including password reset.
Marking a defaulting student `INACTIVE` therefore locks them out of the very flows
they need in order to pay. `EnrollmentService.revokeUser` with `cascade` is the other
option, and it deletes the grant rows outright. Neither is used by this RFC; they are
recorded because "just mark them inactive" is the first thing anyone suggests, and it
is worth having written down why that is worse than doing nothing.

**Time.** `users.timezone` exists (migration `0023_add_user_timezone.sql`) and
`toLocalDateString` (`packages/shared/domain/time/local-date.ts:5`) is the shared
helper. Due dates are calendar dates, so this matters.

**Scheduling.** The Worker entrypoint already carries a commented-out `scheduled`
handler (`apps/api/src/index.ts:41`) and `apps/api/wrangler.jsonc` has no
`triggers.crons` block. Nothing periodic runs today.

**Tenancy.** Each label owns its own D1 database (`config/labels/<label>.jsonc`), so
no tenant column is needed; a plan's `currency` carries what would otherwise be tenant
configuration.

## Proposed Design

### 1. Schema (migration `0026_create_billing_tables.sql`)

```sql
-- Reference data, seeded by this migration. It exists so that a currency code is
-- validated by the database rather than by convention, and so that an amount's
-- exponent is a fact the schema knows: 2 for BRL, 0 for JPY, 8 for BTC.
CREATE TABLE IF NOT EXISTS currencies (
  code      TEXT NOT NULL PRIMARY KEY,                        -- 'BRL', 'JPY', 'BTC'
  exponent  INTEGER NOT NULL CHECK (exponent BETWEEN 0 AND 18),
  symbol    TEXT NOT NULL,
  name      TEXT NOT NULL DEFAULT '',
  active    INTEGER NOT NULL DEFAULT 0
);
-- Seeded by this migration: BRL active, the rest available to flip on. JPY (exponent 0)
-- and BTC (exponent 8) are seeded deliberately, so the non-2-exponent path is exercised
-- by tests and dev without anyone having to insert a currency first (#13).
INSERT OR IGNORE INTO currencies (code, exponent, symbol, name, active) VALUES
  ('BRL', 2, 'R$', 'Brazilian real',   1),
  ('USD', 2, 'US$','US dollar',        0),
  ('EUR', 2, '€',  'Euro',             0),
  ('JPY', 0, '¥',  'Japanese yen',     0),
  ('BTC', 8, '₿',  'Bitcoin',          0);
-- One tenant, one live currency (#4). A tenant that ever switches flips the flag; the
-- old row stays, so an invoice issued years ago can still resolve its own exponent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_currencies_one_active
  ON currencies(active) WHERE active = 1;

-- The shelf: what a student can be sold. Freely editable, because it is a catalogue
-- and not a contract — nothing here is read once a subscription has copied it.
CREATE TABLE IF NOT EXISTS billing_plans (
  id              TEXT NOT NULL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  amount_minor    INTEGER NOT NULL CHECK (amount_minor >= 0),  -- cents; 0 is a first-class plan
  currency        TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  cycle           TEXT NOT NULL CHECK (cycle IN ('monthly','quarterly','yearly')),
  grace_days      INTEGER NOT NULL DEFAULT 5 CHECK (grace_days >= 0),
  scope_topic_id  TEXT REFERENCES topic_nodes(id) ON DELETE SET NULL, -- reserved; unread in v1
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The executed contract. Terms are SNAPSHOT from the plan at signature; a negotiated
-- contract is this same row with different terms and terms_source='negotiated'.
CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT NOT NULL PRIMARY KEY,
  -- RESTRICT, not CASCADE (#6): a student with financial history cannot be deleted.
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_id       TEXT NOT NULL REFERENCES billing_plans(id) ON DELETE RESTRICT, -- provenance
  -- Contract versioning. The first version sets contract_group_id to its own id, so
  -- every report groups on one column with no COALESCE. An amendment supersedes.
  contract_group_id TEXT NOT NULL,
  supersedes_id     TEXT REFERENCES subscriptions(id) ON DELETE RESTRICT,
  terms_source  TEXT NOT NULL DEFAULT 'standard'
                  CHECK (terms_source IN ('standard','negotiated')),
  amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),   -- snapshot
  currency      TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT, -- snapshot
  cycle         TEXT NOT NULL CHECK (cycle IN ('monthly','quarterly','yearly')), -- snapshot
  grace_days    INTEGER NOT NULL CHECK (grace_days >= 0),     -- snapshot
  due_day       INTEGER NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
  -- 'paused' suppresses future issuance only: invoices already open keep their due
  -- dates and keep counting toward standing, totals and aging.
  status        TEXT NOT NULL
                  CHECK (status IN ('active','paused','cancelled','superseded')),
  start_date    TEXT NOT NULL,              -- YYYY-MM-DD; THIS VERSION's start
  end_date      TEXT,                       -- set on cancel or supersede; no invoice past it
  terms_note    TEXT NOT NULL DEFAULT '',   -- why the terms differ, or why amended
  signed_by     TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  signed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_active
  ON subscriptions(user_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_successor
  ON subscriptions(supersedes_id) WHERE supersedes_id IS NOT NULL;  -- no forked chains
CREATE INDEX IF NOT EXISTS idx_subscriptions_group
  ON subscriptions(contract_group_id);

-- A charge for one period, snapshot from the contract. The period is the idempotency
-- key of the invoice run. An amount of 0 is issued like any other and settles at once.
CREATE TABLE IF NOT EXISTS invoices (
  id               TEXT NOT NULL PRIMARY KEY,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, -- denormalised; see #6
  period_start     TEXT NOT NULL,          -- YYYY-MM-DD, inclusive
  period_end       TEXT NOT NULL,          -- YYYY-MM-DD, exclusive
  due_date         TEXT NOT NULL,
  amount_minor     INTEGER NOT NULL CHECK (amount_minor >= 0),  -- snapshot, in currency's minor unit
  currency         TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT, -- snapshot
  grace_days       INTEGER NOT NULL CHECK (grace_days >= 0),     -- snapshot; standing reads THIS
  status           TEXT NOT NULL CHECK (status IN ('open','paid','void')),
  issued_at        TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at        TEXT,
  void_reason      TEXT,
  UNIQUE (subscription_id, period_start)   -- makes the monthly run idempotent
);
CREATE INDEX IF NOT EXISTS idx_invoices_user_status ON invoices(user_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date) WHERE status = 'open';

-- Per-invoice overrides: a discount, a credit, a waiver, a late fee. APPEND-ONLY and
-- signed, so "change what this student owes" is an entry, not an UPDATE of the charge.
-- Every kind is applied BY HAND (#8): nothing in this system accrues a fee on its own.
CREATE TABLE IF NOT EXISTS invoice_adjustments (
  id            TEXT NOT NULL PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL CHECK (kind IN ('discount','credit','waiver','surcharge')),
  amount_minor  INTEGER NOT NULL CHECK (amount_minor <> 0),  -- negative reduces what is owed
  reason        TEXT NOT NULL,
  applied_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  applied_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_adjustments_invoice
  ON invoice_adjustments(invoice_id);

-- Money actually received. APPEND-ONLY: no UPDATE, no DELETE.
-- A mistake is corrected by a reversing row whose amount is negative.
CREATE TABLE IF NOT EXISTS payments (
  id                 TEXT NOT NULL PRIMARY KEY,
  invoice_id         TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_minor       INTEGER NOT NULL CHECK (amount_minor <> 0),   -- negative = reversal
  currency           TEXT NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  method             TEXT NOT NULL CHECK (method IN ('cash','pix','bank_transfer','card','gateway','other')),
  paid_at            TEXT NOT NULL,        -- when the money moved, not when it was typed in
  external_reference TEXT,                 -- receipt no. today; gateway charge id later
  note               TEXT NOT NULL DEFAULT '',
  reverses_id        TEXT REFERENCES payments(id) ON DELETE RESTRICT, -- set on a reversal row
  recorded_by        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_reversal ON payments(reverses_id)
  WHERE reverses_id IS NOT NULL;

-- "Stop chasing this one." An open dispute, a payment being verified, an arrangement
-- made in person: the student still owes, but must not appear in the delinquency list
-- or receive a reminder. Since standing is only ever reported, this suppresses a
-- report and an email — it grants nothing and revokes nothing.
-- A scholarship is a FREE PLAN, not a hold: see "A free contract is a contract" below.
-- CASCADE here is deliberate: a hold is an operational note, not accounting data.
CREATE TABLE IF NOT EXISTS billing_standing_holds (
  user_id     TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  expires_at  TEXT,
  set_by      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  set_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**The plan is the shelf; the subscription is the signed contract.** A plan is a
catalogue item and stays freely editable — re-pricing the shelf is an everyday act. A
subscription copies `amount_minor`, `currency`, `cycle` and `grace_days` out of the plan
at signature and never reads them again, so editing the catalogue cannot restate what a
student already agreed to. Individualising a student is then not a special mechanism: it
is a subscription whose snapshotted terms differ from its plan, marked
`terms_source = 'negotiated'` with the reason in `terms_note`, which also lets a report
separate standard contracts from negotiated ones. The snapshot repeats onto each
invoice, and that is what makes `grace_days` safe to change at all: standing reads the
*invoice's* copy, so a policy change today cannot silently suspend — or un-suspend — a
student against a charge issued last month.

**Renegotiating amends the contract; it never edits it.** Changing a student's amount,
grace or due day *supersedes*: the live row moves to `status = 'superseded'` with its
`end_date` closed, and a new `active` row carries the new terms, `supersedes_id`
pointing back, and the reason in `terms_note`. Every version of a chain shares one
`contract_group_id`, and `idx_subscriptions_one_successor` stops a chain from forking —
the same shape as the one-reversal index on `payments`. The partial unique index on
`active` still holds, because only one version of a chain is ever active.

Two things fall out of that for free. Invoices already reference the *specific version*
that issued them, so an old charge explains itself: the terms it was cut from are still
sitting in a row, un-rewritten. And **"student since"** stops competing with "contract
started": `subscriptions.start_date` means this version's start, and the two membership
dates are both derived rather than stored —

- **student since** = the earliest `start_date` across *all* of that student's
  contracts, spanning every group;
- **current membership since** = the root `start_date` of the group now active.

They differ only for someone who left and came back, which is the case #10 settles: a
re-enrolment opens a **new** `contract_group_id` rather than extending the old chain,
because `supersedes_id` means "this replaced that" and two contracts with a year of
nothing between them never replaced one another. The gap stays visible in the history
instead of being smoothed over, and a student of ten years who took a break is still a
student of ten years, because that date is a query over their contracts rather than a
property of the current one.

The cost is one rule for every report: count active students by grouping on
`contract_group_id`, never by counting rows.

**A free contract is a contract.** `amount_minor = 0` is legal on a plan and on a
subscription, and the invoice run issues zero-value invoices for it exactly as it does
for a paid one. Such an invoice has a zero balance at issue, so it is `paid` on arrival,
standing stays `good`, and no `payments` row exists — the ledger records money, and no
money moved. What the tenant gains is what a bare exemption can never produce: an
unbroken periodic record of the membership — when it started, every period it covered,
when it ended. A scholarship or a trial is therefore a **free plan**, and
`billing_standing_holds` is left to its own job — "stop chasing this one" while a
dispute is open or a payment is being verified. The debt stays on every total; only the
alert goes quiet.

Four constraints carry the design. `UNIQUE (subscription_id, period_start)` is what
makes the invoice run safe to re-run — the whole recovery story for a failed cron
firing. `CHECK (amount_minor <> 0)` on `payments` with a nullable `reverses_id` is what
makes "fix a wrong entry" a ledger operation rather than an `UPDATE`. The same shape on
`invoice_adjustments` does it for "this student owes less than the contract says". And
the partial unique index on `subscriptions(user_id) WHERE status = 'active'` means
standing never has to disambiguate between two live contracts.

Every money column on `invoices` is a **snapshot**, never a join back to the plan.
Raising the tuition must not silently restate what a student was already billed.

**The ledger outlives the account.** Every accounting table references `users` with
`ON DELETE RESTRICT`, so a student who has ever been billed cannot be deleted out from
under their own history — the database refuses, rather than quietly erasing the record
of money that changed hands. This costs nothing in practice, because
`DELETE /v1/admin/users/{id}` is already a **soft** delete: it sets
`status = 'inactive'` and revokes refresh tokens (`apps/api/src/routes/admin/users.ts:359-385`),
and never issues `DELETE FROM users`. The RESTRICT is the second line of defence, for
the manual `wrangler d1 execute` and for whatever future route might reach for the hard
`IUserRepository.delete()` that exists at `d1-user-repository.ts:148` and is, today,
called by nothing.

An erasure request is served by **anonymising the user row** — clearing name and email
in place — not by deleting it. The ledger keeps its `user_id` and stays reconcilable,
which is what a retention obligation on financial records requires; what leaves is the
personal data, which is what the request is actually about. `billing_standing_holds`
keeps `ON DELETE CASCADE`, since a hold is an operational note rather than accounting
data.

**An amount is meaningless without its exponent.** `amount_minor` counts a currency's
minor unit, and how many of those make a whole differs: 100 for BRL, 1 for JPY, and
100,000,000 for BTC. `currencies.exponent` is where that lives, and the foreign key on
every money column means an amount can never be written against a currency the database
does not know — a typo is rejected on insert rather than discovered on a report. Since
one currency is `active` per tenant, the API resolves that row **once per request**, not
per money row; the join only does real work for a historical row in a currency the
tenant has since left behind. Satoshis fit comfortably in an integer: the entire BTC
supply is 2.1 × 10¹⁵ minor units against a `Number.MAX_SAFE_INTEGER` of 9.0 × 10¹⁵, so
nothing about a high-exponent currency threatens the integer discipline.

This is also the reason money is never rendered with `Intl.NumberFormat`'s
`style: 'currency'`. Given `BTC`, `Intl` does **not** throw — it accepts the three-letter
code and formats to two decimals, so a 0.001 BTC fee renders as `BTC 0,00`: a wrong
number on an accounting screen with no error anywhere. `format-money.ts` instead takes
`(amountMinor, exponent, symbol)` and formats with `style: 'decimal'` and the fraction
digits pinned to the exponent. The bug is not crypto-specific — `JPY` has exponent 0 —
which is why the exponent is carried as data rather than assumed to be 2.

### 2. Standing is derived, never stored

```ts
// packages/shared/domain/billing/standing-resolver.ts — pure, no I/O
export type BillingStanding = 'good' | 'due' | 'delinquent' | 'exempt';

export interface StandingInput {
  /** Each invoice carries its own snapshotted graceDays — see §1. */
  openInvoices: { dueDate: string; graceDays: number; balanceMinor: number }[];
  hold: { expiresAt: string | null } | null;   // suppresses the alert, not the debt
  today: string;   // YYYY-MM-DD in the student's timezone
}

export function resolveStanding(input: StandingInput): {
  standing: BillingStanding;
  oldestOverdueDate: string | null;
  outstandingMinor: number;
};
```

Precedence, in order: an unexpired hold reports `exempt` — the debt is unchanged and
still counts in every total, the student simply drops out of the delinquency list and
the reminder mail; otherwise the oldest open invoice with a
positive balance decides, against **its own** `graceDays` — `today < dueDate` → `good`,
within `graceDays` past it → `due`, beyond it → `delinquent`. Both are labels on a
report; neither changes what the student can open. No open invoice at all, or none with a positive balance (the free
contract's case) → `good`.

An invoice's **balance** is
`amount_minor + SUM(invoice_adjustments.amount_minor) − SUM(payments.amount_minor)`,
which is why both correction mechanisms are signed rows: a reversal or a discount moves
the balance and, with it, the standing, through the same arithmetic and with an author
attached. `invoices.status` flips to `paid` when the
balance reaches zero and is a cache of that sum, not an independent truth — the
reports recompute from `payments` and a nightly assertion in the cron run logs any
divergence.

Keeping standing derived rather than stored is deliberate: a stored flag goes stale at
midnight when nothing is running, and it is exactly the kind of state that drifts from
its inputs after a manual DB fix.

### 3. Standing is reported and alerted, never enforced

There is no billing middleware, and `apps/api/src/routes/index.ts` is unchanged. A
student who has not paid keeps the access they had yesterday. Standing reaches people
through three surfaces instead:

1. **The admin roster.** `GET /v1/admin/billing/students` returns every student with a
   contract, their standing, outstanding balance and oldest overdue date, filterable by
   standing. This is the everyday screen — the answer to "who is behind?" in one page.
2. **The periodic alert.** The daily job (§6) computes the students who *crossed* into
   `due` or `delinquent` since the previous run and emails the admins a digest of those
   transitions, so the alert is news rather than a standing list someone learns to
   ignore. Crossings are derived by comparing today's resolved standing against each open
   invoice's dates — no `last_alerted` column, nothing to keep in sync, and a second run
   on the same day therefore reports nobody.
3. **The student themselves.** `GET /v1/me/billing` returns the same statement the admin
   sees for that student; an informational banner links to it; and two emails go out, one
   at the due date and one when the grace period lapses. All three are suppressed by a
   hold. A student who wants to pay should never have to ask what they owe — and none of
   this withholds anything (#2), so the banner is a notice, not a paywall.

All four surfaces — admin roster and badge, admin digest, student email, student
banner — were chosen together (#11, #12). The admin ones make a late payment impossible
to miss; the student ones let it be resolved without the instructor ever raising it.

Nothing here reads or writes an enrollment grant, and `getEffectiveAccessTopicIds`
(`apps/api/src/adapters/db/d1-enrollment-repository.ts:52`) is untouched. Grants keep
answering *what* a student may see; billing answers *what they owe*, and the two never
meet in a query. That separation is the reason this RFC can add a money model to the
platform without any risk to who can read what — the blast radius of a billing bug is a
wrong number on a report.

**Where the seam would be, if this is ever reversed.** `resolveStanding` already returns
a standing a guard could branch on, and the natural choke point is a Hono middleware on
the content routers, beside `authGuard` and `requireRole`. Nothing in this design
forecloses it; nothing in this design builds it. See Alternative 5.

### 4. Ports and container wiring

`IBillingRepository` (`packages/shared/ports/i-billing-repository.ts`) exposes plan
CRUD, subscription CRUD, `listOpenInvoices(userId)`, `issueInvoices(period)`,
`recordPayment(...)`, `listLedger(filter)`, `applyAdjustment(...)` and the holds table. It takes and returns
plain records with no Cloudflare types, per the standing rule for ports — the D1
implementation is swappable for Postgres.

**No payment-gateway port is declared** (#9). What a future provider needs is not an
interface guessed in advance but a ledger it can land in, and that already exists: an
adapter will call the same `recordPayment` path an admin calls, writing a `payments` row
with `method = 'gateway'` and its charge id in `external_reference`, and a chargeback
will be an ordinary reversal. `'gateway'` is kept in the `method` CHECK from day one on
purpose — SQLite cannot alter a CHECK constraint without rebuilding the table, so
reserving the value now is the one piece of forward-compatibility worth paying for,
and it costs a word. Everything else about the provider — the port, its shape, whether
it charges or only reconciles — is decided in the gateway RFC, with a provider in hand.

`container.ts` gains a `billing: BillingContext` group alongside `progress` and
`gamification`, instantiated per request inside `buildApp(env)` like every other
adapter (Workers share no memory between requests).

### 5. HTTP surface

| Method | Route | Role | Purpose |
|---|---|---|---|
| `GET/POST` | `/v1/admin/billing/plans` | admin | Price list |
| `PATCH` | `/v1/admin/billing/plans/{id}` | admin | Edit the shelf freely — signed contracts snapshot their terms |
| `GET/POST` | `/v1/admin/billing/subscriptions` | admin | Sign a contract: standard, or negotiated terms + reason |
| `PATCH` | `/v1/admin/billing/subscriptions/{id}` | admin | Lifecycle only: pause, resume, cancel |
| `POST` | `/v1/admin/billing/subscriptions/{id}/amend` | admin | Renegotiate — supersedes with a new version + reason |
| `GET` | `/v1/admin/billing/invoices?status&from&to&userId` | admin | Invoice search |
| `POST` | `/v1/admin/billing/invoices` | admin | Issue an ad-hoc invoice |
| `POST` | `/v1/admin/billing/invoices/{id}/void` | admin | Void with a mandatory reason |
| `POST` | `/v1/admin/billing/invoices/{id}/adjustments` | admin | Discount, credit, waiver or late fee — append-only |
| `POST` | `/v1/admin/billing/invoices/{id}/payments` | admin | Record money received |
| `POST` | `/v1/admin/billing/payments/{id}/reverse` | admin | Append the correcting entry |
| `GET` | `/v1/admin/billing/reports/movement?month=YYYY-MM` | admin | Billed · received · outstanding |
| `GET` | `/v1/admin/billing/reports/aging` | admin | 0–30 / 31–60 / 61–90 / 90+ buckets |
| `GET` | `/v1/admin/billing/students/{userId}/statement` | admin | Per-student reconciliation |
| `GET` | `/v1/admin/billing/students?standing=` | admin | The roster: standing, outstanding, oldest overdue |
| `POST/DELETE` | `/v1/admin/billing/holds/{userId}` | admin | Stop / resume chasing this student |
| `GET` | `/v1/me/billing` | any | The student's own standing, invoices and payments |

Every one of these is an admin or self surface; **no existing route changes, and none
gains a billing guard**. All business logic sits in controllers returning
`ControllerResult<T>`; routers only parse, guard and shape. Bodies validate through
`@ValidateBody(schema)` + `@Body()`.

**The billing sub-router carries its own `requireRole(ROLES.ADMIN)`.** This is not
decoration: `buildAdminRouter` guards all of `/v1/admin/*` with
`requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR)`
(`apps/api/src/routes/admin/index.ts:21`), so mounting billing there without a narrower
guard would hand the dojo's finances to every content creator. `users.ts:279`,
`levels.ts:82` and `progression.ts:158` already set that precedent; billing follows it.

No role but `admin` reads any of it (#5), and `/v1/me/billing` returns only the caller's
own statement. A tutor is deliberately given nothing here: the role confers no capability
anywhere in the codebase today — it appears in zero `requireRole` call sites — and
billing should not be the module that defines it by accident.

### 6. The invoice run

`apps/api/wrangler.jsonc` gains `"triggers": { "crons": ["0 6 * * *"] }`, and the
`scheduled` handler commented out at `apps/api/src/index.ts:41` is enabled. Daily at
06:00 UTC it: issues invoices for every `active` contract whose next period has started
and lacks a row (a `paused` contract is skipped here and nowhere else) (`UNIQUE (subscription_id, period_start)` absorbs the retry); sends the
student's due-date reminder and grace-lapsed notice through `IMailer`, skipping anyone
under a hold; emits the admin's delinquency alert for the students who crossed into
`due` or `delinquent` since the previous run; and asserts each open invoice's cached
`status` against its recomputed balance, logging divergence.

The same work is reachable as `POST /v1/admin/billing/invoices/run` (admin, idempotent)
so a missed firing is recoverable by hand and so the job is testable without a cron.

### 7. Web

- `/(protected)/admin/billing` — three tabs: **Students** (standing, outstanding, next
  due, negotiated-terms flag — the everyday screen, and the one that answers "who is
  behind?"), **Ledger** (invoices, adjustments and payments, filterable, exportable to
  CSV client-side), **Reports** (monthly movement + aging).
- A delinquency count badge on the admin billing nav entry, so the number is visible
  without opening the screen.
- `/(protected)/settings/billing` — the student's own statement.
- For the student, an informational banner on `due` and `delinquent` linking to that
  statement. **It is a notice, not a block**: no route is guarded, no screen is
  withheld, and dismissing it costs the student nothing.
- Money renders only through the shared `format-money.ts` (minor units + exponent +
  symbol), never through `Intl.NumberFormat`'s currency style — see §1 for why that
  silently mis-renders a non-2-decimal currency.
  All copy goes in `dict-en.ts` / `dict-pt.ts` (identical keys — `check-i18n-coverage.js`
  enforces it); no hardcoded strings.

## Alternatives Considered

1. **Payment state mutates enrollment grants.** Revoke on default, re-grant on payment.
   *Rejected.* Grant rows are the record of what a student earned; deleting them on a
   late payment destroys that, and re-granting a cascade-revoked subtree by hand is the
   exact toil described in Motivation. It also gives one row two meanings.
2. **Reuse `users.status` with a `SUSPENDED` value.** *Rejected.* `AdminUsersController`
   already treats non-`ACTIVE` as "cannot operate on this user"
   (`admin-users.controller.ts:72`), so it would block password reset and login for
   someone whose only problem is an unpaid invoice — they could not reach the page that
   tells them what to pay. `UserStatus` is an identity concern; standing is financial.
3. **Store `standing` as a column, updated by the cron.** *Rejected.* It goes stale
   between firings — a student paying at 09:00 stays locked out until the next run
   unless every write path also recomputes it, which is the derived function again plus
   a cache to keep coherent. Deriving costs one indexed query on `invoices(user_id, status)`.
4. **Integrate a gateway (Stripe / Mercado Pago / Pix) in this RFC.** *Deferred, and the
   provider is still undecided.* Gateway integration is committed roadmap rather than a
   maybe — which is exactly why the ledger is built first (the port is deferred with it,
   see #9). Choosing a provider now would bolt webhook idempotency, PCI surface and a
   vendor's data model onto a change whose hard part is the *record* and the *gate*; and
   a provider adopted before a ledger exists tends to *become* the ledger, which is how a
   dojo ends up unable to record the cash a student handed over at the door. Ledger and
   port here; adapter in its own RFC.
5. **Gate content access on standing (`402 PaymentRequired` on the content routes).**
   *Rejected as a product decision.* This was the original shape of the RFC: one
   middleware beside `authGuard`, mounted on `/v1/topics`, the catalog,
   `/v1/me/progress` and the comments router, allowlisting auth, account and
   `/v1/me/billing` so a suspended student could still see what they owed. It is cheap
   to build and it is *not* what a dojo wants. Collections there are a conversation, and
   a platform that locks a student out the morning after a grace period lapses removes
   the instructor from that conversation and hands a retention decision to a cron job.
   It also spends the platform's only real leverage — the student's own record of
   progress — at the exact moment they are deciding whether to come back. The billing
   context gets a report; the person keeps the judgement. If this is ever reversed,
   `resolveStanding` already returns the state a guard would branch on, and §3 names the
   seam.
6. **Full double-entry accounting.** *Rejected as scope.* The administrator needs
   receivables, not a chart of accounts. The append-only ledger with signed reversals
   gives the auditability that motivates double-entry at a fraction of the model.
7. **Model a scholarship as a standing hold instead of a free plan.** *Rejected
   once free contracts were made first-class.* An exemption records that someone is not
   being charged; it records nothing about *what they are enrolled in* or *for how long*.
   A zero-value contract flows through the same issue → settle path and leaves the
   periodic history a dojo needs to answer "since when has this student been with us?".
   The override table survives for the case it is actually good at: a dispute or a
   temporary hold over a real charge.
8. **Store money as `REAL`.** *Rejected.* SQLite `REAL` is IEEE-754; `0.1 + 0.2` in a
   payment sum is an accounting defect. Integer minor units, formatted once at the UI edge.
9. **Amend a contract with an `UPDATE` instead of superseding it.** *Rejected.* The
   financially relevant history would survive anyway, since invoices snapshot their
   terms — but the *reason* for each renegotiation, and any terms that vigorated without
   producing an invoice, would be gone. It would also be the single place in the design
   where an `UPDATE` destroys history, against payments and adjustments that both correct
   by appending. A `subscription_amendments` ledger with derived current terms was the
   opposite extreme and was rejected too: it puts contract terms on the invoice-issue hot
   path as a derived value, or reintroduces the cached-current-row drift the RFC already
   rejected for standing.
10. **Per-topic paywall (each topic priced, gate per node).** *Rejected, following the
   alternative above.* Beyond being a gate, it would push billing into
   `getEffectiveAccessTopicIds`, coupling the money model to the hot access query.
   `plans.scope_topic_id` survives only as a marker for a future *pricing* scope, and is
   read by nothing.

## Implementation Plan

Total ≈ **8–10 dev days**.

### Phase 0 — Domain and contracts (~2 d)
`Entities.Billing` + config enums; `IBillingRepository`; the pure `packages/shared/domain/billing/` modules (`billing-cycle.ts`,
`standing-resolver.ts`) with exhaustive unit tests — month-end due days, grace
boundaries read from the *invoice's* snapshot, override precedence, a discount moving
standing, a reversal moving it back, and a zero-value invoice settling on arrival. No
Worker needed to run these. Independently shippable: the package builds and tests green
with nothing consuming it.

### Phase 1 — Persistence (~1.5 d)
Migration `0026`; `D1BillingRepository`; seed extension adding one paid plan, one free
plan, and a student subscribed to each, to `migrations/seed` (local only — `check-no-dev-seed.ts`
guards the deployed path). Vitest against the Workers pool.

### Phase 2 — Services and admin API (~3 d)
`BillingService`, `AccountingService`, `AdminBillingController`, the `/v1/admin/billing`
routers, container wiring, structured audit events. Includes contract signature (standard
and negotiated), amendment by superseding, and `invoice_adjustments`. Ships usable: an admin can operate the whole
billing lifecycle over the API before any gate exists.

### Phase 3 — Roster, holds and `/v1/me/billing` (~1 d)
`GET /admin/billing/students`, the holds endpoints, `MeBillingController`. No middleware
and no change to `routes/index.ts`; the phase's regression test is that the existing
suite is untouched while a seeded student sits `delinquent`.

### Phase 4 — Scheduled run and alerts (~1.5 d)
`triggers.crons`, the `scheduled` handler, the idempotent issue job, the student's two
email templates, the admin's crossing-based delinquency alert, the balance-vs-status
assertion, and the manual `/invoices/run` twin.

### Phase 5 — Web (~2 d)
Admin billing screens, the nav delinquency badge, the student statement, the
informational banner, both dictionaries, `api-client` modules.

### Phase 6 — Rollout (~0.5 d)
Deploy with **no plans and no contracts**. Because nothing in this RFC guards a route,
rollout carries no access risk at all: the worst case of a bug on day one is an empty or
wrong report on a screen only admins can open. `resolveStanding` returns `good` for a
student with no open invoices, so no alert fires until an admin signs the first
contract. No feature flag is needed — data absence is the flag. Backfill for `budo` is
then an admin task through the UI, not a script.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| **A delinquent student keeps consuming content indefinitely** | Accepted, deliberately: this is the decision, not an oversight. What the platform owes the dojo is that nobody stays invisible — the roster, the nav badge and the crossing alert put a name in front of a person within a day, and the response is theirs to choose. Alternative 5 records the gate that was rejected, and §3 names the seam if it is ever wanted. |
| Standing is computed on the fly wherever it is shown | It is only ever read on admin screens and `/v1/me/billing`, never on a hot content path — one indexed lookup on `invoices(user_id, status)` plus a hold read, both on small tables. The roster resolves them in one query rather than per student. |
| Cron fires twice, or not at all | `UNIQUE (subscription_id, period_start)` makes a double firing a no-op; the manual `/invoices/run` covers a missed one. |
| `invoices.status` drifts from the payment sum | Reports recompute from `payments`; the daily job asserts the cache and logs divergence. |
| Append-only ledger confuses an admin who wants to "delete a mistake" | The UI offers **Reverse**, not Delete, and shows the reversal inline under the original with its reason. |
| The `currencies` join is paid on every money read | One `active` row per tenant, resolved once per request rather than per row; the partial unique index is what makes that safe to assume. A historical currency costs a real lookup, which is the rare case by construction. |
| A tenant denominates contracts in a volatile currency and the real value of a fee drifts month to month | Out of the platform's hands and into the contract's: each invoice snapshots the amount agreed for that period, and repricing is an amendment (#7) with a date and a reason. The reports state one currency and never convert, so no exchange-rate assumption is ever baked into a total. |
| `ON DELETE RESTRICT` turns a manual user delete into an opaque foreign-key error | It is the intended outcome, and the API never reaches it: `DELETE /v1/admin/users/{id}` is a soft delete already. The failure only meets an operator at a `wrangler d1 execute` prompt, where an aborted delete is far better than a silently erased ledger — and the fix is anonymisation, not deletion. |
| Money in the DB raises the stakes of a bad migration | Phase 1 ships behind no consumer; `0026` is additive only, touching no existing table. |
| A negotiated contract silently drifts from the catalogue, and nobody notices the dojo is charging half its students the wrong price | `terms_source` marks every non-standard contract and `terms_note` carries the reason; the admin Students tab flags negotiated contracts, and a report lists contracts whose terms differ from their plan's current ones. |
| A report counts contract rows and double-counts every renegotiated student | Active students are counted by grouping on `contract_group_id`; the partial unique index guarantees at most one `active` row per chain, so `COUNT(*) WHERE status='active'` is also correct — the trap is only in counting a chain's full history. Asserted by a Phase 2 test over an amended contract. |
| A free contract issues invoices forever for someone who quietly left | Same as any contract: `status = 'cancelled'` with an `end_date` stops issuance. The zero invoices are the point — they are the membership record — so the fix is cancelling the contract, not suppressing the run. |
| Admin-recorded payments are trusted input | Every row carries `recorded_by` and `recorded_at`, reversals are themselves rows, and the ledger is immutable — the audit trail is the control, since there is no gateway to verify against. |
| A hold is set "temporarily" and quietly becomes permanent, hiding a real debt | `expires_at` is offered on every hold and the roster shows held students in their own filter with the reason and who set it — a hold hides someone from the alert, never from the totals or the aging report. |
| Scope creep toward a full financial system | The Non-Goals are enumerated above; a gateway, fiscal documents, per-topic pricing and access gating each need their own RFC. |

## Success Criteria

- **Phase 0** — `format-money.ts` renders 100000 minor units as `R$ 1.000,00` at
  exponent 2, `JP¥ 100000` at exponent 0 and `₿ 0,00100000` at exponent 8 — the last
  being the case `Intl.NumberFormat` silently rounds to `BTC 0,00`. `resolveStanding`
  unit tests cover every precedence branch, both grace
  boundaries (`dueDate + graceDays` inclusive vs. exclusive) read from the invoice's own
  snapshot, a month-end `due_day`, a discount clearing a balance, a reversal moving a
  student from `good` back to `delinquent`, and a zero-value invoice leaving standing
  `good` with no payment row. No Worker in the loop.
- **Phase 1** — Applying `0026` twice is a no-op; inserting the same
  `(subscription_id, period_start)` twice raises a constraint error; a second active
  subscription for one user is rejected by the partial index; inserting a plan with an
  unknown currency code is rejected by the foreign key, and a second `active` currency by
  `idx_currencies_one_active`; `DELETE FROM users` for a student holding any invoice is
  rejected by `ON DELETE RESTRICT`, while the same student's row updates cleanly to
  anonymised name and email with every billing row intact; two amendments leave a
  chain of three rows sharing one `contract_group_id` with exactly one `active`, and a
  second successor for the same version is rejected by `idx_subscriptions_one_successor`;
  editing a plan's
  `amount_minor` and `grace_days` leaves every existing subscription and invoice
  byte-identical.
- **Phase 2** — An admin can create a plan, sign both a standard and a negotiated
  contract, issue, adjust, void, pay and reverse entirely over the API;
  `GET /reports/movement?month=…` reconciles to the sum of the ledger rows in that
  month, adjustments included; an amended student counts once in the active-students
  report; a student with a cancelled contract and a later new one reports "student since"
  as the *earlier* date and "current membership since" as the later one; every mutation emits its
  `billing.*` audit event.
- **Phase 3** — With a seeded student sitting `delinquent`, every pre-existing API test
  still passes unchanged and `/v1/topics`, `/v1/me/progress` and the comments routes all
  return `200` — the negative assertion that this RFC gates nothing. The roster lists
  that student under `standing=delinquent`; setting a hold removes them from the list and
  from the reminder mail while leaving their outstanding balance in every total. A
  `content_creator` and a `tutor` each receive `403` from every `/v1/admin/billing/*`
  route, and a student receives `403` from all of them while `GET /v1/me/billing` returns
  their own statement.
- **Phase 4** — Running the job twice for one period issues each invoice once; a free
  contract's period invoice is issued and lands `paid` without a payment row and sends no
  mail; no adjustment row is ever written by the job, `surcharge` included; the student's grace-lapsed notice fires exactly once per invoice; the admin alert
  names only students who *crossed* a boundary since the previous run, so a second run on
  the same day reports nobody.
- **Phase 5** — `check-i18n-coverage.js` passes; the student banner renders from
  `/v1/me/billing` with no standing rule duplicated in the client, and no route or screen
  is withheld behind it.
- **Rollout** — On a tenant with zero plans the existing suite is unchanged. Stronger,
  and checkable by inspection: `git diff` for the whole RFC touches no file under
  `apps/api/src/middleware/`, does not modify `apps/api/src/routes/index.ts`, and does
  not modify `d1-enrollment-repository.ts`.

## Resolved Decisions

| # | Decision | Decided | By |
|---|---|---|---|
| 1 | **`grace_days` lives on the plan and is snapshotted onto the subscription at signature, then onto each invoice at issue.** The plan is the shelf; the subscription is the executed contract. Standing reads the *invoice's* copy, so editing the catalogue can never restate a signed contract or an issued charge. Individualising a student is a negotiated subscription (`terms_source = 'negotiated'`), and changing a single charge is an append-only `invoice_adjustments` row — never an `UPDATE`. Free plans are first-class and execute a zero-value contract, so a scholarship or trial still accrues the record of time and membership; `billing_standing_overrides` is narrowed to disputes and temporary holds. Gateway integration is confirmed roadmap, so the ledger is shaped as its landing point — the provider and its adapter stay out of scope. *(The `IPaymentGateway` port this decision originally declared was later deferred by #9; the ledger seam is unchanged.)* | 2026-09-10 | Product owner |
| 2 | **Billing never degrades access.** A `delinquent` student keeps exactly the access they had the day before: no middleware, no `402`, no read-only mode, no per-topic paywall, and `routes/index.ts` is not modified. Standing is a *reported* state — it reaches people through the admin roster, a nav badge, a daily alert on students who crossed a boundary, and the student's own statement. Chasing a late payment stays a conversation between a person and a student, now with the numbers in front of them. `billing_standing_overrides` is accordingly renamed `billing_standing_holds` and reduced to one meaning: stop chasing this one — it suppresses an alert, never a permission. The rejected gate is recorded as Alternative 5, and §3 names the seam it would use, so reversing this is a deliberate RFC rather than a patch. | 2026-09-10 | Product owner |
| 3 | **A paused contract stops invoicing, and nothing else.** `status = 'paused'` means the invoice run issues no new period for it; every invoice already open keeps its due date, keeps counting toward the outstanding total and the aging report, and still moves the student's standing to `due` or `delinquent` on schedule. Pausing is not a way to forgive a debt — that is a `waiver` adjustment — nor a way to stop the reminders, which is a hold. Since standing is only ever reported (#2), the practical effect is confined to reports and alerts. | 2026-09-10 | Product owner |
| 4 | **One currency per tenant, held in a `currencies` reference table in D1.** `code` (PK), `exponent`, `symbol`, `active`, seeded by migration `0026`, with a foreign key from every money column — so an unknown currency code is rejected by the database, not by a convention someone can forget. `idx_currencies_one_active` enforces the one-per-tenant rule while keeping retired currencies resolvable for historical rows. The exponent is recorded rather than assumed to be 2, because it is 0 for JPY and 8 for BTC; consequently money is formatted by a shared `format-money.ts` and never by `Intl.NumberFormat`'s currency style, which accepts `BTC` without error and rounds it to two decimals. No admin UI for currencies in v1; adding one is a data operation. | 2026-09-10 | Product owner |
| 5 | **Billing is admin-only; the tutor role gets nothing.** The billing sub-router carries its own `requireRole(ROLES.ADMIN)`, following `users.ts` / `levels.ts` / `progression.ts`, because the blanket `/v1/admin/*` guard admits `content_creator` and would otherwise expose the dojo's finances to every content creator. Tutors are excluded on principle rather than on privacy alone: the role confers nothing anywhere in the codebase (zero `requireRole` call sites), and the financial module should not be what first defines it. Since standing is only reported and never enforced (#2), a tutor who could see it would gain no ability the platform doesn't already give them by asking an admin. Cheaply reversible if a tutor-capabilities RFC later wants it. | 2026-09-10 | Lead architect |
| 6 | **The ledger outlives the account: `ON DELETE RESTRICT` on every billing→`users` FK, and erasure is anonymisation in place.** A student who has ever been billed cannot be deleted out from under their own financial history. This is belt-and-braces rather than a behaviour change: `DELETE /v1/admin/users/{id}` is already a soft delete (`routes/admin/users.ts:359-385`) and the hard `IUserRepository.delete()` (`d1-user-repository.ts:148`) is called by nothing — the FK guards the manual `wrangler d1 execute` and any future route that reaches for it. An erasure request clears name and email on the user row; the ledger keeps its `user_id` and stays reconcilable, which is what retention on financial records requires. `billing_standing_holds` stays `CASCADE`, being an operational note rather than accounting data. Building the anonymisation endpoint, and removing or guarding the dormant hard delete, are backlog items for user management. | 2026-09-10 | Lead architect |
| 7 | **Renegotiation supersedes; it never edits.** The live subscription moves to `status = 'superseded'` with its `end_date` closed, and a new `active` row carries the new terms, `supersedes_id` back to its predecessor, and the reason in `terms_note`. A chain shares one `contract_group_id` (the root's own id), `idx_subscriptions_one_successor` forbids a fork, and the one-active-per-user index still holds. Invoices already point at the version that issued them, so an old charge explains itself. `subscriptions.start_date` means this version's start, and reports count active students by grouping on `contract_group_id`. *(This decision originally defined "student since" as the group root's `start_date`; #10 widened it to span every group.)* | 2026-09-10 | Product owner |
| 8 | **`surcharge` stays as an adjustment kind, applied only by hand.** Recording a late fee is one more signed `invoice_adjustments` row, with a reason and an author like every other. Nothing accrues it: no percentage, no cap, no daily incidence, and the scheduled job never writes an adjustment of any kind. Keeping the value costs a word in a `CHECK`, while adding it later would cost a table rebuild — the same asymmetry that keeps `'gateway'` in `payments.method` (#9). An accrual engine, if ever wanted, is its own RFC. | 2026-09-10 | Product owner |
| 9 | **No payment-gateway port in this RFC.** Designing an interface for a provider nobody has chosen is a guess that would have to be rewritten once one exists, and the seam that actually matters is the ledger, not the signature: a future adapter calls the same `recordPayment` path an admin calls, and a chargeback is an ordinary reversal. `'gateway'` stays in the `payments.method` CHECK from day one — SQLite cannot alter a CHECK without rebuilding the table, so reserving the value is the one piece of forward-compatibility worth paying for. Whether the provider **charges** the student or only **reconciles** money that arrived elsewhere is deferred with the port; it costs nothing to defer, because a pending charge would live in its own table keyed on `invoice_id`, making it a purely additive migration rather than an `ALTER` on a live money table. | 2026-09-10 | Product owner |
| 10 | **A returning student opens a new contract group, and both membership dates are derived.** `supersedes_id` means "this replaced that", so two contracts separated by a year of nothing must not be chained — a re-enrolment starts a fresh `contract_group_id` and the gap stays visible. "Student since" is therefore the earliest `start_date` across *all* of a student's contracts, and "current membership since" is the active group's root: two questions, two queries, no stored column to drift. A student of ten years who took a break still reads as a student of ten years. | 2026-09-10 | Product owner |
| 11 | **The delinquency alert lands both in-app and by email.** The admin roster with its standing filter and the nav count badge are the base; on top of them the daily job emails admins a digest of the students who *crossed* into `due` or `delinquent` since the previous run. Transitions rather than a standing list, so the mail stays news. | 2026-09-10 | Product owner |
| 12 | **The student is told too: banner and email.** An informational banner on `due` and `delinquent` linking to their own statement, plus a reminder at the due date and one when grace lapses. All are suppressed by a hold, and none withholds anything — the banner is a notice, not a paywall (#2). The point is that a student can resolve a late payment without the instructor ever having to raise it. | 2026-09-10 | Product owner |
| 13 | **`0026` seeds BRL active, plus USD, EUR, JPY and BTC inactive.** Changing or adding a tenant currency becomes flipping a flag rather than hand-writing an `INSERT` in production. JPY (exponent 0) and BTC (exponent 8) are seeded on purpose: the non-2-exponent path — the one `Intl.NumberFormat` silently got wrong — is then exercised by tests and by dev without anyone having to insert a currency first. | 2026-09-10 | Product owner |

## Open Questions

None. Every question raised has been resolved above; the table records each decision
with its date and decider, and numbering is stable, so #1–#13 all appear there rather
than here. New questions raised during implementation belong in this section, continuing
from #14.


## References

- Access resolver this RFC deliberately leaves alone: `apps/api/src/adapters/db/d1-enrollment-repository.ts:52`
- Consumers of the effective-access set: `apps/api/src/controllers/topics.controller.ts:44,61`, `apps/api/src/controllers/public-tasks.controller.ts:49,98`, `apps/api/src/core/progress/progress-service.ts`, `apps/api/src/routes/comments.router.ts:100,112`
- Guards this RFC deliberately does **not** join: `apps/api/src/middleware/auth-guard.ts`, `apps/api/src/middleware/require-role.ts`, and the mount points in `apps/api/src/routes/index.ts:75-83`
- Blunt instruments left unused (Motivation, Alternatives 1–2): `packages/shared/types/entities.ts:4-9` (`UserStatus`), `apps/api/src/controllers/admin-users.controller.ts:72`, `apps/api/src/core/enrollment/enrollment-service.ts` (`revokeUser`, and the structured-audit pattern reused here)
- Role-guard precedent for the admin-only billing router: `apps/api/src/routes/admin/index.ts:21` (the blanket `admin` + `content_creator` guard this RFC narrows past), `apps/api/src/routes/admin/users.ts:279`, `levels.ts:82`, `progression.ts:158`
- Retention (#6): soft delete at `apps/api/src/routes/admin/users.ts:359-385`; the dormant hard delete at `apps/api/src/adapters/db/d1-user-repository.ts:148`
- Dormant scheduler: `apps/api/src/index.ts:41`
- Date handling: `packages/shared/domain/time/local-date.ts:5`, migration `0023_add_user_timezone.sql`
- Related RFCs: RFC 0005 (enrollment grants and topic visibility — owns *what* a student may see; this RFC owns *what they owe*, and the two never meet in a query), RFC 0012 (per-label provisioning — each tenant's D1 holds its own ledger)
