# Plan — Task 08: Two-rail roster, reports and statement panel

**Task:** [08-two-rail-roster-reports-and-statement.task.md](../08-two-rail-roster-reports-and-statement.task.md)
**RFC:** [RFC 0015](../../../RFCs/0015-event-extras-one-off-charges-for-events.md) §4, §7, §8, Resolved #4, #5
**Branch:** `feature/m22/08-two-rail-roster-reports-and-statement.task`
**Persona:** frontend-developer (apps/web only — the API is merged and is not edited here)

## Goal

Bring the admin billing console in line with the two-rail API from Tasks 04/05, never
showing a merged figure:

1. **Roster** (`students-tab.tsx`) consumes the reshaped entry
   `{ userId, asOf, currency, contract | null, extras | null, hold }`: a *Monthly fee*
   badge ("No contract" when `contract` is null) and an *Extras* badge (dash when `extras`
   is null), each with its own outstanding amount; extras shows its overdue/open charge
   counts. Two independent filters send `contractStanding` / `extrasStanding`. Two
   separate on-screen totals (monthly fees / extras) replace the single total.
2. **Reports** (`reports-tab.tsx`): aging gets a rail switch (default `contract`,
   switching refetches with `rail=extras`); movement renders three groups —
   *Monthly fees*, *Extras*, *Cash received* — and the only cross-rail number is
   `cashReceivedMinor`, labelled as cash received.
3. **Statement panel** (`student-statement-panel.tsx`): the contract section gets a
   *Monthly fee* heading with the contract standing badge (passed in from the roster row —
   the admin statement carries no contract standing field); a separate *Extras* section
   renders `statement.extras` with its own standing badge, outstanding, oldest overdue and
   one row per charge (event title, event date, due date, status, amount, balance).

## Files to touch

| File | Change |
|---|---|
| `apps/web/src/lib/admin-billing-api.ts` | Types: `BillingRail`, `BillingRosterContract`, `BillingRosterExtras`, reshaped `BillingRosterEntry`, `RosterQuery` (+`contractStanding`, `extrasStanding`, `standing` deprecated), `BillingMovementExtras` + `extras`/`cashReceivedMinor` on movement, `rail` on aging, `BillingStatementCharge`, `BillingStatementExtras`, `extras?` on the statement. `reports.aging(asOf?, rail?)`. |
| `apps/web/src/app/(protected)/admin/billing/standing-badge.tsx` | Optional `railLabel` prop: renders an `sr-only` "<rail>: " prefix inside the badge so each badge names its rail for assistive tech. |
| `apps/web/src/app/(protected)/admin/billing/students-tab.tsx` | Two-rail rows, two filters, two totals, hold button only on rows with a contract, passes `contractStanding` to the statement panel. |
| `apps/web/src/app/(protected)/admin/billing/reports-tab.tsx` | Aging rail switch; three movement groups. |
| `apps/web/src/app/(protected)/admin/billing/student-statement-panel.tsx` | Contract badge + Extras section. |
| `apps/web/src/app/(protected)/admin/billing/__tests__/{students-tab,reports-tab,student-statement-panel,standing-badge}.test.tsx` | Fixtures reshaped; new cases below. |
| `apps/web/src/lib/__tests__/admin-billing-api.test.ts` | Roster filter serialisation, aging `rail`. |
| `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` | New keys (identical sets). |

Not touched: `apps/web/src/hooks/use-delinquency-count.ts` / `layout.tsx`. The nav badge
reads `roster({ standing: 'delinquent' }).length` — it never read a top-level standing, and
the API keeps `standing` as the alias of `contractStanding`, so the badge already reflects
the contract rail only. `RosterQuery.standing` stays (deprecated) so that hook compiles.

## Contracts

```ts
export type BillingRail = 'contract' | 'extras';

export type BillingRosterContract = {
  id: string; groupId: string; status: ContractStatus;
  nextDueDate: string | null; negotiatedTerms: boolean;
  standing: Standing; oldestOverdueDate: string | null; outstandingMinor: number;
};
export type BillingRosterExtras = {
  standing: Standing; oldestOverdueDate: string | null; outstandingMinor: number;
  openCharges: number; overdueCharges: number;
};
export type BillingRosterEntry = {
  userId: string; asOf: string; currency: string;
  contract: BillingRosterContract | null;
  extras: BillingRosterExtras | null;
  hold: BillingHold | null;
};
export type RosterQuery = {
  contractStanding?: Standing; extrasStanding?: Standing;
  /** @deprecated alias of contractStanding on the server. */ standing?: Standing;
  asOf?: string;
};

export type BillingMovementExtras = {
  chargedMinor: number; adjustmentsMinor: number; receivedMinor: number;
  chargesIssued: number; receivableAtCloseMinor: number;
};
BillingMovementReport += { extras: BillingMovementExtras; cashReceivedMinor: number };
BillingAgingReport += { rail: BillingRail };
reports.aging(asOf?: string, rail?: BillingRail) // → /reports/aging?asOf=&rail=

export type BillingStatementCharge = BillingEventChargeDetail & {
  eventTitle: string; eventStartsAt: string | null;
};
export type BillingStatementExtras = {
  standing: Standing; oldestOverdueDate: string | null; outstandingMinor: number;
  charges: BillingStatementCharge[];
};
BillingStudentStatement += { extras?: BillingStatementExtras };
```

`extras` is optional on the statement **type only**: the API always sends it, but
`MyBillingStatement` extends this type and the student-side fixtures
(`components/billing/__tests__/statement-fixture.ts`, Task 09's scope) predate it. Making
it required here would add typecheck errors outside this task's guardrail. The panel
treats an absent block as "no extras". Task 09 may tighten it.

`StudentStatementPanel` gains `contractStanding?: Standing | null` — `undefined`: caller
did not say (no badge), `null`: no contract ("No contract"), a value: the badge.

Nothing in the client derives a standing, a bucket or a due-date consequence; every badge
renders a value the API resolved.

Extras filter options are `good | due | delinquent` — `exempt` is unreachable on the
extras rail (no hold, Resolved #9). Contract filter keeps all four.

Per-charge "standing": the API resolves standing per rail, not per charge. Each charge row
shows its status (`open`/`paid`/`void`) as a text badge; the rail standing badge heads the
section. (Deviation noted — deriving a per-charge standing would put a copy of the
resolver in the client.)

## Tests → acceptance criteria

| AC | Test |
|---|---|
| Contract paid-up + overdue charge ⇒ *Monthly fee: good*, *Extras: delinquent* | `students-tab.test`: row u1 (contract good, extras delinquent 1 overdue) — cells scoped by column show the right badge; badge accessible text includes the rail label. |
| Extras-only buyer ⇒ "No contract" + resolved extras badge | `students-tab.test`: row u3 `contract: null` → `d.noContract`, extras badge, no hold button. |
| Independent filters, each issues its param | `students-tab.test`: change monthly-fee filter → `?contractStanding=delinquent`; change extras filter → `?contractStanding=delinquent&extrasStanding=delinquent`; reset contract → `?extrasStanding=delinquent`. |
| Aging opens on contract; switch refetches `rail=extras` | `reports-tab.test`: first aging call `?rail=contract`, click extras → `?rail=extras`, column header says charges. |
| Movement three groups, no combined "received" but cash | `reports-tab.test`: three regions by name; contract region shows contract received, extras region shows extras received, cash region shows `cashReceivedMinor`; the only occurrence of the cash label. |
| Statement: two sections, each own badge | `student-statement-panel.test`: contract badge from prop, extras section with standing badge, charge row with title/event date/due/balance; `null` → "No contract"; absent extras → empty text. |
| Nav badge contract only | Unchanged hook; `admin-billing-api.test` asserts `standing` still serialises as the alias and the new params serialise. |
| i18n | `node apps/web/scripts/check-i18n-coverage.js`; dict-en/pt typed against the same `Dictionary`. |
| Lint / tests / scope | `make lint`, `make test-web`, `pnpm exec tsc --noEmit` in apps/web (6 pre-existing errors, none added), `git diff --stat feature/m22/candidate`. |

## Verification

```bash
make lint
make test-web                         # alone
node apps/web/scripts/check-i18n-coverage.js
(cd apps/web && pnpm exec tsc --noEmit)   # baseline: 6 errors in catalog/topic-tree tests
git diff --stat feature/m22/candidate
```
