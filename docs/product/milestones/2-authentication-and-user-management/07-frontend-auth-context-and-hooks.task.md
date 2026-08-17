# Task 07: Frontend — Auth State (Context + Hooks)

## Metadata
- **Status:** Complete
- **Complexity:** Medium
- **Milestone:** 2 — Authentication & User Management
- **Dependencies:** `docs/product/milestones/2/04-expose-auth-http-endpoints.task.md`

---

## Summary

Implement the client-side authentication state layer for `apps/web` (Next.js). This includes:

1. An `AuthContext` that holds the current user and provides `login` / `logout` / `refresh`
   actions.
2. Custom hooks (`useAuth`, `useCurrentUser`) for consuming auth state in components.
3. A server-side token-refresh mechanism via Next.js middleware to silently rotate access
   tokens before they expire.

---

## Technical Constraints

- **Provider Independence:** The `AuthContext` talks to the API via a thin `authApi` service
  module (`apps/web/src/lib/auth-api.ts`) — no `fetch` calls scattered in components. If
  the API URL changes, one file changes.
- **Access Token Storage:** Store the short-lived access token **in-memory** (React state)
  only — never in `localStorage` or a cookie from the client side. The refresh token is an
  `HttpOnly` cookie set by the API server, so the browser handles it automatically.
- **Token Transparency:** Components never see the raw JWT string — they interact with the
  decoded `User` object from `AuthContext`.
- **Shared Types:** Import `Entities.Identity.User` and `RoleName` from `@arenaquest/shared`
  so types remain consistent with the API.

---

## Scope

### 1. `authApi` service — `apps/web/src/lib/auth-api.ts`

```ts
export const authApi = {
  login(email: string, password: string): Promise<{ accessToken: string; user: User }>;
  logout(): Promise<void>;
  refresh(): Promise<{ accessToken: string } | null>; // null = not authenticated
};
```

Calls `NEXT_PUBLIC_API_URL/auth/*`. Uses `credentials: 'include'` so the HttpOnly
refresh-token cookie is sent automatically.

### 2. `AuthContext` — `apps/web/src/context/auth-context.tsx`

```ts
interface AuthContextValue {
  user: Entities.Identity.User | null;
  accessToken: string | null;
  isLoading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}
```

On mount, calls `authApi.refresh()` to restore the session from the existing cookie.

### 3. Hooks — `apps/web/src/hooks/use-auth.ts`

- `useAuth()` — returns full `AuthContextValue`.
- `useCurrentUser()` — returns just the `User | null`.
- `useHasRole(role: RoleName)` — returns `boolean`.

### 4. Environment Variable

`NEXT_PUBLIC_API_URL` must be documented in `apps/web/.env.example`.

---

## Acceptance Criteria

- [x] After a successful `login()`, `useCurrentUser()` returns the logged-in user in any
  component tree wrapped by `<AuthProvider>`.
- [x] After `logout()`, `useCurrentUser()` returns `null` and the refresh-token cookie is
  cleared.
- [x] On page reload, `AuthContext` calls `authApi.refresh()` on mount and restores the
  session if the cookie is still valid.
- [x] `authApi` calls include `credentials: 'include'`.
- [x] Unit tests in `apps/web/__tests__/context/auth-context.test.tsx` cover:
  - Successful login sets user state.
  - Failed login (`401`) leaves user as `null` and re-throws.
  - Logout clears user state.
  - Tests use **mock implementations** of `authApi` (no real HTTP).
- [x] `pnpm --filter web test` — green.
- [ ] TypeScript compiles with `pnpm --filter web build` — no type errors.

---

## Verification Plan

1. `pnpm --filter web test` — green.
2. Manual: Start both `apps/api` (wrangler dev) and `apps/web` (next dev).
   - Log in via the login page (Task 08) → refresh the page → user remains logged in.
   - Click logout → user is cleared.
3. In browser DevTools → Application → Cookies: confirm `refresh_token` is `HttpOnly`.
