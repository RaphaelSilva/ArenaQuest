# Task 03 — Backend: R2 media mirror (Phase 0)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0023](../../RFCs/0023-ai-admin-assistant.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-backup-bucket-and-provision-check.task.md)

## Summary

Adds `scripts/backup/mirror-r2.mjs`, an incremental copy of a production label's media bucket
into its backup bucket under `r2/`. It lists the source (paginated), copies every object whose
key is absent from the mirror or whose ETag differs, and **never deletes on the pass that
notices a removal**: an object gone from the source is recorded with its removal date in a
mirror index and pruned only after the profile's tombstone window (90 days). That window is what
makes an accidental delete in the media bucket recoverable. Each run records its outcome in the
backup manifest (Task 02's module) — objects and bytes copied, objects pending, tombstones,
duration — which Task 11 reports as mirror lag. Submissions (`submissions/` prefix) are mirrored
with the rest; nothing in the mirror is ever served publicly.

## Dependencies

- [Task 01](./01-backup-bucket-and-provision-check.task.md) — hard dependency: the backup bucket
  and its tombstone retention.
- Uses the manifest module from [Task 02](./02-d1-export-and-manifest.task.md) — ordering
  preference only; if Task 03 lands first it introduces that module and Task 02 reuses it.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/backup/mirror-r2.mjs` and `scripts/backup/mirror-r2.test.mjs`.
  - `scripts/backup/manifest.mjs` — the `r2` section only.
  - `scripts/backup/s3.mjs` and its test — the S3-compatible list/copy/head client the mirror
    needs (signing library chosen here, recorded in the file header).
  - `Makefile` — `backup-r2-prod` (confirms).
  - The root `package.json` / lockfile — only if a signing dependency is added.
- **Source is read-only.** The mirror never writes, deletes or overwrites anything in the media
  bucket; a test asserts no mutating call targets the source.
- **Bounded and resumable.** A run stops cleanly at a byte or time budget and the next run
  continues from what is missing; no state lives outside the backup bucket.
- **Prune is explicit.** Only tombstones older than the window are deleted from the mirror, and
  the count of pruned objects is logged.
- **No object content in logs.** Keys and sizes only.

## Scope

In:
- Listing, diffing by key + ETag, copying, tombstoning, pruning, manifest update.
- The minimal S3 client.
- Tests with the client stubbed: new object, changed ETag, source deletion, prune after the
  window, budget stop and resume.

Out:
- Scheduling — Task 04.
- Restoring objects back into the media bucket — documented as a manual step in Task 04's
  runbook.
- Off-account copies (milestone Decision 8).

## Acceptance Criteria

- [ ] A first run copies every source object; a second run with no source change copies nothing.
- [ ] Changing one object's bytes in a test double copies only that object.
- [ ] Deleting a source object keeps it in the mirror with a removal date; it is pruned only once
      the window has passed (time injected in tests).
- [ ] No call that writes or deletes is issued against the source bucket (asserted).
- [ ] The manifest's `r2` section reports copied, pending and tombstoned counts after each run.
- [ ] `node --test scripts/backup/` green; `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/backup/mirror-r2.test.mjs scripts/backup/s3.test.mjs`.
2. Run against a **staging** media bucket into a scratch prefix with an explicit override flag
   used only for this verification; confirm counts.
3. Delete one staging object and re-run; confirm the tombstone.
4. `git diff --stat` confirms only scope-guardrail files changed.
