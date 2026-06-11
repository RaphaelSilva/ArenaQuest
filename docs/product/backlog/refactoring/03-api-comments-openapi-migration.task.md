# Task 03: Migrate the Comments Router to `OpenAPIHono` (RFC 0003 — R1)

## Metadata
- **Status:** Open
- **Complexity:** Medium
- **Team:** Backend API
- **Milestone:** RFC 0003 — Route reorganization & OpenAPI (remaining work R1)
- **Dependencies:** None (the rest of the API already runs on `OpenAPIHono` + `_shared/envelope.ts`)
- **Category:** Refactoring / API Contract
- **Source:** `docs/product/RFCs/0003-apps-api-route-organization-and-openapi.md` §4.1, §5 (R1), P6

---

## Summary

`apps/api/src/routes/comments.router.ts` is the **last router still written in raw `Hono`** instead of `@hono/zod-openapi`. As a result, the two topic-comment endpoints it serves are **invisible in `/openapi.json` and `/docs`**, and they still carry the legacy per-handler boilerplate the rest of the API has already shed. This task migrates that router to the declarative `OpenAPIHono` pattern so the endpoints become part of the published contract, share the unified response envelope, and stop throwing `500` on malformed JSON.

---

## Problem Statement

### Current behavior
`comments.router.ts` exposes (mounted at the `/v1` root in `routes/index.ts`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/topics/:id/comments` | List comments on a topic |
| POST | `/v1/topics/:id/comments` | Create a comment on a topic (awards XP) |

Issues:
- Built with raw `Hono`, so it is **not introspected** by `OpenAPIHono.doc31` → absent from `/openapi.json` and the Scalar `/docs` page, and absent from the generated `apps/web/src/lib/api-types.gen.ts`.
- The POST handler reads `await c.req.json()` **without a try/catch**, so a malformed body produces a `500` instead of a `400`.
- It hand-rolls the response envelope (`c.json({ error, ...meta }, result.status as 400 | 403 | 422)`) instead of using the shared `respondWith` / `respondCreated` helpers.

### Expected behavior
- Both endpoints are declared with `createRoute(...)` and registered via `router.openapi(...)`, exactly like `routes/admin/tasks.ts` and `routes/public/catalog.topics.ts`.
- Request validation (the create-comment body, the topic-id path param) happens at the **route** boundary via the existing comment Zod schema; an invalid body yields a standardized `400`, never a `500`.
- Responses flow through `respondWith` / `respondCreated` from `routes/_shared/envelope.ts`.
- Both endpoints appear in `/openapi.json`, render in `/docs`, and are picked up when `api-types.gen.ts` is regenerated.

---

## Architectural Context

### Cloud-Agnostic / Ports & Adapters Alignment
- **Backend-only.** No port, adapter, or DB migration changes. The `ICommentRepository` and `CommentsController` stay as-is.
- The `CommentsController.createComment` already follows the "Pattern B" contract (receives a typed, pre-validated input), so **no controller signature change is required** — this is purely a routing-layer migration.

### Side effects that MUST be preserved
- The **topic-access guard**: `enrollmentRepo.getEffectiveAccessTopicIds(userId)` gates who may read/post on a topic.
- The **XP award** on successful create: `xpEngine.award({ action: 'comment_posted', ... })`, including its existing best-effort try/catch (a failed award must not fail the request).
- The `authGuard` requirement on both endpoints.

### Files in scope
- `apps/api/src/routes/comments.router.ts` — rewrite on `OpenAPIHono` with `createRoute` definitions and the shared envelope.
- `apps/api/src/openapi/components/` — add/reuse the comment request/response schemas as shared OpenAPI components (mirror how topic/task schemas are exposed).
- `apps/api/openapi.json` — regenerate via `pnpm dump-openapi` so the committed contract includes the comment endpoints.

### Out of scope
- Like/delete endpoints (`routes/me/comments.ts`) — already on the `me/` module; not part of R1.
- Any change to comment business rules, persistence, or the XP formula.
- Frontend consumption (covered by Task 05 — RFC R3).

---

## Requirements

1. **Declarative routes.** Replace the raw `Hono` handlers with `createRoute` + `router.openapi`, tagged (e.g. `topics:comments`), with `security: [{ bearerAuth: [] }]`, documented request (path param + JSON body for POST) and response schemas (200 list, 201 created, plus 400/403/422 error bodies using the shared `ErrorBody` / `ValidationErrorBody`).
2. **Validation at the route.** Use the existing create-comment Zod schema as the route `request.body` schema; the handler consumes `c.req.valid('json')`. Malformed/invalid payloads return the standardized `400`.
3. **Unified envelope.** Use `respondWith` (list) and `respondCreated` (create) from `routes/_shared/envelope.ts`; remove the hand-written `result.status as ...` casts.
4. **Preserve behavior.** Keep `authGuard`, the enrollment access check, and the best-effort XP award with identical semantics.
5. **Contract regeneration.** Regenerate and commit `apps/api/openapi.json`; confirm the two endpoints now appear.

---

## Technical Constraints
- **No new runtime dependencies.**
- **No `@ValidateBody`/`@Body` decorators** — validation stays at the route (RFC §4.3 / PD4).
- Response shapes, status codes, and paths for the two endpoints **must not change** (this is a structural migration, not a contract break). The list endpoint keeps its `{ data: [...] }` envelope; the create endpoint keeps returning the created comment with `201`.

---

## Impact on Existing Tests
- `apps/api/test/routes/comments.spec.ts` must continue to pass unchanged in behavior (same paths, same status codes, same bodies). Update only if assertions were coupled to the old error-envelope wording.
- Add coverage for the **malformed-JSON → 400** case (previously `500`).
- Add an assertion (here or in a docs smoke test) that the two comment endpoints are present in the generated OpenAPI document.

---

## Acceptance Criteria
- [ ] `comments.router.ts` uses `OpenAPIHono` + `createRoute`; no raw `Hono` handlers remain in the file.
- [ ] `GET /v1/topics/{id}/comments` and `POST /v1/topics/{id}/comments` appear in `/openapi.json` and render in `/docs`.
- [ ] A malformed JSON body on POST returns `400` (not `500`).
- [ ] Responses go through `respondWith` / `respondCreated`; no `as 400 | 403 | 422` casts remain.
- [ ] Enrollment access guard and the `comment_posted` XP award behave exactly as before.
- [ ] `apps/api/openapi.json` regenerated and committed.
- [ ] `make lint`, `make test-api`, `make build` pass.

---

## Verification Plan
1. `make test-api` — `comments.spec.ts` green, including the new malformed-body case.
2. `pnpm --filter @arenaquest/api dump-openapi` (via `make` target or `pnpm dump-openapi`) — diff shows the two comment endpoints added; commit the result.
3. `make dev-api`, open `/docs` — confirm the comment endpoints are listed with request/response schemas; exercise create + list with a valid token via Scalar "Try it".
4. Negative checks: post a malformed body (expect `400`); post as a non-enrolled user (expect `403`); confirm XP is still awarded on a successful post.
