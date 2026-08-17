# Task 05: Admin Lockout Guards (Last-Admin + Self-Deactivation)

## Metadata
- **Status:** Done
- **Complexity:** Low
- **Severity closed:** S-05 (Low)
- **Story:** [`auth-hardening.story.md`](./auth-hardening.story.md)
- **Dependencies:** none

---

## Summary

Prevent an admin from accidentally (or intentionally) locking the backoffice out. Two
guards: (a) reject any mutation that would leave zero active users with the `admin` role;
(b) reject self-targeted deactivations and self-removal of the `admin` role.

---

## Technical Constraints

- **Server-side only:** the UI may mirror these errors, but the truth is enforced in the
  API.
- **New repository method:** `IUserRepository.countActiveAdmins(): Promise<number>` — a
  focused query beats loading every user. Implement in `D1UserRepository` with
  `SELECT COUNT(DISTINCT u.id) FROM users u INNER JOIN user_roles ur ON ... WHERE ur.role_id = (admin) AND u.status = 'active'`.
- **Error codes:** extend the admin router's error vocabulary:
  - `WOULD_LOCK_OUT_ADMINS` — the target mutation would drop active-admin count to 0.
  - `SELF_LOCKOUT` — actor is trying to deactivate themselves or remove their own admin
    role.

---

## Scope

### 1. Extend `IUserRepository`

```ts
countActiveAdmins(): Promise<number>;
```

Implement in `D1UserRepository`. Add a unit test.

### 2. Guard helpers (private in the router module)

```ts
function wouldLoseLastAdmin(
  existing: User,
  nextStatus: string | undefined,
  nextRoles: string[] | undefined,
  activeAdminsNow: number,
): boolean { ... }

function isSelfLockout(
  actorId: string,
  targetId: string,
  nextStatus: string | undefined,
  nextRoles: string[] | undefined,
): boolean { ... }
```

### 3. PATCH `/admin/users/:id`

Before calling `users.update`:
1. `actor = c.get('user').sub`.
2. If `isSelfLockout(actor, id, status, roles)` → `409 { error: 'SELF_LOCKOUT' }`.
3. If `wouldLoseLastAdmin(existing, status, roles, await users.countActiveAdmins())` →
   `409 { error: 'WOULD_LOCK_OUT_ADMINS' }`.

### 4. DELETE `/admin/users/:id`

Same checks, as DELETE is a soft-delete (status → inactive).

### 5. Tests

`admin-users.router.spec.ts` extends with:
- Last admin cannot be deactivated or stripped of admin role.
- Admin with a peer admin CAN be deactivated.
- Self-deactivation is rejected.
- Admin can still demote a different admin if others remain.

---

## Acceptance Criteria

- [x] `IUserRepository.countActiveAdmins` is implemented and unit-tested.
- [x] `PATCH` that would leave 0 active admins → `409 WOULD_LOCK_OUT_ADMINS`.
- [x] `DELETE` that would leave 0 active admins → `409 WOULD_LOCK_OUT_ADMINS`.
- [x] `PATCH { status: 'inactive' }` on self → `409 SELF_LOCKOUT`.
- [x] `PATCH { roles: [...without admin...] }` on self → `409 SELF_LOCKOUT`.
- [x] `DELETE` on self → `409 SELF_LOCKOUT`.
- [x] Legitimate mutations (≥ 2 admins, not self) still succeed.
- [x] All tests pass; `make lint` clean.

---

## Verification Plan

1. `pnpm --filter api test` — green.
2. Manual `wrangler dev`:
   - Seed admin + extra admin. Deactivate the extra → OK. Then try to deactivate the
     remaining → `409`.
   - While logged in as admin, try to deactivate self → `409 SELF_LOCKOUT`.
