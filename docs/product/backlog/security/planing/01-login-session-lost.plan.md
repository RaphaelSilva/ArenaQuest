# Plan — 01-login-session-lost

**Task:** [01-login-session-lost.task.md](../01-login-session-lost.task.md)
**Source:** Backlog
**Assigned personas:** frontend-developer
**Branch:** feature/backlog/01-login-session-lost.task (from develop)

## Objective

Implement a centralized request interceptor that silently refreshes the access token when any API call receives a 401 Unauthorized response. On successful refresh, retry the original request with the new token. On refresh failure, clear auth state and redirect to `/login` without surfacing stale error messages to the user. Also handle concurrent 401s to issue only one refresh call.

## Affected areas

**New files:**
- `apps/web/src/lib/fetch-with-auth.ts` — centralized fetch wrapper with 401 interception and retry logic

**Modified files:**
- `apps/web/src/context/auth-context.tsx` — expose `refreshSession()` method, add `onSessionExpired()` handler, store in-flight refresh promise to serialize concurrent 401s
- `apps/web/src/lib/topics-api.ts` — replace fetch calls with `fetchWithAuth`
- `apps/web/src/lib/tasks-api.ts` — replace fetch calls with `fetchWithAuth`
- `apps/web/src/lib/users-api.ts` — replace fetch calls with `fetchWithAuth`
- `apps/web/src/lib/media-api.ts` — replace fetch calls with `fetchWithAuth`
- `apps/web/src/lib/auth-api.ts` — no changes (already used for refresh)
- `apps/web/src/components/auth/__tests__/auth.test.tsx` — add unit tests for new `refreshSession` method and `fetchWithAuth` behavior

**Out of scope:**
- Backend changes (refresh endpoint already exists)
- Changes to `(protected)/layout.tsx` load-time redirect

## Step-by-step

### Frontend

1. **Create `fetch-with-auth.ts`** — A utility function that wraps fetch with 401 + retry logic:
   - Accept parameters: `url`, `options`, `accessToken`, `refreshFn`, `onTokenUpdate`, `onSessionExpired`
   - Execute the fetch request
   - If response is 401:
     - Call `refreshFn()` once (e.g., `authApi.refresh()`)
     - If refresh returns a new token: call `onTokenUpdate(newToken)`, retry the original request with the new token in Authorization header, return the retry response
     - If refresh returns null/fails: call `onSessionExpired()`, don't retry, let the caller handle the failed response or undefined
   - If response is not 401: return response as-is
   - **Concurrency guard:** Store the in-flight refresh promise at module scope (e.g., `let refreshPromise: Promise<string | null> | null = null`). When 401 occurs, check if `refreshPromise` is already pending. If yes, await that promise instead of calling `refreshFn` again. If no, start a new refresh and update `refreshPromise`, clearing it when done.

2. **Extend `AuthContext`** in `auth-context.tsx`:
   - Add `refreshSession(): Promise<string | null>` method that:
     - Calls `authApi.refresh()`
     - On success: update `accessToken` and `user` state, return the new token
     - On failure: clear `user` and `accessToken` state, return `null`
   - Add `onSessionExpired()` method (or inline in `fetchWithAuth` callback) that:
     - Clears `user` and `accessToken` state
     - Calls `router.replace('/login')` to redirect without history entry
   - Pass both to `fetchWithAuth` as callbacks from all API client call sites

3. **Update all protected API clients** (`topics-api.ts`, `tasks-api.ts`, `users-api.ts`, `media-api.ts`):
   - **Identify** all fetch calls that include `Authorization: Bearer <accessToken>` header
   - **Replace** with calls to `fetchWithAuth()`, passing:
     - Current `accessToken` from context/props
     - `refreshFn`: `() => authContext.refreshSession()`
     - `onTokenUpdate`: `(token) => authContext.setAccessToken(token)` or similar
     - `onSessionExpired`: `() => authContext.onSessionExpired()`
   - **Preserve** the public API of each client function (no signature changes)

4. **Add tests** in `apps/web/src/components/auth/__tests__/auth.test.tsx` (or new file if preferred):
   - Test `fetchWithAuth` happy path: 200 response → returns response
   - Test `fetchWithAuth` 401 → refresh success → retry success: verify token is updated and original request is retried
   - Test `fetchWithAuth` 401 → refresh failure → `onSessionExpired` called: verify user is cleared
   - Test concurrent 401s: two simultaneous fetch calls with 401 → verify only one refresh call is issued
   - Test existing `refreshSession()` method on AuthContext (if not covered already)

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Silent token refresh on 401 before error shown | 1, 3 | frontend | Network tab shows refresh call before retry |
| If refresh succeeds, original request retried with no visible error | 1, 3 | frontend | Browser test: data loads normally |
| If refresh fails, redirect to /login with no stale errors | 1, 2, 3 | frontend | Browser test: clear cookie → API call → redirected to /login |
| Concurrent 401s trigger exactly one refresh | 1 | frontend | Unit test: verify refresh promise concurrency guard |
| AuthContext accessToken updated after refresh | 2, 3 | frontend | Unit test + browser test: subsequent requests use new token |
| (protected)/layout.tsx redirect remains intact | — | — | Manual verify: load-time guard still works |
| make lint passes | All | frontend | `make lint` |
| No regressions in login/logout/registration | 4 | frontend | Browser test: existing flows still work |

## Risks & open questions

- **Concurrent refresh timing:** If two requests hit 401 simultaneously, both must await a single refresh call. The in-flight promise at module scope must be cleared only after the first consumer reads it, not prematurely. Implementation: store the promise, resolve it once, reuse until cleared.
- **Circular refreshes:** If the refresh endpoint itself returns 401 (should not happen, but defensive), ensure we don't retry the refresh. Add a flag `isRefreshRequest` to the fetch options to skip retry for refresh calls.
- **Router availability:** `router.replace('/login')` must be available in the context where `onSessionExpired` is called. Since AuthContext is a React context, router must be from Next.js `useRouter()` hook, which is available in client components. Verify no SSR issues.
- **Session state races:** Between token refresh and retry, ensure no race where the old token is still used. The new token must be written to state *before* the retry fetch is issued.

## Verification

- **Backend:** No changes required; refresh endpoint already exists.
- **Frontend:**
  - `make lint` — all files pass TypeScript and eslint
  - `make test-web` — unit tests pass (new `fetchWithAuth` tests + `AuthContext` refresh tests)
  - **Browser walkthrough on `make dev-web`:**
    1. Log in, wait for access token to expire (or mock expiry in DevTools)
    2. Navigate to a protected page (e.g., `/catalog`) — data should load without error banner
    3. Network tab shows `POST /auth/refresh` before the retried request
    4. Clear refresh-token cookie in DevTools → perform API action → redirected to `/login` with no stale error
    5. Log in again, navigate, log out explicitly — verify logout still works and doesn't trigger refresh path
    6. Test concurrent requests (use DevTools throttling to slow network, trigger two API calls simultaneously, observe only one refresh)

## Out of scope

- Backend changes (refresh endpoint already exists)
- Changes to `(protected)/layout.tsx` load-time redirect guard
- Auth UI changes (login, logout, registration pages remain as-is)
