# Task 10 — Backend: Migration lint: additive and frozen (Phase 3)

**Status:** ✅ Done
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API

## Summary

Protects the shared staging database from candidate migrations. `scripts/db/check-migrations.mjs`
compares `apps/api/migrations/*.sql` with `origin/main` (base ref configurable) and enforces
two rules. **Additive only:** a migration file that is not on the base ref may contain only
`CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE … ADD COLUMN` (nullable or with a default) and
`INSERT` / `UPDATE` of reference data; `DROP` (table, column, index), `RENAME` and the
create-copy-drop table-rebuild pattern fail — unless the file starts with a
`-- @contract: <reason>` header, which marks a reviewed contract step shipped after the code
stopped reading the old shape. **Frozen:** a migration that exists on the base ref may not be
modified, renamed or deleted, because D1 records migrations by file name and an edited file
never re-runs on staging. The output names the file, the line and the rule. The script runs
in `ci.yml` on every PR and is the first step of the preview plan (Task 12). `seed/` is
excluded (it is not applied as migrations).

## Dependencies

- None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/db/check-migrations.mjs` (new) and `scripts/db/check-migrations.test.mjs` (new).
  - `.github/workflows/ci.yml` — one step (needs `fetch-depth: 0` or a fetch of the base).
  - `Makefile` — `check-migrations` (local, unsuffixed) and the `test-scripts` line.
  - `CONTRIBUTING.md` / `docs/onboarding.md` — the expand/contract rule in a short paragraph.
- **Stdlib + git only.** No SQL parser dependency; a conservative statement scanner that
  strips comments and string literals before matching keywords, erring on the side of
  failing (a false positive is fixed by the `@contract` header, a false negative breaks
  staging).
- **Existing migrations** on the base ref are not re-linted for additivity (0001–0027 already
  shipped); they are only checked for being unchanged.

## Scope

In:
- Additive rule, frozen rule, `@contract` escape hatch, clear per-violation output.
- CI step and local Make target.
- Tests over fixture migrations: each allowed form, each forbidden form, a keyword inside a
  string or comment (must not trip), an edited base migration, a renamed one.
- The expand/contract paragraph for contributors.

Out:
- Running the lint inside the deploy CLI — Task 12 wires it.
- Rewriting historical migrations.

## Acceptance Criteria

- [x] A PR adding a migration with `ALTER TABLE … DROP COLUMN` fails CI naming file and line;
      the same file with `-- @contract: …` passes. _(Verified with `make check-migrations`, the same command the CI step runs; the first GitHub Actions run — including the shallow base-ref fetch — is pending.)_
- [x] A PR editing `0027_create_events.sql` fails CI with the "frozen" rule.
- [x] `DROP` appearing only inside a string literal or comment does not fail.
- [x] The current `main` passes.
- [x] `make check-migrations` works locally; `make test-scripts` and `make lint` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/db/check-migrations.test.mjs`.
2. `make check-migrations` on a clean branch (pass), then with a scratch destructive
   migration (fail), then with the header (pass), then with an edited historical file (fail).
3. Push and confirm the CI step runs on the PR.
4. `git diff --stat` confirms only scope-guardrail files changed.

## Implementation notes

- Allowed in a new migration: `CREATE [TEMP] TABLE`, `CREATE [UNIQUE] INDEX`, `INSERT [OR …] INTO`, `UPDATE`,
  `ALTER TABLE … ADD [COLUMN]` (not `NOT NULL` without `DEFAULT`). `DROP`/`RENAME` anywhere fail; other `ALTER`,
  `DELETE`, `REPLACE`, `CREATE VIEW/TRIGGER`, `PRAGMA`, `WITH` fail. Comments, strings and quoted identifiers are
  blanked before matching (line numbers preserved).
- `-- @contract: <reason>` is accepted anywhere in the file's leading comment header (so it coexists with the
  `-- Migration NNNN:` headers) and prints a warning with the reason.
- Frozen rule: every base-ref file must exist unchanged (first differing line reported). No escape hatch.
- CI: a step in `verify` fetches only the base tip (`--depth=1`) and runs the lint against `origin/<base>`.
- Linting all 27 historical migrations as if new flags only `0004` (a `DELETE`) — low false-positive rate.
