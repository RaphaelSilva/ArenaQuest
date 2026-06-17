# Plan — Task 06a (backend): GET /admin/groups list endpoint

**Assigned persona:** backend-developer
**Branch:** feat/m12-06-unified-access-page (shared with 06b frontend)
**Parent task:** docs/product/milestones/12-enrollment-visibility/06-unified-access-page.task.md
**Why:** The Access page needs to enumerate user groups; no group-list endpoint exists. (Scope expansion approved by product.)

## Affected areas (all additive; mirror existing patterns)
- `packages/shared/ports/i-user-group-repository.ts` (NEW) + `packages/shared/ports/index.ts` (export).
- `apps/api/src/adapters/db/d1-user-group-repository.ts` (NEW).
- `apps/api/src/controllers/admin-groups.controller.ts` (NEW).
- `apps/api/src/routes/admin/groups.ts` (NEW) + mount in `apps/api/src/routes/admin/index.ts`.
- `apps/api/src/container.ts` — instantiate the repo and expose it on `IdentityContext`.
- `apps/api/test/routes/admin-groups.router.spec.ts` (NEW).

## Context facts (verified)
- `user_groups (id TEXT PK, name TEXT UNIQUE, description TEXT DEFAULT '', created_at)` and `user_group_members (group_id, user_id)` exist (migration 0011). No group repository/port exists today.
- Admin routes are mounted in `routes/admin/index.ts` under `buildAdminRouter`, which already applies `authGuard` + `requireRole(ADMIN, CONTENT_CREATOR)` to `*`. The enrollments router is mounted at `/` and owns `/groups/{groupId}/enrollments`. Mounting a new groups router at `/groups` with `GET /` yields `/admin/groups` (exact) — no collision with the `:groupId/enrollments` paths.
- Pattern to mirror: `D1UserRepository` (constructor `(private readonly db: D1Database)`), `buildAdminUsersRouter(container)` destructures `container.identity`, instantiates a controller, returns an `OpenAPIHono`. Controllers return `ControllerResult<T>`.

## Implementation steps

1. **Port — `i-user-group-repository.ts`**:
   - `export interface UserGroupRecord { id: string; name: string; description: string; memberCount: number; createdAt: string; }`
   - `export interface IUserGroupRepository { listAll(): Promise<UserGroupRecord[]>; }`
   - Add `export * from './i-user-group-repository';` to `ports/index.ts`.

2. **Adapter — `d1-user-group-repository.ts`**:
   - `export class D1UserGroupRepository implements IUserGroupRepository` with `constructor(private readonly db: D1Database) {}`.
   - `listAll()`: `SELECT g.id, g.name, g.description, g.created_at, (SELECT COUNT(*) FROM user_group_members m WHERE m.group_id = g.id) AS member_count FROM user_groups g ORDER BY g.name ASC`. Map rows to `UserGroupRecord` (`createdAt: row.created_at`, `memberCount: row.member_count`).

3. **Controller — `admin-groups.controller.ts`**:
   - `export class AdminGroupsController { constructor(private readonly groups: IUserGroupRepository) {} async listAll(): Promise<ControllerResult<UserGroupRecord[]>> { return { ok: true, data: await this.groups.listAll() }; } }`.

4. **Route — `routes/admin/groups.ts`**:
   - `export function buildAdminGroupsRouter(container: AppContainer)`; destructure `const { userGroups } = container.identity;`; `const controller = new AdminGroupsController(userGroups);`.
   - Define `listGroupsRoute = createRoute({ method: 'get', path: '/', summary: 'List User Groups', tags: ['admin:groups'], security: [{ bearerAuth: [] }], responses: { 200: { ... schema: z.object({ data: z.array(GroupSchema) }) } } })` where `GroupSchema` mirrors `UserGroupRecord`.
   - Handler: `const result = await controller.listAll(); return respondWith(c, result)` (or `c.json({ data })` consistent with other admin list routes — check how `buildAdminUsersRouter` shapes its list response and match it).
   - Return the `OpenAPIHono`.

5. **`routes/admin/index.ts`**: import `buildAdminGroupsRouter` and add `app.route('/groups', buildAdminGroupsRouter(container));` (before the `app.route('/', buildAdminEnrollmentsRouter(...))` line is fine — exact `/groups` vs `/groups/:groupId/enrollments` do not collide).

6. **`container.ts`**:
   - Import `D1UserGroupRepository` and the `IUserGroupRepository` type.
   - Add `userGroups: IUserGroupRepository;` to the `IdentityContext` interface.
   - In `buildContainer`, instantiate `const userGroups = new D1UserGroupRepository(env.DB);` and include `userGroups` in the returned `identity` object.

7. **Test — `admin-groups.router.spec.ts`** (mirror `admin-users.router.spec.ts` harness): apply migrations; seed 2 `user_groups` and some `user_group_members`; sign an admin token; assert `GET /admin/groups` returns 200 with a `data` array containing the groups ordered by name with correct `memberCount`; assert a non-admin/unauthenticated request is rejected (401/403) — but note the shared admin guard already covers auth, so a single forbidden-case check is enough.

## Out of scope
- Group CRUD (create/update/delete), group membership editing, group detail endpoint. ONLY the list endpoint.
- Any frontend file (that is 06b).

## Verification (orchestrator)
- Rebuild shared (`pnpm -C packages/shared build`) — new port.
- Scoped lint on new/changed files.
- `pnpm -C apps/api test admin-groups.router.spec` + a quick run of `admin-users.router.spec` to ensure no admin-router regression.
