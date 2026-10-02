# Task 08 — Backend: Move topic media to another topic

**Status:** 📝 Open
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
topic other than the current one.

## Motivation

- Raised while reviewing the M25 storage-browser preview (PR #78): a video uploaded to the wrong
  module can today only be deleted and re-uploaded. That costs another transfer of up to
  100 MB, and the soft-deleted row leaves its R2 object behind as a `deleted-row` until an
  admin cleans it up.
- M23 already gives students the same capability for their own submissions
  (`POST /v1/me/submissions/move`); staff have no equivalent for topic media.

## Scope

In:
- `POST /v1/admin/topics/{topicId}/media/{mediaId}/move`, body `{ targetTopicId: uuid }`,
  declared with `@hono/zod-openapi` `createRoute` next to the other media routes, and guarded
  like them (`admin` and `content_creator`).
- Responses:
  - `200` with the updated media item;
  - `404` when the media does not exist, is `deleted`, or does not belong to `{topicId}`;
  - `404` when the target topic does not exist;
  - `409` when the media is not `ready` (`pending` uploads stay where they were presigned);
  - `400` when the target equals the source topic, or the body is invalid;
  - `401` / `403` from the existing guards.
- A repository write that changes only the topic of one media row, and its port method.
- The regenerated `apps/api/openapi.json`.
- Specs:
  - the role matrix;
  - each error branch;
  - a successful move shows up in both topics' `GET …/media` lists;
  - the storage key and the R2 object are unchanged afterwards.

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
  - `apps/api/src/routes/admin/topics.ts`: the route, beside the existing media routes.
  - `apps/api/src/openapi/components/entities.ts`: the request body schema, if a new one is needed.
  - `apps/api/openapi.json`: regenerated with `pnpm dump-openapi`, never hand-edited.
  - `apps/api/test/controllers/admin-media.controller.spec.ts`, `apps/api/test/routes/admin-media.router.spec.ts`.
- Mirror the existing media routes in `routes/admin/topics.ts`: `createRoute`, the router's
  `defaultHook`, and a controller returning `ControllerResult<T>`. Mirror the submissions move
  (`routes/me/submissions.ts`) for the shape of a cross-topic reassignment.
- **No migration.** `media.topic_node_id` already exists; no new column, table or index.
- **No storage call.** The move never reads, copies or deletes an R2 object.
- **Ordering.** If topic media has a display order, the moved item goes last in the target
  topic. Confirm against `D1MediaRepository` while implementing, and keep it in this file.

## Acceptance Criteria

- [ ] An `admin` and a `content_creator` token each move a `ready` media item from topic A to
      topic B and get `200` with the updated item.
- [ ] Afterwards `GET /v1/admin/topics/B/media` lists the item and `GET /v1/admin/topics/A/media`
      does not.
- [ ] The item's storage key is byte-identical before and after, and its R2 object still exists.
- [ ] A `student` token gets `403` and no token gets `401`.
- [ ] A missing, `deleted` or wrong-topic media item gets `404`; a missing target topic gets `404`.
- [ ] A `pending` media item gets `409`; a target equal to the source gets `400`.
- [ ] `apps/api/openapi.json` is regenerated and lists the route.
- [ ] Changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api`: the new controller and router specs pass.
2. `make dev-api`, sign in as the seeded admin, upload a media item to one topic and move it to
   another with `curl`. Repeat with a `pending` item (409) and a student token (403).
3. `pnpm dump-openapi` produces no further diff.
4. `git diff --stat` confirms only scope-guardrail files changed.
