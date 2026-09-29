# Task 05 — Backend: Seed media: manifest, cache, R2 upload (Phase 1)

**Status:** ✅ Done
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-seed-demo-cli-core.task.md)

## Summary

Gives every demo topic at least one playable media whose object really exists. For each
media the dataset assigns to a topic, the seed computes a deterministic media id and the
object key in the upload path's own shape, `topics/<topicId>/<mediaId>-<name>`, so the
RFC 0018 storage audit classifies it as `linked`. Resolution per object: (1) if the key
already exists in the target bucket, nothing is uploaded; (2) otherwise the file is taken
from the local cache `.arenaquest/demo-media/<sha256>`; (3) otherwise it is downloaded from
the manifest URL and its SHA-256 verified before it enters the cache. Each file passes
`validateMediaFile` (the importer's single preflight over
`packages/shared/domain/media/limits.ts`) and is uploaded with `wrangler r2 object put
<bucket>/<key>` (`--remote` for staging, local bucket for `-e local`) with its content type.
Only after the object is confirmed does the SQL builder emit the `media` row as `ready`
with `uploaded_by` = the demo content creator, `original_name`, `type` and `size_bytes`.
Any download, checksum, validation or upload failure aborts the run before the SQL is
executed — a `ready` row without its object is never written. Existing non-demo objects in
the bucket are never read, linked or modified.

## Dependencies

- [Task 04](./04-seed-demo-cli-core.task.md) — hard: the CLI, target resolution and SQL
  builder this task extends.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/demo/media.mjs` (new) — key derivation, cache, download + checksum, existence
    check, upload.
  - `scripts/demo/seed-demo.mjs`, `scripts/demo/sql.mjs` — wire the media step and the
    `media` rows.
  - `scripts/demo/dataset/base.json` — only the pinned manifest values (URL, SHA-256,
    license) once chosen.
  - `scripts/demo/media.test.mjs` (new).
- **Licensing.** Only CC0 / public-domain sources; each manifest entry records its license
  and source page. Mix `image/*`, `application/pdf` and `video/mp4`; keep the video small
  (well under the 100 MB limit) so a staging reset stays fast.
- **One validator.** Type and size go through `validateMediaFile` from
  `scripts/content/import-media.mjs`; no second copy of the limits.
- **Order of effects.** All objects are present before the SQL containing their rows runs.
- **Network** is used only for step 3 and only for manifest URLs; `--dry-run` never
  downloads or uploads, it prints the per-object plan (exists / cached / download).

## Scope

In:
- Deterministic media ids and keys.
- Bucket existence check, cache, verified download, validation, upload.
- `ready` media rows for every topic; per-object plan in `--dry-run`.
- Tests for key shape, cache hit/miss, checksum mismatch, validation refusal, and "no row
  when upload fails" (wrangler stubbed).

Out:
- Re-linking or copying media owned by non-demo rows (RFC 0021 decision).
- Deleting orphans after a reset — the RFC 0018 audit owns that.

## Acceptance Criteria

- [ ] After `seed-demo -e local`, every one of the 21 topics has ≥ 1 `ready` media and each
      presigned URL returned by `GET /v1/topics/{id}` downloads the file (200). _(Partly verified: 27 `ready` rows over all 21 topics, every object present and SHA-256-checked in the local bucket, and the API returns presigned URLs with the expected keys. The 200 download needs real R2 credentials — `.dev.vars` has empty keys — so it is pending until the first staging seed.)_
- [x] A second run uploads nothing (plan shows every object as "exists").
- [x] A manifest entry with a wrong SHA-256 aborts the run and no `media` row is written.
- [x] A disallowed or oversized file is refused by `validateMediaFile` with the entry named.
- [x] Every key matches `topics/<topicId>/<mediaId>-<name>`.
- [x] `make test-scripts` and `make lint` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `seed-demo --label budo -e local --dry-run` — read the per-object plan.
2. Real local run; `make dev`; open three topics as student-1 and play an image, a PDF and
   the video.
3. Re-run and confirm zero uploads.
4. Corrupt one SHA-256 in a scratch copy of the dataset and confirm the abort.
5. `make test-scripts && make lint`; `git diff --stat` confirms only scope-guardrail files
   changed.

## Implementation notes

- 27 media rows (some topics carry two files), all `ready`; keys `topics/<topicId>/<mediaId>-<name>` with the API's
  `sanitizeFileName` rule (parity test).
- Order in `seed-demo`: write SQL → check bucket → confirm (remote) → download/upload what is missing → `d1 execute`.
  Any media failure aborts before the SQL runs. Uploads are read back and SHA-256 checked.
- Local wrangler R2 calls run serially (parallel local calls hit a wrangler internal error); remote runs 4 at a time.
  A first local run takes ~4 min, a converged re-run ~1.5 min — relevant for the Task 08 CI job.
- Behind a proxy, Node's `fetch` needs `NODE_USE_ENV_PROXY=1` to honour `HTTPS_PROXY`.
- `--dry-run` still reads the bucket to report `exists`, so a staging dry run needs remote R2 credentials.
