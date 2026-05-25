# Task 04: Catalog Mobile & Tablet Responsiveness

## Metadata
- **Status:** ✅ Done
- **Complexity:** Medium-High
- **Milestone:** Phase 5 (Participant Experience)
- **Dependencies:** Task 02 (Catalog Menu Navigation), Task 03 (Topic Content & Media)
- **Category:** User Experience / Responsive Design

---

## Summary

The catalog section (`/catalog`, `/catalog/:id`, `/catalog/:id/:subtopicId`) is not responsive and breaks on mobile and tablet viewports. The fixed 280px left sidebar (`CatalogSidebar`) and fixed 280px right sidebar (`SubtopicSidebar`) consume the entire screen width on small devices, leaving no space for content. This task redesigns the catalog layout to be fully responsive: on mobile and tablet, sidebars are replaced by an inline topic-tree view with progress indicators, a persistent search bar, and a depth-breadcrumb trail showing the current position in the topic hierarchy.

No backend changes are required — all data (topic trees, children, progress) is already returned by existing API endpoints.

---

## Problem Statement

On mobile and tablet:
1. The 280px left `CatalogSidebar` and the 280px right `SubtopicSidebar` overlap or overflow the viewport entirely
2. Content pages become unreadable because the flex-row layout does not collapse
3. Users cannot browse topics or navigate subtopics at all on mobile devices
4. The search bar is hidden inside the left sidebar and inaccessible when the sidebar is off-screen
5. The right `SubtopicSidebar` (sibling list) duplicates navigation already present on the parent topic page and has no meaningful purpose at its current position

**User Impact:**
- Students using mobile or tablet cannot access any catalog content
- The learning experience is desktop-only, excluding mobile-first users
- Discoverability of topics and progress tracking are broken below 1024px

---

## Architectural Context

### Cloud-Agnostic Approach
- **Frontend Only:** All changes are in `apps/web` — layout, components, and responsive CSS
- **No New API Endpoints:** Existing `topicsApi.getById`, `topicsApi.list`, and `topicsApi.listProgress` already return all required data (tree structure, children, progress)
- **No Adapter Changes:** Data layer (`ITopicNodeRepository`, `ITopicProgressRepository`) is unchanged
- **Storage Agnostic:** Media URLs served the same way regardless of viewport

### Current Structure to Modify
- `apps/web/src/app/(protected)/catalog/layout.tsx` — rigid flex row with fixed-width sidebars
- `apps/web/src/components/catalog/CatalogSidebar.tsx` — left sidebar with search, tree, progress
- `apps/web/src/components/catalog/SubtopicSidebar.tsx` — right sidebar with sibling list and prev/next
- `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — topic detail page (subtopic cards)
- `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx` — subtopic detail page

---

## Requirements

### 1. Responsive Catalog Layout (`catalog/layout.tsx`)

**Desktop (≥1024px) — unchanged:**
- Left sidebar (280px) always visible with search, tree, progress
- Main content fills remaining space
- Right `SubtopicSidebar` visible on subtopic detail pages

**Tablet (640px–1023px) and Mobile (<640px) — new behavior:**
- Left sidebar is hidden; replaced by a top persistent search bar always visible above the content area
- No right sidebar — `SubtopicSidebar` is hidden entirely on mobile/tablet
- Full-width content area with comfortable padding
- Search bar at the top of every catalog page on mobile (sticky or always-visible, not collapsible)

### 2. Persistent Search Bar (Mobile/Tablet)

- A search input always visible at the top of the catalog content area on mobile/tablet
- Filters topics just like the sidebar search on desktop (same URL state: `?q=` param)
- Must remain visible while scrolling content (sticky positioning)
- Consistent styling with the existing desktop sidebar search (same input style)
- On desktop this element is hidden (search lives in the sidebar)

### 3. Depth Breadcrumb / Hierarchy Trail

- All catalog pages display a breadcrumb showing the depth path:
  - Catalog root: `Catalogue`
  - Topic detail: `Catalogue › Root Topic Title`
  - Subtopic detail: `Catalogue › Root Topic Title › Subtopic Title`
- On subtopic detail pages with 3+ levels (if a subtopic has children): breadcrumb extends naturally
- The breadcrumb format is visual text with separator characters (e.g., `›`) and clickable links back to parent levels
- On mobile the breadcrumb should be compact (truncate long titles with ellipsis if needed)
- This replaces/extends the existing simple `<nav>` breadcrumbs already in each page

### 4. Mobile Topic List View (`/catalog` and `/catalog/:id`)

**Catalog root page (`/catalog`) on mobile/tablet:**
- Display the full list of root topics directly on the page (currently shows a static "Welcome" placeholder)
- Each root topic entry shows: title, progress bar, percentage complete, number of subtopics
- Completed topics show a green indicator (dot or checkmark)
- Tapping a topic navigates to `/catalog/:id`

**Topic detail page (`/catalog/:id`) on mobile/tablet:**
- Title, progress bar, and metadata remain at top (existing behavior)
- Below: list of subtopics displayed as tappable rows with:
  - Ordered number or green checkmark circle when completed
  - Subtopic title
  - Individual progress indicator (green dot = completed, accent dot = in progress, empty = not started)
- This list is the same subtopic card list already present on the desktop page — ensure it renders well on mobile (single column, comfortable tap targets ≥44px height)

### 5. Subtopic Detail Page — Rethought Layout (`/catalog/:id/:subtopicId`)

**Right sidebar removal on mobile/tablet:**
- `SubtopicSidebar` is hidden on mobile/tablet (sibling list not needed at this level)
- The content page is full-width on mobile/tablet

**Inline children list (if subtopic has children):**
- If the current subtopic node has child nodes, display them at the bottom of the subtopic detail page (below content and media)
- Render as a simple ordered list with green dots for completed children, matching the style of the sibling list on the parent topic page
- Each child is tappable and navigates to `/catalog/:id/:childId`
- This applies on all viewports (desktop + mobile), bringing parity

**Prev/Next navigation:**
- On mobile/tablet, show prev/next subtopic navigation as a bottom bar or inline buttons at the end of the page content (since the sidebar is hidden)
- On desktop the existing `SubtopicSidebar` prev/next remains

### 6. Progress Indicators (Consistent Across All Views)

- Root topic row: progress bar + percentage (already exists on desktop sidebar — mirror on mobile list)
- Subtopic rows: green filled circle for `completed`, accent-colored dot for `in_progress`, empty/grey circle for `not_started`
- The visual language must be consistent between the desktop sidebar tree and the mobile inline list

---

## Technical Constraints

- **No new API endpoints or backend changes** — all data is available via existing endpoints
- **Tailwind CSS v4 responsive utilities** — use `sm:`, `md:`, `lg:` breakpoints for responsive switching; mobile-first approach
- **No new npm dependencies** — use existing Next.js, React 19, Tailwind v4
- **TypeScript strict mode** — no `any` types introduced
- **Cloudflare Pages compatibility** — no features that break `next-on-pages` (no Node.js APIs, no static ISR)
- **Must not break desktop** — all existing desktop behavior must be preserved pixel-perfect
- **`make lint` must pass** before task is considered complete
- **Accessibility** — tap targets ≥44px on mobile, keyboard navigable, semantic HTML, screen reader compatible

---

## Scope

### Files to Modify

1. **`apps/web/src/app/(protected)/catalog/layout.tsx`**
   - Add responsive breakpoints: show sidebar only on `lg:` (≥1024px), hide on smaller viewports
   - Add a mobile-only top search bar slot rendered above `{children}` on mobile/tablet
   - Pass search state down or use URL params shared with `CatalogSidebar`

2. **`apps/web/src/components/catalog/CatalogSidebar.tsx`**
   - Hide the entire component on mobile/tablet (`hidden lg:flex`)
   - Extract the search input logic into a shareable hook or URL-param utility so the mobile top bar can reuse it

3. **`apps/web/src/components/catalog/SubtopicSidebar.tsx`**
   - Hide on mobile/tablet (`hidden lg:flex`)
   - Ensure desktop behavior is unchanged

4. **`apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx`**
   - Add mobile prev/next navigation at the bottom of the page (visible only on mobile/tablet)
   - Add inline children list section at the bottom if the subtopic has child nodes
   - Ensure breadcrumb is consistent and compact on mobile

5. **`apps/web/src/app/(protected)/catalog/[id]/page.tsx`**
   - Ensure subtopic card list is mobile-friendly (touch target sizes, single column)
   - Ensure breadcrumb is compact on mobile

6. **`apps/web/src/app/(protected)/catalog/page.tsx`**
   - On mobile/tablet: replace the static "Welcome" placeholder with a live topic list fetched from the API (mirror the `CatalogSidebar` tree but as page content)
   - On desktop: keep or improve the current placeholder (sidebar provides navigation)

### New Component (optional, if developer judges necessary)
- A `MobileTopicList` or `CatalogTopicListMobile` component that renders the topic+progress list for mobile/tablet views on the root catalog page

**No code in the task — implementation details left to developer.**

---

## Acceptance Criteria

- [x] On mobile (<640px) and tablet (640px–1023px), the left `CatalogSidebar` is hidden and does not consume screen space
- [x] On mobile/tablet, a search bar is always visible at the top of the catalog content area and filters topics via `?q=` URL param
- [x] On desktop (≥1024px), all existing sidebar behavior is unchanged
- [x] On mobile, `/catalog` shows a list of root topics with progress bars and green indicators for completed topics
- [x] On mobile, `/catalog/:id` shows the subtopic list in a mobile-optimized single-column layout with tap targets ≥44px
- [x] On mobile, `/catalog/:id/:subtopicId` is full-width (right sidebar hidden); page contains prev/next navigation at the bottom
- [x] If a subtopic node has children, they are listed at the bottom of the subtopic detail page on all viewports
- [x] Breadcrumb trail is present on all three catalog route levels and shows: `Catalogue › Root Topic › Subtopic`
- [x] Breadcrumb links are tappable and navigate correctly to parent levels
- [x] Progress indicators (green dot/circle for completed, accent for in-progress, grey for not started) are consistent across all views
- [x] Search bar on mobile filters the topic list in real-time with `?q=` URL state (debounced)
- [x] No horizontal scroll or layout overflow on any viewport width (320px–1920px+)
- [x] Desktop layout matches current behavior pixel-for-pixel (no regressions)
- [x] `make lint` passes with no TypeScript violations
- [x] All tap/click targets are ≥44px on mobile
- [x] Dark mode renders correctly on all mobile views

---

## Verification Plan

### Automated Tests

1. Update / add tests in `apps/web/src/components/catalog/__tests__/`:
   - `CatalogSidebar.test.tsx` — verify component is marked hidden on mobile breakpoints (check className)
   - `SubtopicSidebar.test.tsx` (new) — verify hidden on mobile, visible on desktop
   - `subtopic-detail.test.tsx` — verify prev/next nav renders when sidebar is absent; verify children list renders when subtopic has children

### Manual Browser Validation

**Mobile (375px — iPhone SE):**
1. Navigate to `/catalog` → root topic list renders with progress indicators
2. Tap a topic → `/catalog/:id` opens, subtopic list is scrollable with large tap targets
3. Tap a subtopic → `/catalog/:id/:subtopicId` opens full-width; right sidebar is absent
4. Verify breadcrumb reads `Catalogue › Topic › Subtopic`
5. Verify search bar at top is visible and sticky while scrolling
6. Type in search → topic list filters in real-time
7. Tap prev/next at bottom of subtopic detail page → navigates correctly
8. Verify no horizontal scroll at any point
9. Test dark mode

**Tablet (768px — iPad portrait):**
1. Repeat the same flow as mobile — same responsive behavior should apply
2. Ensure search bar is visible and usable in tablet orientation
3. Rotate to landscape (1024px+) → sidebar should reappear

**Desktop (1280px):**
1. Verify left sidebar is present and unchanged
2. Verify right `SubtopicSidebar` appears on subtopic detail pages
3. Verify search in sidebar still works
4. Verify no new children list or mobile-only elements appear at desktop breakpoints (or that they render gracefully)
5. Confirm breadcrumb is present and styled correctly

**Cross-cutting:**
1. Login as student, complete a full learning path (catalog → topic → subtopic) on mobile
2. Verify progress updates correctly after marking a subtopic done (green indicator updates)
3. Navigate back using breadcrumbs at each level
4. Test with topics that have no children, one subtopic, and many subtopics

---

## Notes

- The `SubtopicSidebar` right panel was originally designed for desktop tree-traversal; on mobile, the subtopic list is better served by returning to the parent topic page. The bottom prev/next buttons are sufficient for linear progression on mobile.
- The catalog root page (`/catalog`) currently shows a static placeholder; on mobile where the sidebar is hidden, this page would be blank without the list. The mobile topic list on `/catalog` is essential for discoverability.
- Consider using CSS container queries or `useMediaQuery` hook for any JavaScript-driven responsive logic to avoid hydration mismatches (prefer Tailwind responsive classes over JS where possible).
- The depth breadcrumb should use the same data already loaded by each page (no extra API calls needed).
- No backend task is required — the existing `topicsApi.getById` response already includes `children`, and `topicsApi.listProgress` returns all progress entries. All necessary data is available on the frontend.
