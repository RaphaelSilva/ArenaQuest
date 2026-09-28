# Plan — Task 05: Per-rail reports, statement and `/v1/me/billing`

## Goal

Bring the extras rail (event charges) into movement, aging and both statements
without folding it into any contract figure (RFC 0015 §7). Contract fields keep
their exact pre-task meaning; extras live in sibling blocks; the only cross-rail
number is `cashReceivedMinor`.

## Files to touch (all inside the task guardrail)

- `apps/api/src/core/billing/accounting-service.ts`
- `apps/api/src/controllers/admin-billing.controller.ts` — `rail` on the aging query.
- `apps/api/src/controllers/me-billing.controller.ts` — doc only (extras flows through
  the statement type).
- `apps/api/src/routes/admin/billing.ts` — response schemas + `rail` query param. The
  existing charge schemas (`EventChargeSchema` … `EventChargeDetailSchema`) move above
  `StudentStatementSchema` so the statement can reference them (module-eval order).
- `apps/api/src/routes/me/billing.ts` — description only (schema extends the admin one).
- `apps/api/src/container.ts` — inject `eventChargeRepo` and `eventRepo` into
  `AccountingService` (the task says `index.ts`; wiring moved to `container.ts`).
- `apps/api/test/**` — new specs.

## Contracts

```ts
// accounting-service.ts
export type ExtrasLedgerReader = Pick<IEventChargeRepository, 'listCharges' | 'listLedger'>;
export type EventTitleReader = Pick<IEventRepository, 'findById'>;

constructor(
  repo: IBillingRepository,
  userExists: UserExistsProbe,
  charges: ExtrasLedgerReader = NO_EXTRAS,   // empty reader: pre-task behaviour
  events: EventTitleReader = NO_EVENTS,
)

MovementReport += {
  extras: { chargedMinor, adjustmentsMinor, receivedMinor, chargesIssued, receivableAtCloseMinor };
  cashReceivedMinor: number; // receivedMinor + extras.receivedMinor
}

getReceivablesAging(asOf?: string, rail: BillingRail = 'contract')
AgingReport += { rail: BillingRail }  // invoiceCount counts the rail's receivables

StudentStatement += {
  extras: {
    standing: BillingStanding;           // resolveExtrasRail(charges, today) — no hold
    oldestOverdueDate: string | null;
    outstandingMinor: number;
    charges: StatementCharge[];          // sorted by dueDate, issuedAt
  };
}
StatementCharge = EventChargeWithBalanceRecord & {
  eventTitle: string;                    // current title; falls back to the snapshot
  eventStartsAt: string | null;          // ISO; null when the event row is gone
  adjustments: EventChargeAdjustmentRecord[];
  payments: EventChargePaymentRecord[];
}
```

Rules:
- Partition before arithmetic: invoices + invoice ledger feed the contract fields,
  charges + charge ledger feed `extras`; nothing is summed across except
  `cashReceivedMinor`.
- A voided charge (and its ledger rows) contributes to no total, no bucket, no standing;
  it is listed on the statement with `balanceMinor = 0`.
- Balances are recomputed from ledger rows (as of `periodEnd` / `asOf` / today), never
  from `status`. Billed keyed on `issuedAt`/`appliedAt`, received on `paidAt`.
- Currency: the codes from **both** rails go into one `resolveCurrency` set, so a report
  that would span two currencies is `409` (cash total must be one currency).
- `?rail=` is `z.enum(['contract','extras']).optional()`; absent means `contract`.
- `/v1/me/billing` unchanged in arity; subject is still the token `sub`. The statement
  reads `listCharges({ userId })` / `listLedger({ userId })` only.
- The extras standing uses `resolveExtrasRail` from `event-charge-service.ts` (reused).

## Tests → acceptance criteria

`apps/api/test/core/billing/accounting-extras.spec.ts` (unit; FakeBillingRepository +
in-memory charge reader):
1. 30000 fees + 15000 extras received → `receivedMinor 30000`, `extras.receivedMinor
   15000`, `cashReceivedMinor 45000`. (AC1)
2. Contract fields identical with and without charge data (compare service with the
   empty reader vs. with charges). (AC2)
3. extras block: charged/adjustments/chargesIssued/receivableAtClose keyed on the right
   dates.
4. Aging: default === `'contract'` === service without reader (minus `rail`); `extras`
   buckets only charges. (AC3)
5. Voided charge: absent from movement, aging buckets and statement outstanding. (AC4)
6. Two currencies across rails → 409 on movement/aging/statement. (AC7)
7. Statement: extras object with eventTitle, eventStartsAt, ledger; user with nothing →
   empty statement, extras standing `good`.

`apps/api/test/routes/me-billing-extras.router.spec.ts` (worker + real D1):
8. Paid-up contract + one overdue charge → `standing good`, `extras.standing
   delinquent`, charge carries the event title. (AC5)
9. Two users each charged → each sees only their own charge. (AC6)
10. Admin `GET /reports/aging?rail=extras` and invalid rail → 400; movement includes
    `extras` and `cashReceivedMinor`.

Pre-existing RFC 0013 report specs must pass unchanged.

## Verification

```bash
make lint
make test-api           # alone; rerun once on a bare exit 1 (2-core timeout)
pnpm --filter @arenaquest/shared test
git diff --stat feature/m22/candidate   # only guardrail files
```
