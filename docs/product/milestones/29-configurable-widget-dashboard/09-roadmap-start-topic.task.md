# Task 09 — Backend: Roadmap rooted at a start topic (Phase 3)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-layout-driven-dashboard-aggregate.task.md)

## Summary

Generalises the roadmap widget from roots to **any start topic**. With `config.startTopicId` set,
the stages are the start topic's **direct children** the student can access, in `sort_order`; each
stage's percentage is completed accessible leaves ÷ accessible leaves of its subtree (a leaf stage
is 0 or 100 from its own status), and its status is `completed` at 100, `in_progress` when above 0 or
when any node of the subtree has progress, else `not_started` — the same rules Task 03 applies to
roots, now computed by one recursive query over a subtree restricted to the effective access set.
When the start topic is **archived, unpublished, deleted or outside the student's access**, the
widget's data is `{ unavailable: true }` with **no id and no title**; the stored config is kept, so
the same widget shows stages again when access returns. A start topic with no accessible children
returns an empty stage list. Several roadmap instances in one layout are computed independently.
Task 12 adds the topic picker and the unavailable state to the web.

## Dependencies

- [Task 03](./03-layout-driven-dashboard-aggregate.task.md) — hard dependency: the roadmap provider
  and leaf-progress rules it extends.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/dashboard/**` — the roadmap provider and subtree query.
  - `apps/api/test/**` — roadmap specs.
  - `packages/shared/domain/dashboard/**` — only the roadmap data schema, if the unavailable variant
    is not already declared by Task 01.
- **Access before projection.** The subtree is intersected with `getEffectiveAccessTopicIds` and
  filtered to published, non-archived nodes before any title is read; the unavailable answer is
  decided before the start topic's row is projected.
- **No enumeration oracle.** Archived, unpublished, deleted and inaccessible start topics produce the
  identical body.
- **Bounded cost.** One query per roadmap instance; the 12-instance cap bounds the total. The
  Task 03 performance target still applies.
- **No change** to topic, progress or enrollment code.

## Scope

In:
- Start-topic stages, subtree progress, unavailable state, empty-children state, multiple instances.
- Tests on a fixture tree: percentages for a mixed subtree; a leaf stage; an inaccessible grandchild
  excluded from numerator and denominator; the four unavailable causes return identical bodies;
  access restored → stages back; two roadmap instances with different start topics; `null` start
  topic still returns roots.

Out:
- Web — Task 12. Continue and recommendations — Tasks 10 and 11.

## Acceptance Criteria

- [ ] Each case in Scope is covered by a passing test.
- [ ] The unavailable body contains no id or title of the start topic (asserted on the raw JSON).
- [ ] The dashboard still meets the target recorded in milestone §6 with two roadmap instances on
      the demo seed.
- [ ] Changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api`.
2. `make dev-api` with the demo seed; save a layout with a roadmap rooted at a deep topic; `curl`
   the dashboard; archive the topic as admin; `curl` again.
3. Re-run the Task 03 measurement command with two roadmaps.
4. `git diff --stat` confirms only scope-guardrail files changed.
