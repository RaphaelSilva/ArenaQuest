# Task 02: Enable Catalog Menu Navigation

## Metadata
- **Status:** ✅ Done
- **Complexity:** Low
- **Milestone:** Phase 5 (Engagement and Student Progress)
- **Dependencies:** None (Catalog page already exists at `/protected/catalog`)
- **Category:** User Experience / Navigation

---

## Summary

Add a "Catalog" menu item to the top navigation bar that directs students to the topic catalog. The catalog page already exists but is currently inaccessible from the main navigation—students can only access it through task links. This task makes the catalog discoverable and accessible directly from the top menu.

---

## Problem Statement

Currently, students have no direct navigation path to the topic catalog from the main menu. The catalog page exists and functions correctly at `/protected/catalog`, but:

1. No menu item in the top navigation (desktop or mobile) links to it
2. Students must rely on task-based navigation or direct URL entry
3. Reduces discoverability of available topics and subjects

**User Impact:**
- Students cannot easily browse all available topics without being assigned a task
- Catalog access is hidden from the main UX flow
- Learning paths are task-centric rather than topic-centric

---

## Architectural Context

### Cloud-Agnostic Approach
- Navigation is purely frontend (Next.js routing)
- No backend changes required
- No new API endpoints or database modifications
- Uses existing Next.js `Link` component and routing infrastructure

### Current State
- Catalog page exists: `apps/web/src/app/(protected)/catalog/page.tsx` ✓
- Navigation component: `apps/web/src/components/layout/nav.tsx`
- Top nav desktop links: Dashboard, Admin (conditional), Tasks, Settings
- Mobile drawer links: Dashboard, Tasks, Settings, Admin section
- Catalog is missing from both sections

---

## Requirements

### 1. Desktop Navigation Menu
- Add "Catalog" link to the desktop navigation bar
- Position it logically (suggested: after Dashboard, before Tasks, or after Tasks)
- Apply consistent styling with other nav links (hover states, active state, dark mode)
- Show active state when user is on `/catalog` or catalog sub-pages (`/catalog/:id`, `/catalog/:id/:subtopicId`)

### 2. Mobile Navigation Drawer
- Add "Catalog" link to the mobile drawer menu
- Position it consistently with desktop placement
- Apply same styling and active state logic as desktop
- Ensure drawer closes after navigation (like other links)

### 3. Role-Based Access
- Catalog should be visible to all authenticated users (students, admins, content creators)
- No role restrictions on viewing the catalog (unlike admin links which are conditional)

### 4. Styling & State Management
- Use the same styling pattern as existing nav links
- Implement active state detection using `usePathname()` and checking if current path starts with `/catalog`
- Ensure dark mode support (apply `dark:` Tailwind classes where used)

---

## Technical Constraints

- **No backend changes:** Purely frontend navigation
- **No new dependencies:** Use existing Next.js, React, and Tailwind CSS
- **Must maintain:** Responsive design, accessibility, dark mode compatibility
- **Must not:** Break existing navigation, introduce console errors, or cause TypeScript violations
- **Navigation array:** Update both `navLinks` (or similar) and mobile drawer rendering

---

## Scope

### 1. Update Nav Component
Modify `apps/web/src/components/layout/nav.tsx`:

**Updates to desktop nav section:**
- Add "Catalog" link to the desktop nav bar (lines 136–151)
- Link should point to `/catalog`
- Apply active state styling when `pathname === '/catalog'` or `pathname.startsWith('/catalog/')`

**Updates to mobile drawer:**
- Add "Catalog" link to the mobile drawer `navLinks` list (lines 50–67)
- Ensure it respects the same active state logic
- Drawer closes on click (inherited from existing `onClick={onClose}`)

**No code in the task itself — implementation details left to developer.**

---

## Acceptance Criteria

- [x] "Catalog" link appears in desktop navigation bar
- [x] "Catalog" link appears in mobile navigation drawer
- [x] Desktop link correctly navigates to `/catalog`
- [x] Mobile link correctly navigates to `/catalog`
- [x] Active state (highlighted styling) appears when user is on `/catalog` or `/catalog/*`
- [x] Links are styled consistently with existing nav items (color, hover, dark mode)
- [x] Mobile drawer closes after clicking "Catalog"
- [x] No console errors or TypeScript type violations
- [x] Responsive design maintained (no layout shifts or broken styles)
- [x] Dark mode styling applied correctly
- [x] `make lint` passes
- [x] No regressions in existing navigation flows (Dashboard, Tasks, Settings, Admin remain functional)

---

## Verification Plan

### Automated Tests
1. Add snapshot/unit tests for Nav component in `apps/web/__tests__/components/layout/nav.test.tsx`:
   - Verify "Catalog" link renders in desktop nav
   - Verify "Catalog" link renders in mobile drawer
   - Test active state detection for `/catalog` and `/catalog/:id` paths
   - Verify href is correct (`/catalog`)

### Manual Testing (Browser Validation)

**Desktop Navigation:**
1. Open app in desktop viewport (≥768px width)
2. Verify "Catalog" link is visible in top nav bar
3. Click "Catalog" link → should navigate to `/catalog`
4. Verify active styling appears on the link
5. Verify styling matches other nav links (color, font, spacing)
6. Test dark mode toggle → verify styles update correctly

**Mobile Navigation:**
1. Open app in mobile viewport (<768px width)
2. Click hamburger menu icon → drawer opens
3. Verify "Catalog" link is present in drawer
4. Click "Catalog" link → should navigate to `/catalog` and drawer closes
5. Verify active styling appears when on catalog page
6. Test drawer reopens and link still works

**Integration Flow:**
1. Login as student user
2. Navigate from Dashboard → Catalog (via nav) → Task (via nav) → back to Catalog (via nav)
3. Test breadcrumb/navigation consistency
4. Test that all other nav items still work correctly

**Dark Mode:**
1. Toggle dark mode in settings or browser dev tools
2. Verify "Catalog" link text and hover states are visible in dark mode
3. Confirm contrast meets accessibility standards

---

## Notes

- This is a straightforward navigation enhancement with zero backend impact
- The catalog page and its functionality already exist and are stable
- This task unblocks the full student learning journey by making topics discoverable
- Consider future: In Phase 5 (Dashboard), catalog might be prominently featured on the dashboard itself, but top nav access should remain as a fallback
- Link positioning should follow the principle: primary student features (Dashboard, Catalog, Tasks) before secondary features (Settings)
