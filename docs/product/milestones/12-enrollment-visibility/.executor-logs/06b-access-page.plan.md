# Plan — Task 06b (frontend): unified Access page

**Assigned persona:** frontend-developer
**Branch:** feat/m12-06-unified-access-page (06a backend already committed here)
**Parent task:** docs/product/milestones/12-enrollment-visibility/06-unified-access-page.task.md

## Affected areas
- `apps/web/src/lib/admin-groups-api.ts` (NEW) — `GET /admin/groups` client.
- `apps/web/src/lib/api-client.ts` — add `get adminGroups()`.
- `apps/web/src/app/(protected)/admin/access/page.tsx` (NEW) — the unified Access page.
- `apps/web/src/i18n/dict-pt.ts` + `dict-en.ts` — new `admin.access` keys (reuse existing `enrollment.*` for dialogs).
- `apps/web/src/lib/__tests__/admin-groups-api.test.ts` (NEW).

## Context facts (verified)
- Backend `GET /admin/groups` (06a) returns `{ data: { id, name, description, memberCount, createdAt }[] }`.
- ApiClient getter pattern (`api-client.ts`): `import * as adminGroupsApiModule from './admin-groups-api';` then `get adminGroups() { return adminGroupsApiModule.createAdminGroupsApi(this.http); }`. The transport is `this.http`.
- `client.adminUsers.list(page, pageSize)` → `{ data: Entities.Identity.User[]; total }` (User has `id`, `name`, `email`).
- `client.adminEnrollment` has `listUserGrants`/`grantUserTopic`/`revokeUserTopic(userId,topicId,cascade)` and the group equivalents `listGroupGrants`/`grantGroupTopic`/`revokeGroupTopic(groupId,topicId,cascade)`. `UserGrant`/`GroupGrant` both have `{ id, topicNodeId, grantedAt }`.
- `client.adminTopics.list()` returns `TopicNode[]` (with `parentId`, `status`, `archived`, `title`).
- The EXISTING `enrollment.*` dict namespace already has: `pickerTitle`, `searchPlaceholder`, `noTopicsFound`, `alreadyGranted`, `cancelButton`, `grantButton`, `revokeButton`, `noGrants`, `grantedAt`, `errorLoading/errorGrant/errorRevoke`, `revokeDialog.{title,cascade,cancelButton,revokeButton}`, `directGrantsTitle(n)`, and `users`/`groups` labels. REUSE these — do not duplicate.
- Admin-guard pattern (mirror `admin/groups/page.tsx`): `useHasRole(ROLES.ADMIN)`, redirect to `/dashboard` if not; show `Spinner` while `useAuth().isLoading`.
- `Dictionary = Broaden<typeof dictPt>` — add keys to dict-pt.ts first, mirror in dict-en.ts.
- i18n coverage gate forbids hardcoded copy under src/{app,components,hooks}/**.

## Implementation steps

1. **`admin-groups-api.ts`** (mirror `admin-enrollment-api.ts` style):
   - `export type AdminGroup = { id: string; name: string; description: string; memberCount: number; createdAt: string };`
   - `export function createAdminGroupsApi(http: HttpTransport) { return { async list(): Promise<AdminGroup[]> { const res = await http('GET', '/admin/groups'); if (!res.ok) throw new Error(...); const body = await res.json() as { data: AdminGroup[] }; return body.data; } }; }`
   - Include the `_err` stub export object if the file's siblings do (match `admin-enrollment-api.ts`).

2. **`api-client.ts`**: add the import and the `get adminGroups()` getter next to `get adminUsers()`.

3. **`admin/access/page.tsx`** (`'use client'`) — a principal-centric grant manager:
   - Admin guard as above.
   - Read query params with `useSearchParams()`: `type` (`user|group`) and `id`. Initialise the principal kind toggle and, if `id` present, pre-select that principal.
   - **Principal selector:** a `User | Group` segmented toggle (reuse `enrollment.users` / `enrollment.groups` labels), then a searchable list of principals for the active kind: users via `client.adminUsers.list()` (show name + email), groups via `client.adminGroups.list()` (show name + memberCount). Selecting one sets the active principal.
   - **Granted topics:** once a principal is selected, load grants (`listUserGrants`/`listGroupGrants`) + `client.adminTopics.list()`. Render the grant list and a grant-picker (reuse the EXACT markup/logic patterns from `enrollment.*` in the current `EnrollmentsTab`: a picker dialog of published, non-archived topics shown in **hierarchical (tree) order** — sort by building a parent→child order from `parentId` and indent children by depth — and a revoke dialog with the cascade checkbox).
   - Grant/revoke call the correct user/group endpoints based on the active kind, with cascade on revoke. Optimistically update local grant state like `EnrollmentsTab` does.
   - When no principal is selected yet, show an empty/prompt state ("pick a principal").
   - Do NOT render any "Excluded topics"/denies surface.
   - All copy via the dictionary (reuse `enrollment.*`; new page-level copy under `admin.access`).

4. **i18n** — add an `admin.access` block (PT then EN) with: `title`, `subtitle`, `selectKindUser`/`selectKindGroup` (or reuse `enrollment.users`/`groups`), `searchUsersPlaceholder`, `searchGroupsPlaceholder`, `pickPrincipalPrompt`, `membersCount(n)` (function entry for group member count). Keep it minimal; reuse `enrollment.*` for everything the picker/list/revoke already cover. Translate fully in both languages.

5. **Test — `admin-groups-api.test.ts`** (mirror `admin-topics-api.test.ts`): mock the http transport; assert `createAdminGroupsApi(http).list()` issues `GET /admin/groups` and returns `body.data`. A full Access-page render test is OPTIONAL (heavy providers); prefer the api-client test.

## Out of scope (do NOT touch)
- The user/group detail pages and the `enrollments-tab.tsx` retirement (Task 07).
- Any backend file (06a is done).
- Denies / "Excluded topics".
- The participant catalog.

## Verification (orchestrator)
- `node apps/web/scripts/check-i18n-coverage.js`.
- `pnpm -C apps/web exec tsc --noEmit` (expect only the 6 pre-existing baseline errors; no NEW ones).
- Scoped eslint on new/changed files; the new api-client test via vitest.
