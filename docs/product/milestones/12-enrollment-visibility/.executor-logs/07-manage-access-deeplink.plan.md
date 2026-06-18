# Plan — Task 07: detail pages "Manage access" deep-link + retire enrollments-tab

**Assigned persona:** frontend-developer
**Branch:** feat/m12-07-manage-access-deeplink
**Task file:** docs/product/milestones/12-enrollment-visibility/07-detail-pages-manage-access-deeplink.task.md

## Affected areas
- `apps/web/src/app/(protected)/admin/users/[userId]/page.tsx` — drop the embedded enrollments tab; add a "Manage access" deep-link.
- `apps/web/src/app/(protected)/admin/groups/[groupId]/page.tsx` — add a "Manage access" deep-link (replace the coming-soon block).
- DELETE `apps/web/src/components/enrollment/enrollments-tab.tsx`.
- DELETE `apps/web/__tests__/app/admin/user-enrollments.test.tsx` (it renders the deleted component).
- `apps/web/src/i18n/dict-pt.ts` + `dict-en.ts` — add a shared `admin.access.manageLink` label; remove the now-orphaned `admin.users.tabEnrollments` and `admin.users.tabProfile`.

## Context facts (verified)
- `EnrollmentsTab` is imported ONLY by `users/[userId]/page.tsx` (line 9, used line 111). Safe to delete after migrating that page.
- The user page has a tab system: `type Tab = 'profile' | 'enrollments'`, `tab` defaults to `'enrollments'`, a `<nav>` tab bar (lines 91–108), `{tab === 'enrollments' && <EnrollmentsTab userId={userId} />}` (110–112), and `{tab === 'profile' && ...profile <dl>...}` (114+). `d = dict.admin.users`.
- `d.tabEnrollments` / `d.tabProfile` are referenced ONLY at line 105 of this page (grep-confirmed) — removing the tab bar orphans both dict keys.
- `dict.enrollment.*` keys are now REUSED by the `/admin/access` page (Task 06) — DO NOT remove any `enrollment.*` key.
- The group detail page (`groups/[groupId]/page.tsx`) is admin-guarded and currently renders a "coming soon" dashed block (lines 54–61). `d = dict.admin.groups`.
- `/admin/access` accepts `?type=user|group&id=<id>` (Task 06).
- `user-enrollments.test.tsx` renders `<EnrollmentsTab>` directly and asserts the grant flow — its subject is being deleted; the equivalent logic now lives on the Access page (covered by `admin-groups-api.test.ts` + reused proven logic).
- `users.test.tsx` tests the users LIST table only — leave it untouched.
- Dictionary type derives from dict-pt.ts; edit pt first then mirror en. i18n coverage forbids hardcoded copy.

## Implementation steps

1. **`users/[userId]/page.tsx`**:
   - Remove the `EnrollmentsTab` import (line 9).
   - Remove the tab system: delete the `Tab` type, the `tab`/`setTab` state, the `<nav>` tab bar, and the `{tab === 'enrollments' && ...}` block. Render the profile `<dl>` content directly (when `user` is loaded).
   - Add a **"Manage access"** link near the header (e.g. right under the title or beside it): `<Link href={\`/admin/access?type=user&id=${userId}\`} ...>{dict.admin.access.manageLink}</Link>`, styled as a button using existing tokens (mirror the accent button style used elsewhere, e.g. `var(--accent)` background like the grant button).
   - Ensure no unused imports/state remain (e.g. if `useState` becomes unused, drop it).

2. **`groups/[groupId]/page.tsx`**:
   - Replace the dashed "coming soon" block with a **"Manage access"** link: `<Link href={\`/admin/access?type=group&id=${groupId}\`} ...>{dict.admin.access.manageLink}</Link>`, styled as a button. Keep the back-link, title, and subtitle. (You may keep a short explanatory line, but the working link is the point.)

3. **Delete** `apps/web/src/components/enrollment/enrollments-tab.tsx`.

4. **Delete** `apps/web/__tests__/app/admin/user-enrollments.test.tsx`.

5. **i18n** (pt then en):
   - Add `manageLink` to the existing `admin.access` block (e.g. PT "Gerenciar acesso" / EN "Manage access").
   - Remove `tabEnrollments` and `tabProfile` from `admin.users` in BOTH dicts (orphaned — only the migrated page used them). Verify with grep first; if any other reference exists, leave them.
   - Do NOT touch any `enrollment.*` key.

## Out of scope (do NOT touch)
- The Access page itself (Task 06 — done).
- Any backend file.
- The participant catalog.
- Denies.

## Verification (orchestrator)
- `grep -rn "enrollments-tab\|EnrollmentsTab" apps/web/src apps/web/__tests__` → expect NO matches.
- `node apps/web/scripts/check-i18n-coverage.js`.
- `pnpm -C apps/web exec tsc --noEmit` → expect only the 6 pre-existing baseline errors (no new ones; if removing tab keys broke a ref, tsc shows it).
- Scoped eslint on the two changed pages + both dicts.
- `pnpm -C apps/web exec vitest run __tests__/app/admin/users.test.tsx` (ensure the untouched list test still passes) — and confirm the deleted test file is gone.
