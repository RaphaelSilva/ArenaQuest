# Task 07 — Frontend: Task and progress journeys J7, J8

**Status:** 📝 Open
**Epic:** [End-to-end test phase — Playwright suite gating main](./2026-09-29-e2e-test-phase.epic.md)
**Team:** Frontend Web
**Depends On:** [Task 02](./02-fixtures-and-page-objects.task.md)

## Summary

Cover the task engine and the engagement loop, absorbing the two waiting backlog
items. **J7 — task authoring to student view** (was `test-debt/10-e2e-task-flow`): the
admin seeds published topics, creates a task with stages, links topics to the stages
and publishes it through the API; the student finds the task on `/tasks`, opens it,
sees its title, stages and topic chips, and a chip navigates to the right
`/catalog/:id`. **J8 — enrollment and progress** (was `test-debt/11-e2e-progress-flow`):
using the second student with no enrollments, the task is hidden before access is
granted; the admin grants access to the root topic; the dashboard shows 0 %; the
student checks in every stage in order; the dashboard shows the topic and task at
100 %; after the admin revokes access the task disappears again. When both pass, the
three `docs/product/backlog/test-debt/*e2e*` files are marked superseded by this epic.

## Dependencies

- [Task 02](./02-fixtures-and-page-objects.task.md) — hard dependency: API client
  (task, stage, link, enrollment operations) and role states.
- Existing behaviour: `/v1/admin/tasks/**` (stages, reorder, topic links),
  `/v1/admin/users/{userId}/enrollments/**`, `apps/web/src/app/(protected)/{tasks,dashboard,catalog}/**`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `e2e/specs/tasks/**` — J7; `e2e/specs/progress/**` — J8.
  - `e2e/fixtures/api-client.ts` — task, stage, topic-link, grant and revoke
    operations if not already present.
  - `e2e/pages/**` — tasks list/detail and dashboard page objects.
  - `docs/product/backlog/test-debt/10-e2e-task-flow.task.md`,
    `11-e2e-playwright-scaffold.task.md`, `11-e2e-progress-flow.task.md` — status
    line only, pointing at this epic.
- **Isolation.** J8 uses the dedicated no-enrollment student and its own `uniq()`
  topic tree, so granting and revoking never affects other specs.
- **Assert the user-visible numbers.** Progress is asserted as the percentage the
  dashboard shows, not by reading the API.
- **Budget.** J7 under 45 s and J8 under 60 s on a warm local run.

## Scope

In:
- J7 and J8, including the negative steps (hidden before grant, hidden after revoke).
- The API client operations and page objects they need.
- Superseding the three backlog task files.

Out:
- Gamification (XP, badges, quests) assertions — separate follow-up journeys.
- Group enrollments.

## Acceptance Criteria

- [ ] J7 passes and the topic chip lands on the matching `/catalog/:id`.
- [ ] J8 passes through 0 % → 100 % and both negative steps.
- [ ] J7 < 45 s and J8 < 60 s on a warm local run.
- [ ] The three `test-debt` e2e tasks carry a superseded status linking this epic.
- [ ] `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make e2e` filtered to `e2e/specs/{tasks,progress}` — green; note durations.
2. Run with `--repeat-each=2 --workers=2` — still green.
3. Break the stage check-in assertion — J8 fails with a useful trace; revert.
4. `make lint`.
5. `git diff --stat` confirms only scope-guardrail files changed.
