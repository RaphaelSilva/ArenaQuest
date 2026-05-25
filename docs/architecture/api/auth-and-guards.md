# Auth & Route Guards — Authoring Guide

## Overview

ArenaQuest's auth stack is intentionally **dependency-free**: PBKDF2 password
hashing and HMAC-SHA256 JWT signing both run on the Web Crypto API native to
Cloudflare Workers. The login flow layers a KV-backed rate limiter, a
constant-time dummy verify, and transparent rehashing on top of that core.

This document explains how to protect a new endpoint, how the moving pieces
fit together, and the security invariants every change must preserve.

## Quick Reference

| Layer | File | Purpose |
|---|---|---|
| Adapter | `src/adapters/auth/jwt-auth-adapter.ts` | PBKDF2 hash/verify, JWT sign/verify, refresh token generation |
| Service | `src/core/auth/auth-service.ts` | Login, refresh, logout — orchestrates adapter + repositories |
| Guard | `src/middleware/auth-guard.ts` | Verifies `Authorization: Bearer` and populates `c.get('user')` |
| Role check | `src/middleware/require-role.ts` | Asserts the verified user has one of the listed roles |
| Cookie router | `src/routes/auth.router.ts` | Sets/clears the `refresh_token` cookie, applies the rate limiter |
| Roles enum | `packages/shared/constants/roles.ts` | `ROLES.ADMIN`, `ROLES.CONTENT_CREATOR`, `ROLES.TUTOR`, `ROLES.STUDENT` |

> [!IMPORTANT]
> **Never introduce `jsonwebtoken`, `bcrypt`, or similar.** Auth is portable by
> design — every primitive must run on the Web Crypto API so the codebase
> stays cloud-agnostic. PBKDF2 uses **100,000 iterations** (the Cloudflare
> Workers ceiling); see the rehash path below.

---

## Token Model

| Token | Carrier | Lifetime | Storage | Rotated on |
|---|---|---|---|---|
| Access token (JWT, HS256) | `Authorization: Bearer …` header | 15 min | Stateless | Every refresh |
| Refresh token (random 256-bit) | `refresh_token` HttpOnly cookie | 7 days | `refresh_tokens` table (hashed) | Single-use — rotated on every `/auth/refresh` |

The access token is short-lived and cannot be revoked; the refresh token is
the **revocation point** (delete the row → next refresh fails).

### What's inside the access token

```typescript
{
  sub:   user.id,
  email: user.email,
  roles: ['admin', 'content_creator'],   // role names, not ids
  iat, exp
}
```

`roles` are **role names** (the constants from `ROLES`), not row ids — the
guard middleware compares against `RoleName` values directly without a DB
lookup.

---

## Protecting a Route

### Pattern 1 — Authenticated only

```typescript
router.use('*', authGuard);

router.get('/me', (c) => c.json({ user: c.get('user') }));
```

`authGuard`:

1. Reads `Authorization: Bearer <token>`; returns `401 Unauthorized` if absent.
2. Calls `c.get('auth').verifyAccessToken(token)`; returns `401` on failure.
3. Sets `c.set('user', payload)` with the verified `{ sub, email, roles }`.

Downstream handlers can call `c.get('user')` synchronously with full typing
(see `src/types/hono-env.ts` — augments `ContextVariableMap`).

### Pattern 2 — Authenticated **and** in a role

```typescript
router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));
```

`requireRole(...names)` reads `c.get('user').roles` and returns
`403 Forbidden` if none of the listed names match. **Always import role names
from `@arenaquest/shared/constants/roles`** — never hardcode strings, or you
forfeit the type check that catches typos.

### Pattern 3 — Mixed guards on a single router

When some endpoints in a router are public and others aren't, **don't** put
`authGuard` at the router level. Instead, scope it to the route:

```typescript
router.get('/', publicListHandler);                                     // no guard
router.post('/', authGuard, requireRole(ROLES.ADMIN), createHandler);   // guarded
```

Mixing `router.use('*', authGuard)` with public sub-routes leads to subtle
ordering bugs. Be explicit per route.

### Pattern 4 — Conditional behaviour for logged-in users

If a route should serve both anonymous and authenticated callers (e.g. a
public catalog that hides drafts from anonymous users but shows them to
admins), don't apply `authGuard`. Inspect the header yourself via the auth
adapter, swallow failures, and branch on the result. A future helper
(`maybeUser`) may codify this; until then, do it explicitly in the handler.

---

## The Login Flow (Defence in Depth)

The `/auth/login` route applies several layers in order. Each layer exists for
a specific threat — don't reorder or remove them without understanding why.

### Layer 1 — KV rate limiter (peek)

```typescript
const state = await loginLimiter.peek(key);
if (!state.allowed) {
  c.header('Retry-After', String(state.retryAfterSeconds ?? 1));
  return c.json({ error: 'TooManyRequests' }, 429);
}
```

- Key is `<lowercased-email>:<cf-connecting-ip>`. Lower-casing the email
  prevents `Foo@x.com` / `foo@x.com` from looking like distinct buckets.
- **Fail-open.** If KV itself errors, the request continues — a KV outage
  must not lock every user out. The error is logged.
- `peek` is non-mutating; the bucket only ticks on credential failure (below).

### Layer 2 — Constant-time dummy verify

Inside `AuthService.login`:

```typescript
const hashToVerify = record ? record.passwordHash : DUMMY_PASSWORD_HASH;
const valid = await this.auth.verifyPassword(password, hashToVerify);

if (!record || !valid) {
  throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials');
}
```

A missing email runs the **same PBKDF2 work** as a wrong password. Without
this branch, an attacker can distinguish "user exists" from "wrong password"
by wall-clock latency. The dummy hash's iteration count must match the
adapter's current target — regenerate it via `pnpm --filter api run gen-hash`
if iterations ever change.

### Layer 3 — Status check after verify

```typescript
if (record.status !== Entities.Config.UserStatus.ACTIVE) {
  throw new AuthError('ACCOUNT_INACTIVE', 'Account is not active');
}
```

Disabled / pending accounts still pay the verify cost; only the response
differs. This is intentional — the same defence-in-depth principle as Layer 2.

### Layer 4 — Transparent PBKDF2 rehash on success

```typescript
const currentIter = this.auth.currentPbkdf2Iterations;
const storedIter  = JwtAuthAdapter.readIterationsFromHash(record.passwordHash);
if (storedIter !== null && storedIter < currentIter) {
  const newHash = await this.auth.hashPassword(password);
  await this.users.updatePasswordHash(record.id, newHash).catch((e) => {
    console.warn('[auth] rehash failed, login proceeds', e);
  });
}
```

If we ever raise the iteration count, every successful login transparently
upgrades the stored hash. **Failures here must never break login** — the
promise is `.catch`-ed and logged. The user already authenticated correctly;
denying them their session because of a write hiccup would be a regression.

### Layer 5 — Bucket bookkeeping

- `result.status === 401` → `loginLimiter.hit(key)` (count this attempt).
- `result.ok` (success) → `loginLimiter.reset(key)` (clear the bucket).
- `result.status === 400` (bad payload) → no bucket change. Shape bugs are
  not attack signals.

### Layer 6 — Cookie issuance

The refresh token is set as an HttpOnly cookie:

```typescript
setCookie(c, COOKIE_NAME, result.data.refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: cookieSameSite,   // Strict | Lax | None — see cookie-samesite-security.md
  maxAge: COOKIE_TTL_SECONDS,
  path: '/',
});
```

`SameSite` policy and the cross-domain CSRF analysis are in
[`cookie-samesite-security.md`](./cookie-samesite-security.md).

---

## The Refresh Flow

`/auth/refresh` reads the cookie, looks up the row, and **rotates** it:

```typescript
const stored = await this.tokens.findByToken(refreshToken);
if (!stored || stored.expiresAt < new Date()) {
  throw new AuthError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
}

const user = await this.users.findById(stored.userId);
if (!user) throw new AuthError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');

await this.tokens.delete(refreshToken);   // single-use
return this.issueTokens(user);             // fresh pair, new cookie
```

Single-use rotation is the **revocation point** for stolen refresh tokens: if
an attacker uses a token, the legitimate user's next refresh fails and they
are forced back through `/auth/login`. Tokens are **stored hashed** (see
migration `0004_hash_refresh_tokens.sql`), so a database read does not yield
the raw value.

---

## The `AuthError` → HTTP mapping

`AuthService` throws typed `AuthError`s; the controller translates them. The
mapping is intentionally narrow — don't widen it without a reason.

| `code` | Status | When |
|---|---|---|
| `INVALID_CREDENTIALS` | `401` | Wrong email or wrong password (indistinguishable to the client) |
| `ACCOUNT_INACTIVE` | `403` | Credentials valid but account is not `ACTIVE` |
| `INVALID_REFRESH_TOKEN` | `401` | Cookie missing, expired, or unknown |

Any other thrown error escapes to Hono's default `500` handler — which is
correct, because it indicates a runtime fault, not a credential decision.

---

## Implementation Checklist: Adding a New Protected Endpoint

### 1. Pick the guards

| Audience | Guards |
|---|---|
| Any logged-in user | `authGuard` |
| Admin only | `authGuard, requireRole(ROLES.ADMIN)` |
| Admin or content creator | `authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR)` |
| Public | (none) |

### 2. Mount them at the router level (if all routes share the same audience)

```typescript
export function buildAdminTopicsRouter(...): Hono {
  const router = new Hono();
  router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));
  // …
  return router;
}
```

### 3. Or per-route (if guards vary)

```typescript
router.get('/',  listPublic);
router.post('/', authGuard, requireRole(ROLES.ADMIN), create);
```

### 4. Read the user inside the handler

```typescript
router.get('/me', authGuard, (c) => {
  const user = c.get('user');   // typed as VerifiedToken
  return c.json({ id: user.sub, email: user.email, roles: user.roles });
});
```

Never re-verify the token in your handler — the guard already did it.

---

## Testing Auth

- **Adapter unit tests** — exercise `JwtAuthAdapter` with fixed secrets and
  short token TTLs; assert hash format, verify behaviour, and rehash detection.
- **Service tests** — drive `AuthService` against in-memory repository
  doubles. Cover the four failure paths (missing email, wrong password,
  inactive account, expired refresh) and the rehash branch.
- **Route integration** — use the `@cloudflare/vitest-pool-workers` harness
  to assert `Set-Cookie` headers, `401` vs `403` distinctions, and rate-limit
  headers (`Retry-After`).

The dummy-verify path is easy to break accidentally; keep at least one timing
regression test that pins both branches to comparable durations.

---

## Anti-Patterns

| Don't | Do |
|---|---|
| Add `jsonwebtoken` / `bcrypt` / `argon2` | Use `JwtAuthAdapter` (Web Crypto) |
| Hardcode `'admin'` in `requireRole` | `ROLES.ADMIN` from `@arenaquest/shared/constants/roles` |
| Short-circuit login when the email is unknown | Always run the dummy verify (Layer 2) |
| Throw inside `loginLimiter.peek/hit/reset` failures | Log and continue (fail-open) |
| Block login when transparent rehash write fails | Log and let login succeed |
| Leak `passwordHash` in any response | Strip it before returning the user (`AuthService.login` already does) |
| Re-verify the access token in a handler | Trust `c.get('user')` after `authGuard` |
| Use `SameSite=None` without `Secure` | Cookies always set both — never relax `Secure` |
| Apply `authGuard` then carve out exceptions inside handlers | Mount per-route instead — explicit beats clever |

---

## Related Files

| File | Role |
|---|---|
| `apps/api/src/adapters/auth/jwt-auth-adapter.ts` | PBKDF2 + HMAC primitives, refresh-token generation, iteration parsing |
| `apps/api/src/core/auth/auth-service.ts` | Login / refresh / logout orchestration |
| `apps/api/src/core/auth/auth-error.ts` | `AuthError` and code union |
| `apps/api/src/middleware/auth-guard.ts` | Bearer extraction and verify |
| `apps/api/src/middleware/require-role.ts` | Role assertion middleware |
| `apps/api/src/routes/auth.router.ts` | Login / refresh / logout endpoints, rate limiter, cookie issuance |
| `apps/api/src/types/hono-env.ts` | `ContextVariableMap` augmentation for `c.get('auth' \| 'user')` |
| `apps/api/src/adapters/db/d1-refresh-token-repository.ts` | Stores refresh tokens hashed |
| `apps/api/migrations/0004_hash_refresh_tokens.sql` | Migration that introduced refresh-token hashing |
| `packages/shared/constants/roles.ts` | Canonical role-name constants |
| `packages/shared/ports/i-auth-adapter.ts` | `IAuthAdapter` contract; the JWT adapter is one implementation |
| `docs/product/api/cookie-samesite-security.md` | Cross-domain CSRF analysis and `SameSite` choice |
