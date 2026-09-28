# Plan — Task 04: Two-rail standing and roster

**Task:** [04-two-rail-standing-and-roster.task.md](../04-two-rail-standing-and-roster.task.md)
**RFC:** [RFC 0015](../../../RFCs/0015-event-extras-one-off-charges-for-events.md) §2, §4, §6, §7, Resolved #4, #5, #9
**Branch:** `feature/m22/04-two-rail-standing-and-roster.task`

## Goal

Put both rails on the admin roster without ever merging them:

1. `getStanding` (contract standing) goes through `resolveRailStanding('contract', …)` with
   byte-identical output.
2. A new extras standing, resolved from event charges only through
   `resolveRailStanding('extras', …)`, with **no hold** ever passed.
3. `GET /v1/admin/billing/students` lists the union of **user ids** from contracts and
   charges; each entry carries a `contract` block (or `null`) and an `extras` block (or
   `null`), and no top-level standing or total.
4. `contractStanding` / `extrasStanding` filters; legacy `standing` = alias of
   `contractStanding`.
5. Exactly **four** aggregate reads (subscriptions, invoices, charges, holds), regardless of
   the number of students.

## Files to touch

| File | Change |
|---|---|
| `apps/api/src/core/billing/event-charge-service.ts` | Add `ExtrasRailSummary`, `ExtrasStandingSummary`, pure `resolveExtrasRail(charges, asOf)`, and `EventChargeService.getExtrasStanding(userId, asOf?)`. |
| `apps/api/src/core/billing/billing-service.ts` | `RosterEntry` / `RosterFilter` reshape; `ChargeReader` type; optional 3rd constructor arg `charges`; `getStanding` via `resolveRailStanding('contract', …)`; `listStudentRoster` rewritten over four reads. |
| `apps/api/src/controllers/admin-billing.controller.ts` | `RosterQuerySchema` gains `contractStanding`, `extrasStanding` (keeps `standing`). |
| `apps/api/src/routes/admin/billing.ts` | `RosterEntrySchema` reshaped (`RosterContractSchema`, `RosterExtrasSchema`); route query gains the two filters; description updated. |
| `apps/api/src/container.ts` | Pass `eventChargeRepo` to `BillingService` (see deviation). |
| `apps/api/test/core/billing/standing-roster.spec.ts` | Adapt existing assertions to `entry.contract.*`; new two-rail tests; 4-query budget. |
| `apps/api/test/core/billing/invoice-run.spec.ts`, `apps/api/test/controllers/me-billing.controller.spec.ts`, `apps/api/test/routes/billing-no-gating.spec.ts` | Adapt roster reads to the reshaped entry only. |
| `apps/api/test/routes/admin-billing-roster.router.spec.ts` (new) | HTTP-level rail isolation, extras-only buyer, filters, legacy alias equivalence, response has no top-level standing/total. |

**Deviation:** the guardrail names `apps/api/src/index.ts` for injecting the charge adapter;
the container wiring now lives in `apps/api/src/container.ts` (`buildContainer`, called by
`buildApp`), where Task 03 already wired `eventChargeRepo`. The one-line injection goes there.

## Contracts

### `event-charge-service.ts`

```ts
export interface ExtrasRailSummary {
  standing: Entities.Config.BillingStanding;   // never 'exempt' — the extras rail has no hold
  oldestOverdueDate: string | null;
  outstandingMinor: number;
  openCharges: number;      // non-void charges with balanceMinor > 0
  overdueCharges: number;   // of those, asOf >= dueDate (same "overdue" as oldestOverdueDate)
}
export interface ExtrasStandingSummary extends ExtrasRailSummary { userId: string; asOf: string }

/** Pure; hold is always null (Resolved #9). Throws via resolveRailStanding on a stray item. */
export function resolveExtrasRail(charges: EventChargeWithBalanceRecord[], asOf: string): ExtrasRailSummary;

// EventChargeService
async getExtrasStanding(userId: string, asOf?: string): Promise<ControllerResult<ExtrasStandingSummary>>;
// one read: repo.listCharges({ userId })
```

### `billing-service.ts`

```ts
export type ChargeReader = Pick<IEventChargeRepository, 'listCharges'>;

export interface RosterContractBlock {
  id: string; groupId: string; status: ContractStatus;
  nextDueDate: string | null; negotiatedTerms: boolean;
  standing: BillingStanding; oldestOverdueDate: string | null; outstandingMinor: number;
}
export type RosterExtrasBlock = ExtrasRailSummary;

export interface RosterEntry {
  userId: string; asOf: string;
  currency: string;                  // the contract's; else the newest charge's
  contract: RosterContractBlock | null;
  extras: RosterExtrasBlock | null;  // null = never charged (a void charge still counts as charged)
  hold: BillingStandingHoldRecord | null;
}

export interface RosterFilter {
  contractStanding?: BillingStanding;
  extrasStanding?: BillingStanding;
  /** @deprecated alias of contractStanding. */
  standing?: BillingStanding;
  asOf?: string;
}

constructor(repo, studentExists = async () => true, charges: ChargeReader = NO_CHARGES)
```

`NO_CHARGES` returns `[]` so existing specs constructing the service with a repo alone keep
working; the container passes the real `eventChargeRepo`.

Roster algorithm: `Promise.all([listSubscriptions({}), listInvoices({}), charges.listCharges({}), listHolds()])`
→ group by user → iterate the **union of user ids** (contracts ∪ charges) → contract block via
`resolveRailStanding('contract', invoices.map(fromInvoice), hold, asOf)`; extras block via
`resolveExtrasRail(userCharges, asOf)` (hold never passed). Filter: `standing` and
`contractStanding` both given and different ⇒ `400`; effective contract filter excludes
`contract: null`; extras filter excludes `extras: null`. Sort: contract outstanding desc
(null = 0), then extras outstanding desc, then user id asc.

`getStanding`: same two reads; `resolveRailStanding('contract', unvoided(invoices).map(fromInvoice), hold, day)`.

### HTTP

`GET /v1/admin/billing/students?contractStanding=&extrasStanding=&standing=&asOf=` →
`BillingRosterEntry[]` with the shape above (`BillingRosterContract`, `BillingRosterExtras`
components). No top-level `standing` / `outstandingMinor`.

## Tests mapped to acceptance criteria

| AC | Test |
|---|---|
| Contract paid-up + overdue charge ⇒ good / delinquent | `standing-roster.spec` "rail isolation: a late extra never moves the monthly fee"; router spec same scenario over HTTP. |
| Late invoice + charges paid ⇒ delinquent / good | `standing-roster.spec` "rail isolation: paid extras never clear a late monthly fee"; router spec. |
| Extras-only buyer | `standing-roster.spec` "lists a buyer with no contract" (`contract: null`, extras delinquent, `currency` from the charge); router spec. |
| `contractStanding` & legacy `standing` unchanged by charges | `standing-roster.spec` compares filtered ids with `NO_CHARGES` vs with charges seeded; router spec queries before and after issuing charges. |
| Hold ⇒ contract exempt, extras unchanged | `standing-roster.spec` "a hold is contract-only". |
| `getStanding` identical | Existing `getStanding` tests unchanged and green; new table test comparing `getStanding` to direct `resolveStanding` over several ledgers (void, paid, hold, expired hold). |
| 4 queries for 1 and N | `standing-roster.spec` query budget: each of the four readers called once, total 4, per-student readers never, for 1 student and for 50 students + 50 extras buyers. |
| No top-level standing/total | Router spec asserts `not.toHaveProperty('standing')` / `('outstandingMinor')` on every entry; unit test on the service entry. |
| `getExtrasStanding` | `standing-roster.spec`: one read, hold ignored, void excluded, counts. |
| Lint / tests / scope | `make lint`, `make test-api`, `packages/shared` tests, `git diff --stat`. |

## Verification

```bash
make lint
make test-api            # alone; rerun once on a bare exit 1 (2-core timeout)
cd packages/shared && pnpm test
cd apps/api && pnpm exec tsc --noEmit   # no new errors vs. baseline
git diff --stat feature/m22/candidate
```
