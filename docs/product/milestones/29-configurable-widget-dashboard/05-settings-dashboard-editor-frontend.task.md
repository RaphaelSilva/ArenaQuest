# Task 05 — Frontend: Settings dashboard editor (Phase 1)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Frontend Web
**Depends On:** [Task 02](./02-layout-storage-and-student-routes.task.md), [Task 04](./04-widget-host-frontend.task.md)

## Summary

Adds a **Dashboard** section to `/settings` where the student edits their own layout through
Task 02's routes. It lists the effective layout's instances in order with, for each, **show/hide**,
**move up / move down** and, where the type has a config, **configure** (the roadmap's start topic
arrives in Task 12; here the configure affordance is wired generically). An **Add widget** control
offers the addable types returned by `GET /v1/me/dashboard/layout`. **Save** sends the whole
document with `PUT`; **Restore default** calls `DELETE` after a confirmation. The section shows where
the current layout comes from (default vs personalised), a `400` as a readable validation message,
and disables Save while a request is in flight. The existing password form and the billing link on
the page are untouched. Task 08 adds lock icons and the "new default" notice.

## Dependencies

- [Task 02](./02-layout-storage-and-student-routes.task.md) — hard dependency: the layout routes.
- [Task 04](./04-widget-host-frontend.task.md) — the widget names/icons the list reuses.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/settings/page.tsx` — mount the new section only.
  - `apps/web/src/components/dashboard/settings/**` (new) — the editor and its tests.
  - `apps/web/src/lib/dashboard-layout-api.ts` (new), registration in
    `apps/web/src/lib/api-client.ts`, the regenerated `apps/web/src/lib/api-types.gen.ts`.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts`.
- **Shared limits.** The 12-instance cap and the addable types come from the API / shared module;
  the web does not hard-code them.
- **Accessible controls.** Move up/down are buttons with labels, reachable by keyboard; no drag and
  drop (D2).
- **i18n.** Every string in both dictionaries; `check-i18n-coverage.js` green.

## Scope

In:
- The Dashboard section, API client, i18n keys.
- Tests: hide + move + save sends the expected document; add offers only addable types; restore
  asks for confirmation then calls `DELETE` and re-renders the default; a `400` shows the message
  and keeps the edit; Save disabled while pending.

Out:
- Locks and the new-default notice — Task 08. Roadmap topic picker — Task 12.

## Acceptance Criteria

- [ ] A student hides the ranking and moves the roadmap first, saves, reloads `/dashboard`, and sees
      that layout (manual check recorded in the PR).
- [ ] Each case in Scope is covered by a passing test.
- [ ] The password form and the billing link behave as before.
- [ ] Changed files lint clean; `make test-web` green; `check-i18n-coverage.js` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web` — editor specs pass.
2. `make dev`; as a demo student, edit, save, reload, restore.
3. `git diff --stat` confirms only scope-guardrail files changed.
