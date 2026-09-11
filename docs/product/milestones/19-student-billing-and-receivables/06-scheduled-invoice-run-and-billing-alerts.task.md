# Task 06 — Backend: Scheduled invoice run and billing alerts (Phase 4)

**Status:** ✅ Done
**Milestone:** [19 — Student billing, contracts and receivables accounting](./milestone.md)
**RFC:** [RFC 0013](../../RFCs/0013-student-billing-contracts-and-receivables-accounting.md)
**Team:** Backend API
**Depends On:** [Task 05](./05-standing-roster-holds-and-me-billing.task.md)

## Summary

Turns the platform's first periodic job on, and makes it the thing that notices a late
payment. `wrangler.jsonc` gains a daily `triggers.crons` entry and the `scheduled`
handler currently commented out at `apps/api/src/index.ts:41` is enabled. Each run does
four things: it issues an invoice for every `active` contract whose next period has
started and has no row yet — a `paused` contract is skipped here and nowhere else, and
`UNIQUE (subscription_id, period_start)` absorbs a double firing so the job is safe to
retry; it sends the student's due-date reminder and grace-lapsed notice through the
existing `IMailer` port, skipping anyone under a hold; it emails admins a digest of the
students who *crossed* into `due` or `delinquent` since the previous run, derived by
comparing today's resolved standing against each open invoice's dates rather than from a
`last_alerted` column, so a second run the same day reports nobody and the mail stays
news; and it asserts each open invoice's cached `status` against its recomputed balance,
logging any divergence without repairing it. `POST /v1/admin/billing/invoices/run` is the
same work behind an admin route, so a missed firing is recoverable by hand and the whole
job is testable without a cron. The job writes no money on its own: no adjustment row of
any kind, `surcharge` included.

## Dependencies

- [Task 05](./05-standing-roster-holds-and-me-billing.task.md) — hard code dependency.
  The reminder and digest suppression reads the holds that task lands, and the crossing
  computation reuses its standing resolution.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/wrangler.jsonc` — a `triggers.crons` block only.
  - `apps/api/src/index.ts` — enabling the existing commented-out `scheduled` handler
    and delegating to the billing job. No other change to the entrypoint.
  - `apps/api/src/core/billing/billing-service.ts` — the issue-run, reminder, digest and
    balance-assertion routines.
  - `apps/api/src/controllers/admin-billing.controller.ts` and
    `apps/api/src/routes/admin/billing.ts` — the `POST /invoices/run` twin only.
  - `apps/api/test/**` — job idempotency, mail and crossing specs.
- **The job never writes money on its own.** No `invoice_adjustments` row of any kind is
  written by any scheduled path, `surcharge` included — nothing accrues interest, a
  percentage, a cap or a daily incidence (RFC #8). It issues invoices; it does not price
  them beyond the contract's own snapshot.
- **Idempotent by construction.** Issuance relies on `UNIQUE (subscription_id, period_start)`
  rather than on the job having run exactly once; a retry is a no-op, not a duplicate.
- **Crossings, not a standing list.** The digest names only students who moved into `due`
  or `delinquent` since the previous run, derived from dates. No `last_alerted` column is
  added — there is nothing to keep in sync and nothing to backfill.
- **A hold suppresses mail, never a total.** A held student receives no reminder and
  appears in no digest; their balance is untouched everywhere it is reported.
- **Assert, do not repair.** The balance-vs-status check logs divergence. It does not
  rewrite a status, issue a correcting row, or alter any ledger row — a silent repair
  would hide the bug that caused the drift.
- **Mail through the existing port.** `IMailer` with its existing `ResendMailAdapter` /
  `ConsoleMailAdapter`; no new mail dependency and no provider SDK outside
  `apps/api/src/adapters/`.
- **Two student emails, no sequence.** One at the due date and one when grace lapses.
  This is not a dunning campaign and gains no configuration (RFC Non-Goal).
- **Still no gating.** The job reports and mails; it suspends nothing, and
  `apps/api/src/middleware/**` and `apps/api/src/routes/index.ts` stay unchanged.
- **The manual twin is the same code.** `POST /invoices/run` calls the identical routine
  the cron calls, behind the billing router's own `requireRole(ROLES.ADMIN)`.

## Scope

In:
- The `triggers.crons` entry and the enabled `scheduled` handler.
- The issue run: every `active` contract whose period has started and lacks a row, with
  `paused` and `cancelled` skipped and end-dated contracts issuing nothing past their end.
- Zero-value invoices for free contracts: issued like any other, settling immediately
  with no payment row and sending no mail.
- The student's due-date reminder and grace-lapsed notice, both hold-suppressed and both
  fired once per invoice.
- The admin digest of standing crossings since the previous run.
- The balance-vs-cached-status assertion and its structured divergence log.
- `POST /v1/admin/billing/invoices/run`.
- Tests: double-run idempotency, the free-contract path, hold suppression, once-per-invoice
  mail, a same-day second run reporting nobody, and an assertion that no adjustment row
  exists after a run.

Out:
- Any automatic fee, interest or accrual — explicitly excluded.
- A configurable reminder sequence — explicitly excluded.
- Repairing a drifted status — logged only.
- Any frontend surface — Tasks 07–08.
- Access gating in any form.

## Acceptance Criteria

- [x] Running the job twice for one period issues each invoice exactly once; the second
      run reports the duplicates as absorbed rather than failing.
- [x] A `paused` contract is issued nothing, while its already-open invoices keep their
      due dates and still appear in the roster, the totals and the aging report.
- [x] A free contract's period invoice is issued, lands `paid` with no payment row, and
      sends no mail.
- [x] No `invoice_adjustments` row of any kind exists after a run — asserted by a test
      that counts the table before and after, `surcharge` included.
- [x] The student's due-date reminder and grace-lapsed notice each fire exactly once per
      invoice across repeated runs.
- [x] A held student receives neither mail and appears in no digest, while their
      outstanding balance is unchanged in every report.
- [x] The admin digest names only students who crossed a boundary since the previous run;
      a second run the same day reports nobody.
- [x] An invoice whose cached `status` disagrees with its recomputed balance produces a
      structured divergence log and **no** write — the row is byte-identical after the
      run.
- [x] `POST /v1/admin/billing/invoices/run` performs the identical work and is refused
      with `403` for a `content_creator`, a `tutor` and a student.
- [x] `apps/api/src/index.ts` gains only the `scheduled` delegation; `middleware/**` and
      `routes/index.ts` are unchanged and the pre-existing suite passes.
- [x] Changed files lint clean; `make test-api` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` with the seeded paid and free contracts, then call
   `POST /v1/admin/billing/invoices/run` twice and confirm the invoice count is identical
   after the second call.
2. Inspect the local mail output (`ConsoleMailAdapter`) across those two runs and confirm
   each reminder appears once and the free contract produced none.
3. Set a hold on the delinquent student, re-run, and confirm no mail and no digest entry
   while the aging total is unchanged.
4. Hand-edit one open invoice's cached `status` in the local replica, re-run, and confirm
   a divergence log and an unchanged row.
5. `make dev-api` and confirm the Worker starts with the cron trigger registered.
6. `make test-api` — job specs and the pre-existing suite green.
7. `make lint`.
8. `git diff --stat` confirms only the guardrail files changed.
