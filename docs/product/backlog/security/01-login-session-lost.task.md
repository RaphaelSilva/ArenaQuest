# Task: Session Expiry — Silent Token Refresh and Login Redirect

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Priority:** High
- **Category:** Security / Authentication
- **Dependencies:** None

---

## Summary

When a user's access token expires mid-session, every subsequent API call returns `401 Unauthorized`, resulting in visible "Failed to load …" errors across the UI. The application has no mechanism to silently attempt a token refresh before surfacing the error, and no mechanism to redirect the user to `/login` when the session is fully expired.

This task implements a centralized request interceptor that:
1. Attempts a silent token refresh on the first `401` response.
2. Retries the original request with the new access token if the refresh succeeds.
3. Clears auth state and redirects to `/login` if the refresh also fails.

---

## Problem Statement

**Current behaviour:**
- `AuthContext` calls `authApi.refresh()` once on mount to restore the session from the HttpOnly refresh-token cookie.
- After that, no refresh is attempted during normal navigation.
- When the access token expires, every protected API call (topics, tasks, users, media, etc.) receives a `401` and throws an error that propagates to the component, displaying raw network error banners.

**User impact:**
- Users see multiple "Failed to load" error messages without context.
- There is no graceful recovery path — the user must manually navigate to `/login` or reload the page.
- Silent refresh is already supported by the backend (`POST /auth/refresh`), so the infrastructure exists but is unused mid-session.

---

## Architectural Context

### Cloud-Agnostic Approach
- The fix is entirely within the frontend (`apps/web`). No backend changes required.
- The `authApi.refresh()` call uses the HttpOnly cookie mechanism already in place — no provider-specific logic introduced.
- The interceptor must live in a shared utility so no individual API client needs to be modified. All API clients already receive `accessToken` from `AuthContext`; the interceptor wraps the native `fetch` calls they make.

### Current Auth Flow (relevant files)
- `apps/web/src/context/auth-context.tsx` — holds `accessToken` in React state; exposes `login`, `logout`, `loginWithAccessToken`.
- `apps/web/src/lib/auth-api.ts` — `authApi.refresh()` returns `{ accessToken }` or `null` on failure.
- `apps/web/src/app/(protected)/layout.tsx` — redirects to `/login` only at load time if `user === null`.
- All protected API libs (`topics-api.ts`, `tasks-api.ts`, etc.) call the backend with a `Bearer` token from `AuthContext`.

---

## Scope

### 1. Centralized `fetchWithAuth` Utility
Create a shared fetch wrapper in `apps/web/src/lib/fetch-with-auth.ts` that:
- Accepts the current `accessToken` and a `refreshFn` callback (which calls `authApi.refresh()`).
- Executes the original fetch request.
- On `401` response: calls `refreshFn` once to obtain a new token.
  - If refresh succeeds: stores the new token (via a provided setter) and retries the original request exactly once with the new token.
  - If refresh fails: calls a provided `onSessionExpired` callback (which clears auth state and redirects to `/login`).
- On any other non-401 error: re-throws as-is (no change in current error handling).

### 2. Expose Refresh Capability from `AuthContext`
Extend `AuthContextValue` in `auth-context.tsx` to expose a `refreshSession(): Promise<string | null>` method that:
- Calls `authApi.refresh()`.
- On success: updates `accessToken` and `user` state in context and returns the new token.
- On failure: clears `user` and `accessToken` state and returns `null`.

### 3. Session-Expired Redirect
In `AuthContext`, add an `onSessionExpired` handler that:
- Clears `user` and `accessToken` state.
- Calls `router.replace('/login')` so the user is redirected without leaving a history entry.

The `(protected)/layout.tsx` redirect remains as-is (load-time guard). The new mechanism handles mid-session expiry.

### 4. Wire `fetchWithAuth` into API Clients
Replace the direct `fetch` calls that use `Authorization: Bearer` headers in all protected API client files with the new `fetchWithAuth` wrapper. API clients receive `accessToken` and the new context callbacks via their existing call-site pattern.

> **Do not** change the public signatures of API client functions — only replace the internal fetch transport.

---

## Technical Constraints

- **No new external libraries.** Use only native `fetch`, React context, and Next.js router.
- **Single refresh attempt per request.** The interceptor must not enter a retry loop; one refresh → one retry → fail is the allowed depth.
- **Concurrent 401s.** If multiple requests fail simultaneously, only one refresh call should be issued. A shared in-flight promise (e.g., stored in a module-level variable or ref) prevents multiple parallel refresh calls racing.
- **No access token persistence.** The access token lives only in React state (memory). The refresh token lives in an HttpOnly cookie managed by the browser — the frontend never reads it.
- **Cloud-agnostic.** No Cloudflare-specific APIs used. The solution must work identically if the backend were moved to another provider.

---

## Acceptance Criteria

- [ ] When the access token expires mid-session, the next API call triggers a silent `POST /auth/refresh` before any error is shown to the user.
- [ ] If the refresh succeeds, the original request is retried and the UI receives the expected data with no visible error.
- [ ] If the refresh fails (expired or missing refresh-token cookie), the user is redirected to `/login` with no stale "Failed to load" errors displayed.
- [ ] Concurrent expired-token requests trigger exactly one refresh call, not N parallel calls.
- [ ] The `AuthContext` `accessToken` state is updated with the new token after a successful refresh so subsequent requests use it immediately.
- [ ] The `(protected)/layout.tsx` load-time redirect remains intact and unmodified.
- [ ] `make lint` passes with no errors.
- [ ] No regressions in existing login, logout, and registration flows.

---

## Verification Plan

### Manual Testing
1. **Silent refresh happy path:**
   - Log in and wait for (or artificially expire) the access token.
   - Navigate to any protected page — data should load normally without any error banner.
   - Confirm a `POST /auth/refresh` call was made in the browser Network tab before the retried request.

2. **Expired session redirect:**
   - Clear the refresh-token cookie (browser DevTools → Application → Cookies).
   - Perform an action that triggers an API call.
   - Confirm the user is redirected to `/login` with no "Failed to load" error displayed.

3. **Concurrent requests:**
   - Engineer a scenario (or write a unit test) where two API calls fire simultaneously with an expired token.
   - Confirm only one `POST /auth/refresh` request appears in the Network tab.

4. **Normal logout flow:**
   - Confirm that logging out explicitly still works and does not trigger the refresh path.

### Automated Tests
- Unit tests for `fetchWithAuth` covering: normal success, 401 → refresh success → retry success, 401 → refresh failure → `onSessionExpired` called.
- Update or add tests in `apps/web/src/components/auth/__tests__/auth.test.tsx` to cover the new `refreshSession` method on `AuthContext`.
