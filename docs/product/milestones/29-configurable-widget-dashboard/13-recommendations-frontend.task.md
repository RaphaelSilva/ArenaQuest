# Task 13 — Frontend: Recommendations editor and widget (Phase 3)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Frontend Web
**Depends On:** [Task 08](./08-admin-group-dashboard-editor-frontend.task.md), [Task 11](./11-recommendations-widget.task.md)

## Summary

Brings recommendations to the web. In the group Dashboard section (Task 08), an admin adds a
**Recommendations** widget and edits it: an optional title and up to 10 items, each a topic chosen
with `SingleTopicPicker` and a **reason** with a live character counter (1–280), reorderable with
move up/down and removable; a `400` from the API (archived or unknown topic) is shown on the
offending item. `content_creator` sees it read-only. On the dashboard a new `RecommendationsWidget`
lists the items the API returned — title, reason and a link to `/catalog/{id}` — in order, or nothing
when the list is empty. In Settings → Dashboard the student sees an inherited recommendations
instance as hide/move-only (no configure), and **Add widget** never offers it.

## Dependencies

- [Task 08](./08-admin-group-dashboard-editor-frontend.task.md) — the group editor this extends.
- [Task 11](./11-recommendations-widget.task.md) — hard dependency: validation and live data.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/dashboard/**` — new `RecommendationsWidget.tsx`, the widget map, the
    recommendations editor under `settings/`, and their tests.
  - `apps/web/src/lib/api-types.gen.ts` (regenerated).
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts`.
  - `apps/web/src/components/missions/SingleTopicPicker.tsx` — **import only, no edit**.
- **Limits from the shared module** (10 items, 280 characters); not hard-coded in the web.
- **Reason is plain text.** Rendered as text, never as HTML or Markdown; not translated (D20).
- **i18n.** Every UI string in both dictionaries; `check-i18n-coverage.js` green.

## Scope

In:
- Recommendations editor at group scope, read-only for `content_creator`; dashboard widget; student
  hide/move-only behaviour.
- Tests: adding an item and saving sends the expected body; the 11th item cannot be added; the
  counter blocks 281 characters; a mocked `400` marks the item; the widget renders items in order
  with links; an empty list renders nothing; the student editor offers no configure and Add never
  lists `recommendations`; a reason containing markup renders as literal text.

Out:
- Any API change. Per-language reasons — out of the milestone.

## Acceptance Criteria

- [ ] Each case in Scope is covered by a passing test.
- [ ] Manual check in the PR: an admin recommends an accessible and a restricted topic to a group; a
      member sees only the accessible one.
- [ ] Changed files lint clean; `make test-web` green; `check-i18n-coverage.js` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web`.
2. `make dev`; as admin, edit a demo group's recommendations; as a member, open the dashboard.
3. `git diff --stat` confirms only scope-guardrail files changed.
