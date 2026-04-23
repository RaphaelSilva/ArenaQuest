# Task 05: Admin Media API

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 3 — Content & Media Core
- **Dependencies:** Task 02, Task 03

---

## Summary

Implement the media lifecycle management API to enable direct-to-R2 uploads. The system uses a presigned URL strategy where the backend issues authorization for the client to upload directly to storage, maintaining performance and security by keeping file bytes out of the Worker process.

---

## Architectural Context

- **Router:** `apps/api/src/routes/admin-media.router.ts` (Mounted under `/admin/topics/:id/media`)
- **Security:** Guarded by `authGuard` and `requireRole(ADMIN, CONTENT_CREATOR)`.
- **Storage Strategy:** Presigned PUT URLs for R2.
- **Data Integrity:** Database rows track state (`pending` → `ready` → `deleted`).

---

## Requirements

### 1. Media Lifecycle Endpoints

| Method   | Path                  | Description                                                                 |
|----------|-----------------------|-----------------------------------------------------------------------------|
| `POST`   | `/presign`            | Generates a presigned URL and creates a `pending` media record in the DB.   |
| `POST`   | `/:mediaId/finalize`  | Verifies object existence in R2 and updates DB status to `ready`.           |
| `DELETE` | `/:mediaId`           | Removes the media record (soft delete) and attempts R2 object deletion.     |

### 2. Constraints & Validation

- **Type-Specific Size Limits:**
    - PDF: 25 MB
    - MP4: 100 MB
    - Images: 5 MB
- **Storage Layout:** Objects must be keyed as `topics/{topicId}/{mediaId}-{sanitizedName}`.
- **Idempotency:** The `finalize` operation must be idempotent (safe to retry).
- **Atomic Operations:** Ensure DB records are updated before storage deletions to prevent orphan files or broken references.

---

## Acceptance Criteria

- [ ] All endpoints are implemented and correctly RBAC-protected.
- [ ] Presigned URLs are generated with correct content-type and size constraints.
- [ ] Media records transition from `pending` to `ready` only after successful R2 verification.
- [ ] Deletion removes both the database record and the storage object.
- [ ] Integration tests cover the full lifecycle, including error cases for size/type violations.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- Run integration tests in `admin-media.router.spec.ts` using a mock storage adapter.
- `pnpm --filter api test`

### Manual Verification
- Use `curl` or a REST client to perform a full upload flow:
    1. Request presigned URL.
    2. PUT file to R2 (local or staging).
    3. Finalize upload.
    4. Delete media and verify object removal.
