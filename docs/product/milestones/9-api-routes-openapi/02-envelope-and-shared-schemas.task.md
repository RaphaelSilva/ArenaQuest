# Task 02 — Introduce envelope helpers and shared error/pagination schemas (F2)

**Status:** 📝 Draft
**Milestone:** [9 — `apps/api` Route Reorganization and OpenAPI Adoption](./milestone.md)
**RFC:** [0003 §4.3 and §5 — F2](../../RFCs/0003-apps-api-route-organization-and-openapi.md)

## Summary

Add the single-source-of-truth helpers that future migrated routes will rely on: `respondWith`, `respondCreated`, `respondNoContent` (mapping `ControllerResult<T>` to a `Response`), and the reusable Zod-OpenAPI schemas for `ErrorBody`, `ValidationErrorBody`, and `Pagination`. No existing handler is rewritten in this task — the helpers are introduced and unit-tested in isolation so that F4–F7 can adopt them without inventing local variants.

## Dependencies

Depends on Task 01 (the `OpenAPIHono` foundation must exist). Blocks Tasks 04–07.

## Technical Constraints

- **Scope guardrail:** new files under `apps/api/src/routes/_shared/**` and `apps/api/src/openapi/components/**`. Tests under `apps/api/test/routes/_shared/**`. No edits to existing handlers, controllers, or adapters.
- The envelope helpers must be the **only** place that translates a `ControllerResult` to a `Response`. They must preserve every status code the controllers currently emit (200, 201, 204, 400, 401, 403, 404, 409, 422, 429, etc.).
- The `ErrorBody` schema must match the current production error envelope exactly: `{ error: string, ...meta }` where `meta` is optional and unknown-shaped. Document the freeform meta as `additionalProperties: true` in OpenAPI.
- The `ValidationErrorBody` schema is for Zod-OpenAPI's automatic 400 responses: `{ error: 'ValidationError', issues: ZodIssue[] }`. Confirm shape against `@hono/zod-openapi`'s default hook before committing.
- The helpers must not log, not mutate the context, and not introduce async work.

## Scope

In:
- Create `apps/api/src/routes/_shared/envelope.ts` exporting `respondWith`, `respondCreated`, `respondNoContent`.
- Create `apps/api/src/openapi/components/errors.ts` exporting `ErrorBody` and `ValidationErrorBody` Zod-OpenAPI schemas (registered as reusable components).
- Create `apps/api/src/openapi/components/pagination.ts` exporting a generic `PaginationQuery` (input) and `PaginatedResponse<T>` factory (output) covering the cursor/offset shapes currently used.
- Add unit tests covering the happy path (each status code returned by each helper) and the error path (preserves `error` string and merges `meta`).
- Wire the shared schemas into the root OpenAPI document so they appear under `components.schemas` even before any route references them.

Out:
- Migrating any existing handler to the helpers (handled in F4–F7).
- Defining domain entity schemas (`UserSchema`, `TopicSchema`, etc.) — those land alongside their owning module in F4–F7.
- Touching the controllers' `ControllerResult` shape.

## Acceptance Criteria

- [ ] `apps/api/src/routes/_shared/envelope.ts` exports the three helpers with explicit return types.
- [ ] Unit tests cover: `ok=true` → correct success status (200/201/204), `ok=false` → status preserved, `meta` merged into JSON body, `error` string preserved.
- [ ] `ErrorBody` and `ValidationErrorBody` schemas appear under `components.schemas` in `GET /openapi.json` after this task.
- [ ] `PaginatedResponse<T>` factory produces a schema with `items: T[]`, plus the pagination metadata fields used by the current endpoints (audit them first; document the chosen field set in the PR description).
- [ ] `make test-api` and `make lint` pass green.
- [ ] No diff to existing handlers, controllers, or `routes/index.ts` beyond the OpenAPI registration of the new components.

## Verification Plan

1. Implement the helpers and run the new unit tests with `pnpm --filter @arenaquest/api test test/routes/_shared/envelope.spec.ts`.
2. Run `make dev-api` and `curl /openapi.json | jq '.components.schemas | keys'` to confirm the new schemas are listed.
3. Run `make test-api` to confirm zero regression.
4. Sanity-check the `ValidationErrorBody` shape against an example failure from a Zod-OpenAPI handler (can be a throwaway sandbox route inside the spec, not committed).
