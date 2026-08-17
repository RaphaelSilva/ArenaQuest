# Task 05: Auth Middleware — API Route Protection

## Metadata
- **Status:** Complete
- **Complexity:** Low
- **Milestone:** 2 — Authentication & User Management
- **Dependencies:** `docs/product/milestones/2/04-expose-auth-http-endpoints.task.md`

---

## Summary

Create a reusable Hono middleware that verifies the `Authorization: Bearer <token>` header
on every protected route. If the token is valid, it injects the decoded `VerifiedToken`
payload into Hono's context so downstream handlers can read `userId` and `roles` without
re-parsing the token.

Also create a role-guard helper (`requireRole`) that wraps the base middleware and returns
`403 Forbidden` when the caller's roles don't satisfy the required permission.

---

## Technical Constraints

- **Cloud-Agnostic:** Middleware uses only `IAuthAdapter.verifyAccessToken()` — no direct
  crypto calls, no Cloudflare-specific APIs.
- **Hono Context Extension:** Use Hono's typed context variables (`c.set` / `c.get`) so
  TypeScript knows the shape of the injected claims downstream.
- **Never throw in middleware:** Return `Response` objects (`401`/`403`) instead of
  throwing so Hono's error boundary is not involved.

---

## Scope

### 1. `authGuard` — `apps/api/src/middleware/auth-guard.ts`

```ts
export const authGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await c.get('auth').verifyAccessToken(token);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  c.set('user', payload); // typed via Hono's ContextVariableMap
  await next();
};
```

### 2. `requireRole` — `apps/api/src/middleware/require-role.ts`

```ts
export const requireRole = (...roles: RoleName[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const user = c.get('user');
    const hasRole = roles.some(r => user.roles.includes(r));
    if (!hasRole) return c.json({ error: 'Forbidden' }, 403);
    await next();
  };
```

### 3. Protected Health Check (sanity demo)

Add a `GET /protected/ping` route that requires `authGuard` and returns the caller's email.
This is a development sanity check — not a production feature — and can be removed post-milestone.

---

## Acceptance Criteria

- [x] `GET /protected/ping` without a token returns `401 Unauthorized`.
- [x] With an expired or tampered token, returns `401 Unauthorized`.
- [x] With a valid token but wrong role, `requireRole('admin')` returns `403 Forbidden`.
- [x] With a valid token and correct role, the route proceeds normally.
- [x] Unit tests in `apps/api/test/middleware/auth-guard.spec.ts` cover all four cases
  using a mock `IAuthAdapter`.
- [x] `pnpm --filter api test` — green.

---

## Verification Plan

1. `pnpm --filter api test` — all middleware tests pass.
2. `wrangler dev`:
   - `curl -X GET /protected/ping` → 401.
   - `curl -X GET /protected/ping -H "Authorization: Bearer <valid_token>"` → 200.
   - `curl -X GET /protected/ping -H "Authorization: Bearer <student_token>"` against
     an admin-only route → 403.
