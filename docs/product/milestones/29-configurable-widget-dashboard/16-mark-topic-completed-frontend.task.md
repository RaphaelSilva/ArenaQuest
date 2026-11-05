# Task 16 — Frontend: Mark a topic as completed (Phase 3)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Frontend Web


## Summary

Gives the student a way to **complete a topic**. Today nothing in the web calls the existing
`POST /v1/me/topics/{id}/complete`; a topic becomes `completed` only through a task-stage check-in
(`progress-service.ts`). Without this, the M29 roadmap — whose percentages count completed leaves —
stays at 0% for every tenant that does not use tasks (owner decision, 2026-11-05). The catalog topic
page shows a **Mark as completed** button on **leaf topics only** (no subtopics), for a student who
can read the topic and whose status is not yet `completed`. Clicking it calls the existing
`client.topics.complete(id)`; on success the page shows the completed state in place of the button
and the progress shown on the page updates; on failure an inline, translated error appears and the
button is enabled again. There is **no undo** — completion is monotonic in the API. The route keeps
its current effects, unchanged: on the **first** completion of a topic it awards `topic_complete`
XP (100, from `xp-config.ts`), records streak activity and evaluates quests; a repeat click awards
nothing. Parent topics keep showing their subtopic progress as today.

## Dependencies

- None — independent. The route and client method already exist. Ordering preference: before
  [Task 12](./12-roadmap-and-continue-frontend.task.md), so the roadmap's percentages move in its
  manual check.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — mount the button and refresh the page's
    progress after success.
  - `apps/web/src/components/catalog/CompleteTopicButton.tsx` (new) and its test.
  - `apps/web/src/app/(protected)/catalog/[id]/__tests__/**`.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts`.
- **No API change.** `POST /v1/me/topics/{id}/complete`, its access gate, its XP, streak and quest
  effects stay exactly as shipped; `apps/web/src/lib/topics-api.ts` is reused, not edited.
- **Leaf only.** The button is not rendered on a topic with children; the decision uses the topic
  data the page already loads.
- **Shared file with Task 15.** Both edit the catalog page; whichever lands second rebases.
- **i18n and accessibility.** Every string in both dictionaries; the button has an accessible name
  and a disabled, labelled pending state; `check-i18n-coverage.js` green.

## Scope

In:
- The button component, its states (idle, pending, completed, error), the page mount and the local
  progress refresh; i18n keys.
- Tests: rendered on a leaf topic not yet completed; not rendered on a topic with children; not
  rendered when the status is already `completed`; a click calls `complete` once and shows the
  completed state; a second click is impossible (button gone); a failed call shows the error and
  re-enables the button.

Out:
- Undo / "mark as not completed". Completion of parent topics. A `topic_completed` mission kind.
  Any XP or quest change.

## Acceptance Criteria

- [ ] Each case in Scope is covered by a passing test.
- [ ] Manual check in the PR: as a seeded student, completing a leaf topic grants XP once (dashboard
      level card) and, after Task 09/12, raises the parent stage's roadmap percentage.
- [ ] `git diff` shows no change under `apps/api/` or in `topics-api.ts`.
- [ ] Changed files lint clean; `make test-web` green; `check-i18n-coverage.js` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web`.
2. `make dev`; as a seeded student open a leaf topic, complete it, reload, and check the dashboard
   XP and the roadmap; open a parent topic and confirm no button.
3. `git diff --stat` confirms only scope-guardrail files changed.
