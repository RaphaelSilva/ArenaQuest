# Task 04 — Frontend: Widget host and the eight current widgets (Phase 1)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-layout-driven-dashboard-aggregate.task.md)

## Summary

Switches the learner dashboard to the layout-driven response of Task 03. `client.dashboard.get()`
makes **one** call, `GET /v1/me/dashboard`, and the leaderboard, `/topics` and
`/me/progress/topics` calls disappear from `dashboard-api.ts`, together with the client-side
roadmap adapter. `DashboardContent` becomes a **widget host**: it walks `layout` in order and renders
each instance through a `widget type → component` map, passing it that instance's entry from
`widgets`. The eight existing components (`StatCardLevel`, `StatCardStreak`, `StatCardRanking`,
`DailyTasks`, `MissionsList`, `WeeklyChallenges`, `BadgesGrid`, `Roadmap`) are reused as the
widgets, with **no visual change** for the default layout: stat-type widgets keep their card row,
the others flow in two columns on `lg` and one column on mobile, in the same order. An instance
whose data is `null` renders the component's existing empty state (or nothing, where it renders
nothing today); an instance of a type the web does not know is skipped. The greeting row, the error
banner and the skeleton stay as they are. Task 05 adds the editor; Tasks 12–13 add the new widget
components.

## Dependencies

- [Task 03](./03-layout-driven-dashboard-aggregate.task.md) — hard dependency: the new response
  contract. Ships in the same release as Task 03.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/dashboard/**` — `DashboardContent.tsx`, a new widget map/host file,
    prop adjustments in the eight components (props only, no restyling), their tests.
  - `apps/web/src/lib/dashboard-api.ts` and the regenerated `apps/web/src/lib/api-types.gen.ts`.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — only if a new string is needed.
- **Generated types.** Widget data types come from `api-types.gen.ts`; the hand-written raw API
  types in `dashboard-api.ts` are removed.
- **No backend change**; no change to `components/missions/**`.
- **i18n.** No hard-coded user-facing string; `check-i18n-coverage.js` green. The greeting date's
  `'en-US'` is a backlog item and stays out of this task.

## Scope

In:
- Single-call dashboard client; widget host and type map; reuse of the eight components.
- Tests (Vitest + RTL): the default layout renders the eight widgets in order; a layout without
  `ranking` renders no ranking card; a `null` widget renders its empty state; an unknown type is
  skipped; exactly one `GET /me/dashboard` is issued (no leaderboard / topics / progress call).

Out:
- Settings editor — Task 05. New widgets — Tasks 12 and 13. The `'en-US'` date and the ranking
  names — backlog.

## Acceptance Criteria

- [ ] With the code default, `/dashboard` looks as it does today (side-by-side screenshot in the PR
      at desktop and mobile widths).
- [ ] Each case in Scope is covered by a passing test.
- [ ] `dashboard-api.ts` issues one request and contains no client-side roadmap computation.
- [ ] Changed files lint clean; `make test-web` green; `check-i18n-coverage.js` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web` — host and client specs pass.
2. `make dev` with the demo seed; open `/dashboard` as a demo student; compare with `main` at
   desktop and mobile widths; check the network tab shows one dashboard call.
3. `git diff --stat` confirms only scope-guardrail files changed.
