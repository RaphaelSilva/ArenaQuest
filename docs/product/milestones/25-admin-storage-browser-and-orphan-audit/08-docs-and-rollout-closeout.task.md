# Task 08 — Backend: Docs and rollout closeout (Phase 3)

**Status:** 🚧 In Progress — docs closed; staging `/audit` latency check blocked (no deployable staging environment)
**Milestone:** [25 — Admin storage browser and orphan audit](./milestone.md)
**RFC:** [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md)
**Team:** Backend API
**Depends On:** [Task 05](./05-orphan-and-missing-file-scan-panel.task.md), [Task 07](./07-delete-orphan-action.task.md)

## Summary

Closes the milestone. Records the Storage page in the product feature list, moves RFC 0018 to
`Implemented` in its header and README row, marks every task and the milestone done, and writes
the local closeout note. It also runs the one production-facing check the milestone owes: the
`/audit` latency criterion (a 1000-key page in under 2 s on staging). If that criterion fails,
this task files a separate backlog task for an index on `media.storage_key` — it does not add
the index itself. Finally, it records the drift that the first staging audit surfaces (counts per
status, not keys) in the closeout, so the backlog items for the root causes named in the RFC's
Motivation start from real numbers.

## Dependencies

- [Task 05](./05-orphan-and-missing-file-scan-panel.task.md) and
  [Task 07](./07-delete-orphan-action.task.md) — ordering: the closeout happens after every
  surface has landed (and, transitively, Tasks 01–04 and 06).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `docs/product/FEATURES.md` — one entry for the admin storage browser and orphan audit.
  - `docs/product/RFCs/0018-admin-storage-browser-and-orphan-audit.md` — `Status:` header only.
  - `docs/product/RFCs/README.md` — RFC 0018's row status only.
  - `docs/product/milestones/25-admin-storage-browser-and-orphan-audit/*.md` — task and
    milestone `Status:` lines, §5 table status column, and the local `closeout-analysis.md`
    (gitignored — kept on disk, never force-added).
  - `docs/product/backlog/**` — only if the latency criterion fails: one new task file for the
    `media.storage_key` index.
- **No code change.** Not in `apps/`, not in `packages/`, no migration.
- **No secrets or object keys in docs.** The closeout reports counts and byte totals per status,
  never keys, file names or presigned URLs.
- **Staging only.** The latency check and the first audit run against staging; production is
  audited by an admin through the UI after release, not by this task.

## Scope

In:
- `FEATURES.md` entry.
- RFC 0018 → `Implemented` (header + README row).
- All task statuses and the milestone status set to done; §5 status column updated.
- `closeout-analysis.md` with the latency measurement and the first staging audit's counts.
- A backlog task for the index, only if the latency criterion failed.

Out:
- Fixing any drift root cause — separate backlog items.
- Any code or schema change.
- Deleting objects in staging or production as part of the closeout.

## Acceptance Criteria

- [x] `docs/product/FEATURES.md` lists the admin storage browser and orphan audit.
- [x] RFC 0018's header and README row read `Implemented`; `check-rfc.mjs` passes on it.
- [ ] Every task in the milestone and the milestone itself are marked done; `check-feature.mjs`
      and `check-task.mjs --milestone 25` pass.
- [ ] The closeout records the staging `/audit` page time and the per-status counts, with no key
      or file name.
- [ ] If the page time was ≥ 2 s, a backlog task for the `media.storage_key` index exists and is
      linked from the closeout; otherwise none was created.
- [x] `make test-api` and `make test-web` still green on the candidate branch.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. On staging, as admin, run "Scan for orphans" and note the time of a full 1000-key page (from
   the network panel) and the per-status counts.
2. Run the three validators: `check-rfc.mjs` on RFC 0018, `check-feature.mjs` and
   `check-task.mjs --milestone 25`.
3. `make test-api` and `make test-web` on the candidate branch.
4. `git diff --stat` confirms only scope-guardrail files changed (and `closeout-analysis.md` is
   not staged).
