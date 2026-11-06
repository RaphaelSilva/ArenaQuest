# Task 11 — Fix admin pages that cannot scroll (Users, Admin home, User detail)

## Metadata
- **Status:** ✅ Done
- **Kind:** Bug
- **Complexity:** Low
- **Team:** Frontend Web
- **Dependencies:** none
- **Category:** User Experience / Responsive Layout
- **Found in:** production (budo), mobile, 2026-11-06
- **Branch:** `feature/backlog/user-experience/11-fix-admin-pages-scroll-mobile.task`

---

## Summary

On a phone the admin **Users** page shows the first rows of the table and then stops: the
rows below the fold, and the pagination under the table, cannot be reached by scrolling.
The admin home and the user-detail page have the same defect and only hide it because
their content is short today. The cause is in the layout contract, not in the browser.

---

## Problem Statement

Since the mobile sidebar landed (commit `2c9dedb`, 2026-05-16), the protected layout fixes the
page to the viewport and clips the overflow:

- `apps/web/src/app/(protected)/layout.tsx` — `h-dvh overflow-hidden`
- `apps/web/src/app/(protected)/admin/layout.tsx` — `<main className="flex flex-1 flex-col overflow-hidden">`

So `body` never scrolls and **each page must own its scroll container** with `overflow-y-auto`.
Every other admin page does (badges, billing, events, groups, levels, missions, players,
storage, quests; topics and tasks scroll their two panels). Three pages did not:

| Page | Root element before the fix |
| --- | --- |
| `admin/users/page.tsx` | `<main className="p-4 md:p-6 lg:p-8">` |
| `admin/page.tsx` | `<div className="p-6 md:p-8 lg:p-10">` |
| `admin/users/[userId]/page.tsx` | `<main className="mx-auto max-w-3xl px-6 py-8">` |

Whatever fits in the viewport renders; everything past the bottom edge is clipped and
unreachable. On a phone the table is taller (wrapped cells, header, action buttons), so the
cut happens after a handful of users — which reads as "the scroll stops at a certain number".

A second defect compounded it on the Users page: `fetchUsers` called
`client.adminUsers.list()` with no arguments, so the client's defaults (page 1, 20 rows)
were always used. The `page` / `pageSize` state only changed the "Page X of Y" label; the
table always showed the first 20 users regardless of the pagination controls.

---

## Scope

**In:**
- The three pages above own their scroll: root element gets `flex-1 overflow-y-auto`
  (the user-detail page also `w-full`, mirroring `admin/groups/page.tsx`).
- The Users page passes `page` and `pageSize` to `client.adminUsers.list(page, pageSize)` and
  refetches when either changes; creating a user returns to page 1.
- Tests: `apps/web/src/app/(protected)/admin/users/__tests__/users-page.test.tsx` asserts the
  scroll container and the `list(page, pageSize)` wiring (first load, next page, page-size change).

**Out:**
- Moving the `overflow-y-auto` into `admin/layout.tsx` so pages stop repeating it. Worth doing
  as a follow-up refactor, but the two-panel pages (topics, tasks) rely on `overflow-hidden`
  at the `<main>` level and would need their own adjustment first.
- Any API change: `GET /v1/admin/users?limit&offset` already paginates.

---

## Technical Constraints

- **Scope guardrail:** changes restricted to the three pages above and the new test file.
- **Token reuse:** no new CSS tokens; same Tailwind utilities the other admin pages use.
- **No i18n changes.**

---

## Acceptance Criteria

- [x] On a phone viewport, `/admin/users` scrolls through every row and reaches the pagination.
- [x] *Next* / *Previous* and the page-size select change the rows shown, not only the label.
- [x] `/admin` and `/admin/users/{id}` scroll when their content exceeds the viewport.
- [x] `make lint` and `make test-web` pass green.

---

## Verification Plan

1. `make dev-web`, log in as an admin, open `/admin/users` in a phone-sized viewport (DevTools
   device toolbar or a real device) with more users than fit on one screen.
2. Scroll to the bottom: the last row and the pagination bar are reachable.
3. Press *Next*: the table shows the next 20 users and the network tab shows `offset=20`.
4. Change rows-per-page to 50: the request carries `limit=50&offset=0`.
5. Open `/admin` and `/admin/users/{id}` at the same viewport; both scroll.
