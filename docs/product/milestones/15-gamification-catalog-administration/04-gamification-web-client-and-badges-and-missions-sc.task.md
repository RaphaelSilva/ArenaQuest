# Task 04 — Frontend: Gamification web client and badges and missions screens (Phase 2)

**Status:** 📝 Open
**Milestone:** [15 — Gamification Catalog Administration](./milestone.md)
**RFC:** [RFC 0009](../../RFCs/0009-gamification-catalog-administration.md)
**Team:** Frontend Web
**Depends On:** [Task 01](./01-shared-gamification-catalog-types.task.md), [Task 02](./02-admin-quest-definition-crud-endpoints.task.md), [Task 03](./03-admin-level-definition-editor-endpoints.task.md)

## Summary

Build the typed web client for the whole gamification catalog and ship the two
admin screens whose backend APIs already exist, proving the pattern end-to-end
before the new-API screens land in task 05. The new
`apps/web/src/lib/admin-gamification-api.ts` exposes `badges`, `quests`,
`missions`, and `levels` namespaces over the centralized api-client, returning
the shared `Entities.Gamification.*` types. On top of it, this task delivers
`/admin/badges` (table of icon/name/slug/rule/xpReward/active toggle, with a
create/edit form) and `/admin/missions` (table with the `startAt`/`endAt` window
and an optional `badgeId` selected from existing badges, with create/edit/delete).
Both pages follow the existing admin pattern — `useHasRole` gate, `useDict()`
strings, list + create/edit form — and their root `<main>` is a
`flex-1 overflow-y-auto` scroll region per RFC 0008's layout contract. Task 05
reuses this client for the quests and levels screens and adds the hub cards.

## Dependencies

- [Task 01](./01-shared-gamification-catalog-types.task.md) — the client returns
  the shared `Entities.Gamification.*` types.
- [Task 02](./02-admin-quest-definition-crud-endpoints.task.md) and
  [Task 03](./03-admin-level-definition-editor-endpoints.task.md) — the `quests`
  and `levels` client namespaces type against those contracts even though their
  screens land in task 05; building the full client here keeps it in one owner.
- Extends the centralized api-client (`apps/web/src/lib/api-client`) and the
  existing admin badges/missions backend endpoints.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/lib/admin-gamification-api.ts` — new typed client with the
    four namespaces over the centralized api-client (no new backend endpoint —
    tasks 02/03 own those).
  - `apps/web/src/app/(protected)/admin/badges/page.tsx` and
    `apps/web/src/app/(protected)/admin/missions/page.tsx` — the two new screens.
  - `apps/web/src/components/**` and `apps/web/src/hooks/**` — any shared
    catalog list/form pieces these two screens introduce.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are
    typed) — the new dictionary keys for these two screens and the client.
- **App Router conventions.** Client components (`'use client'`) only where the
  interactive list/form state requires it; root `<main>` is `flex-1 overflow-y-auto`.
- **Role gate.** Both pages gate on `useHasRole(ADMIN || CONTENT_CREATOR)`; the
  badge `xpReward` field is editable only by `ADMIN` (mirrors the backend split).
- **i18n.** No hardcoded user-facing strings under
  `apps/web/src/{app,components,hooks}/**`; `dict-en.ts`/`dict-pt.ts` keep
  identical keys; `check-i18n-coverage.js` must pass.
- **Cloud-agnostic.** The UI calls the new client which targets
  `NEXT_PUBLIC_API_URL`; no provider SDK.
- **Help text.** Each screen surfaces the "edits affect the current period"
  warning and previews the parsed `ruleParams` value before save.

## Scope

In:
- `admin-gamification-api.ts` with `badges`/`quests`/`missions`/`levels`
  namespaces returning the shared types.
- `/admin/badges` screen: list + create/edit form for `name`, `slug`,
  `iconEmoji`, `description`, `ruleKind`, `ruleParams`, `xpReward`, `active`,
  with the active toggle and `ADMIN`-only `xpReward`.
- `/admin/missions` screen: list with `startAt`/`endAt` window and optional
  `badgeId` select, supporting create/edit/delete.
- The new dictionary keys (EN + PT) and component tests covering render and the
  request payload for each screen.

Out:
- The `/admin/quests` and `/admin/levels` screens and the hub cards — task 05.
- Any backend change — tasks 02/03 own the endpoints.

## Acceptance Criteria

- [ ] `admin-gamification-api.ts` exposes the four namespaces returning
      `Entities.Gamification.*` types over the centralized api-client.
- [ ] `/admin/badges` renders for `ADMIN`/`CONTENT_CREATOR`, lists existing
      badges, and completes a create/edit round-trip; `xpReward` is editable only
      for `ADMIN`.
- [ ] `/admin/missions` renders, lists missions with their window and `badgeId`,
      and completes a create/edit/delete round-trip.
- [ ] Both screens' root `<main>` scrolls (`flex-1 overflow-y-auto`).
- [ ] No hardcoded user-facing string; the new keys exist in both `dict-en.ts`
      and `dict-pt.ts`; `check-i18n-coverage.js` passes.
- [ ] The surfaces are responsive and keyboard-usable where interactive.
- [ ] Changed files lint clean; `make test-web` green for the affected component
      tests.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` + `make dev-api` and open `/admin/badges` and `/admin/missions`;
   confirm the list, the create/edit (and mission delete) happy paths, and the
   active toggle.
2. Exercise an error path (invalid form / failed request) and confirm the
   feedback is clear.
3. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; confirm labels translate.
4. `make test-web` — component tests green; run `check-i18n-coverage.js`.
5. Resize to mobile and confirm both screens scroll and stay usable.
6. `git diff --stat` confirms only scope-guardrail files changed.
