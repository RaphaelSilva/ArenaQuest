# Task 06 — Backend: Importer README tags (Phase 2)

**Status:** ✅ Done
**Milestone:** [24 — Catalog search by tags](./milestone.md)
**RFC:** [RFC 0017](../../RFCs/0017-catalog-search-by-tags.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-shared-text-normaliser-and-tag-slugify.task.md), [Task 02](./02-tag-authoring-api.task.md)

## Summary

Lets an existing content tree be tagged in bulk from the same README that already drives
each topic (RFC 0017 Design §6, milestone Objective 8). The `arenaquest` fence accepted by
`scripts/content/import-media.mjs` gains an optional `"tags": string[]` key. On create, the
names are sent as Task 02's `tags` field. On a re-run, the drift check compares the fence's
tags with the reused topic's tags **as slug sets**, so re-casing or re-accenting a name in
the README is not drift, while adding or removing a tag is — and an unchanged tree still
performs zero writes. A `tags` value that is not an array of strings is a warning and is
ignored, like any other malformed fence key; it never fails the run. The dry run shows the
planned tags per topic. Because the importer is stdlib Node and cannot import TypeScript
from `packages/shared`, it carries its own `slugify`, and its test suite asserts parity
with the shared implementation by reading Task 01's `slugify.fixtures.json`.

## Dependencies

- [Task 02](./02-tag-authoring-api.task.md) — hard code dependency: the API must accept
  `tags` on create/update.
- [Task 01](./01-shared-text-normaliser-and-tag-slugify.task.md) — the fixture file the
  parity test reads.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/content/import-media.mjs` — fence parsing, create/update payload, drift
    comparison, dry-run output, local `slugify`.
  - `scripts/content/import-media.test.mjs` — new cases.
- **Same write path.** Tags travel only through the public admin topics API, as every other
  topic field; the importer gains no new endpoint and no direct database access.
- **No new dependency.** Stdlib Node only, as today.
- **Backwards compatible.** A README without `tags` behaves exactly as before; a fence that
  previously parsed still parses.
- **Idempotency preserved.** The no-op re-run guarantee documented in `CLAUDE.md` holds with
  tags present.

## Scope

In:
- `"tags"` in the fence, validated, warned on when malformed.
- `tags` sent on topic create and on drift-triggered update.
- Slug-set drift comparison.
- Dry-run output listing planned tags.
- Tests: fence parsing (valid, missing, malformed), drift detection (same set with
  different casing = no drift; added/removed tag = drift), slug parity against the shared
  fixture.

Out:
- Tags on media files — tags belong to topics only.
- The `--manifest` path, which never touches topics.
- Documentation of the new key — Task 07.

## Acceptance Criteria

- [x] A README with `"tags": ["Soco", "Kihon"]` produces a create request carrying
      `tags: ["Soco", "Kihon"]` (asserted through the injected `fetchImpl`).
- [x] A dry run prints the planned tags for that topic and performs no request that writes.
- [x] Re-running over an unchanged tree whose topic already carries `soco` and `kihon`
      performs zero write requests, including when the README spells them `SOCO` / `kihon`.
- [x] Adding a tag to the README triggers exactly one `PATCH` for that topic.
- [x] `"tags": "soco"` and `"tags": [1]` each yield a warning and no `tags` in the request.
- [x] The parity test passes for every row of `packages/shared/domain/tags/slugify.fixtures.json`.
- [x] `make test-scripts` (the importer's `node --test` suite) and `make test-api` are
      green; the script lints clean.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/content/import-media.test.mjs` — new and existing cases pass.
2. `make dev-api` + `AQ_API_BASE_URL=http://localhost:8787` — import a small local tree
   whose READMEs declare tags; run it twice and confirm the second run reports no writes;
   check the tags in the catalog.
3. `make lint` — clean.
4. `git diff --stat` confirms only scope-guardrail files changed.
