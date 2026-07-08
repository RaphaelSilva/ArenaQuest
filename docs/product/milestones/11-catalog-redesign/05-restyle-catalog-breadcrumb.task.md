# Task 05 — Restyle `CatalogBreadcrumb` — mid-trail collapse and token reuse (Phase 2)

**Status:** ✅ Done
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 2](../../RFCs/0004-catalog-redesign.md)

## Summary

Restyle `CatalogBreadcrumb` to match the wireframe: links use `var(--aq-text3)`, hover uses `var(--aq-accent)`, the current segment uses `var(--aq-text2)`, and when the trail has more than 4 segments the middle segments collapse behind an ellipsis affordance. The trail is derived via `buildTrail` (Task 01) and renders as a single horizontal line above the topic header.

## Dependencies

- Task 01 (`buildTrail` helper available).
- Task 02 (dictionary keys for the ellipsis affordance label, if exposed).

## Technical Constraints

- **Scope guardrail:** changes restricted to `apps/web/src/components/catalog/CatalogBreadcrumb.tsx` (and any sibling style/sub-component file it owns exclusively). The page that mounts it is touched only if the prop signature needs to change.
- **Token reuse.** Only existing `--aq-*` variables. No new colors.
- **Mid-trail collapse.** When the trail length exceeds 4 segments, render `root › … › parent › current`. Clicking/tapping the ellipsis reveals the hidden segments (popover, expanded list, or simple in-place expansion — implementer's choice; the affordance must be visually obvious and keyboard-activatable since it remains a `<button>`).
- **Behaviour preserved.** Each segment except the current is a link to `/catalog/<id>` of that node. The current segment is rendered as plain text (no link).
- **i18n.** Any new affordance label (e.g. "show more segments") reads from the dictionary.
- **Cloud-agnostic.** No new dependency; pure presentational change driven by props.

## Scope

In:
- Replace the existing breadcrumb markup with the wireframe styling.
- Implement the mid-trail collapse when trail length > 4.
- Source the trail from `buildTrail` (the page may compute it once and pass it in; the breadcrumb does not re-walk the tree).

Out:
- Topic header, subtopic card, sidebar, media list, discussion (other tasks).
- Touching the page layout shell.
- Adding analytics or telemetry around segment clicks.

## Acceptance Criteria

- [x] At trail length ≤ 4, the breadcrumb renders every segment inline.
- [x] At trail length > 4, the breadcrumb collapses to `root › … › parent › current`; the ellipsis is a keyboard-activatable affordance that reveals the hidden segments.
- [x] The current segment is not a link; every other segment links to `/catalog/<that-id>`.
- [x] Color tokens match the wireframe (`--aq-text3` for links, `--aq-text2` for current, `--aq-accent` on hover).
- [x] No hardcoded user-facing string under the component; `check-i18n-coverage.js` passes.
- [x] `make lint`, `make test-web`, and `make test-api` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web`, navigate to a leaf at depth ≥ 4; confirm the breadcrumb collapses correctly and the ellipsis affordance reveals the hidden segments.
2. Navigate to a leaf at depth ≤ 3; confirm the breadcrumb shows every segment inline.
3. Hover/focus a link segment; confirm the accent color triggers.
4. Activate the ellipsis affordance with the keyboard (Tab + Enter/Space); confirm reveal still works.
5. `git diff --stat` confirms only the files listed in the scope guardrail are touched.
