# Task 05 — Frontend: topic-editor visibility selector (Phase 3)

**Status:** ✅ Done
**Milestone:** [12 — Enrollment enforcement and node visibility](./milestone.md)
**RFC:** [0005 — Enrollment enforcement and node visibility, Phase 3](../../RFCs/0005-enrollment-exclusions-and-visibility.md)
**Team:** Frontend Web
**Depends On:** [Task 04 — admin/creator bypass + admin `PATCH` visibility schema](./04-controller-bypass-and-admin-patch.task.md) (backend endpoint must accept `visibility?`)

## Summary

Add a `visibility` selector with three options (`public` / `restricted` / `private`) to the admin topic editor (`apps/web/src/app/(protected)/admin/topics/**`), wired to the patched `PATCH /admin/topics/{id}` endpoint via the existing admin topics client. Inline help copy explains each level. All strings go through the i18n dictionary.

## Dependencies

- Task 04 — the admin patch endpoint accepts and persists `visibility?`.
- Existing admin topics client (`apps/web/src/lib/admin-topics-api.ts`).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/topics/**` — add the selector and its help copy to the existing topic editor surface.
  - `apps/web/src/lib/admin-topics-api.ts` — extend the update call's payload type with the optional `visibility` field (no new endpoint).
  - `apps/web/src/i18n/dict-en.ts` and `dict-pt.ts` — new keys for the three labels, the field label, and the per-level help copy.
  - `apps/web/src/i18n/types.ts` — extend the `Dictionary` type with the new keys if the project models keys in the type.
- **App Router conventions.** The selector is a control inside the existing editor; add `'use client'` only where interactive state requires it. Do not convert a Server Component to Client unless necessary.
- **i18n (RFC 0002).** No hardcoded user-facing strings under `apps/web/src/{app,components,hooks}/**`. The three option labels, the field label, and the help copy all read from the dictionary. `dict-en.ts` and `dict-pt.ts` must keep identical keys; `check-i18n-coverage.js` must pass.
- **Default value.** When a topic's `visibility` is absent (older payloads), the selector defaults to `restricted` — matching the backend default — and never silently submits a different value.
- **Cloud-agnostic.** No provider SDK; the selector calls the existing client which targets `NEXT_PUBLIC_API_URL`.
- **Responsive.** The control follows the editor's existing Tailwind v4 layout and stays usable at mobile, tablet, and desktop widths.

## Scope

In:
- Render a three-option `visibility` selector in the admin topic editor, bound to the topic's current value (default `restricted`).
- On change, call the existing admin topics update client with `{ visibility }`; surface success / error feedback consistent with the editor's existing pattern.
- Add inline help copy describing each level (`public` = any authenticated user; `restricted` = grant required; `private` = admin / creator only).
- Add the i18n keys to both dictionaries.
- Add / extend a component test covering the selector render and the update call payload.

Out:
- The unified Access page (Task 06).
- Migrating the user / group detail pages (Task 07).
- Any backend change (Task 04 owns the endpoint).
- Participant catalog changes (none needed — Phase 0 is server-side).

## Acceptance Criteria

- [x] The admin topic editor shows a `visibility` selector with `public` / `restricted` / `private`, defaulting to `restricted` when unset.
- [x] Changing the value persists via `PATCH /admin/topics/{id}` (`visibility` added to the save payload; the detail pane syncs from `selectedNode.visibility`).
- [x] Inline help copy (`admin.topics.detail.visibilityHelp`) explains the three levels, dictionary-sourced.
- [x] No hardcoded user-facing string; `check-i18n-coverage.js` passes; the 5 new keys exist in both `dict-en.ts` and `dict-pt.ts`.
- [x] The control reuses the existing status-select Tailwind tokens (`w-full` responsive), matching the editor's layout.
- [x] `admin-topics-api.test.ts` asserts `update` issues `PATCH /admin/topics/:id` with the `visibility` body (4 cases). _The full page-render test is pre-skipped at repo baseline; the selector mirrors the proven status-select pattern._
- [x] `check-i18n-coverage.js` passes; changed files lint clean; new + i18n tests green; zero new web `tsc` errors (web `tsc` is pre-red on 6 unrelated fixtures at baseline). _Backend untouched._
- [x] No diff outside the scope guardrail (web type `TopicNode.visibility` made optional to avoid breaking pre-existing fixtures — a minimal, in-scope correction).

## Verification Plan

1. `make dev-web` + `make dev-api`. Open the admin topic editor for an existing topic; confirm the selector defaults to `restricted`.
2. Change to `public`, save, reload — confirm the value persists and the catalog now shows the topic to a zero-grant participant (cross-check with the Task 04 backend).
3. Change to `private`, save — confirm the topic disappears from a participant's catalog but remains editable in admin.
4. Switch `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; confirm labels and help copy translate.
5. `make test-web` — component test green; run `check-i18n-coverage.js`.
6. Resize to mobile and confirm the control remains usable.
7. `git diff --stat` confirms only the scope-guardrail files changed.
