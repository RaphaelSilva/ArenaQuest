# Task 07 — Backend: Local seed, docs and closeout (Phase 3)

**Status:** 📝 Open
**Milestone:** [24 — Catalog search by tags](./milestone.md)
**RFC:** [RFC 0017](../../RFCs/0017-catalog-search-by-tags.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-tag-authoring-api.task.md), [Task 03](./03-catalog-search-matcher-and-sidebar.task.md), [Task 04](./04-topic-page-tag-chips.task.md), [Task 05](./05-admin-tag-combobox.task.md), [Task 06](./06-importer-readme-tags.task.md)

## Summary

Closes the milestone: a local seed so anyone can see tag search working on a fresh
machine, the documentation that tells users and operators it exists, and the status
updates that mark RFC 0017 done. A new local-only seed adds a small, tagged topic tree —
including an accented title and a topic findable only by tag — so `make db-reset-local`
followed by `make dev` demonstrates every RFC *Motivation* case. `docs/product/FEATURES.md`
gains a catalog-search entry; the importer paragraph in `CLAUDE.md` documents the fence's
`"tags"` key next to `order` / `status` / `estimatedMinutes` / `title`. The closeout note
records what shipped, what was deferred (content search, fuzzy matching, tag admin,
inheritance, home-grid filtering) and any deviation from the plan; RFC 0017 moves to
`Implemented` in its header and README row, and the milestone status to ✅.

## Dependencies

- [Task 02](./02-tag-authoring-api.task.md), [Task 03](./03-catalog-search-matcher-and-sidebar.task.md),
  [Task 04](./04-topic-page-tag-chips.task.md), [Task 05](./05-admin-tag-combobox.task.md),
  [Task 06](./06-importer-readme-tags.task.md) — ordering dependency: the closeout
  documents what they shipped; the seed exercises Tasks 03–04.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/seed/0004_catalog_tags_local.sql` (new, local only).
  - `Makefile` — **only** to add the new file to the `db-seed-local` target, which lists
    each seed file explicitly.
  - `docs/product/FEATURES.md` — one catalog-search entry.
  - `CLAUDE.md` — the importer README-fence paragraph only.
  - `docs/product/RFCs/0017-catalog-search-by-tags.md` — `Status:` line only.
  - `docs/product/RFCs/README.md` — the 0017 row only.
  - `docs/product/milestones/24-catalog-search-by-tags/milestone.md` — `Status:` and §5
    status column only.
  - `docs/product/milestones/24-catalog-search-by-tags/closeout-analysis.md` (new; stays
    local per the repo's gitignore of closeouts).
- **Seed safety.** The seed is idempotent (`INSERT OR IGNORE` style), local only, and must
  pass the no-dev-seed guard (`apps/api/scripts/check-no-dev-seed.ts`) — it is never applied
  to staging or production.
- **No schema change.** The seed writes only `topic_nodes`, `tags` and `topic_node_tags`
  rows; no DDL.

## Scope

In:
- Local seed: a root with children, one accented title (`Chūdan Tsuki`), tags `soco`,
  `kihon`, `faixa-amarela`, and one topic reachable only through a tag. Topics are
  `published` and visible to the seeded student account.
- `FEATURES.md` entry; `CLAUDE.md` importer fence documentation.
- Status updates for RFC 0017, its README row and the milestone.
- Closeout note.

Out:
- Any code change — if the closeout surfaces a defect, file a follow-up task.

## Acceptance Criteria

- [ ] `make db-reset-local` applies the seed twice without error (idempotent), and the
      seeded student sees the tagged tree in `/catalog`.
- [ ] In `make dev`, every row of RFC 0017's *Motivation* table finds its topic against the
      seeded data.
- [ ] The no-dev-seed guard passes for a staging dry-run deploy.
- [ ] `CLAUDE.md` shows `"tags"` in the fence example and explains slug-set drift.
- [ ] RFC 0017 header and README row read `Implemented`; milestone status is ✅ and every
      §5 row is Done.
- [ ] `make lint`, `make test-api` and `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` twice, then `make dev`; log in as the seeded student and walk the
   *Motivation* cases in the sidebar.
2. `node scripts/cloudflare/deploy.mjs --label arenaquest -e staging --dry-run` — the
   no-dev-seed guard passes.
3. `node .claude/skills/write-rfc/check-rfc.mjs` and
   `node .claude/skills/write-tasks/check-task.mjs --milestone 24` — clean.
4. `git diff --stat` confirms only scope-guardrail files changed.
