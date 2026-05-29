# Task 07 — Fix `TopicHeader` mobile stats layout (horizontal chip row)

## Metadata
- **Status:** ⏳ Planned
- **Complexity:** Low
- **Milestone:** Post-Milestone 11 Bug Fix
- **Dependencies:** Milestone 11, Task 04 (TopicHeader rewrite)
- **Category:** User Experience / Responsive Layout

---

## Summary

The stats trio in `TopicHeader` renders as a **vertical stack** on mobile (`< md`) instead of the required **horizontal chip row**. The three-column grid collapses correctly on mobile (icon and title stack), but the stats container uses `flex-col` on mobile and `flex-row` on `md+`, which is the inverse of the intended responsive contract.

---

## Problem Statement

AC #1 of Task 04 (Milestone 11) specifies:

> On `< md`, icon + title stack and stats render as a **horizontal chip row**.

The current implementation in `apps/web/src/components/catalog/TopicHeader.tsx` has:

```
flex flex-col gap-3 md:flex-row md:gap-4
```

This causes:
- Mobile: stats tiles stacked **vertically** (wrong).
- `md+`: stats tiles in a **horizontal row** inside the right grid column (wrong direction — should be a vertical trio in the right column on desktop, or all horizontal on mobile).

The `closeout-analysis.md` for Milestone 11 describes the mobile rendering as "stats render as a horizontal chip row below," confirming the intended behavior — but the code does not match it.

---

## Scope

**In:**
- Correct the stats container flex direction in `TopicHeader.tsx` so that on mobile (`< md`) the three stat tiles render as a horizontal row, and on `md+` they render as a column in the right grid cell (matching the "right-aligned trio" wireframe contract).
- Verify the fix visually at `< md`, `md`, and `lg` breakpoints.

**Out:**
- Any other layout changes to `TopicHeader`.
- Changes to other components.

---

## Technical Constraints

- **Scope guardrail:** change restricted to `apps/web/src/components/catalog/TopicHeader.tsx`.
- **Token reuse:** no new CSS tokens.
- **No i18n changes.**

---

## Acceptance Criteria

- [ ] On `< md`, the three stat tiles (Subtopics / Media / Total) render as a **horizontal** row of chips below the stacked icon + title.
- [ ] On `md+`, the three stat tiles render in the right grid column as a **vertical** trio (or remain horizontal if the wireframe calls for it — verify against `docs/architecture/web/wireframe/`).
- [ ] `make lint` and `make test-web` pass green.
- [ ] No diff outside `TopicHeader.tsx`.

---

## Verification Plan

1. `make dev-web`, navigate to `/catalog/<any-id>`.
2. Resize to `< md`; confirm stats are a horizontal chip row, not a vertical stack.
3. Resize to `md` and `lg`; confirm three-column header layout is intact.
4. `git diff --stat` confirms only `TopicHeader.tsx` is touched.
