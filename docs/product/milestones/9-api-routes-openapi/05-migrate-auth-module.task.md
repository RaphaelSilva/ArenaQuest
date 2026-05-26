# Task 05 — Migrate `/auth` module: login, register, activate, password, OAuth (F5)

**Status:** 📝 Draft
**Milestone:** [9 — `apps/api` Route Reorganization and OpenAPI Adoption](./milestone.md)
**RFC:** [0003 §4.1 and §5 — F5](../../RFCs/0003-apps-api-route-organization-and-openapi.md)

## Summary

Consolidate the two routers currently mounted at `/auth` (`buildAuthRouter` and `buildOAuthRouter`) into a single declarative sub-app under `apps/api/src/routes/auth/**`. Cover login, refresh, logout, register, activate, password reset/change, and Google OAuth. Each endpoint becomes an OpenAPI-described route using the envelope helpers. Path parity is required (still no `/v1`); cookies, rate limiter wiring, and refresh-token semantics are preserved bit-for-bit.

## Dependencies

Depends on Tasks 01, 02, 03. Can run in parallel with F4, F6, F7 once F3 is merged. Strongly recommended to land after F4 so the new pattern is validated against the lower-risk public domain first.

## Technical Constraints

- **Scope guardrail:** new files under `apps/api/src/routes/auth/**`. Removal of `apps/api/src/routes/auth.router.ts` and `oauth.router.ts` (or their current filenames) after the migration. The `routes/index.ts` mount collapses two entries into one. **No changes** to controllers, the JWT adapter, the rate limiter adapters, or `AuthService`.
- **Cookie behaviour preserved:** `SameSite`, `Secure`, `HttpOnly`, `Path`, expiry, and rotation semantics for refresh tokens must remain identical. The PR description must call this out explicitly and link to the specs that cover it.
- **Rate-limiter wiring preserved:** the `loginLimiter`, `registerLimiter`, `activateLimiter`, `forgotPasswordLimiter` apply on the exact same paths and with the same `key` derivation. They are passed via the `infra.rateLimiters` slice of the `AppContainer`.
- **OAuth callback URL parity:** Google OAuth callback continues to resolve at the same path as today. If the legacy path was `/auth/google/callback`, the new path stays `/auth/google/callback` (not `/v1/...`).
- Every route declares a `security` block (`[]` for public auth bootstrap routes, `[{ bearerAuth: [] }]` for the authenticated ones like `POST /auth/logout`).
- The `ValidationErrorBody` envelope replaces any ad-hoc 400 shape today — confirm no client (web or mobile) depends on the legacy error wording before merging; if any does, document the migration of that consumer in the PR.

## Scope

In:
- Create `apps/api/src/routes/auth/index.ts` aggregator and one module per endpoint family: `login.ts`, `register.ts`, `activate.ts`, `password.ts`, `oauth.google.ts`.
- Migrate each handler to `createRoute(...)` + `respondWith/respondCreated/respondNoContent` (`respondNoContent` for logout).
- Add Zod-OpenAPI schemas for the auth payloads (`LoginRequest`, `LoginResponse`, `RegisterRequest`, `ActivateRequest`, `PasswordResetRequest`, etc.) under `apps/api/src/openapi/components/entities.ts` (or a dedicated `auth.ts` if it keeps the file manageable).
- Delete the legacy `buildAuthRouter` and `buildOAuthRouter` and their mounts. `routes/index.ts` ends up with one auth mount instead of two.
- Update or extend existing `apps/api/test/routes/auth/**` specs only as needed to keep them green; do not rewrite the auth test suite.

Out:
- Changing `AuthService`, the JWT adapter, or token persistence.
- Changing rate-limiter implementations or key derivation.
- Introducing `/v1` (handled in F8).
- Touching `apps/web` auth clients.

## Acceptance Criteria

- [ ] `routes/index.ts` mounts exactly one auth sub-app (down from two).
- [ ] Every `/auth/*` endpoint (login, refresh, logout, register, activate, password reset/change, Google OAuth start + callback) resolves at the same URL and returns the same payload, status, and `Set-Cookie` header set as before.
- [ ] `GET /openapi.json` lists each `/auth/*` route with full request/response schemas, including the `bearerAuth` security marker on authenticated routes.
- [ ] All current `apps/api/test/routes/auth/**` specs pass green. New smoke tests cover any path that previously had none.
- [ ] Login rate-limit, register rate-limit, activate rate-limit, forgot-password rate-limit each trigger on the same conditions as before (verified by existing specs).
- [ ] Refresh-token rotation continues to work end-to-end (verified by existing specs).
- [ ] `make test-api`, `make test-web` (no diff expected here), `make lint` pass green.
- [ ] Legacy `auth.router.ts` and `oauth.router.ts` files are deleted.

## Verification Plan

1. For each auth endpoint, capture a before/after of a successful and a failing call (`curl -i` is sufficient) and diff the headers + body.
2. Inspect `GET /openapi.json` to confirm every auth route has request/response schemas and the correct `security` block.
3. Run the existing auth specs and confirm zero edits to assertions (only imports/paths if the test helpers moved).
4. Manually trigger Google OAuth start → callback locally if credentials are available, otherwise rely on the mocked spec coverage.
5. Confirm `routes/index.ts` no longer mounts `/auth` twice.
