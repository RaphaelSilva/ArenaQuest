# Task 05 — Migrate `(protected)/admin/**` strings to the dictionary (Phase 2)

**Status:** ✅ Done
**Milestone:** [10 — Frontend Internationalization (i18n)](./milestone.md)
**RFC:** [0002 — Frontend i18n, Phase 2](../../RFCs/0002-frontend-internationalization-i18n.md)

## Summary

Replace every hardcoded user-facing string under the admin backoffice — `apps/web/src/app/(protected)/admin/**` and the admin components under `apps/web/src/components/admin/**` — with reads from the dictionary. Covers users, groups, topics, tasks, and any admin-only subroute.

## Dependencies

- Task 03 (`get-dict` and `DictProvider` available).
- Task 02 (`admin`, `common`, and related namespaces populated in both dictionaries).

## Technical Constraints

- **Scope guardrail:** changes restricted to files under `apps/web/src/app/(protected)/admin/**` and `apps/web/src/components/admin/**`. No change to other route groups, to `apps/web/src/i18n/**`, or to shared design-system components (those belong to Task 07).
- Server Components import `dict` from the i18n module; Client Components read via `useDict()`. Components that straddle the boundary are split rather than mixed.
- Strings missing from the Task 02 inventory must be added to **both dictionaries** and to `string-inventory.md` in the same PR; never ship a key that exists in only one language.
- No behavioural changes. Markup, ARIA, table layouts, sort/filter logic, optimistic-UI handlers, and mutation flows are preserved exactly. This is a text-only pass.
- Dynamic strings that interpolate counts or names use the function-style dictionary entries introduced in Task 02; do not inline `${}` template literals over hardcoded text.
- Existing admin tests must continue to pass. Tests that previously asserted Portuguese (or English) literals now assert via the dictionary path the component reads from.

## Scope

In:
- `apps/web/src/app/(protected)/admin/**` (all subpaths: `users`, `users/[userId]`, `groups`, `groups/[groupId]`, `topics`, `tasks`, `tasks/[id]`, and the admin index page).
- `apps/web/src/components/admin/**`.
- Test updates for any admin-component spec that asserted a string literal.

Out:
- Catalog, dashboard, tasks (participant view), enrollment, settings (Task 06).
- Layout/header/navigation chrome (Task 07).
- New admin features or RBAC changes.
- Localizing API-returned error messages (out of milestone scope).

## Acceptance Criteria

- [x] Every JSX text node, `alt`, `aria-label`, `title`, `placeholder`, button label, table header, empty-state message, confirmation modal, and toast under the declared scope reads from `dict` or `useDict`.
- [x] Every key referenced from migrated code exists in both `dict-en.ts` and `dict-pt.ts`.
- [x] Admin tests pass without behavioural changes; literal-string assertions are replaced with dictionary lookups.
- [x] Manual smoke against `make dev-web` with `NEXT_PUBLIC_LANGUAGE=en` and `=pt`: every admin page renders entirely in the expected language, including empty states, error states, and confirmation dialogs.
- [x] `make lint` and `make test-web` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Run `make dev-web` with `NEXT_PUBLIC_LANGUAGE=pt`, log in as an admin, and walk: `/admin`, `/admin/users`, `/admin/users/[id]`, `/admin/groups`, `/admin/groups/[id]`, `/admin/topics`, `/admin/tasks`, `/admin/tasks/[id]`. Confirm Portuguese throughout, including modals and toasts.
2. Repeat with `=en`. Confirm English throughout. Attach before/after screenshots to the PR.
3. Trigger at least one mutation per page (create, edit, delete) and confirm success/error feedback is dictionary-driven and language-correct.
4. Run `make test-web` and confirm green.
5. Run `git diff --stat` and confirm no file outside the declared scope changed.
