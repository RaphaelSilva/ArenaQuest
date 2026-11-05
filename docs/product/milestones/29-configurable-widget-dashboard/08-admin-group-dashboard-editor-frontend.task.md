# Task 08 — Frontend: Admin group dashboard editor, locks and restore (Phase 2)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Frontend Web
**Depends On:** [Task 05](./05-settings-dashboard-editor-frontend.task.md), [Task 07](./07-group-defaults-and-locks.task.md)

## Summary

Brings group defaults and locks to the UI. On the admin group detail page
(`/admin/groups/[groupId]`) a **Dashboard** section reuses Task 05's editor at **group scope**, plus
a numeric **priority** field and a **lock** toggle per instance; it saves with `PUT`, removes the
default with `DELETE` (with confirmation), and is **read-only for `content_creator`** (controls
disabled, no save). Below it, a read-only preview of the **label default** from
`GET /v1/admin/dashboard/label-default`, marked as coming from the deploy. On the student side
(Settings → Dashboard): locked instances show a lock icon and no remove/hide control (move remains);
a `409 WIDGET_LOCKED` is shown as a readable message; when `newDefault` is `true`, a notice offers
**Restore default**. Task 13 adds the recommendations editor inside this section.

## Dependencies

- [Task 05](./05-settings-dashboard-editor-frontend.task.md) — the editor this task reuses and
  extends.
- [Task 07](./07-group-defaults-and-locks.task.md) — hard dependency: group routes, locks,
  `newDefault`. Also reads Task 06's label-default route.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/groups/[groupId]/page.tsx` — mount the section only; the
    members UI is untouched.
  - `apps/web/src/components/dashboard/settings/**` — scope prop, priority, lock toggle, read-only
    mode, lock icon, notice, and tests.
  - `apps/web/src/lib/admin-dashboard-layout-api.ts` (new), registration in
    `apps/web/src/lib/api-client.ts`, the regenerated `apps/web/src/lib/api-types.gen.ts`.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts`.
- **Role from the session.** Read-only mode follows the user's role; the API remains the authority
  (a forced write still gets `403`).
- **i18n.** Every string in both dictionaries; `check-i18n-coverage.js` green.

## Scope

In:
- Group Dashboard section, label-default preview, student lock icon / `409` message / new-default
  notice.
- Tests: admin edits priority + lock and saves the expected body; `content_creator` sees disabled
  controls and no save; delete confirms then calls `DELETE`; student cannot hide a locked widget but
  can move it; a mocked `409` shows the message; `newDefault: true` shows the notice and restore.

Out:
- Recommendations editor — Task 13. A dedicated defaults page (milestone §6, item 28) — not built.

## Acceptance Criteria

- [ ] Each case in Scope is covered by a passing test.
- [ ] The members list and actions on the group page behave as before.
- [ ] Manual check in the PR: an admin locks a widget on a group; a member sees the lock and cannot
      remove it; after the admin edits the default, the member sees the notice.
- [ ] Changed files lint clean; `make test-web` green; `check-i18n-coverage.js` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web`.
2. `make dev`; as admin and as content creator, open a demo group; as a member, open Settings.
3. `git diff --stat` confirms only scope-guardrail files changed.
