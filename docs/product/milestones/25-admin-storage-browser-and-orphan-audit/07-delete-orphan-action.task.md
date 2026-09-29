# Task 07 — Frontend: Delete orphan action in the browser (Phase 2)

**Status:** ✅ Done
**Milestone:** [25 — Admin storage browser and orphan audit](./milestone.md)
**RFC:** [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md)
**Team:** Frontend Web
**Depends On:** [Task 04](./04-admin-storage-browser-page.task.md), [Task 06](./06-guarded-orphan-delete-api.task.md)

## Summary

Lets an admin remove a true orphan from the Storage page. The detail drawer (Task 04) and each
orphan / `deleted-row` result in the scan panel (Task 05) gain a *Delete* action, shown only for
those two statuses and disabled — with the reason — while the object is younger than 24 h. The
action opens a confirmation dialog that repeats the key, size and status and requires an
explicit confirm; it then calls `DELETE /v1/admin/storage/object`. On success the row
disappears from the folder listing and from the scan results, and the reclaimable totals update.
On `409` the dialog shows the classification the server returned ("this file is now linked to
topic *X*", "uploaded less than 24 h ago") and the row is refreshed with it, so the UI never
contradicts the server. No other status offers any destructive action. It consumes Task 06's
route and extends Task 04's drawer and Task 05's panel.

## Dependencies

- [Task 04](./04-admin-storage-browser-page.task.md) — the drawer and page this extends.
- [Task 06](./06-guarded-orphan-delete-api.task.md) — the `DELETE /object` contract; this task
  must not ship ahead of it.
- Extends Task 05's scan panel when it has landed; if Task 07 lands first, the panel wiring is
  added by whichever of the two merges second.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/admin/storage/**` — the delete action, confirmation dialog, row
    removal/refresh, and `__tests__`.
  - `apps/web/src/app/(protected)/admin/storage/**` — only if page-level state must react to a
    deletion.
  - `apps/web/src/lib/admin-storage-api.ts` — the `deleteObject` call.
  - `apps/web/src/lib/api-types.gen.ts` — regenerated with `pnpm gen:api-types`.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` — new keys under `adminStorage`.
- **The server decides.** The client-side "eligible" check only hides or disables the button;
  the `409` answer is always handled and shown.
- **Explicit confirmation.** No one-click delete; the dialog names the key and size; focus lands
  on *Cancel* by default.
- **i18n.** Action, dialog, refusal reasons and success message all come from `adminStorage`;
  identical keys in both dictionaries; `check-i18n-coverage.js` passes.
- **Accessible.** The dialog is modal, traps focus, closes on Escape, and announces the outcome.

## Scope

In:
- `deleteObject` client call.
- The *Delete* action in the drawer and on eligible scan results, with the 24 h disable and its
  reason.
- The confirmation dialog, success removal and total update, and `409` refresh + message.
- Dictionary keys in both languages.
- Component tests: button visibility per status and age, confirm issues the DELETE with the key,
  cancel issues nothing, `409` shows the server's classification and updates the row, success
  removes the row and lowers the totals.

Out:
- Bulk delete, deleting `pending` uploads, any DB-side cleanup — fenced out by the milestone.
- Any backend change.

## Acceptance Criteria

- [x] The *Delete* action appears only for `orphan` and `deleted-row` objects, and is disabled
      with a visible reason for those uploaded less than 24 h ago.
- [x] Confirming issues `DELETE /v1/admin/storage/object` with the object's key; cancelling
      issues no request.
- [x] On success the row leaves the folder listing and the scan results, and the group totals
      decrease by its size.
- [x] On `409` the dialog shows the reason derived from the returned classification and the row's
      badge updates to it.
- [x] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and `dict-pt.ts`;
      `check-i18n-coverage.js` passes.
- [x] The dialog is keyboard-usable, focus-trapped and closes on Escape.
- [x] Changed files lint clean; `make test-web` green for the affected component tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-api` + `make dev-web`; put a stray object locally and confirm the action is disabled
   ("less than 24 h").
2. With a back-dated fixture (or by adjusting the local clock in a test), delete an orphan and
   confirm it disappears from both views.
3. Trigger a `409` (e.g. register the key in a media row between opening and confirming) and
   confirm the message and the refreshed badge.
4. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`.
5. `make test-web` and `check-i18n-coverage.js`.
6. `git diff --stat` confirms only scope-guardrail files changed.
