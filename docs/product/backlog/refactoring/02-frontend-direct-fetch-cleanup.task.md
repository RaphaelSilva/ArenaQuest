# Task 02: Eliminate Direct `fetch` Calls Bypassing the `ApiClient` in the Web Frontend

## Metadata
- **Status:** ✅ Done
- **Complexity:** Medium
- **Milestone:** Future Enhancement (technical debt)
- **Dependencies:** Builds on Task 01 (`01-frontend-api-client-class.task.md` — ✅ Done)
- **Category:** Refactoring / Frontend Architecture

---

## Summary

Task 01 introduced `ApiClient` (`apps/web/src/lib/api-client.ts`) and `useApiClient()` as the **only sanctioned way** for web components to talk to the backend. New features merged after that refactor have reintroduced the old anti-pattern: components call `fetch(\`${API_URL}/...\`, { headers: { Authorization: \`Bearer ${accessToken}\` } })` directly, bypassing the client.

This task removes those direct calls by moving each affected endpoint into a domain module under `apps/web/src/lib/*-api.ts`, exposing it through `ApiClient`, and migrating the call sites to `useApiClient()`.

---

## Problem Statement

### Current behavior
The following files in `apps/web/src` call the backend directly with `fetch` + manual `Authorization` header, duplicating the auth plumbing that `ApiClient`/`fetchWithAuth` already encapsulates:

| # | File | Line(s) | Endpoint | Method |
|---|------|---------|----------|--------|
| 1 | `apps/web/src/app/(protected)/catalog/[id]/page.tsx` | 66 | `/me/badges` | GET |
| 2 | `apps/web/src/components/catalog/Comments.tsx` | 64 | `/topics/{topicId}/comments` | GET |
| 3 | `apps/web/src/components/catalog/Comments.tsx` | 93 | `/comments/{commentId}/like` | POST |
| 4 | `apps/web/src/components/catalog/Discussion.tsx` | 50 | `/topics/{topicId}/comments` | GET |
| 5 | `apps/web/src/components/catalog/Discussion.tsx` | 98 | `/topics/{topicId}/comments` | POST |
| 6 | `apps/web/src/components/catalog/VideoPlayerWithPlaylist.tsx` | 44 | `/topics/{topicId}/videos/{mediaId}/watched` | POST |

Each of these:
- Reads `process.env.NEXT_PUBLIC_API_URL` inline (the client already does this).
- Builds an `Authorization: Bearer ${accessToken}` header by hand from `useAuth()`.
- Uses raw `fetch` rather than `fetchWithAuth`, so the single-flight token-refresh, the 401 → silent-refresh → retry flow, and the `onSessionExpired` propagation are all **skipped**. A user whose access token expires mid-session will silently fail on these endpoints while the rest of the app recovers transparently.
- Has no domain-typed error surface (no `*ApiError` class), so callers cannot distinguish `401` from `404` from `NetworkError` cleanly.

### Expected behavior
- Every call to the backend (other than `auth-api.ts`, which is intentionally excluded per Task 01) goes through `useApiClient()`.
- The `/me/badges`, comments, comment-like, and video-watched endpoints are reachable via domain-grouped namespaces on `ApiClient` (`client.account.*`, `client.comments.*`, `client.topics.*`).
- The affected components no longer read `NEXT_PUBLIC_API_URL`, no longer build `Authorization` headers, and no longer call `fetch` directly.
- Silent refresh and session-expired handling work uniformly across the app.

---

## Architectural Context

### Cloud-Agnostic / Ports & Adapters Alignment
- **Frontend-only** change. No backend route, controller, adapter, or DB migration is touched.
- Reinforces the boundary set up by Task 01: domain modules depend on `HttpTransport`, never on the global `fetch`.
- No new dependencies.

### Files in scope (web)
- **New / extended domain modules**
  - `apps/web/src/lib/account-api.ts` — add `getBadges()` (or introduce `me-api.ts` if `/me/*` warrants its own namespace; see Open Questions).
  - `apps/web/src/lib/comments-api.ts` — **new module** for `GET /topics/{id}/comments`, `POST /topics/{id}/comments`, `POST /comments/{id}/like`. Optionally also covers the existing `me/comments` admin/self routes — confirm during planning.
  - `apps/web/src/lib/topics-api.ts` — add `markVideoWatched(topicId, mediaId)`.
- **Client wiring**
  - `apps/web/src/lib/api-client.ts` — register the new `comments` namespace (and `me` namespace if introduced).
- **Migrated consumers**
  - `apps/web/src/app/(protected)/catalog/[id]/page.tsx`
  - `apps/web/src/components/catalog/Comments.tsx`
  - `apps/web/src/components/catalog/Discussion.tsx`
  - `apps/web/src/components/catalog/VideoPlayerWithPlaylist.tsx`

### Files explicitly out of scope
- `apps/api/**` — backend unchanged.
- `packages/shared/**` — shared types unchanged unless a new DTO is added (in which case prefer extending `Entities.*` over creating ad-hoc shapes).
- `apps/web/src/lib/auth-api.ts` — intentionally excluded; refresh path cannot depend on the client.
- `apps/web/src/lib/fetch-with-auth.ts` — kept as the underlying primitive.

---

## Requirements

### 1. Domain modules
- Each affected endpoint must live in a `createXxxApi(http: HttpTransport)` factory in `apps/web/src/lib/*-api.ts`, following the convention established in `account-api.ts`, `topics-api.ts`, etc.
- Methods accept **only business arguments** (`topicId`, `mediaId`, `commentText`, …). No `token`, no `accessToken`, no `headers`, no `API_URL`.
- A dedicated `*ApiError` class (with `code`, `status`, and a sensible `Code` union — at minimum `Unauthorized`, `NetworkError`, `NotFound`, `Unknown`) is exposed for callers that need to discriminate failures (Comments/Discussion currently swallow errors; preserve that behavior where appropriate but make richer handling possible).

### 2. `ApiClient` surface
- Register each new namespace as a getter in `ApiClient` (mirroring `get topics()`, `get account()`, etc.).
- The decision between adding to an existing namespace (e.g., `client.account.getBadges()`) vs. introducing a new one (e.g., `client.me.badges()` or `client.comments.*`) belongs to planning — see **Open Questions**. The PM's leaning is:
  - `comments-api.ts` as a **new module** (the comments domain is large enough — list, create, like, and the existing `me/comments` admin routes — to warrant its own namespace).
  - `/me/badges` added to **`account-api.ts`** under `client.account.getBadges()`, since `account-api.ts` already represents the authenticated user's own resources.
  - `markVideoWatched` added to **`topics-api.ts`**, since it is a child resource of a topic and `topics-api.ts` already owns `visit()`.

### 3. Consumer migration
- Each file in the table above must be rewritten to call `useApiClient()` and remove:
  - the local `API_URL` constant,
  - the manual `Authorization` header construction,
  - the direct `fetch` call.
- Components that currently destructure `accessToken` from `useAuth()` only to forward it into a `fetch` header must drop that destructure.
- `Discussion.tsx` currently gates rendering on `topic.parentId !== null && accessToken` (`apps/web/src/app/(protected)/catalog/[id]/page.tsx:182`); after the migration the `accessToken` gate is no longer needed (the client already carries auth) — collapse the condition to `topic.parentId !== null`.

### 4. Error surface preservation
- Existing user-visible behavior must not regress. Comments/Discussion silently no-op on failure today; that may stay, but the new error classes must be **available** so a follow-up can add richer UX without another refactor.
- The `/me/badges` endpoint currently soft-fails to an empty array on non-OK responses (`page.tsx:67-68`). Preserve that fallback in the page consumer; do **not** swallow errors inside the domain module — surface them via the error class and let the page decide.

### 5. Single-flight refresh
- All migrated endpoints must inherit `fetchWithAuth`'s 401 → silent-refresh → retry behavior and the single-flight refresh guarantee. This is automatic once they go through `HttpTransport`; the requirement is to **verify** in tests, not to re-implement.

---

## Technical Constraints

- **No new runtime dependencies.**
- **No backend changes.** Endpoint paths, methods, request bodies, and response shapes stay exactly as they are today.
- **Type safety.** All new domain methods are fully typed; DTOs reuse `Entities.*` from `packages/shared` where they already exist (e.g., `Comment`, `Media`, `Badge` — verify during planning whether the badge response DTO is already shared or only defined inline in `page.tsx:69`).
- **SSR/Edge runtime.** The catalog page is `runtime = 'edge'`; the new client methods must work on the edge runtime (they will, since they reuse `HttpTransport`).
- **Internationalization.** No new user-facing strings are expected; if any are introduced, follow the i18n convention from `CLAUDE.md` (dictionary in `dict-en.ts` and `dict-pt.ts`, no hardcoded strings).

---

## Scope

### Phases

**Phase A — Add domain modules and wire the client (additive)**
1. Decide the namespace placement (see **Open Questions**).
2. Create `comments-api.ts` with `createCommentsApi(http)` exporting `listForTopic(topicId)`, `createForTopic(topicId, body)`, `like(commentId)`.
3. Extend `account-api.ts` with `getBadges()` (or create `me-api.ts` if that decision flips).
4. Extend `topics-api.ts` with `markVideoWatched(topicId, mediaId)`.
5. Register new namespaces in `api-client.ts`.
6. Add unit tests per new module covering success, 401, network error, and (for comments) the like idempotency case.

**Phase B — Migrate the four consumers**
1. `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — replace the `/me/badges` fetch in the `Promise.all` with `client.account.getBadges()` (or `client.me.badges()`).
2. `apps/web/src/components/catalog/Comments.tsx` — replace both fetches with `client.comments.*`.
3. `apps/web/src/components/catalog/Discussion.tsx` — replace both fetches with `client.comments.*`; drop the `accessToken` prop and the `accessToken` gate on the parent page.
4. `apps/web/src/components/catalog/VideoPlayerWithPlaylist.tsx` — replace the `/watched` fetch with `client.topics.markVideoWatched(...)`.

**Phase C — Verification**
1. Run the static checks listed under **Verification Plan**.
2. Run `make lint`, `make test`, `make build`.
3. Manual smoke test the catalog (badge strip renders, comments list/post/like work, video watched event fires, expired-token recovery still works on these endpoints).

### What does NOT change
- Backend endpoint paths, methods, payloads, response shapes.
- The catalog UI/UX, badge rendering, comment-thread layout, video player.
- `AuthContext`'s public surface.
- `auth-api.ts`.

---

## Impact on Existing Tests

### Backend tests — **zero impact**
- `apps/api/test/**` is not affected.

### Frontend tests
- Any existing test that mocks `fetch` for `/me/badges`, `/topics/.../comments`, `/comments/.../like`, or `/topics/.../videos/.../watched` must be rewritten to mock `useApiClient` instead (same pattern Task 01 established for `stage-editor.test.tsx` and `student-task-detail.test.tsx`).
- During planning, grep these test files to enumerate the exact set:
  ```bash
  grep -rln "me/badges\|/comments\|/watched" apps/web/__tests__ apps/web/src/**/__tests__ 2>/dev/null
  ```

### New tests REQUIRED
1. **`comments-api.test.ts`** — list/create/like happy paths, 401 mapped to `Unauthorized`, network failure mapped to `NetworkError`.
2. **`account-api.test.ts`** (extend existing) — `getBadges()` happy path, soft-fail mapping (or page-level fallback test if the soft-fail stays in the page).
3. **`topics-api.test.ts`** (extend existing) — `markVideoWatched()` happy path and 401.
4. **One consumer regression test** — pick `Discussion.tsx` (highest fan-in) and assert it renders comments and posts a new one using the mocked client.

---

## Acceptance Criteria

- [x] `grep -rn "fetch(\`\${API_URL}\|process.env.NEXT_PUBLIC_API_URL" apps/web/src --include="*.tsx" --include="*.ts"` returns matches **only** in `auth-api.ts`, `api-client.ts`, and `fetch-with-auth.ts`.
- [x] `grep -rn "Authorization: \`Bearer" apps/web/src --include="*.tsx" --include="*.ts"` returns matches **only** in `auth-api.ts` and `fetch-with-auth.ts`.
- [x] `comments-api.ts` exists, exports `createCommentsApi(http)` and `CommentsApiError`, and is registered on `ApiClient` as `client.comments`.
- [x] `/me/badges` is reachable via `client.account.getBadges()` (or `client.me.badges()` if that route is chosen).
- [x] `topics-api.ts` exposes `markVideoWatched(topicId, mediaId)` and `VideoPlayerWithPlaylist` uses it.
- [x] The four consumer files no longer import `useAuth()` solely to read `accessToken`, no longer read `NEXT_PUBLIC_API_URL`, and no longer call `fetch` directly.
- [x] `apps/web/src/app/(protected)/catalog/[id]/page.tsx:182` no longer conditions on `accessToken` (collapsed to `topic.parentId !== null`).
- [x] All listed new tests exist and pass.
- [x] `make lint`, `make test`, `make build` pass.
- [ ] Manual smoke test: catalog topic page renders badges, comments list, posts, likes, and the video-watched event fires; force a 401 mid-session and confirm silent refresh now covers these endpoints (it does **not** today — this is a behavior fix, not just a structural one).

---

## Verification Plan

### Static checks
1. `grep -rn "fetch(\`\${API_URL}" apps/web/src --include="*.ts" --include="*.tsx"` — zero matches outside `auth-api.ts` / `fetch-with-auth.ts` / `api-client.ts`.
2. `grep -rn "NEXT_PUBLIC_API_URL" apps/web/src --include="*.ts" --include="*.tsx"` — zero matches outside `auth-api.ts` / `api-client.ts`.
3. `grep -rn "Bearer \${accessToken}\|Bearer \${token}" apps/web/src --include="*.ts" --include="*.tsx"` — zero matches outside `auth-api.ts` / `fetch-with-auth.ts`.

### Automated tests
- `make test-web` — new tests pass; rewritten tests pass.
- `make test-api` — unaffected, must still pass.
- `make lint`, `make build` — must pass.

### Manual verification (Browser)
1. Open a catalog topic with badges, comments, and a video.
2. Confirm badge strip renders, comments list loads, a new comment posts, a like toggles, the video reports `watched` when finished.
3. Forced-401 test: invalidate access token in devtools, trigger badge load / comments load / like / watched; confirm silent refresh succeeds and the request retries (this is a **new** capability for these endpoints — today they fail silently).
4. Session-expired test: clear the refresh-token cookie, trigger one of these calls, confirm the standard session-expired flow runs.

---

## Open Questions (resolve in planning)

1. **`/me/*` namespace** — does the codebase already trend toward a `me` namespace (the backend has `apps/api/src/routes/me/`), or should authenticated-user resources stay under `account-api.ts`? Recommendation: keep them under `account-api.ts` for now to avoid a one-method module; revisit if more `/me/*` endpoints land.
2. **Comments DTO** — is there an existing `Entities.Engagement.Comment` (or similar) in `packages/shared/types/entities.ts`? If yes, reuse it. If no, define the DTO in `comments-api.ts` and flag a follow-up to promote it to `packages/shared`.
3. **Like idempotency** — does the backend `POST /comments/{id}/like` toggle or only "like"? Confirm before naming the client method (`like` vs `toggleLike`).
4. **`me/comments` admin routes** — `apps/api/src/routes/me/comments.ts` already exists with `/comments/{id}/like` and `/comments/{id}`. Confirm the frontend uses these same paths and that `comments-api.ts` covers both surfaces (or split into `comments-api.ts` for public reads + `me-comments-api.ts` for self-mutations).

---

## Notes

- This task is the natural follow-up to Task 01. The earlier refactor closed the structural gap for **existing** API surfaces; this one closes the regressions introduced afterward and codifies the boundary so future PRs that reintroduce direct `fetch` calls are caught by the static checks in the **Verification Plan**.
- Consider adding the three `grep` commands from **Verification Plan** to a lint/CI gate (e.g., extend `check-i18n-coverage.js` or add a sibling `check-no-direct-fetch.js`) in a separate, very small follow-up task to prevent future drift. That gate is **out of scope** here but explicitly worth flagging.
