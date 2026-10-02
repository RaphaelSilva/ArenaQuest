# Task 08 — Backend: Move topic media to another topic

**Status:** ✅ Done
**Kind:** Feature
**Team:** Backend API
**Priority:** Medium
**Found in:** M25 preview review (admin storage browser), 2026-10-02

## Summary

Lets an `admin` or `content_creator` reassign a media item that was attached to the wrong topic.
For example, a video uploaded under *Módulo 1* that belongs to *Módulo 2* is moved there without
re-uploading. A new endpoint, `POST /v1/admin/topics/{topicId}/media/{mediaId}/move` with body
`{ targetTopicId }`, performs a **logical transfer**. Only the media row's topic changes; the R2
object is neither copied nor renamed, and its storage key keeps the original topic id in its
path. The response is the updated media item, now listed under the target topic and gone from
the source topic's list. Only `ready` media can be moved, and the target must be an existing
topic other than the current one. Because a media item's audience is its topic's, a move also
changes who can read it in the catalog — that is the point of the operation, and it is done by
the same roles that already decide a topic's status and visibility.

## Motivation

- Raised while reviewing the M25 storage-browser preview (PR #78): a video uploaded to the wrong
  module can today only be deleted and re-uploaded. That costs another transfer of up to
  100 MB, loses the original row (uploader, `createdAt`), and whenever the best-effort
  `deleteObject` fails the old object stays behind as a `deleted-row` (RFC 0018).
- M23 already gives students the same capability for their own submissions
  (`POST /v1/me/submissions/move`); staff have no equivalent for topic media.

## Scope

In:
- `POST /v1/admin/topics/{topicId}/media/{mediaId}/move`, body `{ targetTopicId: uuid }`,
  declared with `@hono/zod-openapi` `createRoute` next to the other media routes, and guarded
  like them (`admin` and `content_creator`).
- Responses (error codes follow the PascalCase style of the existing media errors):
  - `200` with the updated media item, carrying a fresh signed `url` like `listMedia` does;
  - `404 NotFound` when the media does not exist, is `deleted`, or does not belong to `{topicId}`;
  - `404 NotFound` (`meta.detail: 'target topic not found'`) when the target topic does not exist;
  - `409 MediaNotReady` when the media is `pending` (it stays where it was presigned);
  - `400 SameTopic` when the target equals the source topic; `400` from the router's
    `defaultHook` when the body or params are invalid;
  - `401` / `403` from the admin router's umbrella guard.
- The target is any existing topic, **archived included** — the same rule `presignUpload` applies
  to `{topicId}` today. Hiding archived topics from the picker is a frontend choice (Task 09).
- A repository write that changes only the topic of one media row, and its port method. It is a
  **conditional** single statement — the row's id, its current topic and `status = 'ready'` in the
  `WHERE` — decided by `meta.changes`, so a concurrent delete or a second move cannot be
  overwritten (the same technique as the submissions move). On zero changes the controller
  re-reads the row and answers `404` or `409` as above.
- The regenerated `apps/api/openapi.json`.
- Specs:
  - the role matrix;
  - each error branch;
  - a successful move shows up in both topics' `GET …/media` lists;
  - the storage key and the R2 object are unchanged afterwards (the storage fake records no call);
  - the D1 repository method against the Workers pool: it moves a `ready` row, and leaves a
    `pending`, a `deleted` and a wrong-source row untouched.

Out:
- The "Move to…" UI. That is Task 09 (frontend).
- Physically relocating the R2 object to a `topics/<targetTopicId>/` key. Not planned: object
  ownership is resolved from the database (RFC 0018 Decision 6), so a key whose path names the
  old topic still resolves as `linked` to the new one.
- Bulk moves and moving whole topics. Topics already move through `POST /v1/admin/topics/{id}/move`.
- Moving event flyers or student submissions.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/ports/i-media-repository.ts`: one new method for the topic reassignment.
  - `apps/api/src/adapters/db/d1-media-repository.ts`: its implementation.
  - `apps/api/src/controllers/admin-media.controller.ts`: the move use case.
  - `apps/api/src/routes/admin/topics.ts`: the route and its body schema, beside the existing
    media routes (this file declares its own local `MediaSchema`; `openapi/components/entities.ts`
    is not needed).
  - `apps/api/openapi.json`: regenerated with `pnpm dump-openapi`, never hand-edited.
  - `apps/api/test/controllers/admin-media.controller.spec.ts`, `apps/api/test/routes/admin-media.router.spec.ts`,
    `apps/api/test/db/d1-media-repository.spec.ts`.
  - `apps/api/test/controllers/topics.controller.spec.ts`: only to add the new method to its
    `IMediaRepository` fake, so it still type-checks.
- Mirror the existing media routes in `routes/admin/topics.ts`: `createRoute`, the router's
  `defaultHook`, and a controller returning `ControllerResult<T>`. Mirror the submissions move
  (`routes/me/submissions.ts`) for the shape of a cross-topic reassignment.
- **No migration.** `media.topic_node_id` already exists; no new column, table or index.
- **No storage call.** The move never reads, copies or deletes an R2 object.
- **Ordering.** Topic media has no display order column: `listByTopic` sorts by `created_at ASC`.
  The move keeps `created_at` (only `updated_at` changes), so the item takes its chronological
  place in the target list rather than going last. No ordering change is in scope.

## Acceptance Criteria

- [x] An `admin` and a `content_creator` token each move a `ready` media item from topic A to
      topic B and get `200` with the updated item.
- [x] Afterwards `GET /v1/admin/topics/B/media` lists the item and `GET /v1/admin/topics/A/media`
      does not.
- [x] The item's storage key and `createdAt` are identical before and after; `updatedAt` advances;
      no storage method is called.
- [x] A `student` token gets `403` and no token gets `401`.
- [x] A missing, `deleted` or wrong-topic media item gets `404`; a missing target topic gets `404`.
- [x] A `pending` media item gets `409 MediaNotReady`; a target equal to the source gets `400 SameTopic`;
      an archived target topic is accepted.
- [x] The repository write is conditional: a row that is no longer `ready` or no longer on the
      source topic is left unchanged.
- [x] `apps/api/openapi.json` is regenerated and lists the route.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api`: the new controller and router specs pass.
2. `make dev-api`, sign in as the seeded admin, upload a media item to one topic and move it to
   another with `curl`. Repeat with a `pending` item (409) and a student token (403).
3. `pnpm dump-openapi` produces no further diff.
4. `git diff --stat` confirms only scope-guardrail files changed.
