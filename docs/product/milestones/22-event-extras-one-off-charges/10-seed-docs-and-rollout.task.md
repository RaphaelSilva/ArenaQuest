# Task 10 — Backend: Seed, docs and rollout closeout (Phase 5)

**Status:** 📝 Open
**Milestone:** [22 — Event extras: one-off charges on a separate billing rail](./milestone.md)
**RFC:** [RFC 0015](../../RFCs/0015-event-extras-one-off-charges-for-events.md)
**Team:** Backend API
**Depends On:** [Task 07](./07-admin-extras-tab.task.md), [Task 08](./08-two-rail-roster-reports-and-statement.task.md), [Task 09](./09-student-extras-plans-link-and-event-panel.task.md)

## Summary

Takes the milestone from "merged" to "in use" (RFC 0015 Phase 5). It confirms the migration
number against `main` (renumbering if RFC 0016's migration landed first), walks the `budo`
seminar case end to end on staging — price a published event, charge a group of students
including one extras-only buyer and one outside a restricted audience, record and reverse a
payment, let the run send an extras reminder, and read both rails on the roster, the reports
and the student's own page — and records the result. It then updates the product docs:
`docs/product/FEATURES.md` gains the extras capability and the two-rail rule, RFC 0015 and its
README row move to `Implemented`, and the milestone gets its `closeout-analysis.md`. The
production migration is applied for every label through the existing deploy CLI; the tables
are empty and inert for tenants that do not use extras. No new code path is introduced here.

## Dependencies

- [Task 07](./07-admin-extras-tab.task.md), [Task 08](./08-two-rail-roster-reports-and-statement.task.md),
  [Task 09](./09-student-extras-plans-link-and-event-panel.task.md) — the whole feature must be
  merged into the candidate before the walkthrough; transitively every backend task.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/0028_create_event_charges.sql` — **rename only**, if the number
    collides on `main`.
  - `apps/api/migrations/seed/` — adjustments to the local seed file introduced in Task 02,
    if the walkthrough exposes a missing scenario.
  - `docs/product/FEATURES.md`.
  - `docs/product/RFCs/0015-event-extras-one-off-charges-for-events.md` — `Status:` header only.
  - `docs/product/RFCs/README.md` — the 0015 row only.
  - `docs/product/milestones/22-event-extras-one-off-charges/{milestone.md,closeout-analysis.md}`
    and the task files' `Status:` lines.
- **Environments by name.** Staging via `make db-migrate-staging` / `make deploy-staging`;
  production only through the confirming `-prod` targets — never an implicit production.
- **No dev seed in a deployed environment** — the no-dev-seed guard must pass on every deploy.

## Scope

In:
- Migration-number check and rename if needed.
- Staging walkthrough of the `budo` seminar case, recorded in the closeout note.
- `FEATURES.md`, RFC status, README row, milestone status and closeout.
- Production migration for every label via the deploy CLI, after staging is confirmed.

Out:
- Any functional change — a defect found during the walkthrough is filed against the task
  that owns it, not fixed here.

## Acceptance Criteria

- [ ] The extras migration number is unique on `main` and applies after every earlier migration.
- [ ] The staging walkthrough is recorded step by step in `closeout-analysis.md`, including
      the two rail-isolation scenarios observed on the roster.
- [ ] `FEATURES.md` describes extras and states that they never affect contract standing or access.
- [ ] RFC 0015's header and README row read `Implemented`; the milestone status reads Done.
- [ ] The production migration applied for every label without error.
- [ ] `make lint`, `make test-api` and `make test-web` pass green on the candidate.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `git ls-tree origin/main apps/api/migrations/` — confirm the number is free; rename if not.
2. `make db-migrate-staging` and `make deploy-staging`; perform and record the walkthrough.
3. `make test-api` and `make test-web` on the candidate.
4. Apply the production migration through the confirming deploy path for each label.
5. `git diff --stat` confirms only scope-guardrail files changed.
