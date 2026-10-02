# Task 09 — Frontend: Move topic media to another topic

**Status:** ✅ Done
**Kind:** Feature
**Team:** Frontend Web
**Priority:** Medium
**Found in:** M25 preview review (admin storage browser), 2026-10-02
**Depends On:** [Task 08](./08-move-topic-media-to-another-topic--backend.task.md)

## Summary

Adds a **"Move to…"** action to each `ready` media item in the backoffice topic media list
(`/admin/topics`). It is visible to `admin` and `content_creator`, the same roles that upload
and delete there. The action opens a dialog with a topic picker built from the existing topic
tree, in tree order. The current topic and archived topics are excluded, as in the M23
submissions `MoveDialog`. The dialog shows the item's name and the destination, and
requires an explicit confirm before it calls Task 08's `POST
/v1/admin/topics/{topicId}/media/{mediaId}/move`. On success the item disappears from the open
topic's list and a confirmation names the destination. On an error the dialog stays open and
shows the reason from the server: not ready, topic gone, or no permission.

## Motivation

- Raised while reviewing the M25 storage-browser preview (PR #78): a file uploaded to the wrong
  module can today only be deleted and uploaded again.
- Task 08 adds the endpoint, and this task puts it where content is managed, next to upload and
  delete.

## Scope

In:
- `move(topicId, mediaId, targetTopicId)` in `admin-media-api.ts`, over the centralized `api-client`. Unlike
  the module's other methods, which throw a plain `Error`, it rejects with an error carrying the
  HTTP status and the server's `error` code, so the dialog can pick the message per answer.
- The "Move to…" action on `ready` items in the admin `MediaList`. A `pending` item does not
  get the action. `MediaList` today receives only `topicId`, `media` and `onMediaDeleted`, so it
  gains the topic list (from the page's `nodes` state) and a callback that reloads the list after
  a move.
- A move dialog:
  - the topic picker comes from the topic tree the page already loads, indented by depth and
    sorted like the tree (the shape of `moveTargets` in `components/catalog/submissions/MoveDialog.tsx`;
    import or mirror it, do not edit that file);
  - it is modal, keeps focus inside, closes on Escape, and starts on *Cancel*;
  - it announces the outcome.
- List refresh after a success, and an error state that keeps the dialog open.
- The regenerated `api-types.gen.ts`, and new keys in both dictionaries.
- RTL tests for every behaviour above.

Out:
- The endpoint itself. That is Task 08.
- A "Move" shortcut in the M25 storage browser drawer. It can link to the topic later; not
  part of this task.
- Drag-and-drop between topics, and bulk moves.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/lib/admin-media-api.ts`
  - `apps/web/src/lib/api-types.gen.ts`: regenerated with `pnpm gen:api-types`.
  - `apps/web/src/components/admin/MediaList.tsx` and a new `apps/web/src/components/admin/MoveMediaDialog.tsx`
  - `apps/web/src/components/admin/__tests__/**`
  - `apps/web/src/app/(protected)/admin/topics/page.tsx`: only to pass `nodes` and the reload
    callback to `MediaList`.
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts`
- Reuse the topic tree data the topics page already holds; no new fetch for the picker.
- **i18n.** No hardcoded user-facing string; identical keys in both dictionaries;
  `check-i18n-coverage.js` passes.
- The server decides: the client hides the action for non-`ready` items, but always shows a
  `409` / `404` / `403` answer.

## Acceptance Criteria

- [x] A `ready` item shows "Move to…"; a `pending` item does not.
- [x] The picker lists every non-archived topic except the current one; confirming sends the move request
      with the chosen target, and cancelling sends nothing.
- [x] On success the item leaves the current topic's list and the confirmation names the destination.
- [x] On `409`, `404` or `403` the dialog stays open and shows the matching message.
- [x] The dialog is keyboard-usable, keeps focus inside and closes on Escape.
- [x] No hardcoded user-facing string; the new keys exist in both dictionaries; `check-i18n-coverage.js` passes.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web` and `check-i18n-coverage.js`: the new component tests pass.
2. `make dev-api` + `make dev-web`, sign in as the seeded admin: move a video from one topic to
   another, open the destination and see it there. Try a `pending` item and a deleted
   destination topic.
3. `git diff --stat` confirms only scope-guardrail files changed.
