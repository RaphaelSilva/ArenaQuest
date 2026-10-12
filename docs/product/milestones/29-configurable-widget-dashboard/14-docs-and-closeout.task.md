# Task 14 — Backend: Docs and closeout (Phase 3)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-widget-registry-and-layout-schema.task.md), [Task 02](./02-layout-storage-and-student-routes.task.md), [Task 03](./03-layout-driven-dashboard-aggregate.task.md), [Task 04](./04-widget-host-frontend.task.md), [Task 05](./05-settings-dashboard-editor-frontend.task.md), [Task 06](./06-label-default-layout.task.md), [Task 07](./07-group-defaults-and-locks.task.md), [Task 08](./08-admin-group-dashboard-editor-frontend.task.md), [Task 09](./09-roadmap-start-topic.task.md), [Task 10](./10-continue-widget.task.md), [Task 11](./11-recommendations-widget.task.md), [Task 12](./12-roadmap-and-continue-frontend.task.md), [Task 13](./13-recommendations-frontend.task.md)

## Summary

Closes the milestone. Updates `CLAUDE.md` with the dashboard layout model — registry location, the
four resolution tiers, group priority and tie-break, copy-on-customise and `newDefault`, locks and
`409 WIDGET_LOCKED`, the label default in the profile with its preflight and the
`DASHBOARD_DEFAULT_LAYOUT` var, the live recommendations rule and the `last_visited_at` stamp — so a
future change does not re-derive them. Adds the feature to `docs/product/FEATURES.md` and a release
note (the dashboard response contract changed; label owners may now declare a default layout).
Files the backlog items spotted during delivery, including the two fenced out of this milestone if
still open: the ranking widget's display names (a slice of `userId`) and the hard-coded `'en-US'`
greeting date. Writes `closeout-analysis.md`, marks the tasks and the milestone done, and sets RFC
0008 to `Implemented` in its header and in `docs/product/RFCs/README.md`.

## Dependencies

- Every other task of this milestone (01–13) — closeout happens last.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `CLAUDE.md`, `docs/product/FEATURES.md`, `docs/ReleaseNotes.md`.
  - New files under `docs/product/backlog/` (through `write-backlog-task`).
  - `docs/product/milestones/29-configurable-widget-dashboard/**` — task statuses, milestone status
    and §5 statuses, `closeout-analysis.md`.
  - RFC 0008's `Status:` header and its row in `docs/product/RFCs/README.md`.
- **Documentation only.** No code, migration or config change.
- **Statuses verified, not assumed.** Run `verify-doc-status` against the milestone and the RFC
  before flipping them.

## Scope

In:
- `CLAUDE.md` section, FEATURES entry, release note, backlog items, closeout analysis, status flips.

Out:
- Fixing any backlog item it files.

## Acceptance Criteria

- [ ] `CLAUDE.md` describes the layout model in the terms listed in Summary.
- [ ] `make test-api` and `make test-web` are green on the candidate branch at closeout (recorded in
      `closeout-analysis.md`).
- [ ] The backlog items exist and pass `write-backlog-task`'s validator.
- [ ] RFC 0008 and the README row read `Implemented`; `check-rfc.mjs`, `check-feature.mjs` and
      `check-task.mjs --milestone 29` pass.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Run the three `check-*.mjs` validators and `verify-doc-status` on the milestone.
2. `make test-api` and `make test-web` on the candidate branch.
3. `git diff --stat` confirms only scope-guardrail files changed.
