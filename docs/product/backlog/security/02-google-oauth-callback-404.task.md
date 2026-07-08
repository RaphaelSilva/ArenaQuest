# Task: Google OAuth Callback — Route Mismatch Causes 404

## Metadata
- **Status:** ✅ Done
- **Complexity:** Small
- **Priority:** Critical
- **Category:** Security / Authentication
- **Dependencies:**
  - M6 Task 08 — Google OAuth API Endpoints (✅ Done)
  - M6 Task 09 — Web: Google OAuth Login (✅ Done)

---

## Summary

After a successful Google OAuth authentication, the API redirects the browser to `<WEB_BASE_URL>/auth/callback?accessToken=…`. This URL returns a **404 Not Found** on the frontend because the callback page is registered at the wrong filesystem path inside the Next.js App Router, resulting in a route that does not include the `/auth/` prefix.

This is a **production-blocking regression** that prevents any user from completing the Google Login flow in both local and staging environments.

---

## Problem Statement

**Current behaviour:**
- The API's `GoogleOAuthController.handleCallback()` builds the redirect URL as `${webBaseUrl}/auth/callback?accessToken=…` (see `apps/api/src/controllers/google-oauth.controller.ts`, line 140).
- The OAuth route handler (`apps/api/src/routes/auth/oauth.google.ts`, line 74) issues an HTTP 302 redirect to that URL.
- The browser follows the redirect and requests `http://localhost:3000/auth/callback?accessToken=…`.
- The frontend returns **404 Not Found**.

**Root cause:**
- The callback page lives at `apps/web/src/app/(auth)/callback/page.tsx`.
- In Next.js App Router, parenthesised folder names (e.g., `(auth)`) are **Route Groups** — they are stripped from the URL path. They exist solely for layout organisation.
- Therefore, the actual URL served by this page is `/callback`, **not** `/auth/callback`.
- The API expects `/auth/callback`, but the frontend only serves `/callback`. The two disagree, and the redirect lands on a non-existent route.

**User impact:**
- Google OAuth login is completely broken. After authenticating with Google, the user sees a browser 404 page instead of being redirected to the dashboard.
- This affects both local development and staging environments.

---

## Architectural Context

### Cloud-Agnostic Approach
- The fix is entirely within the frontend (`apps/web`). No backend or adapter changes are required.
- The API redirect target (`/auth/callback`) is correct by convention and matches all existing documentation, tests, and the task specification (M6 Task 09).
- The fix must not introduce any provider-specific logic.

### Affected Files
- `apps/web/src/app/(auth)/callback/page.tsx` — the current (incorrect) location of the OAuth callback page.
- The page component code itself is correct. Only its filesystem location within the Next.js App Router is wrong.

### Why the Frontend Route Must Change (Not the API)
- The API redirect URL (`/auth/callback`) is referenced in multiple places: the controller, the router tests, the OAuth setup documentation, and the M6 task specifications.
- The `/auth/` prefix is an intentional URL namespace that logically groups authentication-related pages.
- Changing the API to redirect to `/callback` instead would break the established convention and require updating tests, documentation, and environment configuration.

---

## Scope

### 1. Move the Callback Page to the Correct Route

Relocate the callback page from its current location to a path that resolves to `/auth/callback` under the Next.js App Router conventions.

The page must continue to live within the `(auth)` route group so it inherits the authentication layout (fonts, centred card, no sidebar). The page component code itself requires no changes — only its directory path needs to change.

### 2. Verify Route Resolution

After the move, confirm that the Next.js dev server correctly serves the page at `http://localhost:3000/auth/callback` and that the old path (`/callback`) no longer resolves.

---

## Technical Constraints

- **No backend changes.** The API redirect URL is correct and must not be modified.
- **Layout inheritance preserved.** The moved page must remain within the `(auth)` route group to inherit its layout (fonts, no sidebar).
- **No new dependencies.** This is a pure filesystem reorganisation.
- **Cloud-agnostic.** No provider-specific logic introduced.

---

## Acceptance Criteria

- [x] Navigating to `http://localhost:3000/auth/callback?accessToken=<valid_token>` stores the session and redirects to `/dashboard` (no 404).
- [x] Navigating to `http://localhost:3000/auth/callback` without a valid token shows the error UI with a link to `/login`.
- [x] The callback page inherits the `(auth)` route group layout (fonts, centred card styling).
- [x] The previous URL path (`/callback`) no longer resolves (returns 404).
- [x] The full Google OAuth login flow works end-to-end: click "Continue with Google" → authenticate with Google → land on `/dashboard` with a valid session.
- [x] `make lint` passes with no errors.
- [x] Existing callback page tests (if any) continue to pass after updating import paths.

---

## Verification Plan

### Manual Testing
1. **End-to-end Google OAuth flow:**
   - Start `make dev` (both API and web).
   - Navigate to `/login`, click "Continue with Google".
   - Complete Google authentication.
   - Confirm the browser lands on `/dashboard` with the user's name displayed — no 404 at any step.

2. **Missing token error path:**
   - Navigate directly to `http://localhost:3000/auth/callback` (no query params).
   - Confirm the error message is displayed with a link back to `/login`.

3. **Old route no longer exists:**
   - Navigate to `http://localhost:3000/callback`.
   - Confirm a 404 is returned.

### Automated Tests
- Run `make test` to confirm no regressions in existing web tests.
- Update any test import paths if they reference the old file location.
