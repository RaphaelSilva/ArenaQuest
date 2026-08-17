# Task 08: Google OAuth API Endpoints

## Metadata
- **Status:** Completed
- **Complexity:** Medium
- **Milestone:** 6 — Auth Self-Service & Social Login
- **Dependencies:**
  - M6 Task 06 — `IOAuthAccountRepository` must exist
  - M6 Task 07 — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` bindings must exist
  - M2 Task 01 — `IUserRepository` (create + findByEmail) must exist
  - M2 Task 02 — role seeding (`student` role ID) must exist
  - M2 Task 03 — `AuthService.issueTokens` (or equivalent JWT + refresh token issuance) must exist
  - M3-extends (login) Task 01 — `RATE_LIMIT_KV` binding must exist (reuse for `state` nonce storage)

---

## Summary

Implement the two server-side OAuth 2.0 endpoints for Google login:

1. `GET /auth/google` — initiates the PKCE flow by generating a `state` nonce, storing it in KV, and redirecting to Google's authorization endpoint.
2. `GET /auth/google/callback` — validates the `state`, exchanges the authorization code for a Google ID token, resolves the local user account, and issues ArenaQuest JWT + refresh token before redirecting to the web app.

---

## Architectural Context

- **PKCE:** `code_verifier` and `code_challenge` must be generated using Web Crypto API (`crypto.getRandomValues`, `crypto.subtle.digest`). No external OAuth library.
- **State nonce:** stored in `RATE_LIMIT_KV` with a short TTL (5 minutes). Key pattern: `oauth:state:{nonce}`. Reuses the existing KV binding rather than introducing a new one.
- **Token exchange:** performed via a standard `fetch` to Google's token endpoint (`https://oauth2.googleapis.com/token`) — a plain HTTPS call, no SDK.
- **ID token:** the `sub`, `email`, and `name` claims are read directly from the JWT payload (base64-decode the middle segment). No signature verification is needed when the token is obtained directly from Google's token endpoint over HTTPS.
- **No provider SDK:** the entire flow uses Web Crypto + `fetch`. This keeps the Worker dependency-free and cloud-agnostic.
- **Cloud-Agnostic:** PKCE + HTTPS token exchange is a standard OAuth 2.0 protocol. Any serverless runtime that supports `fetch` and Web Crypto can run this code.

---

## Scope

### 1. `GET /auth/google` — Initiate Flow

- Generate a cryptographically random `state` nonce.
- Generate a `code_verifier` (random, URL-safe base64, min 43 chars) and derive `code_challenge` (SHA-256 hash, base64url-encoded).
- Store `{ codeVerifier }` in KV under key `oauth:state:{state}` with a 5-minute TTL.
- Construct Google's authorization URL with: `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile`, `state`, `code_challenge`, `code_challenge_method=S256`.
- Return an HTTP redirect (`302`) to Google's authorization URL.

### 2. `GET /auth/google/callback` — Handle Callback

**Step 1 — Validate state:**
- Read `state` and `code` from query params. If either is missing → `400`.
- Look up `oauth:state:{state}` in KV. If not found or expired → `400` (CSRF protection).
- Retrieve `codeVerifier` from the KV value, then delete the KV entry.

**Step 2 — Exchange code for tokens:**
- POST to `https://oauth2.googleapis.com/token` with `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`, `code`, `code_verifier`.
- On failure → `400` with an appropriate error.
- Extract `id_token` from the response.

**Step 3 — Parse identity:**
- Base64url-decode the payload segment of `id_token`.
- Extract `sub` (provider user ID), `email`, and `name`.

**Step 4 — Resolve local user (account upsert):**
- Call `IOAuthAccountRepository.findUserByProvider("google", sub)`.
- If found → use the existing local user.
- If not found: call `IUserRepository.findByEmail(email)`.
  - If an active user exists → call `IOAuthAccountRepository.link(...)` to associate; use that user.
  - If no user exists → call `IUserRepository.create(...)` with `status: active`, `name` from Google, no `password_hash` (set a sentinel empty value); assign `student` role; call `IOAuthAccountRepository.link(...)`.

**Step 5 — Issue tokens and redirect:**
- Call `AuthService.issueTokens(user)` (or equivalent) to generate an ArenaQuest access token + refresh token.
- Redirect to `{FRONTEND_BASE_URL}/auth/callback?accessToken={...}&refreshToken={...}`.
  - Alternatively, set `HttpOnly` cookies and redirect to `/dashboard` — choose whichever approach is consistent with the existing auth flow.

### 3. Router

Register both routes in a new `apps/api/src/routes/oauth.router.ts` and mount it in `apps/api/src/routes/index.ts`. Both are public (no auth guard).

---

## Acceptance Criteria

- [x] `GET /auth/google` returns a redirect to `accounts.google.com/o/oauth2/v2/auth` with the correct query params including `code_challenge`.
- [x] A replayed or forged `state` in the callback returns `400`.
- [x] A missing `state` or `code` in the callback returns `400`.
- [x] A new Google user is provisioned as `status: active`, `role: student`.
- [x] An existing email-based user who signs in with Google has their Google identity linked and their existing roles preserved.
- [x] A returning Google user (already linked) is authenticated without creating a new account.
- [x] After a successful callback, the web app receives valid tokens (access + refresh).
- [x] No `GOOGLE_CLIENT_SECRET` is ever returned in a response body or logged.
- [x] `make lint` and `make test` pass.

---

## Verification Plan

### Automated
- Unit tests for state generation, PKCE derivation, and account resolution logic (mock KV and repositories).
- Integration test for the callback with a mocked Google token endpoint response.

### Manual
- End-to-end: start `make dev`, click "Continue with Google" on the login page, complete Google auth, confirm redirect to `/dashboard` with a valid session.
