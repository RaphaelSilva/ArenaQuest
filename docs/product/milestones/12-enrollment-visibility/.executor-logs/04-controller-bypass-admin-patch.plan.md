# Plan — Task 04: admin/creator PRIVATE bypass + admin PATCH visibility (Phase 2)

**Assigned persona:** backend-developer
**Branch:** feat/m12-04-controller-bypass-admin-patch
**Task file:** docs/product/milestones/12-enrollment-visibility/04-controller-bypass-and-admin-patch.task.md

## Affected areas
- `apps/api/src/controllers/admin-topics.controller.ts` — add `visibility` to `CreateTopicSchema` + `UpdateTopicSchema`; destructure & pass it through `create`/`update`.
- `apps/api/src/routes/admin/topics.ts` — add `visibility` to the PATCH body schema, the create body schema, and the `TopicNodeRecordSchema` response.
- `apps/api/src/controllers/topics.controller.ts` — explicit doc comments on the admin/creator bypass (no behaviour change).
- `apps/api/test/routes/topics.router.spec.ts` — integration cases.
- `apps/api/test/routes/comments.spec.ts` — PUBLIC-commentable-by-unenrolled case.
- `apps/api/test/controllers/admin-topics.controller.spec.ts` — unit: update/create pass visibility through.

## Context facts (verified)
- **Two schemas gate the write path.** The route (`routes/admin/topics.ts`) validates the body via its OpenAPI schema; `c.req.valid('json')` STRIPS any field not in that schema. The controller (`admin-topics.controller.ts`) then re-types `body` via its OWN `UpdateTopicSchema`/`CreateTopicSchema` and **destructures only listed fields** (lines 60, 102), dropping the rest. So `visibility` must be added to BOTH schemas AND destructured/passed in BOTH `create` and `update`, or it is silently lost.
- The adapter already persists `visibility` (Task 02): `CreateTopicNodeInput`/`UpdateTopicNodeInput` carry `visibility?`, and `D1TopicNodeRepository` writes it.
- **Public catalog controller already enforces the policy** after Task 03: `listPublished(userId)` filters by the resolver only when `userId` is set; `getPublishedById` returns 404 when a non-admin's effective set lacks the id. Admin/creator callers pass `userId: undefined` (decided in `catalog.topics.ts`), so they skip the resolver and see ALL published topics, including `private`. **No behaviour change is needed in `topics.controller.ts` — only explicit doc comments** per RFC §3.
- **Comments already inherit the resolver.** `comments.router.ts` resolves `getEffectiveAccessTopicIds(userId)` and the controller 403s when the topic is absent. After Task 03 a `public` topic is in every user's set ⇒ commentable by any authenticated user; a lacked `restricted` topic ⇒ 403 (already tested via the unenrolled `tokenC`). No comment-path code change.
- Test harnesses: `topics.router.spec.ts` has `adminToken`, `studentToken` (student enrolled only in `publishedTopicId`), a `req()` helper, and seeds topics via `POST /admin/topics`. `comments.spec.ts` seeds topics via direct `INSERT INTO topic_nodes` and has `tokenC` (unenrolled).

## Implementation steps

1. **`admin-topics.controller.ts`**:
   - Add `visibility: z.enum(['public', 'restricted', 'private']).optional()` to both `CreateTopicSchema` and `UpdateTopicSchema`.
   - In `create`: add `visibility` to the destructure (line ~60) and pass `visibility: visibility as Entities.Config.TopicVisibility` (or cast consistent with the existing `status as ...` style) into `this.topics.create({...})`.
   - In `update`: add `visibility` to the destructure (line ~102) and pass it into `this.topics.update(id, {...})`. Omitting it (undefined) must leave the stored value untouched — the adapter's partial patch already handles that.

2. **`routes/admin/topics.ts`**:
   - Add a local `const TopicVisibilitySchema = z.enum(['public', 'restricted', 'private']);`.
   - Add `visibility: TopicVisibilitySchema.optional()` to the PATCH body schema (the `updateTopicRoute` body, ~line 164) AND to the create body schema (~line 95).
   - Add `visibility: TopicVisibilitySchema` to `TopicNodeRecordSchema` (response, ~line 35) so admin GET/PATCH responses expose the field (needed by the Task 05 frontend).

3. **`topics.controller.ts`** — add concise doc comments to `listPublished` and `getPublishedById` stating the rule explicitly: a missing `userId` (admin / content creator) bypasses the resolver entirely and returns ALL published, non-archived topics including `private`; every other principal is filtered by `(allow ∪ public) − private`. No logic change.

4. **Integration tests — `topics.router.spec.ts`** (reuse `req`, `adminToken`, `studentToken`):
   - Create a fresh published topic, `PATCH /admin/topics/{id}` `{ visibility: 'private' }`. Then: student `GET /topics` EXCLUDES it; student `GET /topics/{id}` → 404; admin `GET /topics/{id}` → 200; admin `GET /topics` INCLUDES it.
   - Create a fresh published topic, `PATCH` `{ visibility: 'public' }`. The student (no grant on it) `GET /topics` INCLUDES it.
   - PATCH round-trip: `PATCH` `{ visibility: 'private' }` then `GET /admin/topics/{id}` returns `visibility: 'private'`.
   - Invalid value: `PATCH` `{ visibility: 'bogus' }` → 400.

5. **Comment inheritance — `comments.spec.ts`**:
   - Seed (direct INSERT) a published topic with `visibility = 'public'`. Assert the UNENROLLED `tokenC` can `POST /topics/{publicId}/comments` successfully (200/201) and `GET` its comments (200) — proving PUBLIC inheritance with NO comment-controller change. (The existing 403-for-unenrolled test already covers the restricted-lack case.)

6. **Unit — `admin-topics.controller.spec.ts`**: assert `update` (and `create`) forwards `visibility` to the repository (the existing spec mocks the topics repo — assert the mock received `visibility`).

## Out of scope (do NOT touch)
- The resolver SQL (Task 03 — done).
- Any comment controller/router code (inheritance is automatic).
- Frontend (Task 05+).
- Denies / negative grants.

## Verification (run by orchestrator, not the child)
- Rebuild shared if needed (no port change here, so likely not).
- Scoped lint on changed files.
- Targeted specs: `topics.router.spec`, `admin-topics.router.spec`, `admin-topics.controller.spec`, `comments.spec`, `topics.controller.spec`.
