# Plan — 02-frontend-direct-fetch-cleanup

**Task:** [02-frontend-direct-fetch-cleanup.task.md](../02-frontend-direct-fetch-cleanup.task.md)
**Source:** Backlog — refactoring
**Assigned personas:** frontend-developer
**Branch:** feature/backlog/refactoring/02-frontend-direct-fetch-cleanup.task

## Objective

Six fetch call-sites in the web frontend bypass `ApiClient` by calling `fetch` directly with a manual `Authorization: Bearer ${accessToken}` header. This breaks the single-flight token-refresh and session-expired propagation that `fetchWithAuth` provides. The fix is additive then mechanical: expose the missing endpoints through domain API modules (`comments-api.ts`, extended `account-api.ts`, extended `topics-api.ts`), register them on `ApiClient`, then rewrite the four affected components to use `useApiClient()`.

## Affected areas

**New files:**
- `apps/web/src/lib/comments-api.ts` — new domain module
- `apps/web/src/lib/__tests__/comments-api.test.ts` — new tests
- `apps/web/src/lib/__tests__/account-api.test.ts` — new tests (none exist yet)
- `apps/web/src/lib/__tests__/topics-api.test.ts` — new tests (none exist yet)

**Modified files:**
- `apps/web/src/lib/account-api.ts` — add `getBadges()`
- `apps/web/src/lib/topics-api.ts` — add `markVideoWatched(topicId, mediaId)`
- `apps/web/src/lib/api-client.ts` — register `get comments()` namespace
- `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — replace badges fetch, remove `accessToken` prop to Discussion, collapse auth gate
- `apps/web/src/components/catalog/Comments.tsx` — replace POST + like fetch, remove `accessToken` prop
- `apps/web/src/components/catalog/Discussion.tsx` — replace GET + POST fetch, remove `accessToken` prop
- `apps/web/src/components/catalog/VideoPlayerWithPlaylist.tsx` — replace watched fetch, remove `accessToken` prop
- `apps/web/src/components/catalog/MediaTabs.tsx` — remove `accessToken` from Props and its pass-through (cascade from VideoPlayerWithPlaylist change)
- `apps/web/src/components/catalog/__tests__/subtopic-detail.test.tsx` — rewrite Comments tests to mock `useApiClient` instead of `global.fetch`

**Explicitly out of scope:**
- `apps/api/**` — no backend changes
- `packages/shared/**` — DTOs are defined inline in the new modules; promotion to shared is a follow-up
- `apps/web/src/lib/auth-api.ts` — intentionally excluded
- `apps/web/src/lib/fetch-with-auth.ts` — kept as-is

## Step-by-step

### Frontend

**Step 1 — Create `comments-api.ts`**

File: `apps/web/src/lib/comments-api.ts`

Define the local DTO types (mirroring `CommentWithMeta` from `packages/shared/ports/i-comment-repository.ts` but without repo-only fields):
```ts
export type CommentItem = {
  id: string;
  userId: string;
  body: string | null;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  parentCommentId: string | null;
};
```

Implement `createCommentsApi(http: HttpTransport)` returning:
- `listForTopic(topicId: string): Promise<CommentItem[]>` → `GET /topics/{topicId}/comments`
- `createForTopic(topicId: string, body: string): Promise<CommentItem>` → `POST /topics/{topicId}/comments` with `{ body }` JSON
- `toggleLike(commentId: string): Promise<void>` → `POST /comments/{commentId}/like`

Add `CommentsApiError` with `code: CommentsApiErrorCode` and `status: number`:
```ts
export type CommentsApiErrorCode = 'Unauthorized' | 'NetworkError' | 'NotFound' | 'Unknown';
```

Error mapping:
- Network catch → `NetworkError` (status 0)
- 401 → `Unauthorized`
- 404 → `NotFound`
- All others → `Unknown`

`toggleLike` is fire-and-forget in the component (optimistic UI with rollback on catch) — the domain method should still throw on non-ok responses.

`listForTopic` response: the backend returns a JSON array directly (see Discussion.tsx line 58: `(await res.json()) as Comment[]`).
`createForTopic` response: returns the created `CommentItem` object.

---

**Step 2 — Add `getBadges()` to `account-api.ts`**

In `apps/web/src/lib/account-api.ts`, add to the returned object inside `createAccountApi`:
```ts
async getBadges(): Promise<BadgeItem[]> { ... }
```

Define local DTO:
```ts
export type BadgeItem = {
  id: string;
  emoji: string;
  name: string;
  earned: boolean;
};
```

The backend response shape (from page.tsx line 68):
```ts
Array<{ badge: { id: string; iconEmoji: string; name: string }; earnedAt: string }>
```
Map to `BadgeItem[]` — throw `AccountApiError('Unknown', ...)` on non-ok responses so the page-level caller can decide to catch and fallback to `[]`.

---

**Step 3 — Add `markVideoWatched()` to `topics-api.ts`**

In `apps/web/src/lib/topics-api.ts`, add to the returned object inside `createTopicsApi`:
```ts
async markVideoWatched(topicId: string, mediaId: string): Promise<void> { ... }
```

Calls `POST /topics/{topicId}/videos/{mediaId}/watched`. Swallow all errors (same behavior as the current inline `try/catch` in VideoPlayerWithPlaylist.tsx — non-blocking beacon).

---

**Step 4 — Register `comments` namespace in `ApiClient`**

In `apps/web/src/lib/api-client.ts`:
1. Add import: `import * as commentsApiModule from './comments-api';`
2. Add getter:
   ```ts
   get comments() {
     return commentsApiModule.createCommentsApi(this.http);
   }
   ```

---

**Step 5 — Migrate `VideoPlayerWithPlaylist.tsx`**

File: `apps/web/src/components/catalog/VideoPlayerWithPlaylist.tsx`

- Remove `accessToken` from `Props` type.
- Add `const client = useApiClient();` inside the component.
- Remove `const API_URL = ...` local constant.
- In `markWatched(mediaId)`, replace:
  ```ts
  await fetch(`${API_URL}/topics/${topicId}/videos/${mediaId}/watched`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  ```
  with:
  ```ts
  await client.topics.markVideoWatched(topicId, mediaId);
  ```

---

**Step 6 — Migrate `MediaTabs.tsx` (cascade)**

File: `apps/web/src/components/catalog/MediaTabs.tsx`

- Remove `accessToken` from `Props` type and from the function signature.
- Remove `accessToken` from the `VideoPlayerWithPlaylist` usage (no longer needed).

---

**Step 7 — Migrate `Discussion.tsx`**

File: `apps/web/src/components/catalog/Discussion.tsx`

- Remove `accessToken` from `Props` type.
- Add `const client = useApiClient();` inside the component.
- Remove `const API_URL = ...` local constant.
- Replace the `useEffect` fetch:
  ```ts
  fetch(`${API_URL}/topics/${topicId}/comments`, { headers: { ... } })
  ```
  with:
  ```ts
  client.comments.listForTopic(topicId)
  ```
- Remove `accessToken` from the `useEffect` dependency array; keep `[topicId, client]`.
- Replace the POST in `handleSubmit`:
  ```ts
  await fetch(`${API_URL}/topics/${topicId}/comments`, { method: 'POST', headers: { ... }, body: ... })
  ```
  with:
  ```ts
  const realComment = await client.comments.createForTopic(topicId, body);
  ```

---

**Step 8 — Migrate `Comments.tsx`**

File: `apps/web/src/components/catalog/Comments.tsx`

- Remove `accessToken` from `Props` type.
- Add `const client = useApiClient();` inside the component.
- Remove `const API_URL = ...` local constant.
- In `handleSubmit`, replace:
  ```ts
  await fetch(`${API_URL}/topics/${topicId}/comments`, { method: 'POST', headers: { ... }, body: ... })
  ```
  with:
  ```ts
  const real = await client.comments.createForTopic(topicId, body);
  ```
- In `handleLike`, replace:
  ```ts
  await fetch(`${API_URL}/comments/${commentId}/like`, { method: 'POST', headers: { ... } })
  ```
  with:
  ```ts
  await client.comments.toggleLike(commentId);
  ```

---

**Step 9 — Migrate `catalog/[id]/page.tsx`**

File: `apps/web/src/app/(protected)/catalog/[id]/page.tsx`

- In the `Promise.all`, replace the `/me/badges` fetch block:
  ```ts
  fetch(`${API_URL}/me/badges`, { headers, cache: 'no-store' })
    .then(async (r) => { ... })
    .catch(() => [] as BadgeItem[])
  ```
  with:
  ```ts
  client.account.getBadges().catch(() => [] as BadgeItem[])
  ```
- Remove the `const API_URL = ...` and `const headers = ...` locals from the `useEffect`.
- Remove `accessToken` from the `Discussion` JSX props.
- Collapse the condition at line 182:
  ```ts
  {topic.parentId !== null && accessToken && (
  ```
  to:
  ```ts
  {topic.parentId !== null && (
  ```
- Remove `const { accessToken } = useAuth();` if `accessToken` is no longer referenced anywhere in the file.
- Remove `import { useAuth } from '@web/hooks/use-auth';` if no longer needed.
- Update `useEffect` dependency array: remove `accessToken` (add `client` if not already there).

---

**Step 10 — Rewrite `subtopic-detail.test.tsx` Comments tests**

File: `apps/web/src/components/catalog/__tests__/subtopic-detail.test.tsx`

- Remove `vi.stubGlobal('fetch', vi.fn())` and `beforeEach` fetch stub.
- Add `vi.mock('@web/context/auth-context', ...)` at the top to mock `useApiClient`, exposing `client.comments.createForTopic` and `client.comments.toggleLike`.
- Rewrite the "optimistically prepends a comment" test to set `mockCreateForTopic.mockResolvedValueOnce(...)` instead of mocking `global.fetch`.
- Rewrite the "rolls back optimistic comment on API failure" test similarly.
- `Comments` no longer accepts `accessToken` prop — remove it from all test renders.
- `MediaTabs` no longer accepts `accessToken` prop — remove it from all test renders.

---

**Step 11 — Write new API module tests**

**`apps/web/src/lib/__tests__/comments-api.test.ts`:**
- Mock `HttpTransport` with `vi.fn()`.
- `listForTopic`: happy path (returns array), 401 → `CommentsApiError('Unauthorized')`, network throw → `CommentsApiError('NetworkError')`.
- `createForTopic`: happy path (returns created comment), 401 mapped.
- `toggleLike`: happy path (void), error throws.

**`apps/web/src/lib/__tests__/account-api.test.ts`:**
- `getBadges`: happy path (maps response shape correctly), non-ok → throws `AccountApiError`.

**`apps/web/src/lib/__tests__/topics-api.test.ts`:**
- `markVideoWatched`: happy path (no throw), network error swallowed silently (no throw).

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| No direct `fetch` + `API_URL` in component files | Steps 5–9 | frontend | `grep -rn "fetch(\`\${API_URL}"` returns 0 non-library matches |
| No manual `Authorization: Bearer` outside auth files | Steps 5–9 | frontend | `grep -rn "Bearer \${accessToken}"` returns 0 outside auth files |
| `comments-api.ts` exported & registered as `client.comments` | Steps 1, 4 | frontend | TypeScript compiles; grep confirms getter |
| `client.account.getBadges()` exists | Step 2 | frontend | TypeScript compiles; test passes |
| `topics-api.ts` exposes `markVideoWatched` | Step 3 | frontend | TypeScript compiles; test passes |
| Four consumers no longer import `useAuth` solely for `accessToken` | Steps 5–9 | frontend | Grep confirms |
| `page.tsx` accessToken gate collapsed | Step 9 | frontend | `grep "accessToken &&" page.tsx` returns 0 |
| All new tests exist and pass | Steps 10, 11 | frontend | `make test-web` |
| `make lint && make test-web && make build` pass | — | frontend | CI |

## Risks & open questions

- **`Comments.tsx` is currently unused in production** (only in tests). It still holds direct `fetch` calls and the test file mocks `global.fetch` for it — Step 10 must update both the component and the test.
- **`Discussion.tsx` `useEffect` dependency**: After replacing `accessToken` with `client` in the dep array, ensure `client` reference is stable (it is, since `useApiClient()` returns the same object reference within a render cycle per `auth-context.tsx`).
- **`Comments.tsx` `CommentWithMeta` type** is currently defined locally in that file. After removing `accessToken`, import `CommentItem` from `comments-api.ts` and replace the local type (or keep both — they're structurally compatible — but unify to avoid drift).
- **`MediaTabs` tests** pass `accessToken="token"` — this must be removed in Step 10 once the prop is gone.

## Verification

- Frontend: `make lint && make test-web`
- Build: `make build`
- Static grep checks (from Acceptance Criteria table above)
- Manual: catalog topic page — badges render, comments list/post/like work, video watched fires; force-401 mid-session confirms silent refresh covers these endpoints.

## Out of scope

- Backend endpoint paths, methods, payloads, response shapes.
- The catalog UI/UX, badge rendering, comment-thread layout, video player.
- `AuthContext` public surface.
- `auth-api.ts`.
- Adding a CI gate script for the grep checks (flagged as a follow-up in the task).
- Promoting Comment/Badge DTOs to `packages/shared`.
