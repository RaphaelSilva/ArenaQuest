# Task 06 — Migrate participant routes — catalog, dashboard, tasks, enrollment, settings (Phase 2)

**Status:** 📝 Draft
**Milestone:** [10 — Frontend Internationalization (i18n)](./milestone.md)
**RFC:** [0002 — Frontend i18n, Phase 2](../../RFCs/0002-frontend-internationalization-i18n.md)

## Summary

Replace every hardcoded user-facing string under the participant-facing routes and their dedicated components: catalog browser, topic/subtopic detail pages, dashboard, tasks list/detail, enrollment, and settings. Covers `apps/web/src/app/(protected)/{catalog,dashboard,tasks,settings}/**` and `apps/web/src/components/{catalog,dashboard,tasks,enrollment}/**`.

## Dependencies

- Task 03 (`get-dict` and `DictProvider` available).
- Task 02 (`catalog`, `dashboard`, `tasks`, `enrollment`, `settings`, `common` namespaces populated in both dictionaries).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/catalog/**`
  - `apps/web/src/app/(protected)/dashboard/**`
  - `apps/web/src/app/(protected)/tasks/**`
  - `apps/web/src/app/(protected)/settings/**`
  - `apps/web/src/components/catalog/**`
  - `apps/web/src/components/dashboard/**`
  - `apps/web/src/components/tasks/**`
  - `apps/web/src/components/enrollment/**`
- No change to admin routes (Task 05), layout chrome (Task 07), or `apps/web/src/i18n/**`.
- **Markdown-rendered content is out of scope.** Topic descriptions, task instructions, and media metadata served by the API are dynamic backend content and are not localized in this milestone. Only the surrounding UI chrome (labels, buttons, empty states, progress legends, viewer controls) is migrated.
- Server vs. client component discipline as in Tasks 04 and 05: no mixing of `dict` and `useDict` inside a single component.
- Strings missing from the Task 02 inventory are added to **both dictionaries** and to `string-inventory.md` in the same PR.
- Progress charts, radial indicators, and tooltips must remain pixel-stable; only their text content changes. Numerical formatting (percentages, counts) stays in the locale-agnostic form already used — explicit `Intl`-based formatting is deferred to RFC 0002 Phase 4.
- Existing tests under `apps/web/src/components/{catalog,dashboard,tasks}/__tests__/**` pass without behavioural changes.

## Scope

In:
- All paths listed under the scope guardrail.
- Updating affected tests to read expected strings from the dictionary.

Out:
- Admin backoffice (Task 05).
- Header, sidebar, footer, breadcrumbs, page chrome (Task 07).
- Localization of dynamic backend content (out of milestone).
- `Intl`-aware date/number/currency formatting (RFC 0002 Phase 4).

## Acceptance Criteria

- [ ] Every JSX text node, attribute string, and UI message under the declared scope reads from `dict` or `useDict`.
- [ ] Every key referenced exists in both dictionaries.
- [ ] Charts and progress indicators are pixel-identical to pre-migration screenshots (verified manually); only text content changes.
- [ ] Backend-driven Markdown content is preserved unchanged — no attempt is made to localize topic/task descriptions in this PR.
- [ ] Participant-route tests pass without behavioural changes; string assertions go through the dictionary.
- [ ] `make lint` and `make test-web` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` with `NEXT_PUBLIC_LANGUAGE=pt`, log in as a participant, walk: `/dashboard`, `/catalog`, `/catalog/[id]`, `/catalog/[id]/[subtopicId]`, `/tasks`, `/tasks/[id]`, `/settings`. Confirm Portuguese throughout.
2. Repeat with `=en`. Confirm English throughout. Attach before/after screenshots to the PR, including at least one progress chart with tooltip open.
3. Confirm Markdown-rendered topic/task content is **not** translated by this PR — it remains exactly as the API returned it.
4. Run `make test-web` and confirm green.
5. Run `git diff --stat` and confirm no file outside the declared scope changed.
