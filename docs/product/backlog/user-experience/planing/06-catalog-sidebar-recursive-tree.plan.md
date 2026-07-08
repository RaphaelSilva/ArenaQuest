# Plan — 06-catalog-sidebar-recursive-tree

**Task:** [../06-catalog-sidebar-recursive-tree.task.md](../06-catalog-sidebar-recursive-tree.task.md)
**Source:** Backlog (user-experience)
**Assigned personas:** frontend-developer
**Branch:** feature/m11/catalog-redesign

## Objective

Align the production catalog sidebar with the approved wireframe by replacing the current two-level renderer with a recursive topic-tree component that supports arbitrary depth. Each row at every depth uses the same visual anatomy (chevron / icon / label / count or status), ancestors of the active route auto-expand, the `?open=` query param round-trips for any depth, and search matches at any depth surface their ancestors. The participant cannot today reach grandchild topics from the sidebar — this plan closes that gap without changing the data layer or any other catalog surface.

## Affected areas

- Modify: `apps/web/src/components/catalog/CatalogSidebar.tsx` (replace `renderTree` with recursive rendering; broaden search predicate; auto-expand ancestors).
- Create: `apps/web/src/components/catalog/TopicTreeNode.tsx` — extracted recursive row component (keeps `CatalogSidebar.tsx` lean).
- Verify (no changes expected): `apps/web/src/components/catalog/CatalogMobileDrawer.tsx`, `apps/web/src/app/(protected)/catalog/page.tsx`, `apps/web/src/app/(protected)/catalog/layout.tsx`.
- Tests: extend `apps/web/src/components/catalog/__tests__/CatalogSidebar.test.tsx` (create file if missing under that path — check existing test location first).

Out of scope:
- API surface, `TopicNode` shape, `topics-api` client.
- Main pane (`TopicHeader`, `SubtopicCard`, `MediaList`, `Discussion`), breadcrumb, dictionaries.
- "Collapse all" affordance, virtualization, drag-reorder, or any new admin tooling.

## Step-by-step

### Frontend
1. **Extract `TopicTreeNode` component** at `apps/web/src/components/catalog/TopicTreeNode.tsx`.
   - Props: `node: TreeNode`, `depth: number`, `expandedIds: Set<string>`, `progressMap: Map<string, TopicProgressStatus>`, `pathname: string`, `query: string`, `onToggle(id): void`.
   - Renders one row + recurses over `node.children` when expanded.
   - Indentation: inline `paddingLeft: 12 + depth * 14`.
   - Row anatomy (matches wireframe `.tn-row`):
     - Chevron slot: visible if `node.children.length > 0`; clicking it calls `onToggle(node.id)` and **stops propagation** (no navigation). Hidden (visibility: hidden) on leaves to preserve alignment.
     - Folder icon (`📚`) inside the existing `--aq-accent-glow` chip.
     - Label (truncate, accent color when active).
     - Trailing element:
       - **Intermediate node (has children):** existing count badge (`node.children.length`).
       - **Leaf node:** existing status dot + glyph (`STATUS_DOT[status]` / `STATUS_LABEL[status]`), pulled from `progressMap`.
   - Active highlighting: keep `is-current` background + left accent bar when `pathname === '/catalog/' + node.id`.
   - Whole row is wrapped in a `Link` to `/catalog/${node.id}` (preserve existing absolute-positioned link pattern so chevron can intercept clicks).
   - Accessibility: `role="button"`, `tabIndex={0}`, `aria-expanded={isOpen}` only when `hasChildren`; chevron `<button>` has `aria-label` of the form `Expand/Collapse <node.title>`.
   - `useEffect` is **not** needed inside the row — expansion state lives in the parent via `expandedIds`.

2. **Refactor `CatalogSidebar.tsx`:**
   - Keep `buildTree`, `STATUS_DOT`, `STATUS_LABEL`, `ChevronIcon`, `SearchIcon`, header (progress bar + search input) unchanged in structure.
   - Replace `renderTree` body: filter visible roots by recursive match, then map each through `<TopicTreeNode />` at `depth={0}`.
   - **Auto-expand ancestors of the active route:** derive `ancestorIds: Set<string>` from `pathname` by walking up `parentId` chains in the flat `topics` list; union with `expandedIds` (without persisting them to URL) when computing what is open. Implementation: pass `effectiveExpanded = new Set([...expandedIds, ...ancestorIds, ...matchAncestorIds])` to the row component.
   - **Recursive search predicate:** new helper `nodeOrDescendantMatches(node, q): boolean`. Use it to filter roots and to compute `matchAncestorIds` (ancestors of any matching node) so matches surface automatically.
   - When the row component asks to toggle an id, parent updates `expandedIds` and writes back to `?open=` via the existing `updateUrl` (unchanged URL contract).
   - When the row is **clicked** (navigation), preserve current behavior: navigate to `/catalog/${id}` (via the wrapped `Link`). Do **not** toggle expansion on row click — let auto-expand handle it after navigation. (Today, root rows toggle on click; we are dropping that side effect because deeper trees need the chevron-only contract. Note this change in the PR description.)

3. **Mobile drawer parity:** read `CatalogMobileDrawer.tsx` to confirm it just wraps `CatalogSidebar`'s children. If it renders its own tree, port the same recursive component; otherwise no change required.

4. **Tests:** Add/extend `apps/web/src/components/catalog/__tests__/CatalogSidebar.test.tsx` (or create the suite if absent — confirm path with `ls` first):
   - **3-level render:** mount with a fixture containing root → child → grandchild; expand root + child via `?open=`; assert grandchild row is in the DOM.
   - **Chevron isolates from navigation:** click chevron on a node, assert `router.replace` was not called with the topic href and that expand state toggled.
   - **Auto-expand ancestors:** mount with `pathname="/catalog/<grandchildId>"`; assert grandchild row is present without any `?open=` param.
   - **Search match through depth:** set `?q=<grandchild title fragment>`; assert match is rendered and its ancestors are expanded.
   - **`?open=` round-trip:** mount with `?open=<non-root id>`; assert that branch renders expanded after the initial render.

5. **Lint & tests:** `make lint && make test-web` from repo root; resolve any failures.

6. **Manual verification (browser):** `make dev-web`, login, navigate the catalog with deep data (use existing seed or create a 3-level topic via admin); run through the manual checklist in the task file (deep nav, expand/collapse, search, dark/light, mobile drawer).

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Sidebar renders the full topic tree to any depth | 1, 2 | frontend | Test "3-level render" + browser walkthrough |
| Each row at every depth uses the same visual anatomy | 1 | frontend | Browser visual diff vs. wireframe |
| Indentation visibly grows with depth | 1 (`paddingLeft: 12 + depth*14`) | frontend | Browser visual check |
| Navigating to a deep topic auto-expands every ancestor | 2 (ancestorIds) | frontend | Test "auto-expand ancestors" |
| Chevron click toggles without triggering navigation | 1 (stopPropagation) | frontend | Test "Chevron isolates from navigation" |
| Row click navigates to the topic page | 1 (wrapped Link) | frontend | Browser walkthrough |
| `?open=` query param round-trips at any depth | 2 (updateUrl unchanged) | frontend | Test "?open= round-trip" |
| Search query matches anywhere in subtree, expands ancestors of matches | 2 (recursive predicate + matchAncestorIds) | frontend | Test "Search match through depth" |
| Leaf nodes show status indicator; intermediate nodes show child count | 1 (row anatomy branching) | frontend | Browser visual check |
| Mobile drawer renders recursive tree without horizontal overflow | 3 | frontend | Browser walkthrough on narrow viewport |
| `make lint` passes | 5 | frontend | Command output |
| `make test-web` passes; tests cover depth ≥ 3 | 4, 5 | frontend | Command output |
| No console warnings | 1 (conditional aria-expanded, stable keys) | frontend | Browser devtools console |
| No regressions in `__tests__/components/catalog` suites | 5 | frontend | `make test-web` |

## Risks & open questions

- **Root-row click behavior change:** today, clicking a root row both navigates and toggles expansion. The plan moves toggle to the chevron only (consistent across depths). Flag in PR description; if PO rejects, fall back to "row click navigates AND toggles" — implementation is a one-line additional `onToggle` call inside the row's anchor click handler.
- **`?open=` URL growth:** with N levels, the param can grow long. Acceptable for tens of nodes; revisit if instrumentation shows truncation.
- **Status indicator on intermediate nodes:** plan opts for count-only on intermediates (matching wireframe). If PO wants both (count + roll-up status), defer to a follow-up.
- **Existing test file path:** confirm whether tests live under `apps/web/src/components/catalog/__tests__/` or `apps/web/__tests__/components/catalog/`. Use the existing convention.

## Verification

- Frontend: `make lint && make test-web` from repo root.
- Browser walkthrough on `make dev-web`:
  1. Deep navigation to a level-3 topic from the sidebar.
  2. Chevron toggle isolation (no navigation).
  3. Search query that matches only a grandchild — ancestors auto-expand.
  4. Dark / Light theme parity.
  5. Mobile drawer at < 768px width.

## Out of scope

- Backend / API / migration changes.
- `TopicNode` schema or `topics-api` updates.
- "Collapse all" button, virtualization, drag-to-reorder, status roll-up on intermediate nodes.
- Changes to main pane, breadcrumb, or dictionary keys.
