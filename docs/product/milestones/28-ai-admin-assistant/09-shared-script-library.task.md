# Task 09 — Backend: Shared script library for the API client and media conversion (Phase 3)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0025](../../RFCs/0025-ai-admin-assistant.md)
**Team:** Backend API

## Summary

A pure refactor that makes the importer's API client and the converter's `.mov` logic reusable,
so `aq-mcp` (Task 10) uploads media through **the same code** the importer uses — one upload
lifecycle, several callers. `createApiClient`, `withRetry`, `ApiError`, `uploadFile`,
`validateMediaFile`, `contentTypeFor` and `resolveBaseUrl` move from
`scripts/content/import-media.mjs` to `scripts/lib/api-client.mjs`; the remux/transcode ladder
and the `ffmpeg` detection move from `scripts/media/convert-skipped.mjs` to
`scripts/lib/convert.mjs`. Both CLIs re-import them and keep their flags, output and exit codes.
Re-exports from the old modules keep every existing test import working, so the existing test
suites pass **without edits**.

## Dependencies

- None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/lib/api-client.mjs`, `scripts/lib/api-client.test.mjs` — new.
  - `scripts/lib/convert.mjs`, `scripts/lib/convert.test.mjs` — new.
  - `scripts/content/import-media.mjs` — imports (and re-exports) the moved functions.
  - `scripts/media/convert-skipped.mjs` — imports (and re-exports) the moved functions.
- **Behaviour-preserving.** No change to any flag, message, retry rule, limit or exit code.
- **Existing tests untouched.** `import-media.test.mjs` and `convert-skipped.test.mjs` are not
  edited; their passing unchanged is the proof of the refactor.
- **Limits stay single-sourced.** `validateMediaFile` keeps reading
  `packages/shared/domain/media/limits.ts`.
- **No new dependency.**

## Scope

In:
- The two new library modules with focused tests, the two CLIs rewired.

Out:
- Any new behaviour — `aq-mcp` is Task 10.
- `apps/**`.

## Acceptance Criteria

- [ ] `node --test scripts/content/import-media.test.mjs scripts/media/convert-skipped.test.mjs`
      passes with both test files byte-identical to `main`.
- [ ] `node --test scripts/lib/` passes.
- [ ] `make import-media-staging SOURCE=<fixture> DRY_RUN=1` and
      `make convert-skipped … DRY_RUN=1` print the same plan as on `main` for the same input.
- [ ] `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/content/ scripts/media/ scripts/lib/`.
2. Run both dry runs on `main` and on the branch; `diff` the outputs.
3. `git diff --stat` confirms only scope-guardrail files changed and the two test files are absent.
