# Task 03 — Restyle `CatalogSidebar` — eyebrow, search, and tree rows (Phase 2)

**Status:** ✅ Done
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 2](../../RFCs/0004-catalog-redesign.md)

## Summary

Restyle the existing `CatalogSidebar` so the desktop tree pane matches the wireframe at `docs/architecture/web/wireframe/project/ArenaQuest Catálogo.html`: a short uppercase eyebrow label above the search input, a single 9 px-radius search input, and narrower (~300 px) tree rows composed of four slots — chevron, icon, label, count. **Behaviour is preserved**: search still filters the tree, selection still routes to `/catalog/<id>`, the sidebar still mounts only at `lg+` and hides below it for the mobile drawer (Task 08).

## Dependencies

- Task 01 (typography loaded; helpers available).
- Task 02 (dictionary keys for the eyebrow label).

## Technical Constraints

- **Scope guardrail:** changes restricted to `apps/web/src/components/catalog/CatalogSidebar.tsx` (and any sibling style file or sub-component it owns exclusively). The catalog layout (`apps/web/src/app/(protected)/catalog/layout.tsx`) is **not** restructured — the sidebar continues to be mounted by the existing layout. The `MobileSearchBar` is not touched in this task.
- **Token reuse only.** All colors, radii, and typography come from the existing `--aq-*` CSS variables and the fonts loaded in Task 01. No `--bg` / `--text` parallel token set is introduced.
- **Responsive contract preserved.** The sidebar remains hidden below `lg` (the drawer in Task 08 will handle mobile mount). On `lg+`, it occupies the 280–300 px fixed column already wired by the layout.
- **Search input.** Behaviour identical to today (filtering, debouncing if any); only visual treatment changes. The 9 px corner radius matches the wireframe.
- **Tree row structure.** Each row is composed of four slots, matching the wireframe's `tn-chev / tn-icon / tn-label / tn-count` pattern. The count slot renders the existing direct-child count (or whatever the current row already shows) — no new aggregate is fetched here.
- **i18n.** The eyebrow label reads from the dictionary (Task 02 key); no hardcoded text.
- **Cloud-agnostic.** No new dependency; no provider-specific import.

## Scope

In:
- Add the uppercase eyebrow label above the search input, using the eyebrow pattern (11 px, weight 600, 1.2 px letter-spacing, uppercase, `var(--aq-text3)`).
- Restyle the search input to the 9 px corner radius and the wireframe's contrast tokens.
- Restructure each tree row into the four-slot layout: chevron (expand/collapse), icon, label, count. Hover and selected states use existing `--aq-*` accents.
- Keep keyboard interactions and click handlers exactly as they are.

Out:
- Mobile drawer behaviour (Task 08).
- Topic header, breadcrumb, subtopic card, media list, discussion (Tasks 04 – 11).
- Touching the layout file or `MobileSearchBar`.
- Adding any new data fetch or any new state in the sidebar component.

## Acceptance Criteria

- [x] On `lg+`, the catalog sidebar renders an eyebrow label, a single search input, and a tree of rows that match the wireframe slot composition.
- [x] Below `lg`, the sidebar continues to be hidden (drawer comes in Task 08).
- [x] Search still filters the tree; clicking any node still routes to `/catalog/<id>`; expand/collapse still works.
- [x] The eyebrow text reads from `dict.catalog.*` (Task 02 key); no hardcoded string under `apps/web/src/components/catalog/CatalogSidebar.tsx`.
- [x] `check-i18n-coverage.js`, `make lint`, and `make test-web` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web`, load `/catalog/<id>` at a desktop viewport (`lg+`); confirm the eyebrow, the new search input, and the four-slot rows render and match the wireframe.
2. Resize to `< lg`; confirm the sidebar is hidden (drawer is not yet wired — Task 08).
3. Type in the search input; confirm filtering still works.
4. Expand/collapse a branch; confirm chevron toggles and child rows show/hide.
5. Click a node; confirm navigation to `/catalog/<id>` and the new route renders.
6. Run `git diff --stat`; confirm only `CatalogSidebar.tsx` and its owned style/sub-files changed.
