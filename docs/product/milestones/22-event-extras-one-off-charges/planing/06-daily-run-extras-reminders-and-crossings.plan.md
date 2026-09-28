# Plan — Task 06: Daily run — extras reminders and per-rail crossings

**Task:** [06-daily-run-extras-reminders-and-crossings.task.md](../06-daily-run-extras-reminders-and-crossings.task.md)
**RFC:** RFC 0015 §5, Resolved #8 and #9.

## Goal

Teach `BillingService.runBillingCycle` to *read* the extras ledger: send the two
extras reminders (`extras_due_date`, `extras_grace_lapsed`) worded for the event,
never suppressed by a contract hold, and compute standing crossings per rail so the
admin digest shows two sections. Invoice issuance, its idempotency key, and contract
reminders are unchanged. The run writes no row in any `event_charge*` table.

## Starting point (Tasks 01–05)

- `BillingService` already takes an optional third argument `charges: ChargeReader`
  (`Pick<IEventChargeRepository, 'listCharges'>`) — read-only by type. The container
  (`apps/api/src/container.ts`) already passes `eventChargeRepo`, so the scheduled
  handler (`runScheduledBilling`) and `POST /v1/admin/billing/invoices/run` both reach
  the extras ledger with **no wiring change** (`src/index.ts` untouched).
- `resolveExtrasRail(charges, asOf)` (event-charge-service.ts) resolves extras standing
  with no hold. Reused for crossings.
- `EventChargeRecord.description` is the event-title snapshot taken at issue — the
  reminder names the event from it (no event repository read needed).

## Files to touch

- `apps/api/src/core/billing/billing-service.ts` — run routine, report types, reminder
  kinds, extras message composition, digest sections.
- `apps/api/test/core/billing/invoice-run-extras.spec.ts` (new, node pool) — reminders,
  hold, re-run, digest sections, wording.
- `apps/api/test/db/billing-run-extras.spec.ts` (new, workers pool) — row counts of the
  four `event_*` tables unchanged by a run against real D1 adapters.

## Contracts

```ts
export type ContractReminderKind = 'due_date' | 'grace_lapsed';
export type ExtrasReminderKind = 'extras_due_date' | 'extras_grace_lapsed';
export type BillingReminderKind = ContractReminderKind | ExtrasReminderKind;

// ReminderLine.kind narrows to ContractReminderKind (contract lines unchanged).

export interface ExtrasReminderLine {
  chargeId: string;
  eventId: string;
  /** The event title snapshot the message names. */
  description: string;
  userId: string;
  kind: ExtrasReminderKind;
  dueDate: string;
  triggerOn: string;
  balanceMinor: number;
  currency: string;
  /** False when no address could be resolved or the mailer failed. */
  sent: boolean;
}

export interface ReminderCounts { sent: number; suppressed: number; undeliverable: number }

export interface BillingRunReport {
  // ...every existing field unchanged in meaning (contract rail only):
  // reminders, crossings, suppressedByHold, ...
  extrasReminders: ExtrasReminderLine[];
  extrasCrossings: StandingCrossingLine[];
  reminderCounts: { contract: ReminderCounts; extras: ReminderCounts };
}
```

`reminderCounts.extras.suppressed` is always 0 — there is no extras hold (Resolved #9);
the field exists so both rails report the same three counts.

## Behaviour

1. Issuance, the divergence assertion, contract reminders and contract crossings: code
   paths untouched.
2. State read once adds `this.charges.listCharges({})`.
3. **Extras reminders:** for every non-void charge with `balanceMinor > 0`, triggers
   `extras_due_date` on `dueDate` and `extras_grace_lapsed` on
   `addDays(dueDate, graceDays + 1)` — same half-open `(since, asOf]` window, so a
   same-day re-run (`since = asOf`) sends nothing. **No hold check.** Undeliverable →
   `billing.extras_reminder_undeliverable`; otherwise mail + `billing.extras_reminder`
   audit (`chargeId`, `eventId`, `kind`).
   Wording: "Your charge of R$150.00 for Seminário de Março is due today, 2026-03-10." /
   "... due on …, is now past its grace period." Subjects name the event; the word
   "membership" never appears.
4. **Extras crossings:** group live charges by user; `resolveExtrasRail(charges, since)`
   vs `(charges, asOf)`; a move into `due`/`delinquent` is a crossing. Sorted like the
   contract list. Never touches holds.
5. **Digest:** sent when either list is non-empty; two sections — "Crossed on the monthly
   fee:" and "Crossed on extras:" (section omitted when empty is *not* done: each section
   prints "(none)" so the reader sees both rails were checked). Subject counts both.
6. Final `billing.invoice_run` audit adds `extrasRemindersSent`, `extrasCrossings`, and
   `chargeRowsWritten: 0`. Header comment: rule 1 now covers both ledgers.

## Acceptance criteria → tests

| AC | Test |
|---|---|
| One `extras_due_date` + one `extras_grace_lapsed` over a span, each naming the event | node: daily chain over a month, count mails per kind; text contains event title, no "membership" |
| Held student still receives extras reminders | node: `setHold` then run on due date → extras mail sent, contract reminder suppressed |
| Same-day re-run sends nothing | node: run `since = asOf` → `extrasReminders` empty, no new mail |
| Row counts of four tables unchanged | workers: issue charge via `EventChargeService`, count, run for due & grace days, count |
| Digest separates rails; extras-only student absent from contract section | node: extras-only student → `crossings` empty, `extrasCrossings` has them; digest text sections |
| Contract behaviour unchanged | existing `invoice-run.spec.ts` untouched and green |
| Lint / test-api | `make lint`, `make test-api` |

## Verification

```bash
make lint
make test-api
pnpm --filter @arenaquest/shared test   # shared untouched, sanity
git diff --stat feature/m22/candidate   # only scope-guardrail files + tests
```
