# Plan — Task 05: topic-editor visibility selector (Phase 3, frontend)

**Assigned persona:** frontend-developer
**Branch:** feat/m12-05-topic-visibility-selector
**Task file:** docs/product/milestones/12-enrollment-visibility/05-topic-editor-visibility-selector.task.md

## Affected areas
- `apps/web/src/lib/admin-topics-api.ts` — add `visibility` to the `TopicNode` type and `UpdateTopicInput` / `CreateTopicInput`.
- `apps/web/src/app/(protected)/admin/topics/page.tsx` — add a visibility `<select>` + help copy to the detail pane, mirroring the existing status select.
- `apps/web/src/i18n/dict-pt.ts` and `apps/web/src/i18n/dict-en.ts` — add `admin.topics.detail` visibility keys.

## Context facts (verified)
- The page is a `'use client'` component (1033 lines). In `AdminTopicsPage`, `d = dict.admin.topics`. The detail pane has a status select at ~line 884 using `detailStatus` state (declared ~line 256), synced from `selectedNode.status` (~line 320, default ~line 311), and saved via `client.adminTopics.update(selectedId, { ..., status: detailStatus, ... })` (~line 481).
- The web `TopicNode`/`UpdateTopicInput`/`CreateTopicInput` types are LOCAL to `admin-topics-api.ts` (string-literal unions), independent of the shared port. `client.adminTopics.update` does `PATCH /admin/topics/:id` with the input as the JSON body — so adding `visibility` to `UpdateTopicInput` and the save payload is all that's needed for persistence (backend Task 04 already accepts it).
- The `Dictionary` type is `Broaden<typeof dictPt>` (from `apps/web/src/i18n/types.ts`). **dict-pt.ts is canonical and drives the type; dict-en.ts must mirror its shape exactly** or `tsc` fails. No `types.ts` edit needed.
- The correct dict block is `admin.topics.detail` (the one nested under `admin.topics`, with `statusLabel` / `statusDraft` / `statusPublished` / `statusArchived` — dict-en ~line 280). Add the visibility keys here, NOT in the other `detail`/`form` blocks of sibling admin sections.
- `make test-web` runs `node scripts/check-i18n-coverage.js && vitest run`; the coverage script forbids hardcoded user-facing strings under `src/{app,components,hooks}/**`. All new copy MUST come from the dict.
- Visibility values are `'public' | 'restricted' | 'private'`; default to `'restricted'` when a node's value is absent.

## Implementation steps

1. **`admin-topics-api.ts`**:
   - Add `visibility: 'public' | 'restricted' | 'private';` to the `TopicNode` type.
   - Add `visibility?: 'public' | 'restricted' | 'private';` to `UpdateTopicInput` and `CreateTopicInput`.

2. **`dict-pt.ts` then `dict-en.ts`** — inside `admin.topics.detail`, add (PT canonical, EN mirrored):
   - `visibilityLabel` (e.g. PT "Visibilidade" / EN "Visibility").
   - `visibilityPublic`, `visibilityRestricted`, `visibilityPrivate` (option labels).
   - `visibilityHelp` — a single help string explaining the three levels (public = any authenticated user; restricted = requires a grant; private = admins/creators only). Keep it one entry to minimise surface. Translate fully in both languages (no empty strings).

3. **`page.tsx`**:
   - Add `const [detailVisibility, setDetailVisibility] = useState<'public' | 'restricted' | 'private'>('restricted');` near the other detail state (~line 256).
   - Sync it where the others sync: in the `selectedNode` effect, `setDetailVisibility(selectedNode.visibility ?? 'restricted')` (and reset to `'restricted'` in the no-selection branch).
   - Add `visibility: detailVisibility` to the `client.adminTopics.update(...)` payload in `handleDetailSave` (~line 481).
   - Add a new `<div>` block immediately AFTER the status select block (~line 894) mirroring its markup: a `<label htmlFor="dp-visibility">{d.detail.visibilityLabel}</label>`, a `<select id="dp-visibility" value={detailVisibility} onChange=...>` with three `<option>`s using `d.detail.visibilityPublic/Restricted/Private`, and a small help `<p>` rendering `d.detail.visibilityHelp` (reuse existing muted-text token classes used elsewhere in the form). Use the same `className` tokens as the status select for visual consistency.

4. **Test — `apps/web/src/lib/__tests__/admin-topics-api.test.ts`** (new, mirror `topics-api.test.ts`):
   - Assert `createAdminTopicsApi(http).update(id, { visibility: 'public' })` issues `PATCH /admin/topics/:id` with a JSON body containing `visibility: 'public'` (mock the `http` transport, capture the call). This covers the "update payload" acceptance.
   - A full page-render test is OPTIONAL — the page needs heavy auth/dict providers; if a minimal render is not cheap, skip it and rely on the API-client test. Do not spend effort scaffolding fragile provider mocks.

## Out of scope (do NOT touch)
- The unified Access page (Task 06) and detail-page deep-links (Task 07).
- Any backend file.
- The participant catalog UI.
- Other admin sections' dict blocks.

## Verification (run by orchestrator, not the child)
- `node apps/web/scripts/check-i18n-coverage.js` (via `make test-web` or directly).
- `pnpm -C apps/web exec tsc --noEmit` (catches dict EN/PT shape drift).
- Scoped eslint on changed files; the new api-client test via vitest.
