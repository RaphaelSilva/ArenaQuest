# Task 07 — Migrate shared layout, navigation, and design-system strings (Phase 2)

**Status:** ✅ Done
**Milestone:** [10 — Frontend Internationalization (i18n)](./milestone.md)
**RFC:** [0002 — Frontend i18n, Phase 2](../../RFCs/0002-frontend-internationalization-i18n.md)

## Summary

Migrate the remaining cross-cutting UI surfaces that previous Phase-2 tasks intentionally left untouched: the root layout, global header / navigation / user menu, the spinner, and every label-bearing component under the shared design system. After this task, **no hardcoded user-facing string remains anywhere under `apps/web/src/{app,components,hooks}/**`** (Task 10 enforces this with an automated check).

## Dependencies

- Task 03 (`get-dict` and `DictProvider` available).
- Task 02 (`layout`, `common`, `errors` namespaces populated in both dictionaries).
- Tasks 04, 05, 06 should be merged (or at least open and aligned) so this task can confirm full coverage.

> **Reminder on out-of-scope items:** no language switcher, no routing/redirect logic, no `apps/web/src/i18n/routing/**` module, no `localStorage` override. These were explicitly removed from the milestone scope (see `milestone.md` §6 decision #2).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/layout.tsx`, `apps/web/src/app/(auth)/layout.tsx`, `apps/web/src/app/(protected)/layout.tsx` (any layout file under `apps/web/src/app/**`).
  - `apps/web/src/app/page.tsx` (landing-page chrome, if any user-facing strings remain).
  - `apps/web/src/components/layout/**`.
  - `apps/web/src/components/design-system/**` (only the label-bearing parts — purely structural components stay untouched).
  - `apps/web/src/components/spinner.tsx` and any other root-level shared component still carrying a string.
  - `apps/web/src/hooks/**` (only the hooks that produce user-facing strings — e.g. a `useToast` default messages helper).
- No change to feature-specific routes or components (covered by Tasks 04–06).
- Design-system components are kept **structurally stable**: if a label was a prop with a default, the default now reads from the dictionary, not from an inline literal. Public APIs of design-system components do not change.
- **No language switcher.** The milestone explicitly ships without a user-facing way to change language (see `milestone.md` §6 decision #2). Do not add a toggle, a settings field, a `<select>`, or any other UI affordance for changing the active language. Layouts render exactly one language — whichever the build was created with.
- Hooks that surface user-facing strings (toast helpers, error formatters) source their defaults from the dictionary via `useDict()` (if client) or accept a dictionary slice as a parameter (if pure utilities). No hook embeds a literal string.

## Scope

In:
- Root and group layouts.
- Header, sidebar, footer, breadcrumb, user menu, global error boundaries.
- Spinner and any shared status components carrying labels.
- Design-system components carrying default labels (buttons, modals, empty states).
- Hooks producing user-facing strings.

Out:
- Any kind of language switcher or selector UI (explicitly out of milestone scope).
- Visual restyling of layout chrome.
- Translating backend content.

## Acceptance Criteria

- [x] All layout files (`layout.tsx` at every level) read user-facing strings from the dictionary.
- [x] Global header, sidebar, footer, and user menu are fully dictionary-driven.
- [x] Design-system component defaults read from the dictionary; the components' public prop APIs are unchanged.
- [x] Hooks producing user-facing strings source them from the dictionary.
- [x] Running the post-merge audit command from Task 08 against `apps/web/src/{app,components,hooks}/**` reports zero remaining hardcoded user-facing strings (preview run included in the PR description).
- [x] `make lint`, `make test-web`, and `make test-api` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` with `NEXT_PUBLIC_LANGUAGE=pt` and again with `=en`. Confirm every chrome element (header, sidebar, footer, user menu, breadcrumbs, modals, default empty states) is fully localized in both runs.
2. Trigger a global error boundary (force a thrown error in a route) and confirm the fallback UI is localized.
3. Run the Task-08-preview audit script (or its grep equivalent) and confirm zero unhandled strings remain anywhere under `apps/web/src/{app,components,hooks}/**`.
4. Run `make test-web` and confirm green.
5. Run `git diff --stat` and confirm no file outside the declared scope changed.
