# Task 03: Implement Auth Service (Login / Logout Business Logic)

## Metadata
- **Status:** Done
- **Complexity:** Medium
- **Milestone:** 2 — Authentication & User Management
- **Dependencies:**
  - `docs/product/milestones/2/01-implement-user-repository.task.md`
  - `docs/product/milestones/2/02-seed-roles-and-rbac-constants.task.md`

---

## Summary

Create the `AuthService` use-case class that orchestrates login/logout logic. It sits in the
**application layer** — it calls ports (`IAuthAdapter`, `IUserRepository`) and never imports
Hono, Cloudflare, or any infrastructure library directly.

The adapter implementations already exist (`JwtAuthAdapter`). This task adds the service
that wires them together into meaningful business operations.

---

## Technical Constraints

- **Hexagonal Architecture:** `AuthService` lives in `apps/api/src/core/auth/auth-service.ts`.
  It depends only on interfaces (`IAuthAdapter`, `IUserRepository`) injected via constructor.
- **Cloud-Agnostic:** No Cloudflare globals (`Request`, `Response`, `env`) inside the service.
  Those belong in the HTTP adapter (route handlers).
- **Refresh Token Strategy:** Refresh tokens are stored in a `refresh_tokens` D1 table
  (opaque token → userId + expiry). The service generates the token via `IAuthAdapter`; the
  DB caller stores it. Requires a new migration (`0003_create_refresh_tokens.sql`).
- **Logout:** Revokes the refresh token row by deleting it from the table (access tokens are
  short-lived and not tracked).

---

## Scope

### 1. `AuthService` — `apps/api/src/core/auth/auth-service.ts`

```ts
export class AuthService {
  constructor(
    private readonly auth: IAuthAdapter,
    private readonly users: IUserRepository,
    private readonly tokens: IRefreshTokenRepository,
  ) {}

  async login(email: string, password: string): Promise<LoginResult>;
  async refreshTokens(refreshToken: string): Promise<LoginResult>;
  async logout(refreshToken: string): Promise<void>;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: Entities.Identity.User;
}
```

### 2. `IRefreshTokenRepository` — `packages/shared/ports/i-refresh-token-repository.ts`

```ts
export interface IRefreshTokenRepository {
  save(userId: string, token: string, expiresAt: Date): Promise<void>;
  findByToken(token: string): Promise<{ userId: string; expiresAt: Date } | null>;
  delete(token: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}
```

### 3. D1 Migration — `apps/api/migrations/0003_create_refresh_tokens.sql`

Schema: `refresh_tokens (token TEXT PK, user_id FK, expires_at TEXT)`.

### 4. `D1RefreshTokenRepository` — `apps/api/src/adapters/db/d1-refresh-token-repository.ts`

Concrete implementation of the port above.

---

## Acceptance Criteria

- [x] `AuthService.login()` returns `LoginResult` when credentials are valid.
- [x] `AuthService.login()` throws a typed `AuthError` (never leaks DB errors) when:
  - Email not found.
  - Password is incorrect.
- [x] `AuthService.logout()` deletes the refresh token row; subsequent calls with the same
  token return `null`.
- [x] `AuthService.refreshTokens()` returns a new `LoginResult` for a valid, non-expired
  refresh token and invalidates the old one (token rotation).
- [x] Unit tests in `apps/api/test/core/auth/auth-service.spec.ts` cover all scenarios above
  using **mock implementations** of `IAuthAdapter`, `IUserRepository`, and
  `IRefreshTokenRepository` (no D1, no real crypto).
- [x] All tests pass: `pnpm --filter api test`.

---

## Verification Plan

1. `pnpm --filter api test` — green.
2. Code review: confirm `AuthService` has zero imports from `hono`, `cloudflare:*`, or
   `@cloudflare/workers-types`.
3. Verify error messages do not expose internal DB details (e.g., catch `D1Error` and
   rethrow as `AuthError: InvalidCredentials`).
