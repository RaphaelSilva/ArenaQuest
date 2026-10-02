# Task 14 — Backend: Documentation closeout, backlog items and release note (Phase 7)

**Status:** 📝 Open
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-video-watched-wiring-frontend.task.md), [Task 02](./02-mission-contracts.task.md), [Task 03](./03-mission-evaluator-domain.task.md), [Task 04](./04-schema-and-d1-adapters.task.md), [Task 05](./05-admin-missions-api.task.md), [Task 06](./06-mission-hooks.task.md), [Task 07](./07-student-missions-api.task.md), [Task 08](./08-reconciliation-job.task.md), [Task 09](./09-admin-mission-editor-frontend.task.md), [Task 10](./10-admin-participants-frontend.task.md), [Task 11](./11-dashboard-missions-panel-frontend.task.md), [Task 12](./12-mission-page-frontend.task.md), [Task 13](./13-demo-seed-requirements.task.md)

## Summary

Closes the milestone. **`CLAUDE.md`** gains a short *Missions* paragraph under the API
architecture: typed requirements (the five kinds, params schemas in
`packages/shared/domain/missions/requirements.ts`), evidence windowed by the mission and by the
step (sequential unlock from the previous step's completion instant), enrollment modes (`auto`
gated by access to every topic target and never for staff, `open` with Join/Leave, `assigned` with
locked teasers), inline best-effort hooks plus the daily reconciliation that closes but never
reopens, write-once rewards through `xp_events` keys and the badge, streak from hook-closed steps
only, and the role boundary (reads open to content creators, writes admin-only).
**`docs/product/FEATURES.md`** §5 updates *Quests, missions and badges* to describe missions with
requirements and links M27 and RFC 0022. **`docs/ReleaseNotes.md`** gets the release entry,
including the line Task 01 drafted: watching a lesson video to the end earns XP again and counts
toward weekly video challenges and video badges; plus mission steps, Join, and the admin-only
editor. **Backlog items** are filed with the `write-backlog-task` skill: (1) the **quest seed
mismatch** — `0019_seed_quests.sql` writes `login` where the evaluator knows `daily_login`, and
`{"count":N}` where it reads `target`, so the daily-login quest never progresses and every quest
target collapses to 1; (2) **fire `visit` on topic page mount**, so text-only topics produce visit
evidence (RFC Open Question 6, decided); (3) **remove the legacy mission path** — the M7 mission
loop in `quest-evaluator.ts` and the `predicate_kind` / `predicate_params` columns — once no legacy
mission is active. The **demo seed's mission params** item named by the RFC roadmap is resolved by
Task 13; the closeout records it as done, and it is filed as a backlog item only if Task 13 did not
land. A `closeout-analysis.md` records what shipped against milestone §3 and any drift. Finally RFC
0022's status moves to `Implemented` in its header and its README row.

## Dependencies

- All of [Task 01](./01-video-watched-wiring-frontend.task.md) through
  [Task 13](./13-demo-seed-requirements.task.md) — ordering dependency: the closeout note and the
  RFC status change assert the milestone is complete, so this task is written last.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `CLAUDE.md` — one *Missions* paragraph in the API architecture section.
  - `docs/product/FEATURES.md` — the §5 *Quests, missions and badges* entry.
  - `docs/ReleaseNotes.md` — the M27 release entry.
  - `docs/product/backlog/**` — the new backlog task files only (no existing file edited).
  - `docs/product/milestones/27-mission-requirements/closeout-analysis.md` (new) and this
    milestone's task statuses in `milestone.md` §5.
  - `docs/product/RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md`
    (`Status:` header) and its row in `docs/product/RFCs/README.md`.
- **Documentation only.** No file under `apps/`, `packages/` or `scripts/` changes.
- **Statements match the code on `main`.** Every behaviour described is verified against the merged
  tasks, not against the RFC's intent.
- **Backlog files** follow the `write-backlog-task` standard and pass its checker.

## Scope

In:
- `CLAUDE.md`, `FEATURES.md` and `ReleaseNotes.md` updates; three backlog items (four if Task 13
  slipped); the closeout note; RFC 0022 status and README row; milestone §5 statuses.

Out:
- Any code change, including the backlog items themselves.

## Acceptance Criteria

- [ ] `CLAUDE.md` has a *Missions* paragraph covering kinds, windowing, enrollment modes, hooks and
      reconciliation, write-once rewards, streak and the role boundary.
- [ ] `docs/ReleaseNotes.md` announces that watching videos earns XP again, and the new mission
      features.
- [ ] Backlog items exist for the quest seed mismatch, `visit` on topic page mount and the legacy
      mission cleanup, each passing the backlog checker; the demo mission params are recorded as
      resolved by Task 13 (or filed if it did not land).
- [ ] `closeout-analysis.md` maps each milestone §3 criterion to its evidence.
- [ ] RFC 0022 reads `Implemented` in its header and README row;
      `node .claude/skills/write-rfc/check-rfc.mjs` and
      `node .claude/skills/write-tasks/check-task.mjs --milestone 27` pass.
- [ ] `make test-api` and `make test-web` green on the final tree.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Read each new paragraph against the merged code (routes, guards, job) and fix any drift.
2. Run the backlog checker on the new files, `check-rfc.mjs`, `check-feature.mjs` and
   `check-task.mjs --milestone 27`.
3. `make test-api`; `make test-web`; `make lint`.
4. `git diff --stat` confirms only documentation files in the guardrail changed.
