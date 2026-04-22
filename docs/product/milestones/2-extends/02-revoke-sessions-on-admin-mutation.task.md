# Task 02: Revoke Sessions on Admin Deactivation / Role Change

## Metadata
- **Status:** Done — commit `5697266`
- **Complexity:** Low
- **Severity closed:** S-02 (Medium)
- **Story:** [`auth-hardening.story.md`](./auth-hardening.story.md)
- **Dependencies:** none

---

## Summary

When an admin deactivates a user or changes their roles, **invalidate every live refresh
token for that user**. Today `PATCH`/`DELETE` in `admin-users.router.ts` updates the user
row only; the victim keeps a valid session for up to 7 days.

---

## Technical Constraints

- **Ports/Adapters:** no new port. Route handlers call the existing
  `IRefreshTokenRepository.deleteAllForUser(userId)`.
- **Injection:** pass the `IRefreshTokenRepository` into `buildAdminUsersRouter` — update
  the factory signature, the wiring in `routes/index.ts`, and the test setup.
- **Audit line:** emit `console.info(JSON.stringify({ event, userId, actor, at }))` on
  every revocation so a future audit adapter can slot in without code changes.

---

## Scope

### 1. Router signature

```ts
export function buildAdminUsersRouter(
  users: IUserRepository,
  auth: IAuthAdapter,
  tokens: IRefreshTokenRepository,   // ← new
): Hono { ... }
```

### 2. Revoke on PATCH

Inside `router.patch('/:id', ...)`, after a successful `users.update`:

- If `status` transitioned **away from** `active`, OR `roles` was present in the payload,
  call `await tokens.deleteAllForUser(id)`.
- Emit the audit line.

### 3. Revoke on DELETE

Every soft-delete revokes all sessions for the target user.

### 4. Wire the new dependency in `routes/index.ts`

Pass `tokens` (already built in `apps/api/src/index.ts`) into the admin router factory.

---

## Acceptance Criteria

- [ ] `PATCH /admin/users/:id` with `{ status: 'inactive' }` deletes all matching rows in
      `refresh_tokens`.
- [ ] `PATCH /admin/users/:id` with a `roles` change deletes all matching rows.
- [ ] `PATCH` with only a `name` change does **not** revoke sessions.
- [ ] `DELETE /admin/users/:id` deletes all matching rows.
- [ ] Integration test: login a user, have an admin deactivate them, then `POST
      /auth/refresh` with their cookie — returns `401`.
- [ ] Audit line is emitted with shape `{ event, userId, actor, at }`.
- [ ] All tests pass; `make lint` clean.

---

## Verification Plan

1. `pnpm --filter api test` — green.
2. Manual: log in as student in browser A; log in as admin in browser B; deactivate the
   student; in browser A the next protected call is `401` and the user lands back on
   `/login`.
