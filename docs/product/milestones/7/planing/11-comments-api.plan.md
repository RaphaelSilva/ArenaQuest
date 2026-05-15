# Plan — 11-comments-api

**Task:** [11-comments-api.task.md](../11-comments-api.task.md)
**Milestone:** 7
**Assigned personas:** backend-developer
**Branch:** feature/m7/11-comments-api.task (from feature/m7/candidate)

## Objective

Expose the discussion-thread HTTP surface for TopicNodes: list comments, post (with optional reply), like-toggle, and soft-delete. Posting awards XP via `XpEngine` with per-day idempotency. Access is gated by M5 enrollment checks.

## Affected areas

**New files:**
- `apps/api/src/controllers/comments.controller.ts`
- `apps/api/src/routes/comments.router.ts`
- `apps/api/test/routes/comments.spec.ts`

**Modified files:**
- `packages/shared/ports/i-comment-repository.ts` — add `findById(id): Promise<CommentRecord | null>`
- `apps/api/src/adapters/db/d1-comment-repository.ts` — implement `findById`
- `apps/api/src/routes/index.ts` — mount comments router, pass `commentRepo` and `xpEngine` to it
- `apps/api/src/index.ts` — instantiate `D1CommentRepository` and pass to `AppRouter.register`

**No new migrations** — `topic_comments` and `comment_likes` tables exist from migration 0022.

**Out of scope:**
- UI (Task 15)
- Edit functionality
- Admin moderation beyond `softDelete`

## Step-by-step

### Backend

1. **Add `findById` to `ICommentRepository` port** (`packages/shared/ports/i-comment-repository.ts`):
   ```ts
   findById(id: string): Promise<CommentRecord | null>;
   ```

2. **Implement `findById` in `D1CommentRepository`**:
   - Simple `SELECT * FROM topic_comments WHERE id = ?`.

3. **`CommentsController`** (`apps/api/src/controllers/comments.controller.ts`):
   - Schemas at top of file:
     - `CreateCommentSchema`: `{ body: z.string().min(1).max(2000), parentCommentId: z.string().uuid().optional().nullable() }`
   - `listComments(topicNodeId, userId, enrolledTopicIds)`:
     - If `topicNodeId` not in `enrolledTopicIds` → `{ ok: false, status: 403, error: 'Forbidden' }`.
     - Return `repo.listByTopic(topicNodeId, userId)` sorted top-level by `created_at DESC`, replies by `created_at ASC`. Sorting done in-memory after fetch (repo returns ASC; controller re-sorts top-level only).
   - `createComment(topicNodeId, userId, body, parentCommentId | null | undefined, enrolledTopicIds, xpEngine, now)`:
     - Access check: `topicNodeId` not in `enrolledTopicIds` → `403`.
     - Strip HTML from body: `body.replace(/<[^>]*>/g, '')`.
     - If `parentCommentId` provided:
       - Fetch `parentComment = repo.findById(parentCommentId)`.
       - If not found → `422 NotFound`.
       - If `parentComment.parentCommentId !== null` → `400 NESTED_REPLY_FORBIDDEN`.
     - `comment = await repo.insert({ topicNodeId, parentCommentId, userId, body })`.
     - Award XP daily idempotent: `xpEngine?.award({ userId, action: 'comment_posted', sourceKind: 'comment', sourceId: null, version: now.toISOString().slice(0, 10) })`.
     - Return `{ ok: true, data: comment }`.
   - `likeComment(commentId, userId)`:
     - `result = await repo.toggleLike(commentId, userId)`.
     - Return `{ ok: true, data: result }`.
   - `deleteComment(commentId, userId, userRoles)`:
     - Fetch comment via `findById`.
     - If not found → `404 NotFound`.
     - If `comment.userId !== userId` and `!userRoles.includes('admin')` → `403 Forbidden`.
     - `await repo.softDelete(commentId)`.
     - Return `{ ok: true, data: null }`.

4. **`CommentsRouter`** (`apps/api/src/routes/comments.router.ts`):
   - `GET /topics/:id/comments` → `CommentsController.listComments`; uses `enrollmentRepo.getEffectiveAccessTopicIds(userId)` for access.
   - `POST /topics/:id/comments` → parse body, `CommentsController.createComment`.
   - `POST /comments/:id/like` → `CommentsController.likeComment`.
   - `DELETE /comments/:id` → `CommentsController.deleteComment`; passes `c.get('user').roles`.
   - All guarded by `authGuard`.

5. **Wire in `AppRouter.register`** (`apps/api/src/routes/index.ts`):
   - Add `commentRepo: ICommentRepository` to `deps`.
   - Mount `/`, `/topics`, `/comments` with `buildCommentsRouter(commentRepo, enrollmentRepo, xpEngine)`.

6. **Wire in `buildApp`** (`apps/api/src/index.ts`):
   - Instantiate `const commentRepo = new D1CommentRepository(env.DB)`.
   - Pass `commentRepo` into `AppRouter.register`.

7. **Integration tests** (`apps/api/test/routes/comments.spec.ts`):
   - Auth guard (401 on each endpoint).
   - List: enrolled user gets comments; unenrolled → 403.
   - Listing preserves deleted comments with `body: null`.
   - `liked_by_me` reflects caller's like state after toggle.
   - Create: nested reply (parent has non-null parentCommentId) → 400 NESTED_REPLY_FORBIDDEN.
   - Delete: author can delete own; other user → 403; admin can delete any.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Nested reply returns `400 NESTED_REPLY_FORBIDDEN` | Step 3 (createComment) | backend | Integration test with 2-level nested reply |
| Deleting another user's comment → `403` | Step 3 (deleteComment) | backend | Integration test |
| Listing returns deleted comments with `body: null` | Step 3 (listComments) | backend | Integration test: delete then list |
| `liked_by_me` reflects caller's like state | Step 3 (listComments) | backend | Integration test: like then list |
| Posting in unenrolled topic → `403` | Step 3 (createComment) | backend | Integration test with unenrolled user |

## Risks & open questions

- **Sorting**: The task requires top-level comments sorted `DESC` and replies sorted `ASC`. The current `listByTopic` returns all `ASC`. Resort top-level in controller (no DB change needed).
- **HTML strip**: Use a simple regex `/<[^>]*>/g` to remove tags, not a full sanitizer, since the task says "plain text only — strip HTML".
- **XP daily key**: `version: now.toISOString().slice(0, 10)` (UTC date) — acceptable since timezone handling for comments is less critical than streaks.

## Verification

- Backend: `make lint && make test-api`

## Out of scope

- UI (Task 15)
- Edit functionality
- Rich-text / Markdown rendering
