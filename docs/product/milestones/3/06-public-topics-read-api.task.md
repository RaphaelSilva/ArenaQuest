# Task 06: Public Topics Read API

## Metadata
- **Status:** Done
- **Complexity:** Low
- **Milestone:** 3 — Content & Media Core
- **Dependencies:** Task 04, Task 05

---

## Summary

Implement the public-facing API for the student catalogue. This API provides read-only access to published content and media, ensuring that internal drafts and archived content remain strictly confidential.

---

## Architectural Context

- **Router:** `apps/api/src/routes/topics.router.ts`
- **Security:** Guarded by `authGuard` (any authenticated user can read).
- **Access Control:** Strictly limited to `published` nodes and `ready` media.
- **Performance:** Implements client-side caching for efficient browsing.

---

## Requirements

### 1. Catalogue Endpoints

| Method | Path         | Description                                                                 |
|--------|--------------|-----------------------------------------------------------------------------|
| `GET`  | `/topics`    | Returns the full catalogue tree (published only), ordered by parent and sort order. |
| `GET`  | `/topics/:id`| Returns details for a specific published topic, including its published children and ready media. |

### 2. Media Access

- **Secure Downloads:** For every `ready` media item, the API must generate a short-lived presigned download URL.
- **State Filtering:** Media in `pending` or `deleted` states must be excluded from public responses.

### 3. Caching & Performance

- Set `Cache-Control: private, max-age=30` to optimize repeated reads while ensuring relatively fresh content for students.

---

## Acceptance Criteria

- [x] Endpoints are correctly implemented and accessible to authenticated users.
- [x] Content filtering is verified: `draft` and `archived` content is unreachable (404).
- [x] Media filtering is verified: Only `ready` media is returned with valid download URLs.
- [x] Response headers include correct caching directives.
- [x] Integration tests verify security boundaries and content visibility.
- [x] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- Run integration tests in `topics.router.spec.ts` covering visibility and RBAC.
- `pnpm --filter api test`

### Manual Verification
- Verify visibility via a student account:
    1. Confirm `draft` topics do not appear in the catalogue.
    2. Confirm `published` topics and their media are accessible.
    3. Verify that `pending` media does not appear even if the parent topic is published.
