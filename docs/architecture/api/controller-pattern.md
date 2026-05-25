# Controller Pattern — Authoring Guide

## Overview

Business logic in `apps/api` lives in **controllers**, never in route handlers.
Routes only translate between HTTP and the controller's typed result; controllers
own validation, repository calls, and domain rules. Every controller method
returns a `ControllerResult<T>` so the route layer has a single, mechanical way
to map success/failure into a response.

This document explains the contract, the decorators that enforce it, and the
step-by-step implementation checklist for adding a new endpoint.

## Quick Reference

| Concern | Lives in | Example |
|---|---|---|
| HTTP parsing, auth guards, status mapping | `src/routes/*.router.ts` | `admin-topics.router.ts` |
| Validation, business rules, repository calls | `src/controllers/*.controller.ts` | `admin-topics.controller.ts` |
| Result envelope | `src/core/result.ts` | `ControllerResult<T>` |
| Body validation decorators | `src/core/decorators.ts` | `@ValidateBody`, `@Body` |
| Repository interfaces | `@arenaquest/shared/ports` | `ITopicNodeRepository` |

> [!IMPORTANT]
> Controllers **must not** import `hono` or touch the request/response objects.
> If a controller needs a header, cookie, or status code from the wire, the
> route layer is responsible for extracting it and passing it as an argument.

---

## The `ControllerResult<T>` Contract

```typescript
type Ok<T>  = { ok: true; data: T };
type Err    = { ok: false; status: number; error: string; meta?: Record<string, unknown> };
export type ControllerResult<T> = Ok<T> | Err;
```

Every controller method returns this discriminated union. Routes consume it the
same way every time:

```typescript
const result = await controller.create(body);
if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 422);
return c.json(result.data, 201);
```

### Conventions for `error` strings

| Status | `error` value | When |
|---|---|---|
| `400` | `BadRequest` | Zod validation failure (set automatically by `@ValidateBody`) |
| `401` | `Unauthorized` | Missing/invalid bearer token (handled by `authGuard`, not controllers) |
| `403` | `Forbidden` | Role check failed (handled by `requireRole`, not controllers) |
| `404` | `NotFound` | Entity by id does not exist |
| `409` | Domain code (`WOULD_CYCLE`, …) | Business invariant violation |
| `422` | Domain code (`UNKNOWN_PREREQ`, …) | Referenced foreign id is invalid |

`meta` is optional and free-form. Use it to surface extra context that the
frontend can render (`{ detail: 'parentId not found' }`, Zod's `flatten()`
output, conflicting ids, etc.).

---

## Decorators: `@ValidateBody` + `@Body`

Inline `schema.safeParse(body)` calls scattered across controllers were the
original source of duplication. `src/core/decorators.ts` centralises that
pattern.

```typescript
import { z } from 'zod';
import { ValidateBody, Body } from '../core/decorators';

const CreateTopicSchema = z.object({
  title: z.string().min(1),
  parentId: z.string().nullable().optional(),
});

export class AdminTopicsController {
  @ValidateBody(CreateTopicSchema)
  async create(@Body() body: z.infer<typeof CreateTopicSchema>): Promise<ControllerResult<TopicNodeRecord>> {
    // body is already parsed and typed — no safeParse here.
    const node = await this.topics.create(body);
    return { ok: true, data: node };
  }
}
```

### What the decorators do

- `@Body()` records which parameter index holds the raw request body for the
  decorated method (default: index `0`).
- `@ValidateBody(schema)` wraps the method so that, before it runs:
  1. `schema.safeParse()` is applied to the marked argument.
  2. On failure → returns `{ ok: false, status: 400, error: 'BadRequest', meta: { details: parsed.error.flatten() } }` immediately.
  3. On success → replaces the raw argument with the typed, parsed value.

### When `@Body()` is needed vs. optional

| Method signature | `@Body()` required? |
|---|---|
| `create(body)` | No — defaults to argument `0` |
| `update(id, body)` | **Yes** — must mark `body` as parameter `1` |
| `move(id, body)` | **Yes** |

> [!TIP]
> If you forget `@Body()` on a method whose body is not the first argument, the
> decorator validates the wrong value (typically the route param string). The
> Zod failure is loud, but the fix is to add `@Body()`.

---

## Implementation Checklist: Adding a New Endpoint

Below is the full path for a new admin endpoint, top to bottom.

### 1. Define (or extend) the port

`packages/shared/ports/i-topic-node-repository.ts` — add the method signature
the controller will call. Keep this layer free of D1/SQL.

### 2. Implement the adapter

`apps/api/src/adapters/db/d1-topic-node-repository.ts` — implement the new
method against D1. If a migration is needed, add it under
`apps/api/migrations/` and apply it locally with `make db-migrations-dev`.

### 3. Add the schema and controller method

`apps/api/src/controllers/admin-topics.controller.ts`:

```typescript
export const PublishTopicSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
});

@ValidateBody(PublishTopicSchema)
async publish(id: string, @Body() body: z.infer<typeof PublishTopicSchema>): Promise<ControllerResult<TopicNodeRecord>> {
  const existing = await this.topics.findById(id);
  if (!existing) return { ok: false, status: 404, error: 'NotFound' };

  if (existing.status === 'archived') {
    return { ok: false, status: 409, error: 'ARCHIVED_TOPIC' };
  }

  const node = await this.topics.publish(id, body.scheduledAt);
  return { ok: true, data: node };
}
```

Rules of thumb:

- Look up referenced entities **before** mutating; return `404` / `422` for
  missing references.
- Sanitise free-form Markdown content with `sanitizeMarkdown()` from
  `@arenaquest/shared/utils/sanitize-markdown` before persisting.
- Never `throw` for validation/business errors — return `{ ok: false, … }`. Let
  unexpected runtime errors bubble up; Hono will turn them into `500`s.

### 4. Wire up the route

`apps/api/src/routes/admin-topics.router.ts`:

```typescript
router.post('/:id/publish', async (c) => {
  const body = await c.req.json();
  const result = await controller.publish(c.req.param('id'), body);
  if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 409);
  return c.json(result.data);
});
```

The `as <status-union>` cast is intentional — it documents which statuses this
endpoint can produce and helps future readers spot drift.

### 5. Test the controller, not the route

Vitest with `@cloudflare/vitest-pool-workers`. Construct the controller with
in-memory or test-double repositories and assert against `ControllerResult`
shapes directly. Reserve route-level integration tests for behaviour that only
exists at the HTTP layer (cookies, CORS, status codes).

---

## Anti-Patterns

| Don't | Do |
|---|---|
| `c.json(...)` from inside a controller | Return a `ControllerResult` |
| `throw new HTTPException(...)` for business rules | Return `{ ok: false, status, error }` |
| `schema.safeParse(body)` inline at the top of every method | `@ValidateBody(schema)` |
| Construct repositories inside the controller | Inject via the constructor (built in `src/index.ts`) |
| Reuse a generic `error: 'BadRequest'` for domain conflicts | Use a specific code (`WOULD_CYCLE`, `UNKNOWN_PREREQ`, …) |
| Cast `result.status as never` everywhere | Cast to the **actual union** of statuses the endpoint can return |

---

## Related Files

| File | Role |
|---|---|
| `apps/api/src/core/result.ts` | `ControllerResult<T>` type definition |
| `apps/api/src/core/decorators.ts` | `@ValidateBody` and `@Body` implementations |
| `apps/api/src/controllers/admin-topics.controller.ts` | Reference controller (validation, 404/409/422 cases) |
| `apps/api/src/routes/admin-topics.router.ts` | Reference router (status mapping) |
| `apps/api/src/index.ts` | Per-request adapter wiring; controllers constructed by routers |
| `packages/shared/ports/` | Repository interfaces controllers depend on |
| `packages/shared/utils/sanitize-markdown.ts` | Required before persisting Markdown content |
