# Task 12 — Frontend: Roadmap configuration and continue widget (Phase 3)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Frontend Web
**Depends On:** [Task 05](./05-settings-dashboard-editor-frontend.task.md), [Task 09](./09-roadmap-start-topic.task.md), [Task 10](./10-continue-widget.task.md)

## Summary

Brings the configurable roadmap and the continue widget to the web. In Settings → Dashboard (and the
group editor, which reuses the same component), a roadmap instance's **configure** action opens a
topic picker — `SingleTopicPicker` from the missions editor, reused without change — to choose the
start topic or reset to roots; **Add widget** can add more roadmap instances. On the dashboard the
`Roadmap` component shows the server's stages and percentages, a heading naming the start topic when
one is set, and the **unavailable** state ("this content is not available" + a link to Settings)
when the data says so. A new `ContinueWidget` shows the last visited topic with its status and a
link to `/catalog/{id}`, or an empty state pointing to the catalog.

## Dependencies

- [Task 05](./05-settings-dashboard-editor-frontend.task.md) — the editor's configure affordance.
- [Task 09](./09-roadmap-start-topic.task.md) — hard dependency: start-topic data and unavailable
  state.
- [Task 10](./10-continue-widget.task.md) — hard dependency: continue data.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/dashboard/**` — `Roadmap.tsx`, new `ContinueWidget.tsx`, the widget
    map, the roadmap config form under `settings/`, and their tests.
  - `apps/web/src/lib/api-types.gen.ts` (regenerated).
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts`.
  - `apps/web/src/components/missions/SingleTopicPicker.tsx` — **import only, no edit**.
- **No title leaks client-side.** The unavailable state renders no topic name (there is none in the
  data); the picker lists only topics the admin/student endpoint already returns.
- **i18n.** Every string in both dictionaries; `check-i18n-coverage.js` green.

## Scope

In:
- Roadmap config form, start-topic heading, unavailable state; continue widget; i18n.
- Tests: picking a topic saves `startTopicId`; reset saves `null`; two roadmaps render
  independently; the unavailable state renders the message and the Settings link; continue renders
  the topic link, and the empty state without data.

Out:
- Recommendations — Task 13. Visit on page mount — backlog `user-experience/10`.

## Acceptance Criteria

- [ ] Each case in Scope is covered by a passing test.
- [ ] Manual check in the PR: a roadmap rooted at a deep topic, then the same widget after the topic
      is archived.
- [ ] Changed files lint clean; `make test-web` green; `check-i18n-coverage.js` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web`.
2. `make dev`; as a demo student, configure two roadmaps and visit a topic; check the dashboard.
3. `git diff --stat` confirms only scope-guardrail files changed.
