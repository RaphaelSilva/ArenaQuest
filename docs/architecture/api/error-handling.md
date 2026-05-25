# Error Handling — `ControllerResult` to HTTP

## Overview

`apps/api` treats errors in two distinct categories:

- **Anticipated outcomes** (validation failures, missing entities, business
  rule violations) — returned as `{ ok: false, status, error, meta? }` from
  controllers, never thrown.
- **Unexpected runtime faults** (DB unreachable, null deref, programmer
  errors) — thrown, caught by Hono's default handler, surfaced as `500`.

Routes are mechanical translators: read the `ControllerResult`, map it onto
an HTTP response, and let anything else escape. This document specifies the
contract — error codes, status conventions, the route translation pattern,
and when to add a new code.

## Quick Reference

| Concern | Mechanism |
|---|---|
| Anticipated failure | `return { ok: false, status, error, meta? }` from controller |
| Unexpected failure | Throw — let Hono produce `500` |
| Body validation | `@ValidateBody(schema)` (decorator emits `400 BadRequest`) |
| Auth failure (route layer) | `authGuard` → `401 Unauthorized` |
| Role failure (route layer) | `requireRole` → `403 Forbidden` |
| Unique-constraint clash | Catch in route, return `409 Conflict` |
| Domain rule violation | `409` with a domain-specific error code (`SELF_LOCKOUT`, `WOULD_CYCLE`) |

> [!IMPORTANT]
> **Don't throw from a controller for an anticipated failure.** Throwing
> erases the typed status/code/meta the route layer needs, forces a
> try/catch in the route, and degrades the response to a generic `500`.
> Return a `ControllerResult` instead.

---

## The `Err` Shape

```typescript
type Err = {
  ok: false;
  status: number;                    // HTTP status the route should send
  error: string;                     // Stable code the frontend can switch on
  meta?: Record<string, unknown>;    // Optional extra context
};
```

Three rules:

1. **`status` is HTTP** — pick the closest semantic status (404 for missing,
   409 for conflicts, 422 for invalid foreign references, etc.).
2. **`error` is a stable string code** — the frontend pattern-matches on it.
   Codes are public API; renaming one is a breaking change.
3. **`meta` is for human/debug context** — `{ detail, maxBytes, details: zodFlatten }`.
   Don't put secrets in here; it lands in the response body.

---

## The Status & Code Catalogue

### Standard status mapping

| Status | When | Reference `error` codes |
|---|---|---|
| `400 BadRequest` | Schema validation failed | `BadRequest` |
| `401 Unauthorized` | No / invalid bearer token, no / invalid refresh cookie | `Unauthorized`, `InvalidCredentials` |
| `403 Forbidden` | Token valid but role insufficient | `Forbidden` |
| `404 NotFound` | Entity by id does not exist (or cross-tenant lookup) | `NotFound` |
| `409 Conflict` | State / uniqueness conflict, business invariant | `Conflict`, `WOULD_CYCLE`, `SELF_LOCKOUT`, `WOULD_LOCK_OUT_ADMINS` |
| `422 Unprocessable` | Body is well-formed but references something invalid | `UNKNOWN_PREREQ`, `FileTooLarge`, `NotUploaded` |
| `429 TooManyRequests` | Rate limiter tripped | `TooManyRequests` |
| `500 InternalServerError` | Unhandled throw | (set by Hono, not us) |

### Generic vs. domain-specific codes

Use `BadRequest`, `NotFound`, `Conflict`, `Forbidden`, `Unauthorized` for the
generic cases. **Promote to a domain code when the frontend needs to behave
differently.** Today's domain codes:

| Code | Status | Where | Meaning |
|---|---|---|---|
| `WOULD_CYCLE` | 409 | `admin-topics.controller.ts` | Move would create a cycle in the topic tree |
| `UNKNOWN_PREREQ` | 422 | `admin-topics.controller.ts` | Referenced prerequisite id doesn't exist |
| `SELF_LOCKOUT` | 409 | `admin-users.router.ts` | Admin attempted to deactivate / demote themselves |
| `WOULD_LOCK_OUT_ADMINS` | 409 | `admin-users.router.ts` | Mutation would leave zero active admins |
| `FileTooLarge` | 422 | `admin-media.controller.ts` | Upload exceeds per-type cap |
| `NotUploaded` | 422 | `admin-media.controller.ts` | Finalize called but R2 has no object |
| `InvalidCredentials` | 401 | `auth.controller.ts` | Login failed (covers wrong password and inactive account) |

> [!TIP]
> **Naming convention:** generic codes are PascalCase (`NotFound`,
> `BadRequest`); domain codes are SCREAMING_SNAKE_CASE (`WOULD_CYCLE`,
> `SELF_LOCKOUT`). The split makes generic-vs-domain visible at a glance.

---

## The Route Translation Pattern

Every route that consumes a `ControllerResult` follows this shape:

```typescript
router.post('/', async (c) => {
  const body = await c.req.json();
  const result = await controller.create(body);
  if (!result.ok) {
    return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 422);
  }
  return c.json(result.data, 201);
});
```

### The `as <status-union>` cast

Hono's `c.json(body, status)` overloads on a literal status type. We cast to
the **exact union of statuses this endpoint can produce**:

```typescript
return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 422);
```

This is intentional — it documents the endpoint's failure surface inline and
makes drift visible at code review. **Don't use `as never` or `as number`** —
that erases the contract.

If you add a new failure code in the controller, update the union in *every*
route that calls it. Type errors at the route layer are a feature, not a
nuisance.

### Spreading `meta` into the response body

```typescript
return c.json({ error: result.error, ...result.meta }, result.status);
```

Convention: `meta` keys land at the top level of the response body alongside
`error`. The frontend reads `body.error` for routing logic and the named
`meta` keys for display. Don't nest `meta` under `body.meta` unless the
caller specifically expects that shape.

### Success path

Routes also choose the success status:

| Operation | Status | Body |
|---|---|---|
| Read | `200` | `c.json(result.data)` or `c.json({ data: result.data })` for collections |
| Create | `201` | `c.json(result.data, 201)` |
| Update / Move | `200` | `c.json(result.data)` |
| Delete / Archive | `204` | `c.body(null, 204)` |

Wrap collections in `{ data: [...] }` to leave room for future pagination
metadata; return single entities unwrapped.

---

## When to Throw vs. Return

| Situation | Action |
|---|---|
| User input fails validation | `@ValidateBody` returns `Err` automatically |
| Entity not found | `return { ok: false, status: 404, error: 'NotFound' }` |
| Business rule violated | `return { ok: false, status: 409, error: 'WOULD_CYCLE' }` |
| Foreign reference invalid | `return { ok: false, status: 422, error: 'UNKNOWN_PREREQ' }` |
| Repository says row vanished after a write | `throw new Error(...)` — this is genuinely broken |
| Adapter throws (network, KV outage, …) | Let it bubble; Hono returns `500` |
| Logically unreachable branch | `throw new Error('unreachable: …')` |

Rule of thumb: if the response should distinguish this case from a generic
`500`, **return**. If hitting it means the server is in a bad state, **throw**.

### `AuthError` is a typed exception (the exception that proves the rule)

`AuthService` throws `AuthError` rather than returning, because the service
predates `ControllerResult`. The translation happens in `AuthController`:

```typescript
try {
  const tokens = await this.authService.login(email, password);
  return { ok: true, data: tokens };
} catch (err) {
  if (err instanceof AuthError &&
      (err.code === 'INVALID_CREDENTIALS' || err.code === 'ACCOUNT_INACTIVE')) {
    return { ok: false, status: 401, error: 'InvalidCredentials' };
  }
  throw err;   // anything else escapes to 500
}
```

This is the **only** layer where you should catch in a controller. The
catch is narrow (specific class + specific codes); anything outside that
re-throws. Don't add new instances of this pattern — return `ControllerResult`
from the start.

---

## Special Cases

### Database uniqueness conflicts

D1 surfaces `UNIQUE constraint failed` as a thrown `Error`. The legacy
admin-users router catches and translates:

```typescript
try {
  const user = await users.create({ name, email, passwordHash, roleNames: roles });
  return c.json(user, 201);
} catch (err) {
  if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
    return c.json({ error: 'Conflict', detail: 'Email already exists' }, 409);
  }
  throw err;
}
```

When porting this to the controller pattern, do the catch **inside the
controller** and return `{ ok: false, status: 409, error: 'Conflict', meta: { detail: 'Email already exists' } }`.
String-matching on the error message is fragile but unavoidable until D1
exposes structured error codes — keep the substring check narrow and
specific.

### Cross-tenant id lookups → `404`, never `403`

When a media id belongs to a different topic than the URL parameter, return
`404 NotFound`, **not** `403 Forbidden`:

```typescript
const record = await this.media.findById(mediaId);
if (!record || record.topicNodeId !== topicId) {
  return { ok: false, status: 404, error: 'NotFound' };
}
```

Returning `403` would leak that the id exists somewhere else. `404` is
indistinguishable from "this id was never used."

### Rate limiting and fail-open

The rate limiter returns `429` with a `Retry-After` header at the **route**
layer (not the controller), because the controller never sees the limiter:

```typescript
if (!state.allowed) {
  c.header('Retry-After', String(state.retryAfterSeconds ?? 1));
  return c.json({ error: 'TooManyRequests' }, 429);
}
```

If the limiter itself errors, **fail open** — log and continue. Never let a
KV outage produce `429` or `500`. See [`auth-and-guards.md`](./auth-and-guards.md)
for the full login flow.

---

## Implementation Checklist: Adding a New Error Code

### 1. Pick the right status

Walk down the catalogue table top to bottom — the first matching row wins.
If nothing fits, you probably want `409` (conflict) or `422` (invalid
foreign reference).

### 2. Pick the right name

- Generic case the frontend handles uniformly → reuse `NotFound`,
  `Conflict`, `BadRequest`.
- Frontend needs a different message / branch → SCREAMING_SNAKE_CASE domain
  code (`MUST_BE_DRAFT`, `ENROLLMENT_CLOSED`).

### 3. Return it from the controller

```typescript
if (existing.status === 'archived') {
  return { ok: false, status: 409, error: 'ARCHIVED_TOPIC' };
}
```

Add `meta` only if the frontend needs structured context to render — not
just to log.

### 4. Update the route's status union

```typescript
return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 409);
//                                                                           ^^^^ add 409
```

### 5. Document it in the catalogue

Add a row to the **Domain-specific codes** table above with status, source,
and meaning. Codes are public API for the frontend — keeping them indexed
prevents accidental duplication (`SELF_LOCKOUT` vs `SELF_LOCK_OUT`).

### 6. Test the failure path

A controller test asserting the **whole `ControllerResult`** is enough:

```typescript
expect(result).toEqual({ ok: false, status: 409, error: 'ARCHIVED_TOPIC' });
```

See [`testing-workers.md`](./testing-workers.md) for the layered test
strategy.

---

## Anti-Patterns

| Don't | Do |
|---|---|
| `throw new HTTPException(404, 'Not found')` from a controller | `return { ok: false, status: 404, error: 'NotFound' }` |
| `return { ok: false, status: 500, error: '…' }` for unexpected faults | Throw — Hono's default handler covers `500` |
| Cast `result.status as never` in the route | Cast to the exact union (`as 400 \| 404 \| 422`) |
| Reuse `BadRequest` for distinct domain conflicts | Promote to a SCREAMING_SNAKE_CASE domain code |
| Put internal stack traces or secrets in `meta` | `meta` is response body — keep it user-facing |
| Return `403 Forbidden` when an id belongs to another tenant | Return `404 NotFound` to avoid disclosure |
| Catch broad `Error`s in a controller | Catch narrowly (specific class + specific predicate) and re-throw the rest |
| Add a domain code without updating the catalogue table | Update `error-handling.md` in the same PR |
| Have routes invent their own error codes | Codes live in the controller; the route just maps |
| Surface `429` from a transient KV outage | Fail open — log and continue |

---

## Related Files

| File | Role |
|---|---|
| `apps/api/src/core/result.ts` | `ControllerResult<T>` / `Ok` / `Err` types |
| `apps/api/src/core/decorators.ts` | `@ValidateBody` — emits `400 BadRequest` automatically |
| `apps/api/src/core/auth/auth-error.ts` | `AuthError` codes thrown by `AuthService` |
| `apps/api/src/controllers/auth.controller.ts` | Reference: typed catch translating `AuthError` → `ControllerResult` |
| `apps/api/src/controllers/admin-topics.controller.ts` | Reference: domain codes (`WOULD_CYCLE`, `UNKNOWN_PREREQ`) |
| `apps/api/src/controllers/admin-media.controller.ts` | Reference: domain codes (`FileTooLarge`, `NotUploaded`) and tenant 404s |
| `apps/api/src/routes/admin-users.router.ts` | Reference: legacy `try/catch` for `UNIQUE constraint failed` and `409 SELF_LOCKOUT` |
| `apps/api/src/routes/auth.router.ts` | Reference: `429 TooManyRequests` with `Retry-After` |
| `docs/product/api/controller-pattern.md` | The `ControllerResult` contract and decorator usage |
| `docs/product/api/auth-and-guards.md` | `401` / `403` flowing from `authGuard` and `requireRole` |
| `docs/product/api/testing-workers.md` | How to assert `ControllerResult` shapes in tests |
