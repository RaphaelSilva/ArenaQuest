# Task 09 — Backend: Reconcile run, cron dispatch and exceptions routes (Phase 3)

**Status:** ✅ Done
**Milestone:** [30 — Payment Gateway](./milestone.md)
**RFC:** [RFC 0026](../../RFCs/0026-payment-gateway-hosted-checkout-collection-for-invoices-and-.md)
**Team:** Backend API
**Depends On:** [Task 06](./06-webhook-route-and-payment-landing.task.md)

## Summary

The recovery path of RFC §6: **`reconcile-payments`**, an hourly, capped run that asks the
provider about checkouts whose webhook may never have arrived, retries unsettled events, counts
stale exceptions and re-asserts the key mode — on its **own Cron Trigger**, dispatched in
`scheduled()` by `controller.cron` so it never rides the daily billing run. It ships with the
admin routes that expose the same machinery: **`POST /v1/admin/billing/payments/reconcile`**,
**`GET /v1/admin/billing/payments/exceptions`** and
**`POST /v1/admin/billing/payments/exceptions/dismiss`**. After this task a missed webhook costs
at most about an hour, and whatever could not be settled is a visible row.

## Dependencies

- [Task 06](./06-webhook-route-and-payment-landing.task.md) — hard code dependency: the landing
  and `handleEvent`, which the run reuses rather than re-implements.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/jobs/reconcile-payments.ts` (new).
  - `apps/api/src/index.ts` — the `scheduled()` dispatch on `controller.cron`.
  - `apps/api/wrangler.jsonc` — the second expression in the top-level `triggers.crons`.
  - `apps/api/src/core/payments/gateway-service.ts` — `confirmCheckout`, `dismissException`.
  - `apps/api/src/routes/admin/billing.ts`, `apps/api/src/controllers/admin-billing.controller.ts`.
  - `apps/api/src/openapi/components/**`, `apps/api/openapi.json`.
  - `apps/api/test/core/jobs/reconcile-payments.spec.ts` (new),
    `apps/api/test/db/job-runs-scheduled.spec.ts`,
    `apps/api/test/routes/admin-billing.router.spec.ts`.
- **Confirm the Cron Trigger allowance before the expression reaches `main`** (milestone §6,
  decision 18): a merge deploys every label and environment, and each Worker carries every
  expression. The task's PR states the account plan, the Cron Triggers in use and the cron CPU
  limit. If a second expression does not fit, the task implements the recorded fallback — one
  hourly expression, the three daily jobs gated on the 06:00 UTC hour — and says so; it never
  ships an expression the account cannot carry.
- **Dispatch.** `0 6 * * *` runs the daily jobs exactly as today; `17 * * * *` runs only this
  job; an unknown expression logs an error and runs nothing. The two expressions are named
  constants, and a test reads `wrangler.jsonc` to prove they match.
- **Caps are named constants, not configuration:** 25 checkouts and 10 events per run, 10 seconds
  per provider call, sequential — 35 provider calls at worst.
- **Off means silent.** With an empty registry the run returns before its first query and records
  no `job_runs` row. Otherwise it records one row (`reconcile_payments`), counts only.
- **Admin only**, with `403` for `content_creator` and `tutor`; `createRoute` + Zod;
  `ControllerResult<T>`. The exceptions list never calls a provider.

## Scope

**In:**
- Step 1 — confirm up to 25 checkouts: open past expiry, open and older than 30 minutes, and
  closed `expired`/`cancelled` not asked since they closed; past-expiry and closed first, then
  least recently asked. One provider search each: a paid payment lands and the checkout becomes
  `paid`; otherwise past expiry → `expired`, not yet expired stays `open`; the asked-at mark is
  set either way; the rest is counted `deferred`. Without a provider call: an open checkout with
  no session for over 30 minutes → `failed`; a checkout whose provider is no longer bound →
  expired and counted `unreachable`, which makes the run `failed`.
- Step 2 — retry up to 10 unsettled events through `handleEvent`, fewest attempts first.
- Step 3 — count `orphan` and `mismatch` rows older than 7 days and not dismissed.
- Step 4 — the key-mode assertion; a mismatch fails the run with `PAYMENTS_CONFIG_INVALID`.
- The manual route: the same job, same caps, trigger recorded as manual, the summary returned.
- The exceptions list: `orphan`, `mismatch`, `failed`, `received` older than an hour, and
  disputed checkouts — oldest first, each with a stable `ref`, its kind, provider and provider
  ids, attempts and, when a checkout is known, the receivable, the student and the amount.
- Dismissal (milestone §6, decision 20): body `{ ref, note }`, note 1–500 characters; stores who,
  when and the note; removes the row from the list and from step 3's count; changes no status or
  outcome and writes no ledger row; audit `payments.exception_dismissed`.
- Tests: a payment missed by the webhook lands while its checkout is still unexpired; 30 due
  checkouts → 25 asked, `deferred: 5`, and the next run takes the remaining 5 first; a late
  payment on a closed checkout lands; an unbound provider; the session-less case; an event that
  failed once ends `applied` with `attempts = 2`; `scheduled()` with each expression and with an
  unknown one; `none` writes no `job_runs` row; the role matrix; dismiss and its effect on the list.

**Out:**
- Raising a notification outside the app — an alert is a row on the exceptions list and a count
  in the run summary.
- The exceptions panel (Task 13); the runbook (Task 16).

## Acceptance Criteria

- [x] A checkout paid at the provider with no delivery received is `paid`, with its ledger row,
      after one run.
- [x] No run issues more than 35 provider calls (asserted on the stub's call log).
- [x] The daily jobs do not run on `17 * * * *`, and this job does not run on `0 6 * * *`.
- [x] `none` leaves `job_runs` untouched; a valid list records exactly one row per run.
- [x] A live key under key mode `test` makes the run `failed` with `PAYMENTS_CONFIG_INVALID`.
- [x] A dismissed exception is absent from the list and from the stale count, and its row keeps
      its original outcome.
- [x] The PR description records the Cron Trigger allowance check and its result.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `cd apps/api && pnpm test test/core/jobs/reconcile-payments.spec.ts test/db/job-runs-scheduled.spec.ts`.
2. `cd apps/api && pnpm dump-openapi` — commit the regenerated `openapi.json`.
3. `make test-api` — green.
4. `make dev-api`, then `curl "localhost:8787/__scheduled?cron=17+*+*+*+*"` — the run returns early under `none`.
5. `git diff --stat` confirms only scope-guardrail files changed.
