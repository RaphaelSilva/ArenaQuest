# Plan — 07-refactor-admin-media-pair

**Task:** [07-refactor-admin-media-pair.task.md](../07-refactor-admin-media-pair.task.md)
**Source:** Milestone 8
**Assigned personas:** backend-developer
**Branch:** feature/m8/07-refactor-admin-media-pair.task (from feature/m8/06-refactor-admin-topics-pair.task)

## Objective

Apply the router-vs-controller convention to the `admin-media` pair. The router spec (~22 tests) has ~85% overlap with the controller spec per RFC §D2. Trim to HTTP smokes: presign 201+DTO, role smoke, finalize happy path, delete 204+verification, and full lifecycle. Add 3 missing business-rule tests to the controller spec (storage key pattern, FileTooLarge for MP4 and image limits) before removing them from the router. Replace inline MIGRATION_SQL with applyMigrations().

## Affected areas

- `apps/api/test/routes/admin-media.router.spec.ts` — remove 15 business-rule tests, replace inline migrations
- `apps/api/test/controllers/admin-media.controller.spec.ts` — add 3 missing tests to `presignUpload` describe

Out of scope: `apps/api/src/**`, R2 adapter spec, any other spec file.

## Step-by-step

### Backend

1. **Add 3 missing controller tests** in `admin-media.controller.spec.ts`, inside the `presignUpload` describe block:

   ```typescript
   it('generates storage key in topics/{topicId}/{mediaId}-{safeName} pattern', async () => {
     await controller.presignUpload('topic-1', { fileName: 'My Document.pdf', contentType: 'application/pdf', sizeBytes: 1_000_000 }, 'user-1');
     const createArg = (mediaRepo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
     expect(createArg.storageKey).toMatch(/^topics\/topic-1\/[\w-]+-my-document\.pdf$/);
   });

   it('returns 422 FileTooLarge for MP4 exceeding 100 MB', async () => {
     const result = await controller.presignUpload('topic-1', { fileName: 'huge.mp4', contentType: 'video/mp4', sizeBytes: 101 * 1024 * 1024 }, 'user-1');
     expect(result.ok).toBe(false);
     if (result.ok) return;
     expect(result.status).toBe(422);
     expect(result.error).toBe('FileTooLarge');
   });

   it('returns 422 FileTooLarge for image exceeding 5 MB', async () => {
     const result = await controller.presignUpload('topic-1', { fileName: 'big.jpeg', contentType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 }, 'user-1');
     expect(result.ok).toBe(false);
     if (result.ok) return;
     expect(result.status).toBe(422);
     expect(result.error).toBe('FileTooLarge');
   });
   ```

2. **Replace inline MIGRATION_SQL** in `admin-media.router.spec.ts`:
   - Remove `const MIGRATION_SQL = [...]` (lines 10–81)
   - Remove `const ADMIN_USER_ID = 'admin-media-test-user';` (keep value inline in beforeAll)
   - Add import: `import { applyMigrations } from '../helpers/apply-migrations';`
   - In `beforeAll`, replace `await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));` with `await applyMigrations(env.DB);`
   - Keep the `ADMIN_USER_ID` constant in scope for the `uploaded_by` FK insert

3. **Remove 15 business-rule tests** from `admin-media.router.spec.ts`:

   **POST /admin/topics/:topicId/media/presign:**
   - `'storage key follows the topics/{topicId}/{mediaId}-{safeName} pattern'` → controller: presignUpload > generates storage key… (added in step 1)
   - `'returns 404 when topic does not exist'` → controller: presignUpload > returns 404 when topic does not exist
   - `'returns 400 for unsupported content type'` → controller: presignUpload > returns 400 for unsupported content type
   - `'returns 400 for missing fileName'` → controller: presignUpload > returns 400 for invalid body schema
   - `'returns 422 FileTooLarge for PDF exceeding 25 MB'` → controller: presignUpload > returns 422 FileTooLarge when sizeBytes exceeds the limit
   - `'returns 422 FileTooLarge for MP4 exceeding 100 MB'` → controller: (added in step 1)
   - `'returns 422 FileTooLarge for image exceeding 5 MB'` → controller: (added in step 1)
   - `'accepts a file at exactly the size limit boundary'` → controller: presignUpload > accepts a file at exactly the size limit boundary

   **POST finalize:**
   - `'finalize is idempotent — second call on ready record returns 200 without error'` → controller: finalizeUpload > is idempotent
   - `'returns non-200 when object is not in R2 yet (S3 unreachable in sandbox)'` → controller: finalizeUpload > returns 422 NotUploaded when object is not yet in storage (plus this test is non-deterministic in sandbox)
   - `'returns 404 for an unknown mediaId'` → controller: finalizeUpload > returns 404 for unknown mediaId
   - `'returns 404 when mediaId belongs to a different topic'` → controller: finalizeUpload > returns 404 when media belongs to a different topic

   **DELETE:**
   - `'returns 204 even when the R2 object no longer exists (best-effort deletion)'` → controller: deleteMedia > succeeds even when storage.deleteObject rejects (best-effort)
   - `'returns 404 for an unknown mediaId'` → controller: deleteMedia > returns 404 for unknown mediaId
   - `'returns 404 when mediaId belongs to a different topic'` → controller: deleteMedia > returns 404 when media belongs to a different topic

4. **Tests to keep** in router spec (6):
   - `'requires admin: POST presign -> 401 without token'` (auth smoke)
   - POST presign: `'returns 201 with uploadUrl and a pending media record'` (201 + DTO shape)
   - POST presign: `'content_creator can request a presigned URL'` (role smoke)
   - POST finalize: `'transitions status from pending to ready when object exists in R2'` (HTTP happy path smoke)
   - DELETE: `'soft-deletes the DB record and removes the R2 object, returns 204'` (204 + DB/R2 verification)
   - Full lifecycle: `'completes the entire presign → finalize → delete flow'` (end-to-end wiring smoke)

5. **Run verification:**
   ```bash
   cd /home/my-ubuntu/projects/ArenaQuest && make lint && make test-api
   ```

## Coverage cross-list

| Removed from router | Covered in controller |
|---|---|
| presign — storage key pattern | presignUpload > generates storage key… (added) |
| presign — 404 bad topic | presignUpload > returns 404 when topic does not exist |
| presign — 400 unsupported type | presignUpload > returns 400 for unsupported content type |
| presign — 400 missing fileName | presignUpload > returns 400 for invalid body schema |
| presign — 422 PDF too large | presignUpload > returns 422 FileTooLarge when sizeBytes exceeds the limit |
| presign — 422 MP4 too large | presignUpload > returns 422 FileTooLarge for MP4 (added) |
| presign — 422 image too large | presignUpload > returns 422 FileTooLarge for image (added) |
| presign — boundary accepted | presignUpload > accepts a file at exactly the size limit boundary |
| finalize — idempotent 2nd call | finalizeUpload > is idempotent |
| finalize — non-200 when not in R2 | finalizeUpload > returns 422 NotUploaded (+ test was non-deterministic in sandbox) |
| finalize — 404 unknown media | finalizeUpload > returns 404 for unknown mediaId |
| finalize — 404 wrong topic | finalizeUpload > returns 404 when media belongs to a different topic |
| delete — 204 best-effort | deleteMedia > succeeds even when storage.deleteObject rejects |
| delete — 404 unknown media | deleteMedia > returns 404 for unknown mediaId |
| delete — 404 wrong topic | deleteMedia > returns 404 when media belongs to a different topic |

## Expected test count delta

| Change | Delta |
|--------|-------|
| Remove 15 tests from admin-media.router.spec.ts | −15 |
| Add 3 tests to admin-media.controller.spec.ts | +3 |
| **Total** | **−12** |

Expected new total: 665 − 12 = **653 tests**.

## Verification

```bash
make lint
make test-api
```

## Out of scope

- Tasks 08–09. `apps/api/src/**`.
