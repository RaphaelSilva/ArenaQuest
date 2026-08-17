# Task 04: Expose Auth HTTP Endpoints (Hono Router)

## Metadata
- **Status:** Complete
- **Complexity:** Medium
- **Milestone:** 2 — Authentication & User Management
- **Dependencies:** `docs/product/milestones/2/03-implement-auth-service.task.md`

---

## Summary

Wire the `AuthService` to HTTP via a **Hono** router. This task introduces Hono as the HTTP
framework into `apps/api` and exposes the three auth endpoints the frontend will consume.

---

## Technical Constraints

- **No logic in route handlers:** Handlers validate the HTTP contract (parse body, set
  cookies/headers) and delegate everything else to `AuthService`. Business logic stays in
  the service layer.
- **Cloud-Agnostic:** Hono runs on any JS runtime; the route file must not import
  `@cloudflare/workers-types` directly.
- **Secrets via `env`:** The `JWT_SECRET` is read from `AppEnv` in `src/index.ts` and
  injected into `JwtAuthAdapter`. Route handlers receive already-constructed adapters.
- **Refresh token cookie:** Return the refresh token as an `HttpOnly; Secure; SameSite=Strict`
  cookie — not in the JSON body — to prevent XSS theft.

---

## Scope

### Dependency to add

```jsonc
// apps/api/package.json — dependencies
"hono": "^4"
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/login` | Exchange credentials for tokens |
| `POST` | `/auth/logout` | Revoke refresh token (cookie) |
| `POST` | `/auth/refresh` | Exchange refresh token for new pair |

### Router — `apps/api/src/routes/auth.router.ts`

```ts
import { Hono } from 'hono';
// ... build the router, inject AuthService via context

export function buildAuthRouter(authService: AuthService): Hono { ... }
```

### Request / Response Contracts

**POST /auth/login**
- Body: `{ email: string; password: string }`
- 200: `{ accessToken: string; user: { id, name, email, roles } }`
- Sets `Set-Cookie: refresh_token=<token>; HttpOnly; ...`
- 401: `{ error: 'InvalidCredentials' }`

**POST /auth/logout**
- Reads `refresh_token` cookie
- 204 on success; 401 if cookie absent

**POST /auth/refresh**
- Reads `refresh_token` cookie
- 200: `{ accessToken: string }`; rotates the cookie
- 401 if token is expired or revoked

### Update `apps/api/src/index.ts`

Mount the Hono app as the Worker's fetch handler using `app.fetch`.

---

## Acceptance Criteria

- [x] `POST /auth/login` with valid credentials returns HTTP 200 with `accessToken` and sets
  the `refresh_token` HttpOnly cookie.
- [x] `POST /auth/login` with wrong password returns HTTP 401 with `{ error: 'InvalidCredentials' }`.
- [x] `POST /auth/logout` clears the `refresh_token` cookie and returns HTTP 204.
- [x] `POST /auth/refresh` with a valid cookie returns a new `accessToken` (200) and rotates
  the cookie.
- [x] `POST /auth/refresh` with an expired/revoked cookie returns HTTP 401.
- [x] Integration tests in `apps/api/test/routes/auth.router.spec.ts` cover all cases above
  using `@cloudflare/vitest-pool-workers` (no mocking of the Hono app itself).
- [x] `GET /health` still returns the adapter status object (regression check).

---

## Verification Plan

1. `pnpm --filter api test` — green.
2. Manual: `wrangler dev` + use `curl` or Postman to hit all three endpoints.
3. Inspect cookie flags (`HttpOnly`, `Secure`, `SameSite=Strict`) in browser DevTools.
