# Task 01 — Backend: Billing domain, entities and repository port (Phase 0)

**Status:** ✅ Done
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Backend API

## Summary

Establishes the cloud-free foundation of the billing context: the canonical entity
shapes, the repository contract the API will talk to, and the three pure domain modules
that hold every rule money depends on. `Entities.Billing` gains the plan, subscription,
invoice, adjustment, payment and hold records, and `Entities.Config` gains the seven
enums that constrain them. `IBillingRepository` declares the full persistence surface —
plan and subscription CRUD, open-invoice listing, period issuance, payment recording,
adjustment application, ledger listing and the holds table — in plain records with no
Cloudflare symbol anywhere, so the D1 implementation that follows is swappable for
Postgres. The domain modules are the substance: `format-money.ts` renders an integer in
minor units against a recorded exponent and symbol; `billing-cycle.ts` computes period
boundaries and due dates for monthly, quarterly and yearly contracts against a `due_day`
of 1–28; and `standing-resolver.ts` turns a set of open invoices, an optional hold and a
calendar date into `good · due · delinquent · exempt` plus the outstanding total and the
oldest overdue date. Every later task consumes this one: the migration mirrors these
shapes, the D1 adapter implements this port, the services call these functions, and the
roster and the student's banner both report what `resolveStanding` returns rather than
re-deriving it. This task is independently shippable — the package builds and its tests
pass with nothing consuming it.

## Dependencies

None — independent. This is the first task of the milestone and introduces no
consumer; `packages/shared` must build and test green on its own.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/types/entities.ts` — the new `Entities.Billing` namespace and the
    seven new `Entities.Config` enums (`BillingCycle`, `ContractStatus`,
    `ContractTermsSource`, `InvoiceStatus`, `PaymentMethod`, `BillingStanding`,
    `AdjustmentKind`). No existing entity or enum changes shape.
  - `packages/shared/ports/i-billing-repository.ts` (new) and `packages/shared/ports/index.ts`
    — the port and its export line only.
  - `packages/shared/domain/billing/` (new) — `format-money.ts`, `billing-cycle.ts`,
    `standing-resolver.ts` and an index barrel.
  - The unit tests for the above, beside them in `packages/shared/**`.
- **Purity is the deliverable.** Every module in `domain/billing/` is a pure function of
  its arguments: no I/O, no `Date.now()`, no ambient clock — the current date arrives as
  a `YYYY-MM-DD` parameter. This is what lets the tests run without a Worker and what
  keeps standing from drifting from its inputs.
- **Ports & Adapters.** `IBillingRepository` takes and returns plain records only. No
  `D1Database`, no `env`, no Hono type, no Zod schema crosses into the port.
- **No payment-gateway port** (RFC #9). `PaymentMethod` reserves the `gateway` value and
  the port keeps `externalReference` on the payment record, but no gateway interface,
  adapter or webhook shape is declared here or anywhere in this milestone.
- **Money is integer minor units.** No `number` in these modules ever holds a fractional
  amount, and no formatting path calls `Intl.NumberFormat`'s currency style — it accepts
  `BTC` without error and rounds it to two decimals, which is the defect this module
  exists to avoid.
- **Dates reuse the existing helper.** Period and due-date arithmetic goes through
  `packages/shared/domain/time/local-date.ts`; this task does not introduce a date
  library.
- **Standing is derived, never stored.** No entity in `Entities.Billing` carries a
  standing field; it is only ever a return value of `resolveStanding`.

## Scope

In:
- The `Entities.Billing` records for plan, subscription, invoice, invoice adjustment,
  payment and standing hold, each mirroring the columns RFC 0013 §1 specifies, including
  the snapshot fields (`amountMinor`, `currency`, `cycle`, `graceDays`) on both the
  subscription and the invoice, and the contract-versioning fields
  (`contractGroupId`, `supersedesId`, `termsSource`, `termsNote`).
- The seven `Entities.Config` enums, with `PaymentMethod` including `gateway` from day
  one and `AdjustmentKind` including `surcharge`.
- `IBillingRepository` covering plan CRUD, subscription CRUD and amendment,
  `listOpenInvoices(userId)`, `issueInvoices(period)`, `recordPayment`, `applyAdjustment`,
  `listLedger(filter)` and the holds read/write, exported from `ports/index.ts`.
- `format-money.ts` — minor units plus exponent plus symbol to a display string.
- `billing-cycle.ts` — for a contract's cycle, `due_day` and a reference date: the
  period boundaries (`periodStart` inclusive, `periodEnd` exclusive) and the due date,
  including the month-end case a `due_day` of 28 has to survive.
- `standing-resolver.ts` — `resolveStanding({ openInvoices, hold, today })` returning
  `{ standing, oldestOverdueDate, outstandingMinor }`, reading each invoice's **own**
  snapshotted `graceDays`.
- Exhaustive unit tests for all three modules, running under plain Vitest.

Out:
- The migration, any D1 code and the seed — Task 02.
- Any service, controller, route or container wiring — Task 03 onward.
- Balance computation from the database; this task defines the arithmetic, the adapter
  that queries the rows for it comes later.
- Any frontend change; `format-money.ts` is consumed by the web app in Tasks 07–08.

## Acceptance Criteria

- [x] `formatMoney` renders `100000` minor units as `R$ 1.000,00` at exponent 2,
      `JP¥ 100000` at exponent 0, and `₿ 0,00100000` at exponent 8 — the last being the
      case `Intl.NumberFormat`'s currency style rounds to `BTC 0,00`.
- [x] `resolveStanding` returns `exempt` for an unexpired hold, and the same input with
      an expired hold returns what it would have returned with no hold at all.
- [x] `resolveStanding` covers both grace boundaries explicitly: `today = dueDate + graceDays`
      is still `due`, and `today = dueDate + graceDays + 1` is `delinquent`, each read from
      the **invoice's** snapshotted `graceDays` and not from any plan value.
- [x] A held student's `outstandingMinor` is unchanged by the hold — the debt is still
      reported in full while the standing reads `exempt`.
- [x] An input with no open invoices, and one whose only open invoice has a zero or
      negative balance, both return `good` with `oldestOverdueDate` null.
- [x] A discount that brings a balance to zero, and a reversal that puts it back above
      zero, move the returned standing accordingly through the same arithmetic.
- [x] `billing-cycle.ts` produces contiguous, non-overlapping periods across a year for
      each of `monthly`, `quarterly` and `yearly`, and resolves a `due_day` of 28 in
      February without rolling into March.
- [x] No import of a Cloudflare, D1, Hono or Zod symbol appears anywhere under
      `packages/shared/domain/billing/` or in `i-billing-repository.ts`.
- [x] No entity in `Entities.Billing` carries a stored standing field.
- [x] `Entities.Config.PaymentMethod` includes `gateway` and `AdjustmentKind` includes
      `surcharge`, with no code in this task producing either.
- [x] Changed files lint clean; `make test` green for the shared package, with the
      billing domain specs running without a Worker.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make build` — `packages/shared` compiles under strict TypeScript with the new
   namespace, enums and port exported.
2. Run the shared package's Vitest suite directly (no Workers pool) and confirm the
   `domain/billing` specs pass — the absence of a Worker in the loop is itself the
   assertion for Phase 0.
3. `grep -rE "D1|Cloudflare|hono|zod" packages/shared/domain/billing packages/shared/ports/i-billing-repository.ts`
   returns nothing.
4. `make lint`.
5. `git diff --stat` confirms only `packages/shared/**` changed — no file under
   `apps/api/` or `apps/web/` appears.
