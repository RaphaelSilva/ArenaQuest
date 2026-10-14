# Task 02 — Frontend: Fixtures and page objects

**Status:** 📝 Open
**Epic:** [End-to-end test phase — Playwright suite gating main](./2026-09-29-e2e-test-phase.epic.md)
**Team:** Frontend Web
**Depends On:** [Task 01](./01-e2e-workspace-and-stack-boot.task.md)

## Summary

Build the thin, typed layer every journey spec stands on. **Role sessions:** the
global setup logs in once per role (admin, student, second student, content creator)
**through the login page**, and stores each browser state under `e2e/.auth/`; specs
opt in per role, so an authenticated spec starts with only the refresh cookie and
re-authenticates through the silent refresh. **API client:** a small fetch wrapper
typed against `apps/web/src/lib/api-types.gen.ts` that logs in as a role, keeps its
own bearer token and exposes only seeding operations (create/publish topic, create
task, add stage, link topics, grant/revoke enrollment, create event, create user) on
`/v1/admin/**`. **Unique data:** a `uniq()` helper that suffixes titles with the
worker index and a short random id so specs are parallel-safe with no cleanup.
**Page objects:** one class per page used by the smoke set (login, catalog, topic,
events list/detail, admin nav), exposing intent and built only on role / label / text
selectors. Where a control has no accessible name, this task adds the missing
`aria-label` or role in the web — never a blanket `data-testid`.

## Dependencies

- [Task 01](./01-e2e-workspace-and-stack-boot.task.md) — hard dependency: the
  workspace, the boot and the seeded accounts.
- Existing contract: `apps/web/src/lib/api-types.gen.ts` (kept fresh by CI), the
  admin routes under `apps/api/src/routes/admin/**`, the login page in
  `apps/web/src/app/(auth)/login/`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `e2e/fixtures/**` — role sessions, API client, `uniq()`, the extended `test`.
  - `e2e/pages/**` — page objects for login, catalog, topic, events, admin nav.
  - `e2e/global-setup.ts` — the per-role login step.
  - `apps/web/src/components/**` and `apps/web/src/app/**` — **only** additive
    accessible names (`aria-label`, `role`, `<label>` association) on controls a page
    object cannot reach semantically; any visible text added reads from the
    dictionaries (`dict-en.ts`, `dict-pt.ts`).
- **Seed through the public API only.** The client never writes to D1 and never
  calls a route that the backoffice does not use.
- **Typed paths.** Endpoint paths and bodies come from the generated types, so an
  API rename fails type-checking in `e2e/` instead of at runtime.
- **Selectors.** `getByRole` / `getByLabel` / `getByText` only; CSS and XPath
  selectors are not allowed.
- **Topic creation is sequential** within a caller (non-transactional sort order
  in `D1TopicNodeRepository.create`); parallelism comes from separate spec files.
- **i18n.** Any new `aria-label` string is a dictionary key present in both
  dictionaries; `check-i18n-coverage.js` passes.

## Scope

In:
- Per-role browser states produced by a UI login in global setup.
- The typed API client with the seeding operations listed above.
- `uniq()` and an extended `test` exposing `api`, the role states and `uniq`.
- Page objects for login, catalog, topic, events list/detail and admin nav.
- The minimal accessibility fixes these page objects need, with a component test
  update where an existing test asserts the old markup.

Out:
- Journey specs — tasks 03, 05–08.
- Mail and R2 helpers — tasks 05, 06.
- Any API change.

## Acceptance Criteria

- [ ] After global setup, one browser state per role exists and a spec using the
      student state lands on `/dashboard` without seeing the login page.
- [ ] A throwaway spec seeds a published topic through the API client and finds it
      in `/catalog` through the catalog page object.
- [ ] Renaming a path in the generated types makes `e2e/` fail type-checking.
- [ ] No page object uses a CSS or XPath selector.
- [ ] Any accessibility attribute added in the web is covered by an i18n key in both
      dictionaries; `check-i18n-coverage.js` passes; `make test-web` green.
- [ ] `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make e2e` — global setup writes the role states; the throwaway spec passes.
2. Delete `e2e/.auth/` and re-run — states are recreated.
3. Temporarily rename a path in `api-types.gen.ts` and type-check `e2e/` — it fails;
   revert.
4. `make test-web` and `make lint`.
5. `git diff --stat` confirms only scope-guardrail files changed.
