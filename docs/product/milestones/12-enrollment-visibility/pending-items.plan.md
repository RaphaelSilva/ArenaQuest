# Plan — M12/RFC 0005 Pending Items

**Branch:** `candidate/m12-enrollment-visibility`
**Source:** `pending-items.md`
**Decision:** Item #2 → build minimal group CRUD (user-selected).

## Scope

### #2 Group CRUD (backend + frontend) — schema already exists (migration 0011)
**Backend**
- `packages/shared/ports/i-user-group-repository.ts`: add `GroupMemberRecord`; add `create`, `getById`, `findByName`, `listMembers`, `addMember`, `removeMember`.
- `apps/api/src/adapters/db/d1-user-group-repository.ts`: implement the above against `user_groups` / `user_group_members`.
- `apps/api/src/controllers/admin-groups.controller.ts`: add `createGroup`, `listMembers`, `addMember`, `removeMember` returning `ControllerResult`; 409 on duplicate name, 404 on missing group/user.
- `apps/api/src/routes/admin/groups.ts`: add `POST /`, `GET /{groupId}/members`, `POST /{groupId}/members`, `DELETE /{groupId}/members/{userId}`.

**Frontend**
- `apps/web/src/lib/admin-groups-api.ts`: add `create`, `listMembers`, `addMember`, `removeMember`.
- `apps/web/src/app/(protected)/admin/groups/page.tsx`: replace placeholder with list + create form + membership manager.
- i18n keys in `dict-en.ts` / `dict-pt.ts`.

### #1 Sidebar entry
- `admin-sidebar.tsx`: add Access item (ADMIN-gated) → `/admin/access`; `adminSidebar.access` key in both dicts.

### #3 Relabel stale users-list action
- `admin/users/page.tsx`: relabel `actions.enrollments` link to a neutral "Details"; rename key `actions.enrollments` → `actions.details` in both dicts (verify no other usage).

## Verification
`make lint && make test-api && make test-web`. Parent owns verification + commit.
