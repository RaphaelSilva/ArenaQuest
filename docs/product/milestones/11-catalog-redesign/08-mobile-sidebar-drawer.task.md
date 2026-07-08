# Task 08 — Mobile sidebar drawer with hamburger trigger (Phase 2)

**Status:** ✅ Done
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 2](../../RFCs/0004-catalog-redesign.md)

## Summary

Below `lg`, the catalog sidebar becomes a slide-in drawer triggered by a hamburger control rendered near `MobileSearchBar`. Tapping the scrim or activating the dismiss control closes the drawer. The desktop sidebar (Task 03) keeps its current `lg:flex` mount; nothing changes above the `lg` breakpoint.

## Dependencies

- Task 03 (`CatalogSidebar` already in its final visual shape — the drawer reuses it).
- Task 02 (dictionary keys for drawer open / close affordances).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - The catalog layout (`apps/web/src/app/(protected)/catalog/layout.tsx`) — wire the drawer mount and the hamburger trigger.
  - A new component `apps/web/src/components/catalog/CatalogMobileDrawer.tsx`.
  - The mobile search row component (e.g. `MobileSearchBar` or the layout-owned row that hosts it) only to add the hamburger control alongside the search input.
- **No new heavy dependency.** Use a lightweight headless primitive (Radix Dialog or Headless UI Dialog) **only if** the project already uses one of them or if the inline path is meaningfully more expensive than pulling the primitive in. If a new primitive is added, it must be tree-shakeable and < 10 kB gzipped. Document the choice inline in the PR description.
- **Behaviour.** Tap-outside (scrim) and dismiss affordance both close the drawer. Pressing Escape closes the drawer (whether implemented by the primitive or wired explicitly). Body scroll is locked while the drawer is open. Focus is returned to the trigger on close.
- **Responsive contract.** Drawer mounts only below `lg`. At `lg+`, the existing sidebar mounts and the hamburger control is hidden.
- **Token reuse.** Scrim color, drawer surface, and animation use existing `--aq-*` variables. No new tokens.
- **i18n.** Open and close affordance labels read from the dictionary.
- **Accessibility.** Per milestone §6, a11y is not a goal — but the drawer must use a `<button>` for the trigger and the dismiss control, set `aria-label` from the dictionary, and not regress existing semantics. No keyboard nav audit is required.

## Scope

In:
- Implement `CatalogMobileDrawer` as a slide-in panel that hosts the existing `CatalogSidebar` (or its tree pane) below `lg`.
- Add the hamburger control near `MobileSearchBar`.
- Lock body scroll while open; restore focus to the trigger on close.

Out:
- Restyling the sidebar internals (Task 03 already did that).
- Restyling the topbar.
- Adding a full a11y audit (out of milestone scope).
- Persisting "drawer open" state across navigations.

## Acceptance Criteria

- [x] Below `lg`, a hamburger control renders near `MobileSearchBar`; activating it slides in a drawer that hosts the `CatalogSidebar` content.
- [x] Tapping the scrim, activating the dismiss affordance, or pressing Escape closes the drawer.
- [x] Body scroll is locked while the drawer is open; focus returns to the hamburger on close.
- [x] At `lg+`, the drawer does not mount; the existing sidebar continues to be visible and the hamburger control is hidden.
- [x] Open and close affordance labels read from the dictionary; `check-i18n-coverage.js` passes.
- [x] If a new primitive (Radix Dialog / Headless UI Dialog) was introduced, the PR description states why and quantifies the bundle impact.
- [x] `make lint`, `make test-web`, and `make test-api` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web`, resize the viewport below `lg`; confirm the hamburger control renders and the sidebar is hidden by default.
2. Activate the hamburger; confirm the drawer slides in, the scrim covers the page, and body scroll is locked.
3. Tap the scrim; confirm the drawer closes and body scroll resumes.
4. Reopen the drawer and press Escape; confirm it closes.
5. Reopen the drawer, click a tree row; confirm navigation to `/catalog/<id>` and the drawer closes (either explicitly or because the page re-renders).
6. Resize to `lg+`; confirm the hamburger control is hidden and the sidebar mounts.
7. `git diff --stat` confirms only the files listed in the scope guardrail are touched.
