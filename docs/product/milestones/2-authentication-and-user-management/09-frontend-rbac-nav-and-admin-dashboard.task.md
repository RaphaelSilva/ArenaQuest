# Task 09: Frontend — RBAC Navigation & Admin Dashboard (User CRUD)

## Metadata
- **Status:** Done
- **Complexity:** High
- **Milestone:** 2 — Authentication & User Management
- **Dependencies:**
  - `docs/product/milestones/2/06-admin-user-crud-endpoints.task.md`
  - `docs/product/milestones/2/08-frontend-login-page-and-middleware.task.md`

---

## Summary

Implement the two remaining UI deliverables for Milestone 2:

1. **RBAC-aware navigation:** The sidebar/top nav dynamically shows or hides links based on
   the logged-in user's roles (e.g., "Admin" menu only visible to `admin` role).
2. **Admin User Management Dashboard:** A CRUD UI at `/admin/users` for administrators to
   list, create, update, and deactivate users.

---

## Technical Constraints

- **No Role Logic in Markup:** Role checks live in the `useHasRole` hook (Task 07) or a
  `<CanView role="admin">` wrapper component — never inline `user.roles.includes(...)` in
  JSX.
- **API Client:** All data fetching goes through a typed `adminUsersApi` service module
  (`apps/web/src/lib/admin-users-api.ts`) that sends the `Authorization: Bearer <token>`
  header using `accessToken` from `useAuth()`.
- **No hardcoded role strings:** Import `ROLES` from `@arenaquest/shared`.
- **Optimistic UI is not required** at this stage. Show a loading state while requests are
  in-flight.

---

## Scope

### 1. `<CanView>` Gate Component — `apps/web/src/components/auth/can-view.tsx`

```tsx
export function CanView({ role, children }: { role: RoleName; children: ReactNode }) {
  const can = useHasRole(role);
  return can ? <>{children}</> : null;
}
```

### 2. RBAC Navigation — update `apps/web/src/components/layout/nav.tsx`

```tsx
<CanView role={ROLES.ADMIN}>
  <NavLink href="/admin/users">User Management</NavLink>
</CanView>
```

### 3. Admin Users API client — `apps/web/src/lib/admin-users-api.ts`

```ts
export const adminUsersApi = {
  list(token: string, page?: number): Promise<{ data: User[]; total: number }>;
  create(token: string, data: CreateUserInput): Promise<User>;
  update(token: string, id: string, data: Partial<UpdateUserInput>): Promise<User>;
  deactivate(token: string, id: string): Promise<void>;
};
```

### 4. Admin User Dashboard — `apps/web/src/app/(protected)/admin/users/page.tsx`

Features:
- Data table with columns: Name, Email, Roles, Status, Created At, Actions.
- **Create User** button → opens a slide-over / modal form.
- Inline **Edit** (opens the same form pre-filled) → update name, roles, status.
- **Deactivate** button with a confirmation dialog.
- Basic pagination (page number + items-per-page selector).

Route protected by:
- Edge middleware (cookie check — Task 08).
- `requireRole(ROLES.ADMIN)` at the API level (Task 06).
- `useHasRole(ROLES.ADMIN)` in the layout to redirect non-admins to `/dashboard`.

---

## Acceptance Criteria

- [x] Non-admin users do not see "User Management" in the navigation.
- [x] A Student navigating directly to `/admin/users` is redirected to `/dashboard`.
- [x] Admin user sees the user table populated with real data from the API.
- [x] Admin can create a new user (modal form, required field validation).
- [x] Admin can change a user's role via the Edit form.
- [x] Admin can deactivate a user; the table row shows "Inactive" status afterwards.
- [x] All API calls from the dashboard include the `Authorization: Bearer <token>` header.
- [x] Component tests in `apps/web/__tests__/app/admin/users.test.tsx` cover:
  - Table renders with mocked API data.
  - "Create User" form submission calls `adminUsersApi.create` with correct args.
  - Non-admin sees redirect (mock `useHasRole` returns `false`).
- [x] `pnpm --filter web test` — green.

---

## Verification Plan

1. `pnpm --filter web test` — green.
2. E2E manual flow (both apps running locally):
   - Log in as admin → see "User Management" nav item.
   - Log in as student → "User Management" nav item absent; direct URL redirects to dashboard.
   - Admin: create a user with role "Student" → appears in table.
   - Admin: edit user → change role to "Tutor" → table updates.
   - Admin: deactivate user → status changes.
3. Network tab: confirm Bearer token on every `/admin/users` request.

---

## Note on Cucumber

Milestone 2 acceptance criteria involve **UI role-switching flows** that could benefit from
Cucumber BDD scenarios (e.g., *"Given I am logged in as a Student, When I visit /admin/users,
Then I should be redirected to /dashboard"*). However, no E2E runner is configured yet for
`apps/web`. A separate task should be created in Milestone 3 to set up Playwright + Cucumber
if the team decides to adopt it. For now, these scenarios are covered by component tests
with mocked roles.
