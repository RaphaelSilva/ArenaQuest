# Task 07 — Frontend: migrate user/group detail pages to a "Manage access" deep-link (Phase 3)

**Status:** Open
**Milestone:** [12 — Enrollment enforcement and node visibility](./milestone.md)
**RFC:** [0005 — Enrollment enforcement and node visibility, Phase 3](../../RFCs/0005-enrollment-exclusions-and-visibility.md)
**Team:** Frontend Web
**Depends On:** [Task 06 — unified Access page](./06-unified-access-page.task.md) (the deep-link target must exist and accept a pre-selected principal)

## Summary

Make the unified Access page the single source of truth for grants. Remove the embedded `enrollment/enrollments-tab.tsx` from the admin user and group detail pages and replace it with a lightweight **"Manage access"** link that deep-links into `/admin/access` pre-filtered to that principal. Once no surface references the shared component, retire it.

## Dependencies

- Task 06 — the `/admin/access` page exists and accepts a query param to pre-select a user or group.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/users/**` and `apps/web/src/app/(protected)/admin/groups/**` — swap the embedded enrollments tab for a "Manage access" deep-link.
  - `apps/web/src/components/enrollment/enrollments-tab.tsx` — delete it **only after** confirming no remaining import references it (`grep` clean); otherwise leave it and note the blocker.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, and `types.ts` — the "Manage access" link label (and removal of now-unused enrollment-tab keys if they are exclusive to it).
- **Single source of truth.** The detail pages no longer embed the full grant UI; all grant management happens on `/admin/access`. The deep-link carries the principal id (and type `user|group`) as query params consumed by Task 06.
- **No regression in reachability.** Every grant operation previously possible from a detail page must be reachable in one click from the "Manage access" link.
- **App Router conventions.** Prefer a plain `<Link>`; add `'use client'` only if the link needs client state. Do not convert Server Components unnecessarily.
- **i18n (RFC 0002).** The link label reads from the dictionary; identical keys in both files; `check-i18n-coverage.js` passes. Remove orphaned keys only if they are exclusive to the deleted component.
- **Clean deletion.** Do not leave a dangling import or a half-removed component. If `enrollments-tab.tsx` is still referenced elsewhere, keep it and document why in the task closeout rather than breaking the build.
- **Cloud-agnostic.** No provider SDK; deep-link is an internal route.

## Scope

In:
- Replace the embedded enrollments tab on the admin user detail page with a "Manage access" deep-link to `/admin/access` pre-filtered to that user.
- Do the same on the admin group detail page, pre-filtered to that group.
- Remove `enrollment/enrollments-tab.tsx` once `grep` confirms no remaining references; clean up its now-orphaned i18n keys.
- Update / add component tests asserting the link renders and points at the correct deep-link target.

Out:
- The Access page itself (Task 06).
- The topic-editor visibility selector (Task 05).
- Any backend change.
- Adding denies / "Excluded topics" (Deferred).

## Acceptance Criteria

- [ ] The admin user detail page shows a "Manage access" link deep-linking to `/admin/access` pre-filtered to that user (no embedded grant UI).
- [ ] The admin group detail page shows the equivalent link pre-filtered to that group.
- [ ] `enrollment/enrollments-tab.tsx` is deleted and `grep -R "enrollments-tab" apps/web/src` returns no matches — **or** the task closeout documents the remaining blocking reference and the component is left intact (no broken build either way).
- [ ] Orphaned i18n keys exclusive to the removed component are cleaned up; no key drift between `dict-en.ts` and `dict-pt.ts`; `check-i18n-coverage.js` passes.
- [ ] Every grant operation formerly available on the detail pages is reachable in one click via the deep-link.
- [ ] Link label is internationalized and present in both dictionaries.
- [ ] Component tests assert the link target.
- [ ] `make lint`, `make test-web`, and `make test-api` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` + `make dev-api`. Open an admin user detail page; confirm the embedded grant UI is gone and a "Manage access" link is present.
2. Click it; confirm it lands on `/admin/access` with that user pre-selected, and grants are manageable there.
3. Repeat on a group detail page.
4. `grep -R "enrollments-tab" apps/web/src` — confirm no matches (or the documented blocker).
5. Switch `NEXT_PUBLIC_LANGUAGE` pt/en; confirm the link label translates; run `check-i18n-coverage.js`.
6. `make build` — confirm no dangling import breaks the build.
7. `make test-web` green.
8. `git diff --stat` confirms only the scope-guardrail files changed.
