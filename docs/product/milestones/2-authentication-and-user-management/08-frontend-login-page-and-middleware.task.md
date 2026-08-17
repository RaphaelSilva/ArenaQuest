# Task 08: Frontend — Login Page & Route Protection Middleware

## Metadata
- **Status:** Complete
- **Complexity:** Medium
- **Milestone:** 2 — Authentication & User Management
- **Dependencies:** `docs/product/milestones/2/07-frontend-auth-context-and-hooks.task.md`

---

## Summary

Build the Login page UI and implement Next.js Edge Middleware to protect internal routes.
Unauthenticated users are redirected to `/login`; authenticated users trying to visit
`/login` are redirected to their home page.

---

## Technical Constraints

- **No Server-Side Secrets in Client Code:** The Next.js middleware reads only the
  `refresh_token` cookie presence (not its value) to decide whether a session might exist.
  Full token verification happens server-side via API calls, not in middleware.
- **Edge-Compatible:** `apps/web/middleware.ts` must use only Edge-compatible APIs
  (no `node:*` modules). It must work with both Cloudflare Pages and Vercel Edge.
- **Context Pattern:** The login form uses `useAuth()` from Task 07 — no direct `fetch`
  in components.
- **UX:** Show a loading spinner during the initial session restore (while `isLoading` is
  `true` in `AuthContext`).

---

## Scope

### 1. Login Page — `apps/web/src/app/(auth)/login/page.tsx`

Fields:
- Email (`<input type="email">`)
- Password (`<input type="password">`)
- Submit button — shows spinner when `isLoading`

On success: redirect to `/dashboard`.
On failure (401): display inline error message "Invalid email or password."

### 2. Next.js Middleware — `apps/web/src/middleware.ts`

```ts
export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
};

export function middleware(request: NextRequest) {
  const hasRefreshCookie = request.cookies.has('refresh_token');
  if (!hasRefreshCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}
```

> Note: The middleware only gate-keeps on cookie presence. The API will return `401` if the
> cookie is invalid/expired, and the React auth context handles that case by redirecting to
> `/login`. This avoids duplicating JWT verification in the Edge runtime.

### 3. Protected Layout — `apps/web/src/app/(protected)/layout.tsx`

A React layout that wraps all protected pages. On mount it calls `useAuth()` and, if
`user === null` after loading, redirects to `/login` via `router.replace`.

This is the client-side second line of defence (after the Edge middleware).

---

## Acceptance Criteria

- [x] Visiting `/dashboard` without a cookie redirects to `/login` (Edge middleware).
- [x] Visiting `/login` when already authenticated redirects to `/dashboard`.
- [x] Login form shows a validation error for empty fields (client-side).
- [x] Login form shows "Invalid email or password" on `401` from the API.
- [x] Successful login redirects to `/dashboard` and the user's name is visible in the nav.
- [x] Component tests in `apps/web/__tests__/app/(auth)/login.test.tsx` cover:
  - Renders email/password fields.
  - Calls `useAuth().login()` on submit with correct arguments.
  - Displays error message on login failure.
  - Uses `jest-dom` matchers and React Testing Library.
- [x] `pnpm --filter web test` — green.

---

## Verification Plan

1. `pnpm --filter web test` — green.
2. Manual flow:
   - Open `/dashboard` in incognito → redirected to `/login`.
   - Log in with wrong password → error message shows.
   - Log in with correct credentials → reach `/dashboard`.
   - Reload → still on `/dashboard` (session restored from cookie).
3. DevTools → Network: login `POST /auth/login` returns 200 with `Set-Cookie` header.
