# Task 15 — Frontend: Record a topic visit on page mount (Phase 3)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Frontend Web
**Depends On:** [Task 10](./10-continue-widget.task.md)

## Summary

Absorbs backlog [`user-experience/10`](../../backlog/user-experience/10-topic-visit-on-page-mount.task.md)
into this milestone, delivered together with [Task 10](./10-continue-widget.task.md) so the continue
widget is reliable from its first release (owner decision, 2026-11-05). The catalog topic page
(`/catalog/{id}`) calls the existing `visit` client **once** when it has loaded a topic the student
can read, and again only when the route's topic id changes — never on re-renders. A failed call
stays silent and never blocks rendering. The media-interaction calls stay as they are (a repeat
visit inside a mission window is new evidence; the API is idempotent on `topic_progress`). With it,
text-only topics produce visits, so they stamp `last_visited_at` (Task 10), move to `in_progress`,
and can complete a `topic_visited` mission step. The mission editor's `topic_visited` hint says the
visit is recorded when the student opens the topic, and the *no media* warning is no longer shown
for a `topic_visited` step. Accepted consequence (decided in RFC 0022 Open Question 6): every
opened topic moves to `in_progress`, so catalog and dashboard progress reflect page opens.

## Dependencies

- [Task 10](./10-continue-widget.task.md) — release pairing, not a code dependency: the API route
  already exists; this task ships in the same release as Task 10 so "continue" sees text-only
  topics from day one.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — the mount-time `visit` call only.
  - `apps/web/src/app/(protected)/catalog/[id]/__tests__/**` (new).
  - `apps/web/src/components/missions/RequirementCard.tsx`,
    `apps/web/src/components/missions/__tests__/RequirementEditor.test.tsx` and
    `apps/web/src/app/(protected)/admin/missions/__tests__/mission-editor-page.test.tsx` (both
    assert today's `noMediaWarning`).
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — the `visitHint` value; drop
    `noMediaWarning` only if nothing else reads it; keys stay identical in both dictionaries.
  - `docs/product/backlog/user-experience/10-topic-visit-on-page-mount.task.md` — status line only,
    pointing at this task.
- **No API change.** Reuse `client.topics.visit` from `apps/web/src/lib/topics-api.ts`; the route,
  its gate and its mission hook stay as shipped.
- **Staff** opening a topic record a visit too, as they already do on media interaction; staff are
  never enrolled in `auto` missions, so no mission effect follows.
- **i18n.** `check-i18n-coverage.js` green.

## Scope

In:
- Mount-time visit on the catalog topic page; the mission editor hint and warning change; the
  backlog item's status marked as moved to M29 Task 15.
- Tests: the page calls `visit` exactly once on mount for a topic without media; it does not call it
  again on re-render; it calls it again when the topic id changes; it does not call it when the
  topic answers `404`; the editor shows the new hint and no warning.

Out:
- Any API change. A `topic_completed` mission kind. The completion button — Task 16. Debouncing
  visits across tabs or sessions.

## Acceptance Criteria

- [ ] Opening `/catalog/{id}` of a published text-only topic as a seeded student sends exactly one
      `POST /v1/me/topics/{id}/visit` (asserted on the mocked client), and that topic becomes the
      continue widget's topic (manual check with Task 10 on `make dev`).
- [ ] A topic that answers `404` sends no visit.
- [ ] The editor's `topic_visited` card shows the new hint in both languages and no *no media*
      warning.
- [ ] Changed files lint clean; `make test-web` and `make lint` green; `check-i18n-coverage.js` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web` — the new page spec and the updated editor specs pass.
2. `make dev`; as a seeded student open a text-only topic, confirm one `visit` request in the
   network panel, then open `/dashboard` and check the continue widget; open an unknown id and
   confirm no request.
3. `git diff --stat` confirms only scope-guardrail files changed.
