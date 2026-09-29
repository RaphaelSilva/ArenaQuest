# Task 04 — Frontend: Admin storage browser page (Phase 1)

**Status:** ✅ Done
**Milestone:** [25 — Admin storage browser and orphan audit](./milestone.md)
**RFC:** [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-admin-storage-api-browse-object-audit.task.md)

## Summary

Adds the admin-only **Storage** page at `/admin/storage`: a folder browser over the bucket that
reads as the content tree instead of a list of UUIDs. The admin starts at the bucket root, opens
`topics/` or `events/`, sees each topic/event folder labelled with its title (or flagged as "no
longer exists"), and inside a folder sees one row per object with its display name, size, upload
date, a status badge (`linked`, `pending` / stale, `displaced`, `deleted-row`, `orphan`) and the
resolved owner — "Topic *9th Kyu* · `kata_final.mp4` · uploaded by Ana", or the event title for
a flyer — linking to that topic or event in the backoffice. A breadcrumb built from the prefix
navigates back up; "Load more" follows `nextCursor`. Selecting an object opens a detail drawer
with every reference, the raw key, the orphan hint and an inline preview (image, PDF or video)
from the presigned URL. A *Storage* item appears in the admin sidebar for `admin` only, and the
page redirects any other role. It consumes `GET /v1/admin/storage/browse` and `/object` from
Task 03; Task 05 adds the scan panel and Task 07 the delete action to this page.

## Dependencies

- [Task 03](./03-admin-storage-api-browse-object-audit.task.md) — the `/browse` and `/object`
  contracts; this task must not ship ahead of them.
- Extends the admin shell: `apps/web/src/components/layout/admin-sidebar.tsx` and
  `apps/web/src/hooks/use-auth` (`useHasRole`), and the centralized `apps/web/src/lib/api-client.ts`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/storage/**` (new) — the page.
  - `apps/web/src/components/admin/storage/**` (new) — breadcrumb, folder/object table, status
    badge, owner cell, detail drawer, preview, and their `__tests__`.
  - `apps/web/src/lib/admin-storage-api.ts` (new) — `browse` and `getObject` over `api-client`.
  - `apps/web/src/lib/api-types.gen.ts` — regenerated with `pnpm gen:api-types` from Task 03's
    `openapi.json`, not hand-edited.
  - `apps/web/src/components/layout/admin-sidebar.tsx` — one *Storage* item,
    `requiredRoles: [ROLES.ADMIN]`.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` — the `adminStorage` section and the sidebar
    label.
- **Admin only in the UI too.** The sidebar item is hidden for `content_creator`; the page checks
  `useHasRole(ROLES.ADMIN)` and redirects otherwise. The API remains the real guard.
- **App Router conventions.** The page is a client component (it needs the auth context, like
  the rest of `(protected)/admin`); keep subcomponents presentational where possible.
- **i18n.** No hardcoded user-facing strings; status labels, hints, empty and error states all
  come from `adminStorage`; both dictionaries keep identical keys; `check-i18n-coverage.js`
  passes. Keys and file names are data and render verbatim.
- **Preview safety.** Previews use only the presigned URL returned by `/object`; nothing is
  fetched by key from the browser.
- **Responsive & accessible.** The table collapses to a stacked list on mobile; rows and folders
  are keyboard-reachable; the drawer traps focus and closes on Escape.

## Scope

In:
- The API client for `/browse` and `/object`, typed from the regenerated types.
- The page with breadcrumb, folder rows (with titles or a "gone" marker), object rows, status
  badges, owner links, "Load more", loading/empty/error states.
- The detail drawer with references, key, hint and preview.
- The admin-only sidebar item and page redirect.
- The `adminStorage` dictionary section in both languages.
- Component tests: navigation issues the right `prefix`, badges per status, owner link targets,
  "Load more" sends the cursor, redirect/hidden item for `content_creator`.

Out:
- The scan panel — Task 05.
- The delete action — Task 07.
- Any backend change.

## Acceptance Criteria

- [x] Opening `/admin/storage` as admin requests `/browse` with `prefix=''` and renders the root
      folders; clicking `topics/` then a topic folder requests those prefixes and shows the topic
      title in the folder row and the breadcrumb.
- [x] Each object row shows name, size, date, the badge for its status (stale pending visually
      distinct) and an owner link to `/admin/topics` or `/admin/events/<id>`.
- [x] "Load more" appears only when `nextCursor` is present and requests the next page with it.
- [x] Selecting a row requests `/object` and shows references, key, hint and an inline preview
      of an image, a PDF and a video from the presigned URL.
- [x] The *Storage* sidebar item is absent and `/admin/storage` redirects for a
      `content_creator` session (RTL test).
- [x] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and `dict-pt.ts`;
      `check-i18n-coverage.js` passes.
- [x] The surface is responsive and keyboard-usable, including the drawer.
- [x] Changed files lint clean; `make test-web` green for the affected component tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-api` + `make dev-web`, sign in as the seeded admin, upload one topic media, then
   browse root → `topics/` → that topic and open the object.
2. Put a stray object locally (`wrangler r2 object put --local`) and confirm it shows as
   `orphan` with its hint.
3. Sign in as the seeded content creator: no sidebar item, and `/admin/storage` redirects.
4. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; confirm labels translate.
5. `make test-web` and `check-i18n-coverage.js`.
6. Resize to mobile; the list and drawer stay usable.
7. `git diff --stat` confirms only scope-guardrail files changed.
