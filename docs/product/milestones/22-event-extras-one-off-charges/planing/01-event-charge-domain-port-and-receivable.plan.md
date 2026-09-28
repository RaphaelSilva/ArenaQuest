# Plan — Task 01: Event-charge domain, port and the rail-tagged receivable

**Task:** [01-event-charge-domain-port-and-receivable.task.md](../01-event-charge-domain-port-and-receivable.task.md)
**RFC:** [RFC 0015](../../../RFCs/0015-event-extras-one-off-charges-for-events.md) §2, §3, Resolved #5
**Branch:** `feature/m22/01-event-charge-domain-port-and-receivable.task`

## Goal

Lay down the contracts Tasks 02–06 build on, with no persistence and no HTTP:

1. Canonical entity shapes for an event price, an event charge, its adjustments and payments,
   plus a `ChargeStatus` enum.
2. A cloud-agnostic port `IEventChargeRepository`, a **sibling** of `IBillingRepository`.
3. A pure module `domain/billing/receivable.ts` that tags every receivable with its rail and
   exposes `resolveRailStanding`, the only sanctioned route from receivables to the unchanged
   `resolveStanding`.

## Files to touch (scope guardrail)

| File | Change |
|---|---|
| `packages/shared/types/entities.ts` | **Additions only**: `Entities.Config.ChargeStatus`; `Entities.Billing.EventPrice`, `EventCharge`, `EventChargeAdjustment`, `EventChargePayment`. |
| `packages/shared/ports/i-event-charge-repository.ts` | New port + record/input/filter types. |
| `packages/shared/ports/index.ts` | `export * from './i-event-charge-repository';` |
| `packages/shared/domain/billing/receivable.ts` | New pure module. |
| `packages/shared/domain/billing/receivable.spec.ts` | New unit tests. |
| `packages/shared/domain/billing/index.ts` | `export * from './receivable';` |

Not touched: `standing-resolver.ts` and its spec, `i-billing-repository.ts`, anything in
`apps/`.

## Entity additions (`entities.ts`)

```ts
// Entities.Config
export enum ChargeStatus { OPEN = 'open', PAID = 'paid', VOID = 'void' }

// Entities.Billing
export interface EventPrice {
  eventId: string; amountMinor: number; currency: string;
  dueInDays: number; graceDays: number; updatedBy: string; updatedAt: Date;
}
export interface EventCharge {
  id: string; eventId: string; userId: string;
  description: string;                       // event title snapshot at issue
  amountMinor: number; currency: string;
  termsSource: Config.ContractTermsSource;   // reuses standard | negotiated
  termsNote: string;
  dueDate: string; graceDays: number;        // snapshots
  status: Config.ChargeStatus;
  issuedBy: string; issuedAt: Date;
  voidedAt: Date | null; voidReason: string | null;
}
export interface EventChargeAdjustment {
  id: string; chargeId: string; kind: Config.AdjustmentKind;
  amountMinor: number; reason: string; appliedBy: string; appliedAt: Date;
}
export interface EventChargePayment {
  id: string; chargeId: string; amountMinor: number; currency: string;
  method: Config.PaymentMethod; paidAt: Date; externalReference: string | null;
  note: string; reversesId: string | null; recordedBy: string; recordedAt: Date;
}
```

## Port (`i-event-charge-repository.ts`)

Flat persistence records (dates as strings, money as integer minor units, relations as ids),
same style as `i-billing-repository.ts`; only `import type { Entities }`.

Records: `EventPriceRecord`, `EventChargeRecord`, `EventChargeWithBalanceRecord`
(`EventChargeRecord & { balanceMinor: number }`), `EventChargeAdjustmentRecord`,
`EventChargePaymentRecord`, `ChargeLedgerEntryRecord` (discriminated union
`payment | adjustment` with `occurredAt`).

Inputs/filters: `SetEventPriceInput`, `EventChargeFilter`
(`eventId?`, `userId?`, `status?`, `dueFrom?`, `dueTo?`), `IssueChargeItem`
(`userId`, `amountMinor`, `currency`, `termsSource`, `termsNote?`, `dueDate`, `graceDays`),
`IssueChargesInput` (`eventId`, `description`, `issuedBy`, `items: IssueChargeItem[]`),
`EventChargePair` (`{ eventId; userId }`), `IssueChargesResult`
(`{ created: EventChargeRecord[]; absorbed: EventChargePair[] }`),
`RecordChargePaymentInput`, `ApplyChargeAdjustmentInput`, `ChargeLedgerFilter`
(`chargeId?`, `eventId?`, `userId?`, `from?`, `to?`).

```ts
export interface IEventChargeRepository {
  getPrice(eventId: string): Promise<EventPriceRecord | null>;
  setPrice(input: SetEventPriceInput): Promise<EventPriceRecord>;
  clearPrice(eventId: string): Promise<void>;

  listCharges(filter: EventChargeFilter): Promise<EventChargeWithBalanceRecord[]>;
  getCharge(id: string): Promise<EventChargeWithBalanceRecord | null>;
  issueCharges(input: IssueChargesInput): Promise<IssueChargesResult>;
  voidCharge(id: string, reason: string, voidedBy: string): Promise<EventChargeRecord | null>;

  recordPayment(input: RecordChargePaymentInput): Promise<EventChargePaymentRecord>;
  getPayment(id: string): Promise<EventChargePaymentRecord | null>;
  applyAdjustment(input: ApplyChargeAdjustmentInput): Promise<EventChargeAdjustmentRecord>;
  listLedger(filter: ChargeLedgerFilter): Promise<ChargeLedgerEntryRecord[]>;
}
```

Documented invariants: append-only ledger (no update/delete methods); reversal by a negative
mirror row with `reversesId`; idempotent `issueCharges` against one live charge per
`(eventId, userId)` (partial unique index `WHERE status <> 'void'`), absorbed pairs reported
rather than failing; `balanceMinor = amountMinor + Σ adjustments − Σ payments`, computed by the
adapter; `status` is a cache; no payment-gateway port (RFC 0013 #9).

**Deviation from RFC §3 text:** `absorbed` is typed `EventChargePair[]` instead of `string[]`,
so a caller never has to parse a joined key. The information carried is identical.

## Domain module (`receivable.ts`)

```ts
export type BillingRail = 'contract' | 'extras';
export type ReceivableKind = 'invoice' | 'event_charge';
export const RAIL_OF_KIND: Readonly<Record<ReceivableKind, BillingRail>>;

export interface Receivable {
  rail: BillingRail; kind: ReceivableKind; id: string; userId: string;
  sourceId: string;   // eventId for a charge; subscriptionId for an invoice (see note)
  label: string;      // 'YYYY-MM' of periodStart for an invoice; event title / description for a charge
  issuedAt: string; dueDate: string; graceDays: number;
  amountMinor: number; currency: string;
  status: 'open' | 'paid' | 'void';
  balanceMinor: number;
}

export function fromInvoice(invoice: InvoiceWithBalanceRecord): Receivable;
export function fromCharge(charge: EventChargeWithBalanceRecord, eventTitle?: string): Receivable;
export function resolveRailStanding(
  rail: BillingRail,
  items: Receivable[],
  hold: { expiresAt: string | null } | null,
  today: string,
): StandingResult;
```

`resolveRailStanding`: (1) throws `Error` if any item's `rail !== rail` (or its `kind` does not
map to `rail`) — checked **before** dropping voids, so a mixed input fails even when the stray
item is void; (2) drops `status === 'void'`; (3) maps to `StandingInvoice`
(`dueDate`, `graceDays`, `balanceMinor`) and delegates to `resolveStanding`.

**Note on `sourceId` for invoices:** RFC §2 says "the contract group". `InvoiceRecord` carries
only `subscriptionId`, and `fromInvoice` takes the record alone (pure, no lookup), so the
invoice's `subscriptionId` is used. Nothing in this task reads `sourceId`.

## Tests (`receivable.spec.ts`) mapped to acceptance criteria

| AC | Test |
|---|---|
| Contract rail equals `resolveStanding` | Table-driven `it.each` over the standing-resolver scenarios (no invoice, settled, overpaid, before due, on due, last grace day, day after grace, month-end grace crossing, zero grace, oldest-grace-decides ×2, settled older ignored, active hold, never-expiring hold, hold on expiry day, expired hold, discount clears, reversal reopens, outstanding sums positives only). Each case builds `InvoiceWithBalanceRecord`s, maps with `fromInvoice`, and asserts `toEqual(resolveStanding(...))`. |
| Mixed input throws, both directions | `resolveRailStanding('contract', [fromCharge(...)])` throws; `resolveRailStanding('extras', [fromInvoice(...)])` throws; a mixed list with a valid first item still throws; a void stray still throws. |
| Voids excluded | A voided, overdue charge with a positive balance on the extras rail → `good`, `outstandingMinor 0`, `oldestOverdueDate null`; alongside a live overdue one only the live one counts. |
| Mappers preserve snapshot and balance | `fromInvoice` keeps `graceDays`, `balanceMinor`, `dueDate`, `amountMinor`, `currency`, `status`, rail `contract`, kind `invoice`; `fromCharge` keeps the charge's own `graceDays`/`balanceMinor`, rail `extras`, kind `event_charge`, `sourceId = eventId`, label from `eventTitle` or falls back to `description`. |
| Extras rail resolves | An overdue open charge past grace on `extras` → `delinquent`. |
| `standing-resolver.ts` no diff | `git diff --stat main -- packages/shared/domain/billing/standing-resolver*` empty. |
| No provider imports | `grep -nE "D1|R2|hono|zod|cloudflare" <port> <module>` finds no import. |
| Scope | `git diff --stat main` lists only the guardrail files + this plan. |

## Verification commands

```bash
cd packages/shared && pnpm test                 # new receivable spec + standing-resolver spec
make lint
cd apps/api && pnpm exec tsc --noEmit            # API still compiles (does not consume the port yet)
git diff --stat main
git diff main -- packages/shared/domain/billing/standing-resolver.ts packages/shared/domain/billing/standing-resolver.spec.ts
```

`make test` is not run (web + API concurrently times out on the 2-core box); `make test-api`
may be run alone if time allows.
