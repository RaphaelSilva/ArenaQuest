# Task 05 — Backend: Record scheduled and manual job runs (Phase 1)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0023](../../RFCs/0023-ai-admin-assistant.md)
**Team:** Backend API

## Summary

Makes every scheduled and manual job leave a factual record. A new `job_runs` table (one
additive migration, next free number — `0031` is claimed by M27) holds one row per execution:
job (`billing` · `sweep_submissions`), trigger (`cron` · `manual`), start and finish times, status
(`running` · `ok` · `failed`), a JSON summary of counts, and a truncated error message. A new
`IJobRunRepository` port with a D1 adapter owns it. `scheduled()` records each job around its
existing call — `running` before, `ok` with counts or `failed` with the error after — inside the
existing `try/finally`, so a billing failure is recorded **and** the sweep still runs.
`runScheduledBilling` returns its counts instead of only logging them, and
`POST /v1/admin/billing/invoices/run` records `trigger = 'manual'`. Writing a `job_runs` row can
never fail the job it describes. The daily run prunes rows older than 180 days. Task 06 exposes
these rows; Task 13's runbook queries them.

## Dependencies

- None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/00NN_create_job_runs.sql` — table + `(job, started_at DESC)` index;
    additive, no backfill, rollback is dropping the table.
  - `packages/shared/ports/i-job-run-repository.ts` and its re-export in `ports/index.ts`;
    the entity type in `packages/shared/types/entities.ts`.
  - `apps/api/src/adapters/db/d1-job-run-repository.ts` and `apps/api/src/container.ts` (wiring).
  - `apps/api/src/index.ts` — recording in `scheduled()`.
  - `apps/api/src/core/billing/billing-service.ts` — `runScheduledBilling` returns its counts;
    no billing rule changes.
  - `apps/api/src/jobs/sweep-pending-submissions.ts` — return its counts; behaviour unchanged.
  - `apps/api/src/routes/admin/billing.ts` / its controller — record the manual trigger.
  - `apps/api/test/**`.
- **Ports & Adapters.** `index.ts` and the controller see only the port; D1 lives in the adapter.
- **Failure isolation.** A throwing repository is caught and logged; the job outcome and the
  sweep-after-billing order are unchanged (asserted).
- **No payloads.** The error column holds a message truncated to 1 KiB — no request body, no
  personal data, no secret.
- **Adapters per invocation.** The container stays built inside `scheduled()`.

## Scope

In:
- Migration, port, entity, adapter, wiring, recording in both callers, pruning, tests.

Out:
- HTTP read surface — Task 06.
- Recording any other job (none exist today).
- Frontend.

## Acceptance Criteria

- [ ] A Workers test driving `scheduled()` with a passing billing writes two `ok` rows (billing,
      sweep) with counts; a day with nothing to bill writes an `ok` billing row with zero counts.
- [ ] With billing forced to throw, the billing row is `failed` with a truncated message, the sweep
      row is `ok`, and the sweep ran.
- [ ] With the job-run repository forced to throw, billing and sweep still run and their effects
      are unchanged.
- [ ] `POST /v1/admin/billing/invoices/run` writes one billing row with `trigger = 'manual'`.
- [ ] Rows older than 180 days are pruned by the daily run; newer rows are kept.
- [ ] No D1 import outside `apps/api/src/adapters/`; `make lint` and `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-migrate-local` on a fresh replica; inspect the table and index.
2. `make test-api` — the new specs and the existing billing/sweep specs.
3. `make dev-api`, trigger the scheduled handler locally, and `SELECT * FROM job_runs`.
4. `git diff --stat` confirms only scope-guardrail files changed.
