# Task 02 — Author EN and PT dictionaries with a shared `Dictionary` type (Phase 1)

**Status:** ✅ Done
**Milestone:** [10 — Frontend Internationalization (i18n)](./milestone.md)
**RFC:** [0002 — Frontend i18n, Phase 1](../../RFCs/0002-frontend-internationalization-i18n.md)

## Summary

Audit every user-facing string currently rendered by `apps/web/src/**` and capture them into two structured, typed dictionaries: `dict-en.ts` and `dict-pt.ts`. Both dictionaries satisfy a single `Dictionary` type so that a missing or misspelled key in either one fails typecheck. This task **only** authors the dictionaries and the type; it does not touch any component (that happens in Tasks 04–07).

## Dependencies

- Task 01 (i18n module foundation) must be merged.

## Technical Constraints

- **Scope guardrail:** changes restricted to new files `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts`, `apps/web/src/i18n/types.ts` (or equivalent type-only file), and an update to `apps/web/src/i18n/index.ts` to re-export the dictionaries and the `Dictionary` type. No component, no page, no test is modified by this task.
- The `Dictionary` type must be **derived from one of the dictionaries** (so the type cannot drift from the data) — both dictionaries are then asserted to satisfy that same shape via TypeScript's `satisfies` operator (or equivalent). Renaming a key in one without mirroring the other must fail `tsc`.
- Namespaces are organised by feature area, not by route. Minimum namespaces (extend as needed during the audit): `auth`, `admin`, `catalog`, `dashboard`, `tasks`, `enrollment`, `settings`, `layout`, `common`, `errors`.
- Keys are stable identifiers, not human text (e.g. `auth.login.submitButton`, not `auth.login.entrar`). The English string is the reference label only — both languages are equally first-class.
- No string interpolation framework is introduced. Where a string needs a runtime value, the dictionary entry is a function returning a string (e.g. `(count) => …`). Functions must be pure and synchronous.
- Both dictionaries are `as const` to maximize literal-type inference and tree-shakability.
- The audit must produce a **string inventory artifact** committed alongside the dictionaries (a Markdown file under `docs/product/milestones/10-frontend-i18n/string-inventory.md`) listing every source location → namespace.key mapping. This artifact is what Task 10's coverage gate compares against.

## Scope

In:
- Sweep `apps/web/src/app/**`, `apps/web/src/components/**`, and `apps/web/src/hooks/**` for user-facing string literals (JSX text, `alt`, `aria-label`, `title`, placeholder, button labels, validation messages, toast/notification text).
- Group the inventory into the namespaces listed in the constraints.
- Produce `dict-en.ts` with English text for every key, `dict-pt.ts` with the Portuguese counterpart. Where the current UI is mixed PT/EN, prefer the Portuguese text for `dict-pt` (current users) and a faithful English translation for `dict-en`.
- Define the `Dictionary` type and wire both dictionaries to satisfy it.
- Update `apps/web/src/i18n/index.ts` to re-export `dict-en`, `dict-pt`, and the `Dictionary` type.
- Commit `docs/product/milestones/10-frontend-i18n/string-inventory.md`.

Out:
- Replacing any hardcoded string in components (Tasks 04–07).
- Implementing `get-dict.ts` or `dict-context.tsx` (Task 03).
- Translating dynamic content returned by the API (out of milestone scope).
- Adding a translation tooling pipeline (PO files, Crowdin, etc.) — the dictionaries remain hand-edited TS files.

## Acceptance Criteria

- [x] `apps/web/src/i18n/dict-en.ts` and `apps/web/src/i18n/dict-pt.ts` exist and are exported through `apps/web/src/i18n/index.ts`.
- [x] A single `Dictionary` type is defined; both dictionaries satisfy it via `satisfies Dictionary`. A deliberate test (added to a `__type-tests__` file or as a comment-driven check, removed before merge) confirms that removing a key from `dict-pt` makes `tsc` fail.
- [x] Every key listed in `string-inventory.md` has an entry in both dictionaries.
- [x] No dictionary value is an empty string. Untranslated entries are flagged in `string-inventory.md` with a `TODO-translate` note and tracked in the PR description, not silently shipped as empty strings.
- [x] `make lint` and `make test-web` pass green.
- [x] No diff outside the files listed in the scope guardrail.

## Verification Plan

1. Open `string-inventory.md` and walk a random sample of 20 entries — for each, confirm the source file actually contains the listed string and that both dictionaries have the corresponding key.
2. Run `tsc --noEmit` (via `make test-web` or directly) and confirm green.
3. Temporarily delete one key from `dict-pt.ts` and confirm typecheck fails with a clear error pointing at the dictionary shape; revert before commit.
4. Confirm `apps/web/src/{app,components,hooks}/**` is unchanged by this PR (component migration belongs to later tasks).
