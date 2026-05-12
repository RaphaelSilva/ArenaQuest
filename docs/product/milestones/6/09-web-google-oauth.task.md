# Task 09: Web — Google OAuth Login

## Metadata
- **Status:** Completed
- **Complexity:** Small
- **Milestone:** 6 — Auth Self-Service & Social Login
- **Dependencies:**
  - M6 Task 08 — `GET /auth/google` and `GET /auth/google/callback` API endpoints must exist
  - M6 Task 07 — `FRONTEND_BASE_URL` binding must be configured (defines where the API redirects back)
  - M2 Task 07 — `AuthContext` and token-storage hooks must exist
  - M2 Task 08 — login page must exist

---

## Summary

Add a "Continue with Google" button to the login page and implement the OAuth callback page that receives the tokens from the API redirect and establishes the user session in the web app.

---

## Architectural Context

- **No client-side OAuth SDK:** the OAuth flow is entirely server-side (API handles PKCE and token exchange). The web app only initiates the redirect and receives the result — it never touches Google's endpoints directly.
- **Token handling:** the API redirects to `/auth/callback?accessToken=...&refreshToken=...`. The callback page reads these from the URL, stores them via the existing `AuthContext`, and redirects to `/dashboard`. URL params are cleared after consumption to avoid tokens lingering in browser history.
- **`NEXT_PUBLIC_API_URL`:** the "Continue with Google" button links to `{NEXT_PUBLIC_API_URL}/auth/google`. No new env var is needed.
- **Cloud-Agnostic:** no Google JS SDK, no `next-auth`. The web app is a thin redirect handler.

---

## Scope

### 1. Login Page Update — `src/app/(auth)/login/page.tsx`

- Add a visual divider (e.g., "or") between the existing email/password form and the new Google button.
- Add a "Continue with Google" button styled consistently with the existing design system.
- The button is an anchor (`<a>`) or a form with `method="GET"` pointing to `{NEXT_PUBLIC_API_URL}/auth/google`. It must perform a full-page navigation (not `fetch`) so the browser follows the redirect chain to Google and back.
- Show a loading indicator if the redirect takes more than ~500 ms (edge case on slow networks).

### 2. OAuth Callback Page — `src/app/(auth)/callback/page.tsx`

- Reads `accessToken` and `refreshToken` from URL search params.
- If either param is missing: show an error message with a link back to `/login`.
- If both are present: call the existing auth context's login/token-storage mechanism to establish the session, then redirect to `/dashboard`.
- Clear the tokens from the URL (use `router.replace('/dashboard')`) immediately after storing them so they do not appear in browser history or be visible if the user inspects the URL bar.
- Show a loading/spinner state while storing and redirecting.

### 3. Navigation / UX Consistency

- The callback page is part of the `(auth)` layout group (no sidebar, same centered card layout as login).
- No change to the `(protected)` layout or navigation is required for this task.

---

## Acceptance Criteria

- [x] The login page renders a "Continue with Google" button below the existing form.
- [x] Clicking the button navigates to the API OAuth redirect endpoint (full-page navigation, not XHR).
- [x] After successful Google auth, the user lands on `/dashboard` with a valid session (the auth context contains `user`, `accessToken`; refresh token is stored as HttpOnly cookie by the API).
- [x] After the redirect, `accessToken` does not appear in the browser URL bar or history (router.replace clears it).
- [x] Navigating to `/auth/callback` without valid params shows an error with a link to `/login`.
- [x] The Google button and callback page are consistent with the existing design system (fonts, colours, spacing).
- [x] `make lint` passes (TypeScript strict mode).

---

## Verification Plan

### Automated
- Add a component test for the callback page: renders spinner → stores tokens → redirects (mock `useRouter` and auth context).
- Existing login page tests must continue to pass.

### Manual
- Start `make dev`, navigate to `/login`, click "Continue with Google", complete the Google auth flow, confirm landing on `/dashboard` with the user's name shown in the nav.
- Open browser DevTools → Application → Cookies/Local Storage; confirm tokens are stored and not in the URL.
