# Task 04: Standardize Controller Input on Pattern B (RFC 0003 — R2)

## Metadata
- **Status:** Open
- **Complexity:** Medium
- **Team:** Backend API
- **Milestone:** RFC 0003 — Route reorganization & OpenAPI (remaining work R2)
- **Dependencies:** None (independent of Task 03; may land in parallel)
- **Category:** Refactoring / API Architecture
- **Source:** `docs/product/RFCs/0003-apps-api-route-organization-and-openapi.md` §4.3, §5 (R2), §9 (PD4)

---

## Summary

Controllers in `apps/api/src/controllers/` currently use **three inconsistent input patterns**. A subset still receive `input: unknown` and run their own `safeParse` inside the controller (Pattern A), duplicating the validation boundary and emitting **three different 400 error envelopes**. This task converges those controllers onto **Pattern B** — the controller receives an already-validated, typed value, and the HTTP-shape validation lives at the route via `@hono/zod-openapi`'s `c.req.valid('json')`. The result is one validation boundary, one standardized 400 body, and a clear controller role: transport-agnostic domain logic.

---

## Problem Statement

### Current behavior
| Pattern | Controllers | Validation site | 400 envelope |
|---|---|---|---|
| **A** — `unknown` + internal `safeParse` | `register.controller.ts`, `password.controller.ts`, `activate.controller.ts`, `admin-badges.controller.ts` | inside the controller | divergent: `ValidationFailed` / `ValidationError` / `BadRequest` |
| **B** — typed, pre-validated input | `admin-tasks`, `admin-topics`, `admin-task-stages`, `comments`, … | at the route (`c.req.valid('json')`) | standardized |
| **D** — primitive args, no body | `topics`, `me-missions`, … | n/a | n/a |

Pattern A means the same request shape is conceptually validated twice (route could/should validate, but the controller re-does it), the error body is inconsistent across endpoints, and the controller signature leaks `unknown`.

### Expected behavior
- The Pattern A controllers receive **typed** input (the Zod-inferred type), with validation performed at their route via a declarative `request.body` schema.
- All body-validation failures produce a **single, standardized 400** shape (the shared `ValidationErrorBody`).
- Pattern D controllers are left unchanged (no body to validate).
- The controller's documented role is reaffirmed: orchestrate repositories/engines, enforce **domain invariants** (e.g. duplicate email, last-admin guard, token validity), return `ControllerResult<T>` — **no HTTP parsing, no shape re-validation**.

---

## Architectural Context

### Cloud-Agnostic / Ports & Adapters Alignment
- **Backend-only.** Ports, adapters, and DB schema are untouched. Only controller method **signatures** and their corresponding route definitions change.
- Reinforces RFC §4.3: schema validation is the **route's** responsibility; the controller is the transport-agnostic application/domain layer.
- **PD4 (RFC §9):** the `@ValidateBody` / `@Body` decorators do **not** exist on `develop` and must **not** be reintroduced; this task does not add them.

### Distinction to preserve
- **Shape validation** (types, required fields, formats, lengths) → moves to the route schema.
- **Semantic/domain validation** that needs the DB or business context (email already taken, activation token expired, "cannot remove the last admin") → **stays in the controller** and keeps returning the appropriate non-400 status (`409`/`422`/`404`) via `ControllerResult`.

### Files in scope
- Controllers: `register.controller.ts`, `password.controller.ts` (`resetPassword`, `forgotPassword`), `activate.controller.ts`, `admin-badges.controller.ts` (`create`, `update`).
- Their routes: `routes/auth/register.ts`, `routes/auth/password.ts`, `routes/auth/activate.ts`, `routes/admin/badges.ts` — add the `request.body` schema so the route validates and narrows the type.
- Shared schemas: reuse the existing per-feature Zod schemas (e.g. `RegisterSchema`, the password/activate schemas, the badge create/update schemas) — promote to `openapi/components/` where it helps the published contract.
- Error body: standardize on the shared `ValidationErrorBody` from `routes/_shared` / `openapi/components/errors`.

### Out of scope
- Pattern D controllers and any controller already on Pattern B.
- Business-rule changes (the domain checks themselves are unchanged — only where shape validation lives).
- The comments router migration (Task 03) and frontend/test alignment (Tasks 05/06).

---

## Requirements
1. **Route-level schemas.** Each affected route declares its `request.body` (and/or query) Zod schema; handlers consume `c.req.valid('json')` and pass the typed value to the controller.
2. **Controller signatures.** Change the four Pattern A controllers to accept the Zod-inferred type instead of `unknown`; remove the internal `safeParse` and its bespoke 400 branch.
3. **Single 400 contract.** All body-validation failures surface the shared `ValidationErrorBody`. Domain failures keep their semantic status codes (`409`/`422`/`404`) and messages.
4. **No behavior regression.** Successful and domain-error paths (duplicate email, expired/invalid token, password policy, last-admin/self-lockout where relevant) behave identically.
5. **Docs.** Regenerate `apps/api/openapi.json` so the now-declared request schemas and the standardized error body appear in the contract.

---

## Technical Constraints
- **No new runtime dependencies; no decorators.**
- Endpoint **paths and success response shapes are unchanged.** Only the **400 body** is normalized (acceptable pre-launch contract tidy-up — there is no production client; see RFC §5).
- Keep rate-limiting middleware on the auth routes (`login`/`register`/`forgot-password`/`activate`) exactly as configured.

---

## Impact on Existing Tests
- Route specs that assert the old 400 envelopes will need updating to the standardized shape:
  - `test/routes/register.router.spec.ts`, `password.router.spec.ts`, `activate.router.spec.ts`, `admin-*badges*` specs.
- Verify domain-error assertions (duplicate email, expired token, etc.) still hold — those statuses/messages must **not** change.
- Add/keep a test proving an invalid body now yields the **standardized** 400 for each migrated route.

---

## Acceptance Criteria
- [ ] `register`, `password`, `activate`, and `admin-badges` controllers accept typed input; no `safeParse(unknown)` remains in them.
- [ ] Their routes declare `request.body` schemas and use `c.req.valid('json')`.
- [ ] All body-validation failures across these routes return the **same** standardized 400 body.
- [ ] Domain-error paths (status codes + messages) are unchanged and still covered by tests.
- [ ] No `@ValidateBody` / `@Body` decorator is introduced anywhere.
- [ ] `apps/api/openapi.json` regenerated and committed.
- [ ] `make lint`, `make test-api`, `make build` pass.

---

## Verification Plan
1. `make test-api` — updated route specs pass; domain-error specs unchanged and green.
2. `grep -rn "safeParse" apps/api/src/controllers` — no matches in the four migrated controllers (only legitimately remaining ones, if any, are documented).
3. `pnpm dump-openapi` — the four routes now show request schemas and the shared error body; commit the diff.
4. `make dev-api` + `/docs` — submit an invalid body to each migrated endpoint and confirm an identical standardized 400; submit a valid-but-conflicting payload (e.g. duplicate email) and confirm the domain status code is preserved.
