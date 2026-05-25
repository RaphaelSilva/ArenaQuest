# Plan — 04-frontend-topics-mobile-adapt

**Task:** [04-frontend-topics-mobile-adapt.task.md](../04-frontend-topics-mobile-adapt.task.md)
**Source:** Backlog
**Assigned personas:** frontend-developer
**Branch:** feature/backlog/04-frontend-topics-mobile-adapt.task

## Objective

Redesign the catalog layout to be fully responsive on mobile and tablet viewports (<1024px). On small screens, fixed sidebars (280px left + right) consume the entire viewport, breaking the layout. The solution replaces sidebars with a top persistent search bar, inline topic lists, breadcrumb trails, and bottom navigation. Desktop behavior (≥1024px) remains unchanged.

## Affected areas

**Files to modify:**
- `apps/web/src/app/(protected)/catalog/layout.tsx` — add responsive breakpoints, show/hide sidebars, render mobile search bar
- `apps/web/src/components/catalog/CatalogSidebar.tsx` — add `hidden lg:flex` to hide on mobile/tablet
- `apps/web/src/components/catalog/SubtopicSidebar.tsx` — add `hidden lg:flex` to hide on mobile/tablet
- `apps/web/src/app/(protected)/catalog/page.tsx` — show root topic list on mobile (replace static Welcome)
- `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — ensure subtopic list is mobile-optimized (single column, ≥44px tap targets)
- `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx` — full-width on mobile, add bottom prev/next nav, add inline children list

**Components to create (if needed):**
- Mobile search bar component (or refactor existing search from CatalogSidebar)
- Breadcrumb component for catalog hierarchy (Catalogue › Topic › Subtopic)
- Mobile topic list view (for /catalog on small screens)

**Out of scope:**
- Backend API changes
- New API endpoints
- Database migrations
- Changes to data adapters or repository interfaces

## Step-by-step

### Frontend

1. **Make CatalogSidebar and SubtopicSidebar responsive**
   - Add `hidden lg:flex` to root container of `CatalogSidebar` component (hide on sm/md, show on lg+)
   - Add `hidden lg:flex` to root container of `SubtopicSidebar` component
   - Verify no layout shift on desktop at 1024px boundary

2. **Create a reusable breadcrumb component**
   - New file: `apps/web/src/components/catalog/CatalogBreadcrumb.tsx`
   - Accepts `path` array with labels and href values
   - Renders: `Catalogue › Topic › Subtopic` with clickable links
   - On mobile, add `truncate` / `text-sm` for compact display
   - Use `›` separator
   - Link to parent levels using existing route structure

3. **Extract search logic into a mobile search bar**
   - New file: `apps/web/src/components/catalog/MobileSearchBar.tsx` (or reuse existing search input)
   - Input searches via `?q=` URL param (same as sidebar search)
   - Sticky positioning on mobile (`sticky top-0 z-10`)
   - Hidden on desktop (`hidden lg:block`)
   - Reuse styling from CatalogSidebar search input
   - Debounce input to avoid excessive URL updates (200-300ms)

4. **Update catalog layout to include mobile search bar**
   - In `apps/web/src/app/(protected)/catalog/layout.tsx`:
     - Keep existing flex row layout (sidebar + content)
     - Add conditional mobile search bar above `{children}` (visible only on `md:` and below)
     - Ensure content area takes full width on mobile (no fixed sidebar)
     - No layout shift between mobile and desktop at 1024px

5. **Update catalog root page (/catalog) to show topic list on mobile**
   - In `apps/web/src/app/(protected)/catalog/page.tsx`:
     - On mobile: fetch root topics (from existing `topicsApi.list()`) and render inline
     - Each root topic: title, progress bar (%), number of subtopics, green dot if completed
     - Tappable rows (≥44px height) → navigate to `/catalog/:id`
     - On desktop: keep existing placeholder or enhance it (sidebar provides navigation)
     - Breadcrumb: `Catalogue` only

6. **Ensure topic detail page is mobile-friendly (/catalog/:id)**
   - In `apps/web/src/app/(protected)/catalog/[id]/page.tsx`:
     - Subtopic card list should render in single column on mobile (already likely does via Tailwind, verify)
     - Verify tap targets are ≥44px (adjust card padding/height if needed)
     - Breadcrumb: `Catalogue › Topic Title`
     - Progress bar and metadata visible at top (unchanged)
     - No horizontal scroll

7. **Update subtopic detail page for mobile (/catalog/:id/:subtopicId)**
   - In `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx`:
     - Hide `SubtopicSidebar` on mobile (it's already hidden via Tailwind in layout)
     - Make content full-width on mobile
     - Add inline children list at bottom of page content if subtopic has children:
       - List each child with ordered number/green checkmark circle
       - Render same style as parent sibling list on desktop
       - Each child is tappable → `/catalog/:id/:childId`
     - Add bottom prev/next navigation (visible on mobile, hidden on desktop where sidebar has it)
       - Two buttons: "← Previous" and "Next →"
       - Styled as bottom bar or inline buttons
       - Disabled state if at start/end of sibling list
     - Breadcrumb: `Catalogue › Root Topic › Subtopic`

8. **Create breadcrumb component integration**
   - On all three catalog routes:
     - `/catalog` → render `<CatalogBreadcrumb path={[{ label: 'Catalogue', href: '/catalog' }]} />`
     - `/catalog/:id` → render breadcrumb with topic title
     - `/catalog/:id/:subtopicId` → render breadcrumb with root topic and subtopic title
   - Breadcrumb should fetch needed data from context/props (already loaded on page)
   - No extra API calls

9. **Verify progress indicators are consistent**
   - Root topic: progress bar + percentage (desktop: in sidebar; mobile: in inline list)
   - Subtopic rows: green filled circle (completed), accent dot (in_progress), empty/grey circle (not_started)
   - Ensure styling matches across desktop sidebar tree and mobile inline lists
   - Update color palette if needed to match Tailwind accent colors

10. **Test dark mode**
    - Verify all new mobile components render correctly in dark mode
    - Check contrast on search bar, breadcrumb, buttons
    - Test at least one flow in dark mode

11. **Run linting and tests**
    - `make lint` — ensure no TypeScript violations, no unused imports
    - `make test-web` — run all web tests (update snapshots if needed)
    - Fix any violations before merging

12. **Manual browser validation**
    - On mobile (375px viewport):
      - Navigate `/catalog` → root topic list renders with progress bars
      - Tap topic → `/catalog/:id` opens, subtopic list scrollable with ≥44px tap targets
      - Tap subtopic → `/catalog/:id/:subtopicId` full-width, breadcrumb visible, bottom nav visible
      - Search bar sticky at top, filters topics in real-time
      - No horizontal scroll at any point
    - On tablet (768px):
      - Repeat same flow, verify responsive behavior
    - On desktop (1280px):
      - Verify sidebars appear (desktop unchanged)
      - Verify search in sidebar works
      - Verify no regression from mobile elements

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| CatalogSidebar hidden on mobile/tablet (<1024px) | 1 | frontend | Tailwind class check, browser visual test |
| Search bar always visible at top on mobile, filters via `?q=` param | 3, 4 | frontend | Manual test, URL inspection |
| Desktop behavior unchanged at ≥1024px | 1, 4 | frontend | Regression test, browser visual comparison |
| /catalog shows root topic list on mobile | 5 | frontend | Browser test, no data should be from mock |
| /catalog/:id subtopic list is single-column with ≥44px tap targets | 6 | frontend | Browser measurement, manual test |
| /catalog/:id/:subtopicId is full-width on mobile, right sidebar hidden | 7 | frontend | Tailwind class check, visual test |
| Subtopic children list renders at bottom if present | 7 | frontend | Manual test with nested topics |
| Breadcrumb shows correct depth path on all routes | 8 | frontend | Manual navigation, link validation |
| Breadcrumb links are clickable and navigate correctly | 8 | frontend | Manual test at each level |
| Progress indicators (green/accent/grey dots) consistent | 9 | frontend | Visual comparison across views |
| Search bar on mobile filters in real-time with debounce | 3, 4 | frontend | Manual typing test, no excessive URL updates |
| No horizontal scroll 320px–1920px | 7 | frontend | Visual test across breakpoints |
| Desktop layout pixel-perfect match | 1, 4 | frontend | Side-by-side browser comparison |
| `make lint` passes, no TS violations | 11 | frontend | CLI output |
| All tap targets ≥44px on mobile | 6, 7 | frontend | Browser DevTools measurement, manual test |
| Dark mode renders correctly on mobile | 10 | frontend | Visual test in dark mode |

## Risks & open questions

- **Search state management on mobile:** Ensure URL `?q=` param is synchronized with search input state to avoid hydration mismatches. Prefer URL-driven state over React state where possible.
- **Breadcrumb data availability:** Current pages must already load topic titles and IDs; breadcrumb component should not require extra API calls. Verify data is in context/props.
- **Children list recursion:** If a subtopic has many children, the inline list could be long. No pagination spec given — render all children but consider visual grouping if list > 10 items.
- **Prev/next navigation logic:** Siblings list is derived from parent topic's children. Verify order is stable and matches displayed subtopic list order.
- **Mobile topic list fetching:** `/catalog` on mobile must call `topicsApi.list()` to get root topics. Verify API is available in page context and cache behavior.
- **Sticky search bar interaction:** On iOS Safari, sticky positioning can behave unexpectedly with keyboard input. Test on actual mobile device if possible.

## Verification

- **Frontend unit tests:** `make test-web` — verify breadcrumb, mobile search bar, responsive classes
- **Frontend linting:** `make lint` — no TypeScript violations, no unused imports
- **Manual browser validation (per §3.6 of task):**
  - Mobile (375px): full catalog flow, search filtering, no horizontal scroll
  - Tablet (768px): same as mobile
  - Desktop (1280px): sidebar visible, no regressions
  - Dark mode: at least one flow
- **Tap target validation:** DevTools measurement or manual test, verify ≥44px on all clickable elements on mobile
- **No data from mocks:** All API calls should hit real endpoints (via dev server); no placeholder data except default `Welcome` on desktop /catalog

## Out of scope

- Backend changes or new API endpoints
- Database migrations or data modeling changes
- Creating a new parent topic level or restructuring existing hierarchy
- Pagination on children lists (render all if present)
- Animation or transition refinement (use existing Tailwind defaults)
- A/B testing or analytics instrumentation
