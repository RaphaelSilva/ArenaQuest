# Task 04 — Backend: Seed CLI: users, groups, topics, enrollments, tags (Phase 1)

**Status:** ✅ Done
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-demo-ids-and-dataset.task.md)

## Summary

Delivers the `seed-demo` CLI and the relational core of the demo. `node
scripts/demo/seed-demo.mjs --label <l> -e local|staging [--dry-run] [--yes]` resolves the
target from the label profile the same way the deploy CLI does (local → the local replica
`arenaquest-db --local`; staging → the profile's staging D1 and wrangler env
`<label>-staging`), **refuses `-e production` and any D1 name or bucket that appears in any
profile's `production` block**, prompts before a remote write (naming the database) unless
`--yes`, and reads `AQ_DEMO_PASSWORD` from the environment only. From the Task 03 dataset
it builds one SQL file (`.arenaquest/demo-<label>-<env>.sql`, gitignored) that upserts, by
deterministic id: the six users (PBKDF2 hash in the `JwtAuthAdapter` format
`pbkdf2:100000:<saltHex>:<keyHex>`, computed at run time) and their `user_roles`; the
*Demo class* group and members; the 21 topic nodes with parent, sort order, status,
visibility, `estimated_minutes` and content (`sample-topic.md` with the title interpolated,
passed through `sanitizeMarkdown`); the tags and topic-tag links; and the enrollments
(group grant on Root 2, user grant on Root 3, `granted_by` = demo admin). It runs that file
with `wrangler d1 execute --file` and prints a per-entity summary. `--dry-run` writes the SQL
and stops. A re-run converges: no duplicate rows, changed dataset values are updated. Tasks
05, 06 and 14 add their statements to the same builder.

## Dependencies

- [Task 03](./03-demo-ids-and-dataset.task.md) — hard: ids, dataset and loader.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/demo/seed-demo.mjs` (new) — CLI, target resolution, prompt, execution.
  - `scripts/demo/sql.mjs` (new) — pure SQL builder (dataset → statements).
  - `scripts/demo/hash.mjs` (new) — PBKDF2 hash in the adapter's format.
  - `scripts/demo/*.test.mjs` (new) and the `Makefile` `test-scripts` line.
  - `.gitignore` — only if `.arenaquest/` is not already ignored.
- **Reuse, don't fork.** Target resolution reuses `scripts/label.mjs` (profile loading,
  wrangler env naming); markdown sanitising imports `packages/shared/utils/sanitize-markdown.ts`
  the way the importer does; the hash format is pinned by a test against a hash produced by
  `apps/api/scripts/gen-hash.ts`.
- **Idempotent SQL.** Every write is an upsert on the primary key; join tables use their
  composite keys; nothing is deleted.
- **Credentials.** `AQ_DEMO_PASSWORD` required for any non-dry run; never accepted on argv,
  never logged, never written to the SQL file in clear (only the hash).
- **Production is unreachable** by construction: the refusal happens before any file is
  written or any wrangler process is spawned.
- **Topic `sort_order`** is written explicitly from the dataset (not derived with
  `MAX(sort_order)`), so re-runs never reorder.

## Scope

In:
- CLI flags, profile-based target resolution, the production refusal, the remote prompt.
- SQL builder for users, roles, group, members, topics, tags, topic-tags, enrollments.
- Execution through wrangler and a summary report; `--dry-run`.
- Unit tests for the builder (statement per entity, upserts, sanitised content) and for the
  refusal rules.

Out:
- Media (Task 05), gamification (Task 06), events/billing/tasks/comments (Task 14).
- Makefile targets and the CI job (Task 08).

## Acceptance Criteria

- [x] `seed-demo --label budo -e local` on a freshly migrated replica creates 6 users with the
      expected roles, 1 group with 2 members, 21 topics (3 roots, depth 3), 2 tags and the two
      enrollments; a second run leaves every row count unchanged.
- [x] `demo.admin@budo.demo.invalid` logs in on `make dev` with `AQ_DEMO_PASSWORD`.
- [x] As student-1 the catalog shows Root 1 and Root 2 (not the private lesson, not Root 3);
      as student-3 it shows Root 1 and Root 3 without the draft module.
- [x] `-e production`, and `-e staging` with a profile whose staging D1 equals a production
      D1 name, exit non-zero before writing any file.
- [x] A non-dry run without `AQ_DEMO_PASSWORD` exits non-zero with a message naming the
      variable.
- [x] `make test-scripts` and `make lint` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, then `AQ_DEMO_PASSWORD=… node scripts/demo/seed-demo.mjs --label
   budo -e local`; count rows per table with `wrangler d1 execute --local`.
2. Run it again; compare counts.
3. `make dev`, log in as demo admin, student-1 and student-3; check the catalog per the
   criteria above.
4. Try `-e production` and a run without the variable.
5. `make test-scripts && make lint`; `git diff --stat` confirms only scope-guardrail files
   changed.

## Implementation notes

- Extension point for Tasks 05/06/14: a section is `{ name, build(dataset, ctx) → { statements, counts } }`;
  `SECTIONS` in `scripts/demo/sql.mjs` is ordered by foreign keys (users, groups, tags, topics, enrollments).
- `sanitizeMarkdown` is the shared TS util transpiled in memory with the workspace `typescript` (CI runs Node 20,
  which cannot import `.ts`), so the seed stores exactly what the API would.
- The local replica is addressed as `arenaquest-db --local` for every label (the label only picks the dataset);
  it is exempt from the production-name refusal because it is never addressed remotely.
- `password_hash` is rewritten on every run (fresh salt) — re-running with a new `AQ_DEMO_PASSWORD` rotates it.
- A demo row colliding with a non-demo row (same e-mail, tag slug or group name) fails the run instead of adopting it.
- Verified locally: first and second run give identical counts; demo admin, student-1 and student-3 catalogs match
  the criteria through the API (`make dev-api`). Staging exercised by `--dry-run` only.
