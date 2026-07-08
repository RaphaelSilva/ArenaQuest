# Plan — Task 01: Catalog enrollment enforcement (Phase 0)

**Assigned persona:** backend-developer
**Branch:** feat/m12-01-catalog-enrollment-enforcement
**Task file:** docs/product/milestones/12-enrollment-visibility/01-catalog-enrollment-enforcement.task.md

## Affected areas
- `apps/api/src/routes/public/catalog.topics.ts` — wire the enrollment adapter into the controller.
- `apps/api/test/routes/topics.router.spec.ts` — add the regression test that pins the fix.

## Root-cause summary
`buildCatalogTopicsRouter(ctx)` is already invoked with the full `AppContainer` (see `apps/api/src/routes/public/index.ts:14`), but its parameter type only destructures `slice.content` and constructs `new TopicsController(topics, media, storage, undefined)`. Because `this.enrollment` is `undefined`, the controller's `if (userId && this.enrollment)` guard (`topics.controller.ts`) is skipped and every authenticated user receives every published topic. The container already exposes `progress.enrollmentRepo: IEnrollmentRepository` (`container.ts` → `ProgressContext`). The fix is to thread that repository into the controller.

## Implementation steps

1. **`apps/api/src/routes/public/catalog.topics.ts`**
   - Widen the `buildCatalogTopicsRouter` parameter type to also receive the progress slice, e.g.
     `slice: { content: ContentContext; progress: ProgressContext }`.
   - Import the `ProgressContext` type from `@api/container` (alongside the existing `ContentContext` import).
   - Destructure `enrollmentRepo` from `slice.progress`.
   - Replace `new TopicsController(topics, media, storage, undefined)` with
     `new TopicsController(topics, media, storage, enrollmentRepo)`.
   - Remove/replace the misleading comment ("enrollment is not needed for public catalog reads") with an accurate one explaining the enrollment adapter gates non-admin reads.
   - **Do not** touch the two route handlers — they already pass `isAdmin ? undefined : user.sub`, which is the correct admin/content-creator bypass. No callsite change is needed in `public/index.ts` because it already passes the full `ctx`.

2. **`apps/api/test/routes/topics.router.spec.ts`** — add a regression test that fails before the fix and passes after:
   - In `beforeAll`, after the existing seeding, create a **second published root topic** ("Ungranted Root") via `POST /admin/topics` with `{ title: 'Ungranted Root', status: 'published' }` and capture its id (e.g. `ungrantedTopicId`). Do **not** grant the student any enrollment on it.
   - Add a `describe('Phase 0 — enrollment enforcement', ...)` block with:
     - `GET /topics` as the **student** returns a `data` array that **includes** `publishedTopicId` (granted) but **excludes** `ungrantedTopicId`.
     - `GET /topics` as the **admin** includes **both** `publishedTopicId` and `ungrantedTopicId` (bypass).
     - `GET /topics/{ungrantedTopicId}` as the **student** returns `404`.
     - `GET /topics/{ungrantedTopicId}` as the **admin** returns `200`.
   - Reuse the existing `req()` helper, `adminToken`, and `studentToken`.

## Out of scope (do NOT touch)
- The `visibility` column / enum / resolver (Tasks 02–04).
- `TopicsController` logic (the guard already exists).
- Comments / video-watched paths (already gated).
- Any frontend file.

## Verification (run by orchestrator, not the child)
- `make lint`
- `make test-api` (the full suite, including the new Phase 0 block).
