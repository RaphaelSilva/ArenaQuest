# Task 01 — Foundation: typography, tree helpers, and route topology cleanup (Phase 1)

**Status:** ✅ Done
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 1](../../RFCs/0004-catalog-redesign.md)

## Summary

Land the foundation that every Phase 2 task builds on: load the two missing display typefaces required by the wireframe (Space Grotesk and JetBrains Mono), introduce a small `topic-tree` helper module with `countDeep` and `buildTrail`, and collapse the catalog route topology by deleting the legacy two-segment subtopic route and migrating any internal callsite that still uses it. **No visual restyle and no dictionary work in this task** — the goal is purely to land the foundation.

## Dependencies

None. Blocks every Phase 2 task in this milestone. Task 09 (backend `mediaCount`) is independent and can land in parallel.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/layout.tsx` (font imports only).
  - A new `apps/web/src/lib/topic-tree.ts` module and a sibling `apps/web/src/lib/__tests__/topic-tree.spec.ts` (or the existing test location convention in the workspace).
  - Deletion of the directory `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/` in its entirety.
  - Any source file under `apps/web/src/**` that still references the two-segment URL — only the URL substitution; nothing else changes in the file.
- **No new runtime dependency.** Both typefaces ship through `next/font/google`, which is already used by the root layout.
- **Cloud-agnostic.** The helper module is pure TypeScript operating on `TopicNode` shapes already exported by `packages/shared`. It must not import anything from `@cloudflare/*` or any provider-specific package, must not read `process.env`, and must not depend on any DOM API.
- **No cycle protection at the view layer.** Per RFC 0004, the invariant is enforced on write; helpers may assume acyclic input.
- The helpers must operate on the **flat `TopicNode[]` list** returned by `client.topics.list()` — i.e. shape `{ id, parentId, ... }[]`. `buildTrail` walks `parentId` upward; `countDeep` walks `children` (or `parentId` mapping) downward. Implementer chooses the most ergonomic signature provided both helpers are unit-testable in isolation.

## Scope

In:
- Add `Space Grotesk` and `JetBrains Mono` to the `next/font/google` block in `apps/web/src/app/layout.tsx`, exposing them as CSS variables consumable from Tailwind/global CSS. Do not change DM Sans or any other existing font configuration.
- Create `apps/web/src/lib/topic-tree.ts` exporting `countDeep` and `buildTrail`. Document both with a one-line TSDoc comment that states the precondition (acyclic input) and the return shape.
- Add unit tests covering: `buildTrail` for root, leaf at depth N, leaf with a missing intermediate parent (safe fallback to whatever partial trail is recoverable, with no thrown exception); `countDeep` for an empty subtree, a one-level subtree, and a multi-level subtree.
- Delete `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/` and every file beneath it.
- Replace any `<Link href={\`/catalog/${id}/${subId}\`}>` (or `router.push` / string-template equivalent) with `<Link href={\`/catalog/${subId}\`}>`. The change is a pure URL substitution; no surrounding markup, no props, and no component import is altered.

Out:
- Restyling the sidebar, header, breadcrumb, or subtopic card (Tasks 03 – 06).
- Dictionary additions (Task 02).
- Removing the instructor-preview toggle (Task 02).
- Mounting the helpers in any page component (deferred to the Phase 2 tasks that consume them).
- Backend changes (Task 09).

## Acceptance Criteria

- [x] `apps/web/src/app/layout.tsx` imports `Space_Grotesk` and `JetBrains_Mono` from `next/font/google` and exposes both as CSS variables alongside the existing `DM_Sans` configuration. No other line in the file changes.
- [x] `apps/web/src/lib/topic-tree.ts` exports `countDeep` and `buildTrail`; both are typed against the `TopicNode` shape from `packages/shared` and accept the flat list already loaded by the sidebar layout.
- [x] Unit tests for `countDeep` and `buildTrail` cover the cases listed under "Scope" and pass green under `make test-web`.
- [x] `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/` does not exist after this PR.
- [x] `grep -RE "catalog/[^/\"\\s]+/[^/\"\\s]+" apps/web/src` returns no matches in TypeScript/TSX source files. (The grep may legitimately match documentation; only source code is required to be clean.)
- [x] `make lint`, `make test-web`, and `make test-api` pass green.
- [x] No diff outside the scope guardrail. In particular, no component visual change ships in this PR.

## Verification Plan

1. Run `make test-web` and confirm the new helper tests pass.
2. Run `make build-web`; confirm the build succeeds and Next.js reports the two new fonts as loaded.
3. With `make dev-web` running, navigate to `/catalog/<any-leaf-id>` and confirm the page renders (Task 02+ will restyle it; this task only verifies the route still resolves with the legacy two-segment route removed).
4. Attempt to load a legacy URL of the form `/catalog/<id>/<subId>` and confirm Next.js responds with a 404 (the segment no longer exists).
5. Run `git diff --stat` and confirm only the files listed in the scope guardrail are touched.
