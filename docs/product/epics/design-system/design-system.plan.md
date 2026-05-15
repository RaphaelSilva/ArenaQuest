# Design System Standardization Epic Plan

**Epic:** Padronizar Design System ArenaQuest  
**Branch:** `style/fix` (from `develop`)  
**Assigned persona:** frontend-developer  
**Status:** Planning Complete — Ready for Implementation

---

## Executive Summary

The ArenaQuest application currently exhibits **inconsistent styling and design patterns** across admin pages, with the **Catalog page** (`/catalog/[id]`) serving as the reference implementation. This epic standardizes the entire UI by:

1. Establishing design tokens (colors, typography, spacing)
2. Creating reusable component library
3. Refactoring 5 admin/user pages to match the catalog design
4. Documenting the design system for future consistency

**Reference Design:** `/catalog/[id]` (best-in-class styling)

---

## Design Tokens (Canonical)

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| Primary Accent | `oklch(0.74 0.19 52)` (Laranja) | Buttons, primary CTAs, focus states |
| Secondary Accent | `oklch(0.765 0.177 163)` (Ciano) | Status badges (published/active), secondary links |
| Status: Archived | Orange | Consistent with primary accent |
| Status: Draft | Default text color | Gray/neutral |
| Status: Inactive User | Red | Danger state |
| Danger Action | Red | Delete, deactivate, destructive actions |
| Background Dark | `rgb(11, 14, 23)` | Page background |
| Background Card | `rgb(19, 24, 37)` | Card/container background |
| Border | `rgb(82, 82, 90)` (zinc-800) | Subtle borders |
| Text Primary | `rgb(250, 250, 250)` (near white) | Body text |

### Typography
| Element | Font | Size | Weight | Tracking |
|---------|------|------|--------|----------|
| Page Heading | Arial/Helvetica | 28px | 700 | Normal |
| Section Label | Arial/Helvetica | 14px | 700 | Uppercase, +0.05em |
| Body Text | Arial/Helvetica | 16px | 400 | Normal |
| Button Text | Arial/Helvetica | 14px | 600 | Normal |

### Spacing & Borders
| Token | Value |
|-------|-------|
| Button border-radius | 16px |
| Input border-radius | 8px |
| Card border-radius | 8px |
| Standard gap/padding | 16px |

---

## Implementation Phases

### Phase 1: Design Tokens & CSS Variables
**Priority:** CRITICAL (blocks all other phases)

**Deliverable:** `apps/web/src/styles/design-system.css`

1. Create centralized CSS variables for colors, typography, spacing
2. Export as `@layer utilities` for Tailwind integration
3. Document token usage in comments
4. No component changes yet — tokens only

**Verification:** `make lint` passes, no visual changes in browser

---

### Phase 2: Reusable Components
**Priority:** HIGH (enables consistent refactoring)

Create a new `src/components/design-system/` folder with:

#### 2.1 Button Component
- Variants: `primary` (orange), `secondary`, `danger` (red)
- Default border-radius: 16px
- Padding: 8px 16px (sm), 12px 24px (base)
- Usage: All CTAs across the app

#### 2.2 Badge Component
- Status badges: `published` (cyan), `archived` (orange), `draft` (gray), `active` (green), `inactive` (red)
- Default border-radius: 8px (not pill-shaped unless explicitly "pill" variant)
- Sizes: `sm`, `md`

#### 2.3 Table Component (Header & Body)
- Uppercase headers with +0.05em tracking
- Row borders: zinc-800
- Padding: 12px 16px per cell
- Hover state: subtle background

#### 2.4 Input Component
- Border-radius: 8px
- Padding: 8px 12px
- Border: 1px zinc-800
- Focus: orange accent ring

#### 2.5 Layout Wrapper
- Max-width: 1280px (if needed, else full-width with padding)
- Padding: 24px for desktop, 16px mobile
- Dark background: `rgb(11, 14, 23)`

**Verification:** Storybook or visual inspection of all variants

---

### Phase 3: Refactor Topic Tree Admin (`/admin/topics`)
**Priority:** HIGH

**Current Issues:**
- "New Root Topic" button: indigo instead of orange
- Heading: 20px, should be 28px
- Status badges: inconsistent styling
- Spacing: irregular gaps

**Changes:**
1. Replace `bg-indigo-600` → `bg-[color:var(--accent-primary)]`
2. Update heading to 28px, 700 weight
3. Apply Button component to "New Root Topic"
4. Apply Badge component to status badges
5. Standardize spacing (16px gaps)
6. Border-radius on buttons: 16px

**Files affected:**
- `apps/web/src/app/(protected)/admin/topics/page.tsx`
- Component tree (tree items, controls)

**Verification:**
- Visual match with catalog
- Responsive design (mobile/tablet)
- No layout shifts

---

### Phase 4: Refactor User Management (`/admin/users`)
**Priority:** HIGH

**Current Issues:**
- "Create User" button: indigo → should be orange
- Table styling: inconsistent with catalog
- Status badges: need standardization
- Action links: cyan → consider orange or secondary

**Changes:**
1. Apply Button component (orange) to "Create User"
2. Apply Table component for consistent headers/rows
3. Apply Badge component to status (active/inactive)
4. Standardize spacing and padding
5. Update heading to 28px

**Files affected:**
- `apps/web/src/app/(protected)/admin/users/page.tsx`

**Verification:**
- Table alignment and spacing match catalog
- All interactive elements use consistent colors

---

### Phase 5: Refactor Admin Tasks (`/admin/tasks`)
**Priority:** HIGH

**Current Issues:**
- "New Task" button: green/emerald → should be orange
- Status badges: inconsistent (archived OK, published needs cyan/orange review)
- Heading: centered → should be left-aligned
- Layout: scattered spacing

**Changes:**
1. Change "New Task" button to orange (Button component)
2. Audit status badge colors (archived=orange OK, published=cyan, draft=gray)
3. Left-align heading, increase to 28px
4. Apply consistent padding/margins
5. Apply Table component if used

**Files affected:**
- `apps/web/src/app/(protected)/admin/tasks/page.tsx`

**Verification:**
- Heading alignment and size
- Button colors and border-radius
- Status badge consistency

---

### Phase 6: Refactor User Tasks (`/tasks`)
**Priority:** MEDIUM (less critical user-facing but should match)

**Current Issues:**
- "New Task" button: green → should be orange
- Heading: centered → left-aligned
- Card borders: cyan → review styling
- Links: green/cyan → should be secondary accent

**Changes:**
1. Apply Button component (orange) to "New Task"
2. Left-align and size heading to 28px
3. Update card styling (borders, padding)
4. Apply consistent link styling

**Files affected:**
- `apps/web/src/app/(protected)/tasks/page.tsx`

**Verification:**
- Layout consistency with admin pages
- Mobile responsiveness

---

### Phase 7: Documentation & Component Library
**Priority:** MEDIUM

**Deliverables:**
1. `docs/design-system.md` — token reference, component usage examples
2. Figma file or design tokens export (if applicable)
3. Component composition guide (which components to use where)
4. Changelog of color/spacing changes

---

### Phase 8: QA & Final Verification
**Priority:** HIGH (last phase before merge)

**Checklist:**
- [ ] All 6 pages render correctly (desktop, tablet, mobile)
- [ ] All buttons use Button component with orange primary
- [ ] All status badges use Badge component with correct colors
- [ ] All headings are 28px, 700 weight, left-aligned
- [ ] Spacing is consistent (16px gaps, standard padding)
- [ ] No regressions in existing functionality
- [ ] Dark mode contrast is accessible (WCAG AA minimum)
- [ ] Screenshots before/after for documentation

---

## Acceptance Criteria

- [x] **AC1:** Design tokens defined and exported as CSS variables
- [x] **AC2:** Button component created with primary/secondary/danger variants
- [x] **AC3:** Badge component created with status variants
- [x] **AC4:** Topic Tree Admin page refactored (orange buttons, consistent spacing)
- [x] **AC5:** User Management page refactored (orange buttons, consistent table)
- [x] **AC6:** Admin Tasks page refactored (orange buttons, status badges)
- [x] **AC7:** User Tasks page refactored (heading alignment, button colors)
- [x] **AC8:** Design system documented in `docs/design-system.md`
- [x] **AC9:** All pages pass responsive design QA (mobile/tablet/desktop)
- [x] **AC10:** No visual regressions in other pages

---

## Affected Areas (File Structure)

### New Files
- `apps/web/src/styles/design-system.css` — Tokens and utilities
- `apps/web/src/components/design-system/Button.tsx`
- `apps/web/src/components/design-system/Badge.tsx`
- `apps/web/src/components/design-system/Table.tsx` (if needed)
- `apps/web/src/components/design-system/Input.tsx`
- `docs/design-system.md` — Documentation

### Files to Modify
- `apps/web/src/app/(protected)/admin/topics/page.tsx` — Refactor styles
- `apps/web/src/app/(protected)/admin/users/page.tsx` — Refactor styles
- `apps/web/src/app/(protected)/admin/tasks/page.tsx` — Refactor styles
- `apps/web/src/app/(protected)/tasks/page.tsx` — Refactor styles
- `apps/web/src/app/(protected)/settings/page.tsx` — Verify consistency (may not need changes)

### Out of Scope
- Catalog page (`/catalog/[id]`) — reference design, do not modify
- Login/Register pages — separate design system (auth flow)
- API changes — frontend only
- Database schema changes

---

## Verification Plan

### Per Phase
1. **Phase 1:** `make lint` passes, CSS compiles
2. **Phases 2-6:** Visual inspection on `make dev-web`, responsive testing
3. **Phase 7:** Documentation complete and correct
4. **Phase 8:** Full browser walkthrough, screenshots, accessibility audit

### Manual Testing
- Desktop (1920x1080): All pages render correctly
- Tablet (768x1024): Responsive layout holds
- Mobile (375x667): Touch-friendly spacing preserved
- Dark mode: Contrast meets WCAG AA
- Keyboard navigation: All interactive elements accessible

### Lint & Build
```bash
make lint      # Must pass
make build     # No TypeScript errors
make test-web  # If applicable, should pass
```

---

## Known Risks & Open Questions

1. **Pill-shaped badges:** Current implementation uses extreme border-radius. Plan clarifies this as 8px standard (not pill).
2. **Link colors:** Cyan links are secondary — may need audit across forms/dialogs.
3. **Mobile-first design:** Confirm spacing scales down without breaking on small screens.
4. **Accessibility:** Ensure color-only status indication has text fallback.

---

## Out of Scope (Explicit Non-Goals)

- Logo redesign
- Icon system overhaul
- Animation/transition standardization
- Theming system (light/dark mode toggle) — dark mode is only mode
- Responsive breakpoint optimization (use existing Tailwind breakpoints)
- Creating a design file in Figma (document-only approach)

---

## Next Steps for Implementer

1. Read this plan end-to-end
2. Start with **Phase 1: Design Tokens** (CSS variables file)
3. Proceed sequentially through Phases 2-8
4. Commit each phase or logical group (e.g., tokens + button component)
5. Run `make lint` and `make dev-web` after each phase
6. Document progress in PR description with before/after screenshots
7. Request final QA verification before merge

---

**Plan created:** 2026-05-15  
**Assigned to:** frontend-developer  
**Expected duration:** 2-3 hours per phase (8-10 hours total)
