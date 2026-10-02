# Task 08 — Frontend: User management journey J10

**Status:** 📝 Open
**Epic:** [End-to-end test phase — Playwright suite gating main](./2026-09-29-e2e-test-phase.epic.md)
**Team:** Frontend Web
**Depends On:** [Task 02](./02-fixtures-and-page-objects.task.md)

## Summary

Cover the admin user-management backoffice. **J10:** the admin creates a user from
`/admin/users` with a `uniq()` address and a role, finds it in the list, opens its
detail page, deactivates it and confirms the user can no longer log in; then the
admin tries to demote or deactivate **themselves** as the last active admin and sees
the lockout-guard message, and the account stays active and an admin. The spec never
modifies the shared seeded admin in a way that survives the spec: it asserts the
guard's refusal, not a successful self-change.

## Dependencies

- [Task 02](./02-fixtures-and-page-objects.task.md) — hard dependency: role states
  and page objects.
- Existing behaviour: `/v1/admin/users/**` with the last-admin and self-lockout
  guards, `apps/web/src/app/(protected)/admin/users/**`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `e2e/specs/admin/**` — J10.
  - `e2e/pages/**` — admin users list and user detail page objects.
- **No shared-state damage.** Only the user created by the spec is deactivated; the
  seeded admin is only used to trigger a refusal.
- **Assert the message the user sees**, through the dictionary text in the English
  build, not an API status code.
- **No production code change.**

## Scope

In:
- J10: create, list, detail, deactivate, login refused, last-admin guard.
- The page objects it needs.

Out:
- Password reset by admin — covered by API tests; a journey can follow later.
- Groups administration.

## Acceptance Criteria

- [ ] J10 passes: the created user appears, is deactivated and cannot log in.
- [ ] The self-lockout attempt shows the guard message and the seeded admin remains
      an active admin afterwards (a subsequent smoke run still logs in as admin).
- [ ] `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make e2e` filtered to `e2e/specs/admin` — green.
2. Run the full suite right after — every admin journey still passes.
3. `make lint`.
4. `git diff --stat` confirms only scope-guardrail files changed.
