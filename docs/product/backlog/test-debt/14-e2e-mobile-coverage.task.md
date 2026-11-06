# Task 14 — Tooling: Mobile and tablet E2E coverage

**Status:** 📝 Open
**Kind:** Chore
**Team:** Tooling
**Priority:** Medium
**Found in:** Backlog test-debt, Task 11 (E2E scaffold), 2026-11-06
**Depends On:** [Task 11 — E2E scaffold](./11-e2e-playwright-scaffold.task.md)

## Summary

The web app has three responsive mechanisms and none is tested: the top bar
(`apps/web/src/components/layout/nav.tsx`) swaps its links, theme toggle and
sign-out for a hamburger and a drawer below `md` (768 px); the admin sidebar
(`components/layout/admin-sidebar.tsx`) is `hidden md:block`, so on a phone the
backoffice is reachable only through that drawer; and the catalog
(`app/(protected)/catalog/layout.tsx`) replaces its sidebar with
`MobileSearchBar` and `CatalogMobileDrawer` (`role="dialog"`) below `lg`
(1024 px). jsdom applies no CSS, so the existing `nav.test.tsx` and
`CatalogSidebar.test.tsx` can only assert that the markup exists, never which
half of it a user sees. Ten admin pages render tables inside `overflow-x-auto`
whose behaviour at 412 px nobody has measured.

Target state: the `mobile` (Pixel 7) and `tablet` (iPad Mini portrait) projects
of Task 11 carry twelve mobile-specific specs (M1–M12 below), and every shared
journey of the scenario roadmap passes in both, through the `nav` fixture. No
product behaviour changes; a defect found is filed, not fixed here.

## Why It Is Worth Fixing

- The catalog redesign shipped a drawer, a search bar and a breadcrumb that only
  exist on phones, with no automated check that the drawer opens, traps focus,
  or closes on navigation.
- An admin on a phone depends on the drawer carrying the backoffice links; a
  change to `adminLinks` in `nav.tsx` can silently drop one from mobile while
  the desktop sidebar still shows it.
- Horizontal overflow at phone width is the most common regression in a
  Tailwind layout and the cheapest to assert (`scrollWidth <= innerWidth`).

## Scope

In — mobile-only specs (`e2e/specs/mobile/*.spec.ts`, skipped on `desktop`):

| # | Spec | Asserts |
|---|---|---|
| M1 | Top-bar drawer | Hamburger (`dict.layout.nav.openMenu`) opens the drawer; each link navigates; the close button (`closeMenu`) and a tap on the overlay close it; the overlay is `aria-hidden` |
| M2 | Drawer contents | Theme toggle and sign-out are inside the drawer and the desktop pair is not visible; sign-out from the drawer lands on `/login` |
| M3 | Admin links in drawer | As `admin`, every entry of `adminLinks` is present in the drawer; as `content_creator`, *Users* and *Levels* are absent; the sidebar is not visible |
| M4 | Catalog drawer | `MobileSearchBar` visible, desktop sidebar not; the drawer button opens a `role="dialog"` with `aria-modal`; focus lands inside; choosing a topic navigates and closes it; `Escape` closes it |
| M5 | Mobile search | Typing in the mobile search bar (`dict.catalog.mobileSearch.ariaLabel`) lists a seeded topic; clearing restores the list |
| M6 | No horizontal overflow | Parametrised over the 15 routes below: `document.documentElement.scrollWidth <= window.innerWidth` after load and after opening any drawer |
| M7 | Admin tables | For the 10 admin tables: the table's scroll container scrolls horizontally and the page does not (page `scrollWidth` unchanged) |
| M8 | Forms | Login, event form and upload form: every input is reachable by tap, submit is visible without scrolling the page sideways, and each interactive element's bounding box is at least 44 × 44 px |
| M9 | Dialogs | Reset-password modal, move-media dialog and edit-submission dialog fit the viewport (`getBoundingClientRect` within bounds) and close by their close button |
| M10 | Viewers | Video player and PDF viewer render within the viewport width for seeded media |
| M11 | Public events board | Cards stack in one column, the scope tabs are reachable, a detail page opens, all anonymous |
| M12 | Tablet mixed state | On `tablet` (768 px): the desktop top bar is shown (no hamburger) **and** the catalog still shows the mobile drawer, because `md` ≤ 768 < `lg` |

Routes for M6: `/`, `/login`, `/events`, `/events/<slug>`, `/dashboard`,
`/catalog`, `/catalog/<id>`, `/catalog/<id>/submissions`, `/notes`, `/tasks`,
`/missions`, `/settings`, `/admin`, `/admin/topics`, `/admin/users`.

In — shared journeys:
- Scenarios 1–8 of Task 11 pass on `mobile` and `tablet` with no
  viewport-specific branch in the spec; where the journey needs the drawer, the
  `nav` fixture handles it.
- `make e2e-mobile` and `make e2e-tablet` are the gates; CI runs all projects.

Out:
- Visual snapshots (`toHaveScreenshot`): platform fonts make them flaky across
  the runner and developer machines; revisit with a Docker-run browser.
- axe-core scans, contrast, real screen readers.
- WebKit (`iPhone` presets need it): follow-up once Chromium is stable in CI.
- Fixing anything under `apps/web/src/**`: a missing accessible name, a table
  that overflows or a drawer that does not trap focus becomes a
  `user-experience` backlog bug with the failing spec as its reproduction.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `e2e/specs/mobile/**`, `e2e/fixtures/**` (extending `nav`, adding a
    `viewport` helper for the overflow and bounding-box assertions)
  - `e2e/playwright.config.ts` (project options only)
  - `Makefile` (`e2e-mobile` / `e2e-tablet` only, if Task 11 did not add them)
  - `docs/onboarding.md` (the *Mobile* subsection)
- Device presets come from Playwright's `devices` table; no hand-written user
  agent or `deviceScaleFactor`.
- Touch interactions use `tap()` on the `mobile` and `tablet` projects (the
  presets enable `hasTouch`); `click()` is reserved for `desktop`.
- Accessible names come from `dict-pt.ts`; no `data-testid` is added for this
  task.
- A spec that needs a viewport branch to pass is a bug report, not a spec with
  a branch.

## Acceptance Criteria

- [ ] `make e2e-mobile` runs M1–M11 plus scenarios 1–8 and exits 0; `make
      e2e-tablet` runs M12 plus scenarios 1–8 and exits 0.
- [ ] `make e2e-desktop` reports M1–M12 as *skipped* with the reason "mobile
      only", not as passed or missing.
- [ ] M6 lists 15 routes in its report, one result per route.
- [ ] Shrinking the drawer's hit target below 44 px in a throwaway local edit
      makes M8 fail; dropping an entry from `adminLinks` makes M3 fail; both
      reverted.
- [ ] The total CI `e2e` job stays under the 6-minute budget set by Task 11
      with the three projects enabled; otherwise the mobile-only specs are
      sharded, not reduced.
- [ ] Any defect found is filed under `docs/product/backlog/user-experience/`
      with the spec name as reproduction, and listed in the PR description.
- [ ] `make lint` and `make test` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make e2e-mobile`, `make e2e-tablet`, `make e2e-desktop` — three reports;
   confirm the skipped/passed split per project.
2. Demonstrate the guards listed in the acceptance criteria with throwaway edits
   under `apps/web/src/components/layout/nav.tsx`; revert each.
3. Open the HTML report for one failing M6 route on purpose (inject a
   `w-[2000px]` element locally) and confirm the trace shows the overflow;
   revert.
4. Read the `e2e` job duration in CI with every project enabled.
5. `git diff --stat` confirms only scope-guardrail files changed.
