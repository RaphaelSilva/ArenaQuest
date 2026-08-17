# Task: Decoupling Business Logic from Route Handlers (Controller Refactoring)

## 📋 Context & Rationale
Currently, our Hono route handlers in `apps/api/src/routes` are over-encumbered with business logic, input validation, and complex data orchestration. This architectural "fat router" pattern:
1.  **Hinders Testability**: Logic is tightly coupled to the HTTP lifecycle (Hono Context), making unit testing difficult without heavy mocking of the framework.
2.  **Reduces Reusability**: Business rules locked in routes cannot be easily leveraged by other parts of the system or future CLI/Internal tools.
3.  **Increases Cognitive Load**: Large route files make it harder to separate infrastructure concerns (routing, middleware, CORS) from the actual application logic.

By migrating to a **Controller-based architecture**, we align with the Clean Architecture principles already present in our Ports & Adapters setup.

## 🎯 Objectives
*   Extract application logic from route files into dedicated, context-agnostic Controller classes.
*   Standardize API response handling through a unified `ControllerResult<T>` pattern.
*   Enable 100% unit test coverage for business logic without requiring an HTTP server.

## ✅ Acceptance Criteria
- [x] **Infrastructure Separation**: Route files (`*.router.ts`) must contain ONLY path definitions, middleware assignments, and mapping of `ControllerResult` to Hono HTTP responses.
- [x] **Context Agnosticism**: Controllers MUST NOT import from `hono` or use the Hono `Context` object. They should receive plain objects/parameters and return typed results.
- [x] **Dependency Injection**: Controllers must receive their required Repositories/Adapters via constructor injection.
- [x] **Validation Mapping**: Zod schemas used for request bodies should be moved to the controller layer or shared type files.
- [x] **Test Coverage**: Each new controller must have a corresponding `.spec.ts` file with unit tests for success and failure scenarios.

## 🛠️ Implementation Scope
1.  **`AdminMediaController`**:
    *   Target: `admin-media.router.ts`
    *   Responsibilities: Presigned URL generation, file metadata creation, status finalization.
2.  **`AdminTopicsController`**:
    *   Target: `admin-topics.router.ts`
    *   Responsibilities: Topic CRUD, tree manipulation logic.
3.  **`TopicsController`**:
    *   Target: `topics.router.ts`
    *   Responsibilities: Public read-only topic access.

## 📈 Definition of Done (DoD)
- [x] Logic successfully migrated to `/src/controllers`.
- [x] Routers refactored to thin "delegates".
- [x] All existing integration tests pass (340/341, 1 pre-existing skip).
- [x] New unit tests for controllers pass with high coverage (70 unit tests across 3 new spec files).
- [x] No regressions in API behavior for frontend consumers.

## 🗒️ PM Review — 2026-04-29

### ✅ Delivered
All five acceptance criteria met and all DoD items checked off. The refactoring produced:

- **`src/controllers/result.ts`** — Unified `ControllerResult<T>` type shared by all controllers.
- **`src/controllers/admin-media.controller.ts`** — Extracted `listMedia`, `presignUpload`, `finalizeUpload`, `deleteMedia`. Includes Zod schema (`PresignSchema`), size-limit constants, and `sanitizeFileName` helper. Zero Hono dependencies.
- **`src/controllers/admin-topics.controller.ts`** — Extracted `listAll`, `create`, `getById`, `update`, `move`, `archive`. All three Zod schemas moved here. Zero Hono dependencies.
- **`src/controllers/topics.controller.ts`** — Extracted `listPublished`, `getPublishedById`. Zero Hono dependencies.
- Three router files reduced to thin HTTP-to-controller delegates (path + middleware + result mapping only).
- **70 new pure unit tests** (no HTTP server, no Cloudflare runtime needed for logic tests).

### ⚠️ Observations & Gaps
1. **`sanitizeFileName` is exported but not tested directly** — it's exercised indirectly through `presignUpload`, but a dedicated unit for edge cases (empty string, unicode, very long names) would raise confidence. Low priority.
2. **`PresignSchema` / `CreateTopicSchema` etc. are exported** from controller files rather than dedicated schema files. Acceptable for now, but as these schemas grow they could be split into a `schemas/` folder.
3. **`ITagRepository` is injected but unused** in `AdminTopicsController`. Tag wiring is presumably a future feature. The `_tags` parameter naming signals this intentionally.
4. **`Cache-Control` header** remains in the router layer (`topics.router.ts`), which is correct — it is an HTTP concern, not a business concern.

### 🔖 Status: **DONE**
