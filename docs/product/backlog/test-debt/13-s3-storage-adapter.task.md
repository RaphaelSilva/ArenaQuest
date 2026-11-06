# Task 13 — Backend: Binding-less S3 storage adapter for local and E2E runs

**Status:** 📝 Open
**Kind:** Chore
**Team:** Backend API
**Priority:** Medium
**Found in:** Backlog test-debt, Task 11 (E2E scaffold), 2026-11-06

## Summary

`apps/api/src/adapters/storage/r2-storage-adapter.ts` serves one bucket through
**two clients**: the `R2` binding for `putObject`, `getObject`, `deleteObject(s)`,
`headObject`, `readHead` and `listObjects`, and an S3 client (`R2_S3_ENDPOINT`
+ keys) for `getPresignedUploadUrl`, `getPresignedDownloadUrl` and
`objectExists`. In production both reach the same R2 bucket. Locally they do
not: the binding is Miniflare's simulation under `.wrangler/state`, while a
presigned `PUT` lands wherever `R2_S3_ENDPOINT` points. The consequence is
already visible without E2E: an event flyer finalize
(`admin-events.controller.ts:534`, `headObject`) and a submission finalize
(`submissions.controller.ts:483` and `:498`, `headObject` + `readHead`) can never
succeed against a presigned upload in local development, because they read the
binding after the browser wrote to S3. Media finalize
(`admin-media.controller.ts:122`) happens to work because it uses `objectExists`,
which is the one read that goes through S3.

Target state: a second implementation of the existing `IStorageAdapter` port,
`apps/api/src/adapters/storage/s3-storage-adapter.ts`, that serves **every**
method over the S3 client (`PutObject`, `GetObject` with `Range` for
`readHead`, `HeadObject`, `DeleteObject` / `DeleteObjects`, `ListObjectsV2`,
and the two presigns), selected in `container.ts` only when
`env.STORAGE_DRIVER === 's3'`. `R2StorageAdapter` and every deployed
environment are unchanged: no `env.*` block in `wrangler.jsonc` sets the
variable, and a check keeps it that way. This is what lets Task 12's store be
the single bucket an E2E run sees.

## Why It Is Worth Fixing

- Task 11's scenario 8 and the submission journey (scenario 15) are impossible
  otherwise: with the stock adapter the flyer and submission finalizes return
  `422 UPLOAD_MISMATCH` locally for an upload that did land.
- The split is also a trap for manual QA: `make dev-api` with real R2 keys in
  `.dev.vars` uploads to the real bucket and then reads Miniflare — the
  `qa` skill cannot validate finalize today without knowing this.
- The port already exists (`packages/shared/ports/i-storage-adapter.ts`), so
  this is the adapter pattern doing what it was introduced for; no new port,
  no migration, no change to any route or controller.

## Design

- `S3StorageAdapter` takes `{ s3Endpoint, bucketName, accessKeyId,
  secretAccessKey, publicBase? }` — the `R2StorageAdapterConfig` without the
  binding — and builds its `S3Client` with the same options as the R2 one
  (`region: 'auto'`, `forcePathStyle: true`). If the SDK's default request
  checksum (`aws-chunked` + `x-amz-checksum-crc32`) is rejected by a store, the
  client option that turns it to *when required* is set on **both** adapters in
  the same way, so the two never diverge in wire behaviour.
- `readHead` is `GetObject` with `Range: bytes=0-(n-1)`; a `416` or a shorter
  object returns what exists; `NoSuchKey`/`404` returns `null` — the contract
  the binding version already documents.
- `listObjects` maps `ListObjectsV2` (`Prefix`, `MaxKeys` clamped like
  `clampListLimit`, `ContinuationToken`) to `ListObjectsResult` with the same
  cursor semantics as the R2 version.
- Selection: in `container.ts`, `env.STORAGE_DRIVER === 's3' ? new
  S3StorageAdapter(cfg) : new R2StorageAdapter({ bucket: env.R2, ...cfg })`.
  `STORAGE_DRIVER` is declared optional in `worker-configuration.d.ts` through
  `make cf-typegen`, and documented in `.dev.vars.example` as *local only*.
- Guard: `apps/api/test/core/storage-driver-not-deployed.spec.ts` parses
  `wrangler.jsonc` and fails if any `env.*.vars` block or the top-level `vars`
  carries `STORAGE_DRIVER` — the same shape as the existing config guards.
- Contract spec: `apps/api/test/adapters/storage/storage-adapter.contract.ts`
  exports the behavioural cases (put/head/readHead/list/delete round trips,
  missing-key answers) and is run by the existing R2 spec on the Workers
  project and by a new `s3-storage-adapter.spec.ts` on the Node project against
  a stubbed `S3Client.send`. One list of cases, two adapters.

## Scope

In:
- `s3-storage-adapter.ts`, its Node-project spec and the shared contract cases.
- The selection line in `container.ts`, the optional `STORAGE_DRIVER` type and
  `.dev.vars.example` comment.
- The *not deployed* guard spec.

Out:
- Any change to `R2StorageAdapter`'s behaviour, to the port, to controllers,
  routes or migrations.
- Making `STORAGE_DRIVER=s3` the local default or wiring it into `make dev-api`
  (a later decision once E2E has run on it for a while).
- Removing the binding client, or routing production through S3 for anything
  it does not already use S3 for.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/adapters/storage/s3-storage-adapter.ts`
  - `apps/api/src/container.ts` (the storage selection only)
  - `apps/api/worker-configuration.d.ts` (via `make cf-typegen`), `apps/api/.dev.vars.example`
  - `apps/api/test/adapters/storage/**`, `apps/api/test/core/storage-driver-not-deployed.spec.ts`
  - `apps/api/vitest.config.mts` (only if a new include pattern is needed)
- No behaviour change for any request when `STORAGE_DRIVER` is unset: the
  R2 adapter is still constructed with the same config, in the same place.
- No new dependency: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
  are already in `apps/api/package.json`.
- No security boundary moves: the variable is a local-only selector, never a
  value from a request, and the guard spec keeps it out of every deployed
  environment.

## Acceptance Criteria

- [ ] With `STORAGE_DRIVER=s3` and `R2_S3_ENDPOINT` pointing at Task 12's
      embedded store, `wrangler dev` finalises a flyer and a submission uploaded
      through their presigned URLs (`200`, row `ready`), where the stock adapter
      answers `422 UPLOAD_MISMATCH`.
- [ ] With `STORAGE_DRIVER` unset, every existing spec passes unchanged and
      `container.ts` still constructs `R2StorageAdapter`.
- [ ] The contract cases run against both adapters and the two spec files
      share them (one list, imported twice).
- [ ] Adding `"STORAGE_DRIVER": "s3"` to any `env.*.vars` block of
      `wrangler.jsonc` fails `make test-api` with a message naming the block.
- [ ] `readHead` on an object shorter than the requested range returns the
      object's bytes, and on a missing key returns `null`, in both adapters.
- [ ] `make test-api` and `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — existing specs pass unchanged; the new Node-project spec
   and the guard spec are listed in the output.
2. Start `node e2e/s3/embedded-server.mjs --port 8333` (Task 12), run
   `wrangler dev` with `--var STORAGE_DRIVER:s3` and the store's endpoint and
   keys, and walk a submission `presign → PUT → finalize` with `curl`; repeat
   without the variable and record the `422`.
3. Demonstrate the guard: add `STORAGE_DRIVER` to the `budo-staging` vars block,
   run `make test-api`, read the failure, revert.
4. `git diff --stat` confirms only scope-guardrail files changed.
