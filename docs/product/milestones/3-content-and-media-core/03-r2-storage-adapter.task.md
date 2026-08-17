# Task 03: R2 Storage Adapter

## Metadata
- **Status:** Done
- **Complexity:** Medium
- **Milestone:** 3 — Content & Media Core
- **Dependencies:** none (port already exists in shared)

---

## Summary

Provide a working concrete implementation of `IStorageAdapter` backed by Cloudflare R2. The key design decision is using two access paths: the native R2 binding (for server-side object operations) and the S3-compatible HTTP endpoint (required for presigned URLs that let clients upload directly to storage without passing through the Worker).

---

## Scope

**Dependencies:**
- Add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to `apps/api/package.json`. These packages are confined to the adapter file — no other file in the app may import them.

**Wrangler bindings (`apps/api/wrangler.jsonc`):**
- New R2 bucket binding (`R2`).
- Plain vars: `R2_S3_ENDPOINT`, `R2_PUBLIC_BASE`.
- Secrets (set via `wrangler secret put`): `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

**Adapter (`apps/api/src/adapters/storage/r2-storage-adapter.ts`):**
- Implements every method of `IStorageAdapter`.
- Object operations (put, get, delete, head, list) use the native `R2Bucket` binding.
- Presigned URL operations (upload, download) use the S3 presigner.
- Presigned upload URLs encode `Content-Type` and `Content-Length` so the browser cannot substitute a different MIME or size.
- `getPublicUrl` throws if no `publicBase` is configured (fail-fast).
- Missing credentials at construction time causes an immediate error (no silent failures).

**Tests:**
- Use a fake in-memory `R2Bucket` — no real R2 emulator is available in the Workers test pool.
- Cover: put/get/delete round-trip, head positive + negative, list with pagination, presigned URL format assertions, public URL error path.

**Wiring:**
- Instantiate `R2StorageAdapter` in `buildApp()`. No routes consume it yet; that lands in Tasks 05 and 06.

**Agnosticism contract:** A `grep` in the test suite confirms that `@aws-sdk/*` and R2-specific types appear only inside `apps/api/src/adapters/storage/`.

---

## Acceptance Criteria

- [x] Adapter implements every method of `IStorageAdapter`.
- [x] `wrangler.jsonc` declares the R2 binding, `R2_S3_ENDPOINT`, and `R2_PUBLIC_BASE`.
- [x] `make cf-typegen` produces a clean types file that includes `R2` as `R2Bucket`.
- [x] `@aws-sdk/*` imports are confined to the adapter file (enforced by a grep assertion in tests).
- [x] Constructing the adapter with missing credentials throws immediately.
- [x] Unit tests against a fake R2Bucket pass for all operations.
- [x] `make lint` is clean; all tests pass.
