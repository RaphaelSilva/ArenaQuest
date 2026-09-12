# Task 13 — Frontend: Manual invoice cycle run (Phase 5)

**Status:** ✅ Done
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Frontend Web
**Depends On:** [Task 06](./06-scheduled-invoice-run-and-billing-alerts.task.md), [Task 12](./12-ledger-write-actions.task.md)

## Summary

Surfaces the manual twin of the daily cron, which exists precisely so a missed firing is
recoverable without a deploy — and is currently recoverable only by someone who can write
an authenticated request by hand. The administrator gets a control that runs the cycle and
then shows what the run actually did: which invoices were issued, how many were absorbed
as already-existing, which reminders went out and which students crossed into due or
delinquent. The report is the point. A run that silently returns success tells an
administrator nothing about whether the month was billed, and the job's own design — it
issues, it notifies, it digests and it asserts cached statuses — is legible only if its
result is shown. Because the job is idempotent by construction, the screen can say plainly
that running it twice is safe, which is what makes an administrator willing to use it when
they are unsure whether the cron fired.

## Does this need a backend change?

**No.** `POST /v1/admin/billing/invoices/run` exists, delivered by Task 06 as the manual
twin of the scheduled handler, with an optional request body and a structured run report
as its response.

This task does add the **only new client method** in the write-surface set:
`apps/web/src/lib/admin-billing-api.ts` covers every other `/v1/admin/billing/*` endpoint
but not this one. That file is a frontend module inside this milestone's guardrail, so
adding a method to it is frontend work and introduces no server contract — the route, its
schema and its report shape are all fixed by Task 06. `git diff` for this task must
contain no file under `apps/api/` or `packages/`.

This is also why the task is sequenced after Task 12 rather than run in parallel with it:
both touch the Ledger tab and its client module, and serialising them avoids a merge
conflict on files neither task owns exclusively.

## Dependencies

- [Task 06](./06-scheduled-invoice-run-and-billing-alerts.task.md) — owns the run endpoint,
  its idempotency and the report this screen renders. Already `✅ Done`.
- [Task 12](./12-ledger-write-actions.task.md) — shares the Ledger tab and
  `admin-billing-api.ts`; sequenced after it for that reason rather than for a functional
  dependency.
- The existing Ledger tab and the console's resolved display currency, both consumed as
  they stand.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/billing/**` — the run control, its confirmation
    and the report rendering.
  - `apps/web/src/lib/admin-billing-api.ts` — one added method for the existing run
    endpoint. No other endpoint is added, and no existing method changes shape.
  - `apps/web/src/components/**` and `apps/web/src/hooks/**` — only pieces this screen
    introduces.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed).
  - `apps/web/**` component tests.
- **Frontend only.** No backend file is touched. The endpoint, its optional parameters and
  its report shape are fixed by Task 06; this task types and renders them, and defines no
  new server contract.
- **The report is rendered, not summarised away.** Issued invoices, the absorbed count,
  reminders sent and standing crossings each appear. A run that issued nothing must be
  distinguishable on screen from a run that failed, and from a run that issued nothing
  because everything was already billed.
- **Say that a second run is safe.** Idempotency is guaranteed by a uniqueness rule on
  contract plus period start, so a re-run absorbs rather than duplicates. The copy states
  this, because an administrator unsure whether the cron fired is exactly the person this
  control is for.
- **The confirmation states what the run does**, including that it sends the students'
  reminder and grace-lapsed notices and emails the admin digest — a run is not a
  read-only preview, and an administrator should not discover by surprise that it mailed
  anyone.
- **The run writes no adjustment of any kind**, surcharge included, and the screen must
  not suggest it applies fees, interest or corrections. It issues, notifies, digests and
  asserts cached statuses.
- **A hold suppresses notices, not totals.** Where the report mentions skipped reminders,
  the copy keeps the existing distinction: a hold stops the chasing and never the debt.
- **No standing rule in the client.** Crossings are read from the report; nothing on
  screen recomputes who is due or delinquent.
- **Money renders only through the shared money formatter** at the currency's recorded
  exponent; `Intl.NumberFormat`'s currency style must not appear in this diff.
- **No paywall affordance.** The run changes no permission and withholds no screen; a
  student who becomes delinquent as a result keeps exactly the access they had.
- **A long run must not look like a hung screen.** The control reports progress or a
  pending state and cannot be triggered twice concurrently by a double click.
- **App Router conventions.** The Ledger tab is already a Client Component; this task
  follows it and converts no existing Server Component.
- **i18n.** No hardcoded user-facing string under `src/{app,components,hooks}/**`;
  `dict-en.ts` and `dict-pt.ts` keep identical keys and `check-i18n-coverage.js` passes.
- **Responsive & accessible.** The control, its confirmation and the report stay usable at
  mobile width and keyboard-reachable, with the pending state announced rather than shown
  by colour alone.

## Scope

In:
- A run control on the Ledger tab, behind a confirmation that states what the run does —
  issues the period's invoices, sends the students' two notices, emails the admin digest
  and asserts cached invoice statuses — and that a second run is safe.
- The added client method for the existing run endpoint, typed against the report Task 06
  returns, including its optional parameters where the screen exposes them.
- The report rendering: invoices issued with their student, period, due date and amount;
  the absorbed count; reminders sent; and the students who crossed into due or delinquent.
- A distinguishable empty result — nothing to issue because everything is already billed
  — separate from a failure.
- A pending state that prevents a concurrent second trigger.
- Error feedback carrying the server's explanation, leaving the ledger list consistent
  with what persisted.
- Dictionary keys in both languages, including the copy about idempotency, about the
  mails the run sends, and about a hold suppressing notices rather than debt.
- Component tests for: the added client method's request; the report rendering each of its
  sections; an empty run rendering as "nothing to issue" rather than as a failure; the
  control refusing a concurrent second trigger; and amounts rendering at exponents 2, 0
  and 8.

Out:
- Any backend change — Task 06 owns the endpoint, its idempotency and its report.
- The cron schedule itself, the mail templates and the digest's content — all Task 06.
- Any per-invoice write — Task 12.
- A run history or an audit log screen. The report shown is the result of the run the
  administrator just triggered; persisting and browsing past runs is not part of this
  milestone.
- Scheduling, re-scheduling or disabling the cron from the UI.
- Automatic late fees or interest — the run writes no adjustment, and a milestone
  Non-Goal.

## Acceptance Criteria

- [x] The Ledger tab offers a run control behind a confirmation that names what the run
      does, including the mails it sends, and states that a second run is safe.
- [x] Running the cycle issues the due period's invoices and the report lists each one
      with its student, period, due date and amount.
- [x] A second run the same day issues nothing, reports the absorbed count, and names no
      crossings — distinguishable on screen from both a failure and a first run.
- [x] A run with nothing to issue renders as "nothing to issue", not as an error and not
      as an ambiguous success.
- [x] The report shows reminders sent and the students who crossed into due or delinquent,
      read from the response with no standing logic in the client.
- [x] Nothing on screen suggests the run applies a fee, interest, an adjustment or a
      correction.
- [x] Where skipped reminders are shown, the copy keeps the distinction that a hold stops
      the chasing and not the debt.
- [x] Double-clicking the control does not trigger two concurrent runs, and the pending
      state is announced accessibly rather than by colour alone.
- [x] A server error surfaces the server's explanation, and the ledger list afterwards
      matches what actually persisted.
- [x] Amounts render at exponents 2, 0 and 8 through the shared money formatter, and
      `Intl.NumberFormat` does not appear in the diff.
- [x] Nothing on the screen gates, suspends, restricts or downgrades access, and a student
      who becomes delinquent from the run keeps the access they had.
- [x] `apps/web/src/lib/admin-billing-api.ts` gains exactly one method, for the existing
      run endpoint, and no existing method changes shape.
- [x] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and
      `dict-pt.ts`; `node apps/web/scripts/check-i18n-coverage.js` passes.
- [~] The control and report are responsive at mobile width and keyboard-usable, verified
      in a browser.
- [x] `git diff` contains no file under `apps/api/` or `packages/`.
- [x] Changed files lint clean; `make test-web` green for the affected component tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, `make dev-api`, `make dev-web`; sign in as the seeded admin and
   sign a contract whose next period has already started, so the run has work to do.
2. Read the confirmation copy and confirm it names the mails the run sends before
   proceeding.
3. Run the cycle and confirm the report lists the invoice it issued with the right
   student, period, due date and amount, and that the invoice appears in the ledger list.
4. Run it again immediately and confirm nothing new is issued, the absorbed count is
   reported, and no crossing is named.
5. Cancel every eligible contract and run once more; confirm the result renders as
   "nothing to issue" and is clearly not a failure.
6. Set a hold on a student who would receive a reminder, run again, and confirm the notice
   was suppressed while the student's outstanding balance stayed in the totals and the
   aging report.
7. Confirm the free contract's zero-value invoice is issued, lands settled with no payment
   row, and sends no mail — as the report should show.
8. Double-click the control and confirm only one run is triggered.
9. Stop the API and trigger the run; confirm the error is explained and the ledger list is
   not left inconsistent.
10. Point the local replica's active currency at JPY and at BTC and confirm the report's
    amounts render at exponents 0 and 8.
11. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`, confirm every label translates,
    and run `node apps/web/scripts/check-i18n-coverage.js`.
12. Resize to mobile width and drive the control and read the report with the keyboard.
13. `make test-web` and `make lint`.
14. `git diff --stat` confirms only `apps/web/**` changed.
