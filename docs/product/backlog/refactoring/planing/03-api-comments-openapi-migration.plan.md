# Plan — 03-api-comments-openapi-migration

**Task:** [03-api-comments-openapi-migration.task.md](../03-api-comments-openapi-migration.task.md)
**Source:** Backlog / refactoring
**Assigned personas:** backend-developer
**Branch:** feature/backlog/refactoring/03-api-comments-openapi-migration.task

## Objective

Migrate `apps/api/src/routes/comments.router.ts` — the last router still using raw `Hono` — to the `OpenAPIHono` + `createRoute` pattern already used by every other router in the project. The two topic-comment endpoints (`GET /v1/topics/{id}/comments` and `POST /v1/topics/{id}/comments`) must become first-class members of the published OpenAPI contract: visible in `/openapi.json`, rendered in `/docs`, and validated at the route boundary so a malformed body returns `400` instead of `500`. All existing semantics (auth guard, enrollment access check, best-effort XP award) are preserved verbatim.

## Affected areas

**Files to modify:**
- `apps/api/src/routes/comments.router.ts` — full rewrite to `OpenAPIHono` + `createRoute`
- `apps/api/src/openapi/components/entities.ts` — add `CommentSchema` and `CommentWithMetaSchema`
- `apps/api/test/routes/comments.spec.ts` — add malformed-body → 400 test case and OpenAPI presence assertion
- `apps/api/openapi.json` — regenerate via `pnpm dump-openapi`

**Files NOT to touch:**
- `apps/api/src/controllers/comments.controller.ts` — controller and `CreateCommentSchema` unchanged
- `apps/api/src/routes/index.ts` — mount call `v1.route('/', buildCommentsRouter(...))` stays as-is (return type becomes `OpenAPIHono`, which is assignable to `Hono`)
- `apps/api/src/routes/me/comments.ts` — out of scope (already on `me/` module)
- Any frontend files

## Step-by-step

### Backend

**Step 1 — Add `CommentSchema` and `CommentWithMetaSchema` to `entities.ts`**

In `apps/api/src/openapi/components/entities.ts`, add at the bottom:

```typescript
export const CommentSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  topicNodeId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  parentCommentId: z.string().uuid().nullable().openapi({ example: null }),
  userId: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  body: z.string().nullable().openapi({ example: 'This topic was very helpful!' }),
  createdAt: z.string().datetime().openapi({ example: '2024-01-01T12:00:00Z' }),
  deletedAt: z.string().datetime().nullable().openapi({ example: null }),
}).openapi('Comment');

export const CommentWithMetaSchema = CommentSchema.extend({
  likeCount: z.number().int().openapi({ example: 3 }),
  likedByMe: z.boolean().openapi({ example: false }),
}).openapi('CommentWithMeta');
```

**Step 2 — Rewrite `comments.router.ts` with `OpenAPIHono` + `createRoute`**

Replace the entire file content. Key changes:
- Import `createRoute, OpenAPIHono, z` from `@hono/zod-openapi`
- Import `CommentSchema, CommentWithMetaSchema` from `@api/openapi/components/entities`
- Import `ErrorBody` from `@api/openapi/components/errors`
- Import `respondWith, respondCreated` from `@api/routes/_shared/envelope`
- Change function return type from `Hono` to `OpenAPIHono`
- Apply `authGuard` via `router.use('*', authGuard)` (not per-route)
- Define `listCommentsRoute` with `createRoute`:
  - `method: 'get'`, `path: '/topics/{id}/comments'`
  - `tags: ['topics:comments']`, `security: [{ bearerAuth: [] }]`
  - `request.params`: `z.object({ id: z.string().uuid() })`
  - `responses`: 200 → `{ data: z.array(CommentWithMetaSchema) }`, 403 → ErrorBody description
- Define `createCommentRoute` with `createRoute`:
  - `method: 'post'`, `path: '/topics/{id}/comments'`
  - `tags: ['topics:comments']`, `security: [{ bearerAuth: [] }]`
  - `request.params`: `z.object({ id: z.string().uuid() })`
  - `request.body`: content `application/json` → reuse `CreateCommentSchema` from the controller (import it)
  - `responses`: 201 → `CommentSchema`, 400/403/422 → ErrorBody descriptions
- Handler for list: read `c.req.valid('param').id`, call `controller.listComments(...)`, return `respondWith(c, result)` but wrap data in `{ data: result.data }` envelope when ok (or use `c.json({ data: result.data }, 200)` after checking `result.ok`, delegating error to `respondWith`)
- Handler for create: read `c.req.valid('param').id` and `c.req.valid('json')`, call `controller.createComment(...)`, apply XP best-effort, return `respondCreated(c, result)`

> **Note on the list envelope:** `respondWith` returns `c.json(result.data, 200)` on success, but the existing API returns `{ data: [...] }`. The handler must wrap manually:
> ```typescript
> router.openapi(listCommentsRoute, async (c) => {
>   ...
>   if (!result.ok) return respondWith(c, result);
>   return c.json({ data: result.data }, 200);
> });
> ```
> This matches the pattern used by `admin/tasks.ts` list handlers.

**Step 3 — Update `comments.spec.ts` — add malformed-body and OpenAPI presence tests**

Add to the existing test file:

1. In the `POST /topics/:id/comments` describe block, add:
```typescript
it('returns 400 for malformed JSON body', async () => {
  const request = new IncomingRequest(`http://example.com/v1/topics/${TOPIC_ID}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
    body: 'not-valid-json{{{',
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(400);
});
```

2. Add a new top-level `describe` block for OpenAPI presence:
```typescript
describe('OpenAPI contract', () => {
  it('comment endpoints appear in /openapi.json', async () => {
    const res = await req('GET', '/openapi.json');
    expect(res.status).toBe(200);
    const doc = await res.json<{ paths: Record<string, unknown> }>();
    expect(doc.paths).toHaveProperty('/v1/topics/{id}/comments');
    const commentPaths = doc.paths['/v1/topics/{id}/comments'] as Record<string, unknown>;
    expect(commentPaths).toHaveProperty('get');
    expect(commentPaths).toHaveProperty('post');
  });
});
```

> **Note on path prefix:** The OpenAPI document is generated by `app.doc31(...)` called on the root app, and routes registered via `app.route('/v1', v1)` will appear with the `/v1` prefix. Verify the actual prefix with a quick sanity check or look at other endpoints in the current `openapi.json`.

**Step 4 — Regenerate `openapi.json`**

Run from the `apps/api` directory:
```bash
pnpm dump-openapi
```

Commit the updated `openapi.json`.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| `comments.router.ts` uses `OpenAPIHono` + `createRoute`; no raw `Hono` handlers | Step 2 | backend | code review + `make test-api` |
| `GET /v1/topics/{id}/comments` and `POST /v1/topics/{id}/comments` appear in `/openapi.json` | Steps 2, 4 | backend | `make test-api` OpenAPI presence test + manual check |
| Malformed JSON body on POST returns `400` (not `500`) | Steps 2, 3 | backend | new test case |
| Responses go through `respondWith` / `respondCreated`; no `as 400 \| 403 \| 422` casts | Step 2 | backend | code review |
| Enrollment access guard and XP award behave exactly as before | Step 2 | backend | existing `make test-api` tests pass |
| `openapi.json` regenerated and committed | Step 4 | backend | `git diff --stat` shows `openapi.json` changed |
| `make lint`, `make test-api`, `make build` pass | All steps | backend | CI verification |

## Risks & open questions

- **`createRoute` path param validation with UUID**: `OpenAPIHono` will reject non-UUID `:id` path params at the route boundary if the param schema is `z.string().uuid()`. Existing tests use the string `TOPIC_ID = 'cmt-topic-1'` which is NOT a UUID. Consider using `z.string()` (not `.uuid()`) for the path param to preserve test compatibility, or update `TOPIC_ID` to a UUID in the test. **Recommendation: use `z.string()` for the param schema to avoid breaking existing tests, matching the controller's own loose typing.**
- **OpenAPI path prefix**: Verify that the `doc31` endpoint on the root `OpenAPIHono` app collects routes from sub-apps registered via `app.route('/v1', v1)`. If it does not, the two endpoints will not appear; in that case, the `doc31` must be moved/configured on `v1` instead. Check existing `openapi.json` to confirm sub-routes appear with `/v1` prefix.
- **`authGuard` on `OpenAPIHono`**: `router.use('*', authGuard)` must be called **before** the `router.openapi(...)` registrations to take effect. The `security: [{ bearerAuth: [] }]` in `createRoute` is declarative-only (for docs); it does not enforce auth by itself.

## Verification

- Backend: `make lint && make test-api`
- Confirm `openapi.json` diff includes `/v1/topics/{id}/comments` GET and POST paths
- Manual: `make dev-api`, open `/docs` and confirm comment endpoints render with request/response schemas

## Out of scope

- Like/delete endpoints in `routes/me/comments.ts`
- Any frontend consumption changes (Task 05 — RFC R3)
- Controller business logic, persistence, or XP formula changes
- Schema extraction to standalone shared OpenAPI component files (beyond `entities.ts` addition)
