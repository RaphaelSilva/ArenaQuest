# Plan — Enable Catalog Menu Navigation

**Task:** [02-enable-catalog-menu.task.md](../02-enable-catalog-menu.task.md)  
**Milestone:** Phase 5 (Engagement and Student Progress)  
**Assigned persona:** frontend-developer  
**Branch:** feature/enable-catalog-menu (from develop)

## Objective

Add a "Catalog" menu item to both desktop and mobile navigation in the top nav bar. The catalog page already exists at `/protected/catalog` but is currently hidden from the main navigation—students can only access it via task links. This enhancement makes the catalog discoverable and navigable directly from the main menu, improving the UX flow and topic discoverability.

## Affected areas

**Files to modify:**
- `apps/web/src/components/layout/nav.tsx` — desktop nav section (desktop links) and mobile drawer (drawer links)

**Files to test (no changes needed):**
- Catalog page: `apps/web/src/app/(protected)/catalog/page.tsx` — verify link works

**Files NOT touched:**
- Backend API (no changes needed)
- `packages/shared` (no type changes)
- Database migrations (no changes)

## Step-by-step

### Frontend

1. **Open nav.tsx** and locate the desktop nav links section (lines ~136–151).
   - Add a new nav link object for "Catalog" pointing to `/catalog`
   - Position it logically (suggested: after Dashboard, before Tasks)
   - Style consistently with existing nav items using Tailwind

2. **Implement active state detection** for the "Catalog" link.
   - Use `usePathname()` to detect current route
   - Active state triggers when: `pathname === '/catalog'` OR `pathname.startsWith('/catalog/')`
   - Apply active styling (color, font weight, or underline) consistent with other nav links

3. **Add "Catalog" to mobile drawer links** (lines ~50–67).
   - Insert into the `navLinks` array used by the mobile drawer
   - Apply same active state logic
   - Drawer closes on click (inherited from existing `onClick={onClose}`)

4. **Dark mode support** — ensure styling uses `dark:` Tailwind classes where appropriate.
   - Test hover states, active states, and text contrast in dark mode
   - Verify dark mode toggle in settings applies correctly to the new link

5. **No console errors** — ensure TypeScript strict mode is satisfied and no console warnings appear.

## Acceptance Criteria mapping

| AC | Plan step(s) | Verification |
|---|---|---|
| "Catalog" link appears in desktop navigation bar | Step 1, 2 | Visual inspection on desktop viewport |
| "Catalog" link appears in mobile navigation drawer | Step 3 | Visual inspection on mobile viewport + hamburger menu |
| Desktop link correctly navigates to `/catalog` | Step 1 | Click link, verify URL and page content |
| Mobile link correctly navigates to `/catalog` | Step 3 | Click link in drawer, verify URL and page content |
| Active state (highlighted styling) appears when on `/catalog` or `/catalog/*` | Step 2, 3 | Navigate to catalog and sub-pages, verify styling |
| Links styled consistently with existing nav items (color, hover, dark mode) | Step 1, 2, 3, 4 | Compare styling with Dashboard, Tasks, Settings links |
| Mobile drawer closes after clicking "Catalog" | Step 3 | Click link in drawer, verify drawer closes and navigation occurs |
| No console errors or TypeScript violations | Step 5 | Run `make lint` and check browser console |
| Responsive design maintained (no layout shifts or broken styles) | All steps | Test on multiple viewport sizes (mobile, tablet, desktop) |
| Dark mode styling applied correctly | Step 4 | Toggle dark mode and verify readability and contrast |
| `make lint` passes | All steps | Run `make lint` before committing |
| No regressions in existing navigation (Dashboard, Tasks, Settings, Admin remain functional) | All steps | Navigate through all existing nav items and verify they work |

## Risks & open questions

- None identified — this is a straightforward UI addition with zero backend impact and no new dependencies.
- Catalog page already exists and is stable.
- Existing nav component is well-structured; adding a link is a minimal change.

## Verification

**Automated:**
- `make lint` — verify TypeScript strict mode and linting pass
- Optional: add unit test snapshot in `apps/web/__tests__/components/layout/nav.test.tsx` to verify "Catalog" link renders

**Manual (Browser):**
1. Start dev server: `make dev-web` (localhost:3000)
2. Desktop viewport (≥768px):
   - Verify "Catalog" appears in top nav bar
   - Click link → navigates to `/catalog`
   - Verify active styling appears
   - Verify styling matches other nav links (color, font, spacing)
3. Mobile viewport (<768px):
   - Click hamburger menu
   - Verify "Catalog" in drawer
   - Click link → navigates to `/catalog` and drawer closes
4. Dark mode:
   - Toggle dark mode in settings
   - Verify link text and hover states are visible and high contrast
5. Integration:
   - Log in as student
   - Navigate: Dashboard → Catalog → Tasks → Catalog (verify nav consistency)
   - Test breadcrumb/navigation flow

## Out of scope

- Backend API changes (no new endpoints)
- Database or migration changes
- Modifying the Catalog page functionality itself
- Changing the catalog component styling (only nav link styling)
- Admin role-based restrictions (catalog visible to all authenticated users, no role gate)
