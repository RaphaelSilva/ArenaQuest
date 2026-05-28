# Task 06: Catalog Sidebar — Recursive Topic Tree (N-Level Depth)

## Metadata
- **Status:** ✅ Done
- **Complexity:** Medium
- **Milestone:** Catalog UX Polish
- **Dependencies:** None (builds on existing `CatalogSidebar.tsx` and `topics-api`)
- **Category:** User Experience / Navigation

---

## Summary

The catalog sidebar currently renders only **two levels** of the topic hierarchy (root topics with their direct children as a flat link list). The approved wireframe (`docs/architecture/web/wireframe/project/ArenaQuest Catálogo.html`) specifies a **recursive tree** that supports arbitrary depth, with consistent chevron/folder iconography, indentation per depth, and a children-count badge on every node — not just the root.

This task aligns the production sidebar with the wireframe so that deep topic structures (grandchildren and beyond) are reachable directly from the navigation tree.

---

## Problem Statement

`apps/web/src/components/catalog/CatalogSidebar.tsx` builds the full tree via `buildTree()` but the `renderTree()` function only iterates `tree` (roots) and renders `node.children` as a flat list of `<Link>` rows. Grandchildren are never rendered, so users cannot:
- See that a subtopic itself contains further subtopics from the sidebar.
- Expand/collapse intermediate nodes.
- Navigate beyond level 2 without going through the main pane.

**Current behavior (level cap = 2):**
- Root row: chevron + folder icon + title + count badge.
- Child row: dot status + title + status glyph. No chevron, no recursion.
- Grandchildren are invisible in the sidebar.

**Expected behavior (per wireframe):**
- Every node is rendered by the same recursive component.
- Indentation scales with depth (`paddingLeft = base + depth * step`).
- Every node with children shows a chevron and a `tn-count` badge.
- Expansion state auto-opens ancestors of the current route and persists via the existing `?open=` query param.
- Leaves render without a chevron (hidden placeholder to keep alignment).

---

## Architectural Context

### Cloud-Agnostic Approach
- Pure frontend refactor inside `apps/web`. No API, schema, or adapter changes.
- Existing `TopicNode` shape from `@web/lib/topics-api` already exposes `parentId` and supports arbitrary depth.
- `buildTree()` already returns a fully-nested `TreeNode[]`; only the render layer is constrained.

### Reference
- **Wireframe HTML:** `docs/architecture/web/wireframe/project/ArenaQuest Catálogo.html` (`.tn-row`, `.tn-chev`, `.tn-icon`, `.tn-label`, `.tn-count` styles, lines ~73–83).
- **Wireframe JSX:** `docs/architecture/web/wireframe/project/catalog/catalog-components.jsx` (`TreeNode` component, lines 71–110).
- **Current implementation:** `apps/web/src/components/catalog/CatalogSidebar.tsx` (`renderTree`, lines 132–241).

---

## Requirements

### 1. Recursive Rendering
- Extract a `TopicTreeNode` (or inline recursive) component that renders one node and recurses over `node.children`.
- Replace the two-tier `renderTree()` body with a list of `TopicTreeNode` invocations at depth 0.
- Pass `depth` as a prop and compute indentation as `paddingLeft = 12 + depth * 14` (matching the wireframe; tune in design QA if needed).

### 2. Visual Consistency Across Depths
- Every node renders the same row anatomy: chevron slot, icon slot, label, count badge.
- Nodes without children render the chevron slot with `visibility: hidden` to preserve alignment.
- Active node continues to receive `--aq-accent-glow` background + left accent bar.
- Ancestors of the active node are highlighted only when expanded (no extra style change required, but verify visually).

### 3. Expansion State
- `expandedIds` (driven by `?open=`) must continue to work and apply to every depth, not just roots.
- On mount / route change, auto-expand all ancestors of the current `pathname` topic so deep nodes are visible without manual clicks.
- Clicking the chevron toggles expand/collapse without navigating; clicking the row navigates (preserve current behavior).

### 4. Status Indicators
- Today, only level-2 children show the `STATUS_DOT` / `STATUS_LABEL` (completed / in_progress / not_started). After the refactor, **leaf nodes at any depth** should still surface progress status.
  - Recommended rule: show the status dot/glyph on nodes with no children (leaves), regardless of depth. Intermediate nodes show the count badge instead.
- Confirm rule with PO before final styling if ambiguous; document the chosen rule in the PR description.

### 5. Search Behavior
- `topicMatchesSearch` currently inspects only the node and its immediate children. Update the predicate to match recursively: a node is visible if its title matches **or** any descendant title matches.
- When a search query is active, auto-expand all ancestors of matching nodes so matches are reachable.

### 6. Accessibility
- Each row keeps `role="button"`, `tabIndex={0}`, `aria-expanded` (only when it has children).
- Chevron button has `aria-label` indicating expand/collapse plus the node title.
- Keyboard: Enter toggles expansion on the row; Space should not scroll the page.

---

## Technical Constraints

- **No new dependencies.** Use existing icons (`ChevronIcon`) and CSS variables (`--aq-*`).
- **Preserve URL contract.** The `?open=id1,id2,...` and `?q=` query params must remain backward compatible.
- **Mobile drawer reuse.** `CatalogMobileDrawer.tsx` wraps the same sidebar; verify nothing breaks at small breakpoints.
- **Performance.** Trees are small (tens of nodes) — recursion is fine; no virtualization needed.

---

## Scope

### Files to modify
- `apps/web/src/components/catalog/CatalogSidebar.tsx` — main refactor.
- (Optional) Extract `TopicTreeNode` into its own file under `apps/web/src/components/catalog/` if the parent grows past ~250 lines.

### Files to verify (no expected changes)
- `apps/web/src/components/catalog/CatalogMobileDrawer.tsx`
- `apps/web/src/app/(protected)/catalog/page.tsx`
- `apps/web/src/app/(protected)/catalog/layout.tsx`

### What does NOT change
- API surface, data fetching, or the `TopicNode` type.
- Main pane (`TopicHeader`, `SubtopicCard`, `MediaList`, `Discussion`).
- Breadcrumb component.
- i18n dictionary keys (reuse existing `dict.catalog.sidebar.*`).

---

## Acceptance Criteria

- [x] Sidebar renders the full topic tree to any depth present in the data.
- [x] Each row at every depth uses the same visual anatomy (chevron / icon / label / count or status).
- [x] Indentation visibly grows with depth and matches the wireframe spacing.
- [x] Navigating to a deep topic auto-expands every ancestor in the sidebar.
- [x] Chevron click toggles expand/collapse without triggering navigation.
- [x] Row click navigates to the topic page (existing behavior).
- [x] `?open=` query param round-trips correctly for nodes at any depth.
- [x] Search query matches anywhere in the subtree and expands ancestors of matches.
- [x] Leaf nodes show status indicator; intermediate nodes show child count.
- [x] Mobile drawer renders the recursive tree without horizontal overflow.
- [x] `make lint` passes.
- [x] `make test-web` passes; existing sidebar tests are updated to cover depth ≥ 3.
- [x] No console warnings (keys, `aria-expanded` on leaves, etc.).
- [x] No regressions in `__tests__/components/catalog` suites.

---

## Verification Plan

### Automated Tests
1. Add/extend tests in `apps/web/src/components/catalog/__tests__/CatalogSidebar.test.tsx`:
   - Renders a 3-level tree and asserts a grandchild row is present in the DOM.
   - Clicking a chevron toggles its subtree without changing route.
   - Navigating to a deep node auto-expands all ancestors.
   - Search with a grandchild match expands ancestors and shows the match.
   - `?open=` containing a non-root id keeps that branch open after reload.

### Manual Testing (Browser)
1. **Seed deep data:** in local dev, create or use a topic with at least three levels of nesting.
2. **Deep navigation:** click through to a level-3 node from the sidebar; confirm path renders and breadcrumb is correct.
3. **Expand/collapse:** verify chevron isolates from row click; tab key cycles through rows; Enter toggles expansion.
4. **Search:** type a query that only matches a grandchild — confirm its ancestors auto-expand and the match is reachable.
5. **Active highlighting:** navigate to a deep node and confirm only the active row gets the accent background and left bar.
6. **Mobile drawer:** open the drawer below the mobile breakpoint; confirm recursive tree fits and scrolls without horizontal overflow.
7. **Dark / Light themes:** toggle theme and verify chevron, count badge, and status indicators read correctly in both.

---

## Notes

- The wireframe is the source of truth for visual spacing and row anatomy; deviations should be justified in the PR description.
- This change increases the visual density of the sidebar — confirm with PO whether to add a "collapse all" affordance later (out of scope here).
- The status-indicator rule for intermediate nodes (count vs. dot) is a deliberate UX choice; surface it in the PR so reviewers can validate.
