# Task 14 — Backend: Demo extensions: events, billing, tasks, comments (Phase 4)

**Status:** ✅ Done
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-seed-demo-cli-core.task.md), [Task 08](./08-demo-seed-ci-and-make.task.md)

## Summary

Extends the demo beyond the baseline to the four areas decided in RFC OQ2, using the same
dataset, deterministic ids, upserts and relative dates. **Events:** one published event per
audience — `public`, `members`, and `restricted` granted to *Demo class* through
`event_audience_group` — with one of them in the past and the others upcoming, dates in the
`YYYY-MM-DD HH:MM:SS` UTC form computed at run time, `flyer_status = 'none'` (no object
needed). **Billing:** a monthly plan and a free plan in the active BRL currency; student-1
and student-2 subscribed (snapshot terms, `contract_group_id` = own id, `signed_by` = demo
admin), one invoice paid (with a payment) and one open. **Tasks:** one published task with
three ordered stages, each linked to a Root 1 lesson, so the stage check-in path (20 XP) is
testable by student-3. **Comments:** one thread on a Root 1 lesson — a comment by student-1,
a reply by the tutor, and a like by student-2. The CI check of Task 08 is extended with the
row counts for these tables.

## Dependencies

- [Task 04](./04-seed-demo-cli-core.task.md) — hard: users, group, topics and the builder.
- [Task 08](./08-demo-seed-ci-and-make.task.md) — ordering: its CI check is extended here.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/demo/extensions.mjs` (new) — events, billing, tasks, comments statements.
  - `scripts/demo/sql.mjs`, `scripts/demo/seed-demo.mjs` — wiring.
  - `scripts/demo/dataset/base.json` — the four new sections.
  - `scripts/demo/dataset.mjs` — validation of the new sections.
  - `scripts/demo/ci-check.mjs` — extra assertions.
  - `scripts/demo/extensions.test.mjs` (new).
- **Schema as it is.** Column sets and constraints follow migrations `0008`–`0010`, `0022`,
  `0026`, `0027`; nothing in `apps/api` changes. Constraints that matter: one active
  subscription per user; `task_stages` unique `(task_id, sort_order)`; event `slug` unique.
- **Relative dates** for events, invoices and payments; the "past" event is past by the
  computed predicate `COALESCE(ends_at, starts_at + 1 day) < now`.
- **Stage check-ins and comments are not pre-seeded** as XP (the tester performs them), so
  the gamification state of Task 06 stays exactly as specified.

## Scope

In:
- The four dataset sections, their validation and their SQL.
- CI assertions for their row counts.
- Unit tests for relative dates, unique constraints and grants.

Out:
- Event flyers (no object upload for events).
- Any change to billing, event, task or comment behaviour.

## Acceptance Criteria

- [x] Anonymous, student-3 and student-1 see, respectively, only the public event; public +
      members; public + members + restricted — and exactly one of them is listed as past.
- [x] The billing backoffice shows the two plans and, for student-1 and student-2, one paid
      and one open invoice.
- [x] Student-3 checks in the first stage of the demo task and earns 20 XP. _(The check-in writes a 20 XP `stage` event; the same request also completes the linked lesson, so the existing badge engine adds `alicerce-solido` (+250) — student-3's total becomes 270.)_
- [x] The demo Root 1 lesson shows a comment by student-1, a reply by the tutor and one like.
- [x] A second seed run changes no row count; the extended CI check passes.
- [x] `make test-scripts`, `make lint`, `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Local reset + `make db-seed-demo-local LABEL=budo`; count rows in the eight tables.
2. `make dev`; check the events board anonymously and as student-1 / student-3; open the
   billing backoffice as admin; check in a stage as student-3; open the demo lesson's
   comments.
3. Re-run the seed; run `node scripts/demo/ci-check.mjs`.
4. `git diff --stat` confirms only scope-guardrail files changed.

## Implementation notes

- Rows per label: events 3 (+1 group audience), billing plans 2, subscriptions 2, invoices 2, payments 1, task 1 with
  3 stages and 4 topic links, comments 2 (+1 like).
- The **members** event is the past one; anonymous sees only the public event, student-3 public + members,
  student-1 all three. Out-of-audience details return 404.
- Billing: student-1 and student-2 on the monthly plan (R$150.00); student-1's previous-month invoice is paid (pix),
  student-2's current-month invoice is open. The free "Demo scholarship" plan is listed but unused. Contracts start on
  the 1st, matching the app's period computation.
- Write policy: contracts, invoices, payments, comments and likes are **insert-once** (a re-seed never rewrites
  history); event `flyer_status` and stage `sort_order` are set on insert only; events (incl. dates) are rewritten
  every run so "upcoming" stays upcoming.
- `ci-check.mjs` now covers 12 more tables in the no-drift assertion (~60 s for three labels).
