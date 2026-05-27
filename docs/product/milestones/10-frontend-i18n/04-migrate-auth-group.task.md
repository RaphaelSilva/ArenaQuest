# Task 04 — Migrate `(auth)` route group strings to the dictionary (Phase 2)

**Status:** ✅ Done
**Milestone:** [10 — Frontend Internationalization (i18n)](./milestone.md)
**RFC:** [0002 — Frontend i18n, Phase 2](../../RFCs/0002-frontend-internationalization-i18n.md)

## Summary

Replace every hardcoded user-facing string under the `(auth)` route group with reads from the dictionary plumbing landed in Task 03. Covers login, register/activate, forgot-password, reset-password, OAuth callback, and every component under `apps/web/src/components/auth/**` they depend on.

## Dependencies

- Task 03 (`get-dict` and `DictProvider` available).
- Task 02 (`auth` namespace populated in both dictionaries).

## Technical Constraints

- **Scope guardrail:** changes restricted to files under `apps/web/src/app/(auth)/**` and `apps/web/src/components/auth/**`. No change to `apps/web/src/i18n/**`, no change outside the `(auth)` boundary. If a string lives in a shared component used by both auth and protected routes (e.g. a generic `Button`), do **not** migrate it here — flag it for Task 07.
- Server Components import `dict` from `@/i18n` (or whatever path alias is configured). Client Components read via `useDict()`. Mixing the two patterns inside a single component is forbidden — split components if the existing one straddles the server/client boundary.
- Every replaced string must already exist in both `dict-en.ts` and `dict-pt.ts` (per the Task 02 inventory). If a string is found that the inventory missed, add it to **both dictionaries** and to `string-inventory.md` in the same PR; do not invent a key that exists in only one language.
- No visual or behavioural change. Markup, classes, `data-*` attributes, event handlers, validation logic, and accessibility attributes are preserved exactly. The diff should read as a pure text-substitution pass.
- Existing tests under `apps/web/src/components/auth/__tests__/**` must continue to pass without changes; if a test asserts a specific string, update it to read from the dictionary (the same path the component uses), not to hardcode the new key's value.

## Scope

In:
- `apps/web/src/app/(auth)/login/**`
- `apps/web/src/app/(auth)/activate/**`
- `apps/web/src/app/(auth)/forgot-password/**`
- `apps/web/src/app/(auth)/reset-password/**`
- `apps/web/src/app/(auth)/auth/callback/**`
- `apps/web/src/components/auth/**` (excluding shared design-system pieces — those belong to Task 07)
- Updating `apps/web/src/components/auth/__tests__/**` to read expected strings from the dictionary.

Out:
- Any change outside the auth group.
- Adding new auth features or refactoring auth flow.
- Localizing API error responses (those are returned by `apps/api` — out of milestone scope).

## Acceptance Criteria

- [x] `grep -RIE "[A-Za-zÀ-ÿ]{4,}" apps/web/src/app/(auth) apps/web/src/components/auth` over JSX text, `alt`, `aria-label`, `title`, and `placeholder` attributes returns only references that resolve through `dict` / `useDict` (verified by spot-check of 100% of files in the diff).
- [x] Every key referenced from migrated code exists in both `dict-en.ts` and `dict-pt.ts`.
- [x] All existing auth-related tests pass without behavioural changes; string assertions read from the dictionary, not from inlined literals.
- [x] Manual smoke against `make dev-web` with `NEXT_PUBLIC_LANGUAGE=en` and again with `=pt`: every screen in the `(auth)` group renders entirely in the expected language.
- [x] `make lint` and `make test-web` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Run `make dev-web` with `NEXT_PUBLIC_LANGUAGE=pt` and walk every `(auth)` screen — login, activate, forgot-password, reset-password, OAuth callback. Confirm Portuguese throughout.
2. Repeat with `=en`. Confirm English throughout. Take screenshots; attach to the PR.
3. Trigger validation errors (empty form submit, mismatched passwords, expired token) and confirm error text is also dictionary-driven and language-correct.
4. Run `make test-web` and confirm green.
5. Run `git diff --stat` and confirm no file outside the declared scope changed.
