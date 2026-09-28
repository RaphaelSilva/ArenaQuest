# Task 01 — Backend: Event-charge domain, port and the rail-tagged receivable (Phase 0)

**Status:** ✅ Done
**Milestone:** [22 — Event extras: one-off charges on a separate billing rail](./milestone.md)
**RFC:** [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md)
**Team:** Backend API

## Summary

Lays down the contracts every later task builds on, with no persistence and no HTTP. It adds
the canonical shapes of an **event price** and an **event charge** (with its adjustments and
payments) to `Entities.Billing`, a `ChargeStatus` enum (`open` · `paid` · `void`), and a new
cloud-agnostic port, `IEventChargeRepository` — a **sibling** of `IBillingRepository`, not an
extension of it, because the two ledgers share rules but never rows (RFC 0015 §3). Its methods
cover the price (get / set / clear), charges (list with computed balance, get, idempotent bulk
issue that reports *created* and *absorbed* pairs, void), and the charge ledger (record payment,
get payment, apply adjustment, list ledger). It also introduces the pure module
`domain/billing/receivable.ts`, which is the heart of the **two-rail rule** (RFC 0015 §2,
Resolved #5): a `BillingRail` (`contract` · `extras`), a `Receivable` shape carrying its rail,
the `fromInvoice` / `fromCharge` mappers, and `resolveRailStanding`, the only sanctioned way to
feed receivables to the unchanged `resolveStanding` — it drops voids, **throws on any item
whose rail differs from the one requested**, and delegates. Tasks 02–06 implement and consume
these contracts.

## Dependencies

None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/types/entities.ts` — **only** additions: `Entities.Billing.EventPrice`,
    `EventCharge`, `EventChargeAdjustment`, `EventChargePayment`, and
    `Entities.Config.ChargeStatus`. No existing type is modified.
  - `packages/shared/ports/i-event-charge-repository.ts` (new) and its re-export in
    `packages/shared/ports/index.ts`.
  - `packages/shared/domain/billing/receivable.ts` (new), its spec, and its re-export in
    `packages/shared/domain/billing/index.ts`.
- **`resolveStanding` is not modified.** `standing-resolver.ts` and its spec stay byte-identical;
  rail separation is enforced one layer above it.
- **Ports & Adapters.** The port carries persistence-facing flat records (dates as
  `YYYY-MM-DD` strings, money as integer minor units, relations as ids) in the same style as
  `i-billing-repository.ts`. No D1, Worker `env`, Hono or Zod type crosses it.
- **No payment-gateway port** is declared (RFC 0013 #9 still applies).
- **Pure module.** `receivable.ts` performs no I/O and reads no clock.

## Scope

In:
- The four entity shapes and the `ChargeStatus` enum.
- `IEventChargeRepository` with the record, input and filter types it needs, documented with
  the invariants the adapter must honour: append-only ledger, reversal by mirror row,
  idempotent bulk issue on one live charge per `(event, user)`, balance computed as amount +
  Σ adjustments − Σ payments.
- `receivable.ts`: `BillingRail`, `ReceivableKind`, `Receivable`, `fromInvoice`, `fromCharge`,
  `resolveRailStanding`.
- Unit tests for `receivable.ts`.

Out:
- The migration and the D1 adapter (Task 02); any service or route (Tasks 03–06); any
  frontend change.
- Any change to `IBillingRepository`.

## Acceptance Criteria

- [x] `resolveRailStanding('contract', …)` over invoice-derived receivables returns exactly
      what `resolveStanding` returns today for the same invoices (table-driven test reusing
      the standing-resolver cases).
- [x] `resolveRailStanding` called with a mixed input (an `event_charge` item on the
      `contract` rail, or the reverse) throws; a test proves it for both directions.
- [x] Void receivables are excluded before resolution; a test proves a voided overdue item
      leaves the standing `good`.
- [x] `fromInvoice` and `fromCharge` preserve the item's own `graceDays` snapshot and balance.
- [x] `standing-resolver.ts` shows no diff.
- [x] No provider-specific (D1/R2) import appears in the port or the domain module.
- [x] Changed files lint clean; `make test-api` green (and the `packages/shared` specs pass).
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Run the `packages/shared` Vitest suite; the new `receivable` spec and the existing
   `standing-resolver` spec pass.
2. `make lint` — clean.
3. `make test-api` — green (nothing in the API consumes the port yet; it must still compile).
4. `git diff --stat` confirms only scope-guardrail files changed.
