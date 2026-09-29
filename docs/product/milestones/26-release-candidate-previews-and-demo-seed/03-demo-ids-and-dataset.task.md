# Task 03 — Backend: Demo ids and baseline dataset (Phase 1)

**Status:** 📝 Open
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API

## Summary

Defines **what** the demo is, separately from **how** it is written. `scripts/demo/ids.mjs`
derives every demo id as a UUIDv5 from one fixed demo namespace and the name
`<label>:<entity>:<key>` (for example `budo:topic:root-2/module-1/lesson-2`), so ids are
stable across runs and valid for the API's `uuid()` route params; it also exposes the list
of demo user ids for any label (Task 07 needs it) and the demo e-mail rule
`demo.<key>@<label>.demo.invalid`. `scripts/demo/dataset/base.json` is the label-agnostic
baseline: the six users and their roles (admin, content_creator, tutor, student-1..3), the
group *Demo class* and its members, the three roots × two modules × two lessons tree with
titles, `estimated_minutes`, status and visibility per node (Root 1 public, Root 2
group-granted, Root 3 user-granted to student-3, one private lesson, one draft module), the
tags `demo` and `beginner` and where they attach, the media manifest entries (key, MIME type,
source URL, SHA-256, license — CC0/public domain only) and which topic uses which, and the
gamification state table from RFC 0021 §3.4. `scripts/demo/dataset/sample-topic.md` is the
markdown every topic carries, covering the whole basic syntax (headings h1–h3, paragraphs and
line breaks, bold / italic / both, nested blockquote, nested ordered and unordered lists,
inline code and a fenced block, horizontal rule, links, image link) with a `{{title}}` slot.
An optional `config/labels/<label>/demo.json` may override titles/language and add media;
the loader merges it over the base and validates the result. Tasks 04–06 and 14 consume this.

## Dependencies

- None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/demo/ids.mjs`, `scripts/demo/dataset.mjs` (loader + validation) (new).
  - `scripts/demo/dataset/base.json`, `scripts/demo/dataset/sample-topic.md` (new).
  - `scripts/demo/ids.test.mjs`, `scripts/demo/dataset.test.mjs` (new) and their line in the
    `Makefile` `test-scripts` target.
- **Stdlib only** (Node ≥ 22 `node:crypto` for SHA-1 in UUIDv5), like the deploy CLI.
- **Data, not behaviour.** No wrangler call, no SQL, no network in this task.
- **Role names** are exactly those seeded by `apps/api/migrations/0002_seed_roles.sql`
  (`admin`, `content_creator`, `tutor`, `student`); badge and quest slugs are those of
  `0021` / `0019`. The loader fails on an unknown one.
- **Media limits** come from `packages/shared/domain/media/limits.ts` — the loader rejects a
  manifest entry whose type is not allowed.
- **No password, hash or secret** in any dataset file.

## Scope

In:
- UUIDv5 derivation with a committed namespace constant and a documented name format.
- The e-mail rule and the "all demo user ids for label X" helper.
- `base.json` with every entity listed in the Summary; `sample-topic.md`.
- Loader: merge the optional label override, validate structure, roles, slugs, media types,
  tree depth (exactly 3) and that every topic resolves ≥ 1 media.
- Unit tests for determinism, UUID shape, merge and every validation failure.

Out:
- Writing anything to a database or bucket — Tasks 04–06.
- Events, billing, tasks, comments data — Task 14 extends the dataset.

## Acceptance Criteria

- [ ] The same `<label>:<entity>:<key>` always yields the same id; different labels yield
      different ids; every id matches the UUID v5 format.
- [ ] Loading `base.json` for `budo` yields 6 users, 1 group, 21 topics (3 roots, depth 3),
      2 tags and a media mapping covering all 21 topics.
- [ ] The loader rejects: an unknown role, an unknown badge/quest slug, a disallowed MIME
      type, a tree deeper or shallower than 3, and a topic with no media — each with a
      message naming the offending entry.
- [ ] `sample-topic.md` contains every basic-syntax element listed in the Summary.
- [ ] `make test-scripts` green including the new specs; `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/demo/ids.test.mjs scripts/demo/dataset.test.mjs`.
2. Load the dataset for each label in a REPL and inspect the counts.
3. Render `sample-topic.md` in the local web catalog once Task 04 lands (visual check).
4. `make test-scripts && make lint`.
5. `git diff --stat` confirms only scope-guardrail files changed.
