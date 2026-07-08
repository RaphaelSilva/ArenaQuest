# Plan — 06-refactor-admin-topics-pair

**Task:** [06-refactor-admin-topics-pair.task.md](../06-refactor-admin-topics-pair.task.md)
**Source:** Milestone 8
**Assigned personas:** backend-developer
**Branch:** feature/m8/06-refactor-admin-topics-pair.task (from feature/m8/05-convention-and-auth-pair.task)

## Objective

Apply the router-vs-controller convention (documented in Task 05) to the `admin-topics` pair. Trim `admin-topics.router.spec.ts` to HTTP smokes only (status codes, DTO shape, Zod validation, auth smokes, wiring checks). Move all business-rule error branches to `admin-topics.controller.spec.ts`. One controller test is missing (sanitize on update) — add it before removing from the router spec. Also replace the inline `MIGRATION_SQL` array with `applyMigrations(env.DB)`.

## Affected areas

- `apps/api/test/routes/admin-topics.router.spec.ts` — remove business-rule tests, replace inline migrations
- `apps/api/test/controllers/admin-topics.controller.spec.ts` — add one missing sanitize-on-update test

Out of scope: `apps/api/src/**`, any other spec file.

## Step-by-step

### Backend

1. **Add missing controller test** — in `admin-topics.controller.spec.ts`, inside the `update` describe block, add:
   ```typescript
   it('sanitizes markdown content on update', async () => {
     await controller.update('root-1', { content: '<iframe src="evil.com"></iframe>' });
     const callArg = (topicsRepo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
     expect(callArg.content).not.toContain('<iframe');
   });
   ```
   Note: `topicsRepo.update` is called as `update(id, data)`, so data is the second argument (`mock.calls[0][1]`).

2. **Replace inline MIGRATION_SQL** in `admin-topics.router.spec.ts`:
   - Remove the `const MIGRATION_SQL = [...]` array (lines 10–81)
   - Add import: `import { applyMigrations } from '../helpers/apply-migrations';`
   - In `beforeAll`, replace `await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));` with `await applyMigrations(env.DB);`

3. **Remove business-rule tests** from `admin-topics.router.spec.ts`. Remove these tests (already covered by the controller spec):

   **POST /admin/topics:**
   - `'returns 404 when parentId does not exist'` → controller: `create > returns 404 when parentId does not exist`
   - `'returns 422 UNKNOWN_PREREQ when prerequisite does not exist'` → controller: `create > returns 422 UNKNOWN_PREREQ when a prerequisiteId does not exist`
   - `'sanitizes dangerous markdown content before storage'` → controller: `create > sanitizes markdown content`
   - `'returns 400 for missing title'` → controller: `create > returns 400 for missing title`

   **GET /admin/topics/:id:**
   - `'returns 404 for an unknown id'` → controller: `getById > returns 404 for unknown id`

   **PATCH /admin/topics/:id:**
   - `'returns 404 for an unknown id'` (PATCH) → controller: `update > returns 404 when node does not exist`
   - `'returns 422 UNKNOWN_PREREQ when updating with a bad prerequisite'` → controller: `update > returns 422 UNKNOWN_PREREQ for unknown prerequisiteId`
   - `'sanitizes dangerous content on update'` → controller: `update > sanitizes markdown content on update` (added in step 1)

   **POST /admin/topics/:id/move:**
   - `'returns 409 WOULD_CYCLE when moving a node under itself'` → controller: `move > returns 409 WOULD_CYCLE when node is moved to itself`
   - `'returns 409 WOULD_CYCLE when moving a node under a descendant'` → controller: `move > returns 409 WOULD_CYCLE when move creates a cycle`
   - `'returns 404 when node does not exist'` (move) → controller: `move > returns 404 when node does not exist`
   - `'returns 404 when newParentId does not exist'` → controller: `move > returns 404 when newParentId does not exist`

   **DELETE /admin/topics/:id:**
   - `'returns 404 for an unknown node'` → controller: `archive > returns 404 when node does not exist`

4. **Tests to keep** in router spec:
   - `'requires admin: GET /admin/topics -> 401 without token'` (auth smoke)
   - POST: `'creates a root node and returns 201'` (201 + DTO shape)
   - POST: `'content_creator can create a node'` (role smoke)
   - POST: `'creates a child node under a valid parent'` (parentId in DTO response)
   - POST: `'accepts a valid prerequisite ID'` (prerequisiteIds in DTO response)
   - GET list: `'returns flat array in { data: [] } shape'` (DTO shape)
   - GET list: `'content_creator can list topics'` (role smoke)
   - GET list: `'includes nodes of all statuses'` (multi-status HTTP flow)
   - GET /:id: `'returns the node with a children array'` (DTO shape with children)
   - PATCH: `'updates the title'` (200 smoke)
   - PATCH: `'PATCH { status: published } is immediately reflected in GET'` (HTTP round-trip)
   - PATCH: `'returns 400 for invalid status value'` (Zod enum validation — HTTP concern)
   - POST /move: `'moves a node to a new parent'` (200 smoke)
   - POST /move: `'moves a node to root (newParentId: null)'` (null parentId smoke)
   - DELETE: `'archives a node and returns 204'` (204 smoke)
   - DELETE: `'archive cascades to all descendants'` (cascade behavior, not testable via mock)

   **Final count: 16 tests** (from 28, removing 13 tests [missing the `'returns 400 for invalid status value'` which stays])

   Wait — recount: removing 13 tests from 28 (including the 13 listed above), keeping 15. Plus "returns 400 for invalid status value" is kept (Zod). That's 16 kept.

5. **Run verification:**
   ```bash
   cd /home/my-ubuntu/projects/ArenaQuest && make lint && make test-api
   ```

## Coverage cross-list

| Removed from router | Covered in controller |
|---|---|
| POST create — 404 bad parentId | `create > returns 404 when parentId does not exist` |
| POST create — 422 UNKNOWN_PREREQ | `create > returns 422 UNKNOWN_PREREQ when a prerequisiteId does not exist` |
| POST create — sanitizes markdown | `create > sanitizes markdown content` |
| POST create — 400 missing title | `create > returns 400 for missing title` |
| GET /:id — 404 unknown id | `getById > returns 404 for unknown id` |
| PATCH — 404 unknown id | `update > returns 404 when node does not exist` |
| PATCH — 422 UNKNOWN_PREREQ update | `update > returns 422 UNKNOWN_PREREQ for unknown prerequisiteId` |
| PATCH — sanitizes content on update | `update > sanitizes markdown content on update` (added in step 1) |
| POST /move — 409 WOULD_CYCLE self | `move > returns 409 WOULD_CYCLE when node is moved to itself` |
| POST /move — 409 WOULD_CYCLE descendant | `move > returns 409 WOULD_CYCLE when move creates a cycle` |
| POST /move — 404 node doesn't exist | `move > returns 404 when node does not exist` |
| POST /move — 404 newParentId doesn't exist | `move > returns 404 when newParentId does not exist` |
| DELETE — 404 unknown node | `archive > returns 404 when node does not exist` |

## Acceptance Criteria mapping

| AC | Plan step | Persona | Verification |
|---|---|---|---|
| Router test count drops; every remaining test is HTTP-shaped | 3 | backend | 16 tests, no business-rule error branches |
| Controller covers every removed business-rule branch | 1 | backend | sanitize-on-update added; all others pre-existing |
| `make test-api` and `make lint` pass | 5 | backend | exit 0 |
| No diff outside `apps/api/test/**` | all | backend | `git diff --stat` |

## Expected test count delta

| Change | Delta |
|--------|-------|
| Remove 13 tests from admin-topics.router.spec.ts | −13 |
| Add 1 test to admin-topics.controller.spec.ts | +1 |
| **Total** | **−12** |

Expected new total: 677 − 12 = **665 tests**.

## Verification

```bash
make lint
make test-api
```

## Out of scope

- Tasks 07–09 (other controller/router pairs).
- `apps/api/src/**` — no production code.
