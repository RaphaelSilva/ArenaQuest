# Task 06 — Frontend: unified, principal-centric Access page (Phase 3)

**Status:** Open
**Milestone:** [12 — Enrollment enforcement and node visibility](./milestone.md)
**RFC:** [0005 — Enrollment enforcement and node visibility, Phase 3](../../RFCs/0005-enrollment-exclusions-and-visibility.md)
**Team:** Frontend Web
**Depends On:** [Task 04 — admin/creator bypass + admin `PATCH` visibility schema](./04-controller-bypass-and-admin-patch.task.md) (grant endpoints unchanged, but lands after the backend phase)

## Summary

Build a new unified, principal-centric Access page at `apps/web/src/app/(protected)/admin/access/**` that replaces the two separate entry points (per-user tab + per-group tab) currently provided by `enrollment/enrollments-tab.tsx`. The page offers a `User | Group` principal selector, then a "Granted topics" grant picker that renders the topic hierarchy as an **ordered tree** reusing the catalog's tree component, wired to the existing grant / revoke endpoints. No new grant API is introduced.

## Dependencies

- Task 04 (backend phase complete; grant / revoke endpoints are unchanged but the milestone ordering puts UI after backend).
- Existing enrollment client (`apps/web/src/lib/admin-enrollment-api.ts`) and the catalog tree component (`apps/web/src/components/catalog/TopicTreeNode.tsx` and siblings).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/access/**` — the new route, page, and page-local components.
  - Optionally a shared, reusable grant-tree-picker component under `apps/web/src/components/**` if the catalog tree node needs an admin-mode wrapper; reuse, do not fork, the catalog tree rendering.
  - `apps/web/src/lib/admin-enrollment-api.ts` — reuse the existing grant / revoke functions; only add a thin helper if strictly needed (no new endpoint).
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, and `types.ts` — new keys for the page.
- **Principal-centric, not topic-centric.** The page picks a user or group, then shows that principal's granted topics. No reverse-lookup ("who can see this node") and no new port methods — a Non-Goal of the RFC.
- **Reuse the catalog's ordered tree.** The grant picker renders the same hierarchy participants browse, in the same order, by reusing the existing catalog tree component rather than building a parallel tree.
- **Existing endpoints only.** Grants use the current `grantUser` / `revokeUser` / `grantGroup` / `revokeGroup` flows (with `{ cascade }`). No new route; denies / "Excluded topics" are Deferred and must **not** appear.
- **App Router conventions.** Page is a Server Component where possible; `'use client'` only for the interactive selector / tree state. Deep-linkable: it accepts query params to pre-select a principal (consumed by Task 07).
- **i18n (RFC 0002).** No hardcoded strings; identical keys in both dictionaries; `check-i18n-coverage.js` passes.
- **Responsive & accessible.** Tailwind v4; the tree picker supports keyboard navigation and the principal toggle is operable by keyboard. Semantic HTML.
- **Cloud-agnostic.** No provider SDK; the existing client targets `NEXT_PUBLIC_API_URL`.

## Scope

In:
- Create the `/admin/access` route with a principal selector (`User | Group`) and a search/pick control for the principal. Verb-first flow ("manage access → pick whom").
- Render a "Granted topics" grant picker as an ordered tree reusing the catalog tree component, reflecting the selected principal's current grants and toggling grants via the existing endpoints (with cascade semantics preserved).
- Accept query params to pre-select and pre-filter to a given user or group (so Task 07's deep-link works).
- Add the i18n keys to both dictionaries.
- Add component tests for the principal selector and the grant-toggle call.

Out:
- An "Excluded topics" / denies tab (Deferred — must not ship).
- The topic-editor visibility selector (Task 05).
- Removing the embedded `enrollments-tab` from the detail pages (Task 07).
- Any backend change.

## Acceptance Criteria

- [ ] `/admin/access` renders a `User | Group` principal selector with search/pick.
- [ ] Selecting a principal loads their current grants and renders the "Granted topics" picker as an ordered tree reusing the catalog tree component.
- [ ] Toggling a grant calls the existing grant / revoke endpoints with correct cascade semantics; the UI reflects the new state.
- [ ] The page accepts query params to pre-select a principal (used by the Task 07 deep-link).
- [ ] No "Excluded topics" / denies surface is present.
- [ ] No hardcoded user-facing string; `check-i18n-coverage.js` passes; keys exist in both dictionaries.
- [ ] The tree picker and principal toggle are keyboard-operable; semantic HTML throughout.
- [ ] Responsive across mobile / tablet / desktop.
- [ ] Component tests for the selector and grant-toggle pass.
- [ ] `make lint`, `make test-web`, and `make test-api` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` + `make dev-api`. Navigate to `/admin/access`; toggle `User | Group` and pick a principal.
2. Confirm the granted-topics tree reflects the principal's current grants in catalog order; toggle a grant and confirm it persists (cross-check via `GET /topics` as that participant).
3. Confirm cascade: granting a parent grants its descendants in the participant catalog.
4. Visit `/admin/access?...` with a principal pre-selected via query param and confirm it pre-filters.
5. Confirm no denies / "Excluded topics" tab exists.
6. Keyboard-navigate the tree and the principal toggle.
7. Switch `NEXT_PUBLIC_LANGUAGE` pt/en; confirm copy translates; run `check-i18n-coverage.js`.
8. `make test-web` green; resize to mobile and confirm usability.
9. `git diff --stat` confirms only the scope-guardrail files changed.
