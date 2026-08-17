# Task 14 — Web: Content Browser Redesign

**Status:** ✅ Done
**Milestone:** [7](./milestone.md)

## Summary

Rebuild `/catalog` per `docs/product/web/wire/Content.html`: left sidebar with expandable topic tree, global progress, search filter, role pill (Participant ↔ Instructor) gated by RBAC, topic header (icon, title, description, stat boxes), badges strip for the topic, and subtopic cards with progress + status. Instructor mode exposes add/edit/delete affordances backed by existing M3 CRUD.

## Dependencies

None new. Uses existing `/topics` (M3) and `/me/progress/topics` (M5). Badge data from Task 04 / Task 10 if the dashboard aggregate already includes per-topic badges; otherwise call `/topics/:id/badges` (add a thin route if needed).

## Technical Constraints

- `apps/web/src/app/(protected)/catalog/page.tsx` and `apps/web/src/app/(protected)/catalog/[topicId]/page.tsx`.
- Tree state (expanded nodes, selected topic, search query) lives in URL search params so a refresh preserves it.
- Role pill is only rendered if the caller has `instructor` or `admin` roles. Switching it does not change the active session role — it toggles a local "preview" mode that hides admin affordances when set to Participant.
- Instructor CRUD reuses existing M3 endpoints; no new routes.
- Light + dark themes mirror the wireframe palette.

## Scope

In:
- The two pages and their components (`Sidebar`, `TopicTreeItem`, `TopicHeader`, `BadgesStrip`, `SubtopicCard`).
- Search filter applies to both top-level and subtopic names.
- Empty state when a tenant has no topics.

Out:
- Topic / subtopic forms (already in M3 admin tooling).
- Discussion thread (Task 15).

## Acceptance Criteria

- [x] Sidebar tree expand/collapse persists in URL state.
- [x] Search narrows the visible items in real time without blocking the UI thread.
- [x] Selecting a topic deep-links to `/catalog/[topicId]` and the main column updates without a full page reload.
- [x] Role pill renders only for `instructor`/`admin`; Participant preview hides edit/delete buttons.
- [x] Layout matches the wireframe at ≥ 1280 px within ±8 px in light and dark themes.
- [x] `make lint` passes; RTL covers expand/collapse and search filter.

## Verification Plan

1. Manual walkthrough in `make dev-web` as both a participant and an admin.
2. RTL specs.
3. `make lint`.
