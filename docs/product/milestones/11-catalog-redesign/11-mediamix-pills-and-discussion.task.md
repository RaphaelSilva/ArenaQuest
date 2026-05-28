# Task 11 — MediaMix pills on `SubtopicCard` and `Discussion` thread component (Phase 3)

**Status:** ⏳ Planned
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 3](../../RFCs/0004-catalog-redesign.md)

## Summary

Wire the two surfaces that close out the wireframe: the MediaMix pills on `SubtopicCard` (`🎥 N · 🎧 N · 📄 N`) now that the backend exposes `mediaCount` (Task 09), and a new `Discussion` component that renders comments + an inline composer, wired to the existing `GET / POST /topics/:id/comments` endpoints. Likes and threaded replies are explicitly out of scope and are not exposed in the UI.

## Dependencies

- Task 06 (`SubtopicCard` already in its final visual shape).
- Task 09 (backend `mediaCount` field available in `TopicNode`).
- Task 07 (`SectionEmpty` / `SectionError` available for the discussion empty and failure paths).
- Task 02 (dictionary keys for the pills, the composer, the publish action, the empty-state nudge, and the error fallback).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/catalog/SubtopicCard.tsx` — render the MediaMix pills using `subtopic.mediaCount`. Drop any "optional placeholder" left from Task 06.
  - A new `apps/web/src/components/catalog/Discussion.tsx` (and any sibling sub-component it owns exclusively).
  - The catalog detail page (`/catalog/[id]/page.tsx`) — mount `Discussion` below the media section, hide it at the root, and wire empty/error fallbacks.
  - The existing comments client (`apps/web/src/lib/*-api.ts`) only if a thin helper is needed; no new backend route is added.
- **No likes or replies in the UI.** The `Discussion` component renders the list and the composer; it does **not** render like buttons, reply buttons, or nested reply trees. The wireframe leaves a clean spot for those, but they wait for a separate RFC.
- **Discussion hidden at root.** When the current node is a root topic, the discussion section does not mount (per RFC §"Component-by-component changes").
- **Composer behaviour.** The publish button (`Publicar` / EN equivalent) auto-reveals when the textarea has non-empty content and disappears when empty. Submitting calls `POST /topics/:id/comments`. On success, the new comment is appended to the list (optimistic update is allowed but not required — refetch is also acceptable). On failure, the composer surfaces the generic error fallback inline; no global toast.
- **MediaMix pills.** Render only kinds with non-zero counts. Render the "deep" pill alongside (already wired in Task 06). When `mediaCount.total === 0`, no kind pill renders.
- **Token reuse.** Pills, comment cards, composer surface, and publish button use existing `--aq-*` variables and the existing `.btn-primary` class. No new tokens.
- **i18n.** Every label and placeholder reads from the dictionary; `check-i18n-coverage.js` passes.
- **Cloud-agnostic.** No provider SDK; existing comments client already abstracts the backend.

## Scope

In:
- Render the MediaMix pills on `SubtopicCard`, consuming `subtopic.mediaCount`. Kinds with zero counts are omitted; the "deep" pill still renders when applicable.
- Implement `Discussion`: header label, composer textarea with auto-revealing publish button, comment list with avatar + name + time + optional badge + body. No like, no reply.
- Mount `Discussion` on `/catalog/[id]` below the media section; do **not** mount it at the root.
- Wire empty state (`SectionEmpty`) when the topic has no comments (admin-motivating nudge for the first comment), and `SectionError` when the comments fetch fails.

Out:
- Likes (`POST /comments/:id/like`).
- Replies (`POST /comments/:id/replies`) and any nested-reply rendering.
- Adding XP balance UI tied to the existing `xpEngine.award` side-effect on `POST /topics/:id/comments` (the side-effect stays as-is; no new UI is built around it).
- Telemetry / analytics on comment publish.

## Acceptance Criteria

- [ ] `SubtopicCard` renders one pill per non-zero media kind (video / audio / PDF) from `subtopic.mediaCount`, alongside the "deep" pill from Task 06. When `mediaCount.total === 0`, no kind pill renders.
- [ ] `Discussion` reads the comment list via the existing `GET /topics/:id/comments` and posts new comments via `POST /topics/:id/comments`.
- [ ] The composer shows the publish button only when the textarea has non-empty content; submitting clears the input and the new comment appears in the list (optimistic update or refetch).
- [ ] No like or reply affordance is rendered anywhere in `Discussion`.
- [ ] `Discussion` does not mount at the root of the catalog (no `parentId`).
- [ ] Empty state and error fallback for the discussion section read from the dictionary via `SectionEmpty` / `SectionError`.
- [ ] No hardcoded user-facing string; `check-i18n-coverage.js` passes.
- [ ] `make lint`, `make test-web`, and `make test-api` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` + `make dev-api`. Load `/catalog/<id>` for a topic with mixed-kind subtopics; confirm the MediaMix pills render per child and the "deep" pill still appears where applicable.
2. Pick a subtopic whose `mediaCount` is all zeros; confirm no kind pill renders.
3. Load `/catalog/<root-id>`; confirm `Discussion` does not mount.
4. Load a non-root topic; confirm the discussion section renders. Type into the composer; confirm the publish button appears. Submit; confirm the new comment appears in the list.
5. Pick a topic with zero comments; confirm `SectionEmpty` renders the nudge copy.
6. Force the comments fetch to fail (DevTools network block) and confirm `SectionError` renders in place of the section.
7. Inspect the rendered DOM for any like / reply affordance; confirm none exists.
8. `git diff --stat` confirms only the files listed in the scope guardrail are touched.
