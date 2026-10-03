# Task 10 — Frontend: Admin participants tab and Reconcile now (Phase 5)

**Status:** 📝 Open
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Frontend Web
**Depends On:** [Task 08](./08-reconciliation-job.task.md), [Task 09](./09-admin-mission-editor-frontend.task.md)

## Summary

Gives staff the follow-up view. The mission editor page `(protected)/admin/missions/[id]` gains a
**Participants** tab backed by `GET /v1/admin/missions/{id}/participants` (cursor pages): one row
per enrolled student with name, enrollment source (*Automatic*, *Joined*, *Assigned*), join date,
whether they left, and a row of **step chips** — *locked*, *open* with `current/required`, or
*completed* with its date and whether a hook or the daily reconciliation closed it — plus the
mission's completion date when complete. An empty state explains that automatic missions enroll
students as they act or at the next daily run. **Reconcile now** (admin only) calls
`POST /v1/admin/missions/{id}/reconcile`, shows the returned counts (enrollments, steps closed,
missions closed) and refreshes the list. A **content creator** sees the tab and the rows — the
instructor animates the mission in class — but not the *Reconcile now* button.

## Dependencies

- [Task 08](./08-reconciliation-job.task.md) — hard code dependency: the reconcile route and
  `completed_by` values.
- [Task 09](./09-admin-mission-editor-frontend.task.md) — hard code dependency: the editor page
  this tab lives in.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/missions/[id]/page.tsx` — the tab switch only.
  - `apps/web/src/components/missions/**` — participants table and step chips.
  - `apps/web/src/lib/admin-gamification-api.ts` — participants and reconcile calls;
    `apps/web/src/lib/api-types.gen.ts` regenerated.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — keys under `admin.missions`.
  - Component tests beside the new components.
- **Admin-only action** gated by `useHasRole(ROLES.ADMIN)`; the server refuses it for others anyway.
- **Cursor pagination** with a *Load more* control; no client-side recomputation of progress.
- **No hardcoded strings**; `check-i18n-coverage.js` passes.
- **Consumes the API contract as is**: no API source file changes in this task.

## Scope

In:
- Participants tab, step chips, paging, empty state, *Reconcile now* with its result and refresh,
  dictionaries.
- Component tests: chip rendering per state including *reconcile*; paging; button hidden for a
  content creator; counts shown after a mocked reconcile.

Out:
- The editor itself — Task 09. Student surfaces — Tasks 11 and 12.

## Acceptance Criteria

- [ ] With a mocked participants page, each step renders as locked, open with `current/required`,
      or completed with its date and a *hook* or *reconcile* marker.
- [ ] *Load more* fetches the next cursor page and appends rows.
- [ ] An admin clicking *Reconcile now* sees the returned counts and a refreshed list; a content
      creator sees the tab without the button.
- [ ] `check-i18n-coverage.js` passes; `pt` and `en` builds both render the tab.
- [ ] Changed files lint clean; `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev`; as admin, open a mission with seeded participants and read the tab.
2. Complete a step as a student in another browser, click *Reconcile now* and see it update.
3. Log in as the content creator and confirm the tab is readable and the button absent.
4. `make test-web`; `make lint`.
5. `git diff --stat` confirms only guardrail files changed and nothing under `apps/api/src/`.
