# Plan — 02-remove-low-signal-specs

**Task:** [02-remove-low-signal-specs.task.md](../02-remove-low-signal-specs.task.md)
**Source:** Milestone 8
**Assigned personas:** backend-developer
**Branch:** feature/m8/02-remove-low-signal-specs.task (from feature/m8/01-vitest-dual-project-split.task)

## Objective

Delete or shrink six test artefacts that assert constants, literal returns, or duplicate coverage already present in more appropriate files. No production code is touched. All removals are verified against the existing suite before deletion.

## Affected areas

### In scope (files to modify or delete)
- `apps/api/test/shared-roles.spec.ts` — **DELETE** (tests a string constant)
- `apps/api/test/controllers/health.controller.spec.ts` — **DELETE** (tests literal return values; covered by `test/index.spec.ts`)
- `apps/api/test/index.spec.ts` — remove the `"/health returns ok (unit style)"` test block only
- `apps/api/test/routes/auth.router.spec.ts` — remove the `describe('GET /health (regression)')` block (lines 309–316)
- `apps/api/test/routes/parse-cookie-samesite.spec.ts` — reduce from 11 tests to 4 (keep: `undefined→None`, `Strict`, `Lax`, `invalid→None+warn`)
- `apps/api/test/routes/cors.router.spec.ts` — remove wildcard/matcher describe blocks; keep only the HTTP-smoke describes (`preflight OPTIONS /health` and `simple GET /health`)

### Out of scope
- `apps/api/test/core/cors/origin-policy.spec.ts` — must NOT be touched; it is the source of truth for CORS matcher logic
- Any file under `apps/api/src/**`, `packages/shared/**`, `apps/web/**`

## Step-by-step

### Backend

1. **Verify no cross-file imports before deleting.**
   Run:
   ```bash
   grep -r "shared-roles\|health.controller" apps/api/test/ --include="*.ts"
   ```
   If any file imports these, STOP and emit `BLOCKED:`.

2. **Delete `test/shared-roles.spec.ts`.**
   ```bash
   rm apps/api/test/shared-roles.spec.ts
   ```

3. **Delete `test/controllers/health.controller.spec.ts`.**
   ```bash
   rm apps/api/test/controllers/health.controller.spec.ts
   ```

4. **Remove the unit-style health test from `test/index.spec.ts`.**
   Remove only this block (lines 13–22 approximately):
   ```typescript
   it("/health returns ok (unit style)", async () => {
       const request = new IncomingRequest("http://example.com/health");
       const ctx = createExecutionContext();
       const response = await worker.fetch(request, env as AppEnv, ctx);
       await waitOnExecutionContext(ctx);
       expect(response.status).toBe(200);
       const body = await response.json<{ status: string }>();
       expect(body.status).toBe("ok");
   });
   ```
   The "integration style" test and the 404 test must remain.

5. **Remove the `GET /health (regression)` describe from `test/routes/auth.router.spec.ts`.**
   Remove the entire block at the end of the file (lines 309–316 approximately):
   ```typescript
   describe('GET /health (regression)', () => {
     it('still returns 200 with status ok', async () => {
       ...
     });
   });
   ```

6. **Reduce `test/routes/parse-cookie-samesite.spec.ts` to 4 tests.**
   Keep ONLY these four `it(...)` blocks:
   - `'returns "None" when input is undefined'`
   - `'parses "Strict" correctly'`
   - `'parses "Lax" correctly'`
   - `'falls back to "None" on unrecognised value and logs warning'`

   Delete the remaining 7 tests:
   - `'returns "None" when input is empty string'`
   - `'returns "None" when input is only whitespace'`
   - `'parses "None" correctly'`
   - `'normalises case-insensitive input "strict"'`
   - `'normalises case-insensitive input "NONE"'`
   - `'normalises case-insensitive input "lAx"'`
   - `'trims leading/trailing whitespace before parsing'`

   Remove the `vi` import from the import line if it is no longer used after keeping only the 4 tests (check — `vi` is only used in the warning test, which we keep, so leave the import).

7. **Reduce `test/routes/cors.router.spec.ts` to HTTP smokes only.**
   Keep:
   - Helper functions and constants at top (lines 1–41)
   - `describe('CORS — preflight (OPTIONS /health)')` — 3 tests
   - `describe('CORS — simple request (GET /health)')` — 2 tests

   Delete:
   - `describe('CORS — no console.log regression')` — 1 test (duplicate of simple GET test above)
   - `describe('CORS — wildcard-host: https://*.pages.dev')` — 5 tests
   - `describe('CORS — full wildcard "*" with credentials')` — 3 tests
   - `describe('CORS — mixed exact + wildcard list')` — 3 tests

   These 12 removed tests all verify matcher/parser logic already fully covered by `test/core/cors/origin-policy.spec.ts` (40 tests).

8. **Run full suite to verify.**
   ```bash
   cd apps/api && pnpm test
   ```
   All remaining tests must pass.

## Acceptance Criteria mapping

| AC | Plan step | Persona | Verification |
|---|---|---|---|
| All deletions/reductions applied, suite green | 2–8 | backend | `pnpm test` exit 0 |
| No dangling imports/references to deleted files | 1 | backend | grep confirms no cross-file imports |
| Total test count drops (baseline: 734, expected: ~709) | 2–7 | backend | Test count in summary |
| `make test-api` and `make lint` pass | 8 | backend | exit 0 |
| No diff outside `apps/api/test/**` | all | backend | `git diff --stat` |

## Expected test count delta

| Change | Delta |
|--------|-------|
| Delete `shared-roles.spec.ts` | −1 |
| Delete `health.controller.spec.ts` | −3 |
| Remove unit-style health from `index.spec.ts` | −1 |
| Remove health regression from `auth.router.spec.ts` | −1 |
| Reduce `parse-cookie-samesite.spec.ts` (11→4) | −7 |
| Reduce `cors.router.spec.ts` (17→5) | −12 |
| **Total** | **−25** |

Expected new total: 734 − 25 = **~709 tests** across 59 files (−2 files).

## Risks & open questions

- If `vi` is imported in parse-cookie-samesite.spec.ts and only used in the warning test that we keep, leave the import. Confirm before removing.
- The CORS router test currently has a `BASELINE_ENV` / `BASELINE_ALLOWED_ORIGIN` constant block — these are still needed by the tests we keep, so retain the helpers section intact.

## Verification

```bash
make lint          # from repo root
make test-api      # from repo root
```

Both must exit 0.

## Out of scope

- Touching `apps/api/test/core/cors/origin-policy.spec.ts`.
- Moving any spec files to different directories.
- Any production source file.
