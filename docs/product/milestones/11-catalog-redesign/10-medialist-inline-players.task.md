# Task 10 — `MediaList` — inline-expandable video, audio, and PDF stages (Phase 3)

**Status:** ✅ Done
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 3](../../RFCs/0004-catalog-redesign.md)

## Summary

Introduce a new `MediaList` component that replaces the current `MediaGallery` **only on the participant catalog surface**. The list renders one collapsible row per media item; activating a row expands the appropriate inline stage — a 16∶9 video stage with scrub bar, an audio stage with play + waveform + time, or a PDF stage with paper preview alongside a Download (primary) / Open (ghost) actions column. Each player kind is code-split via `next/dynamic` per RFC §"Tradeoffs & Risks". Any interaction (expand, play, scrub) fires the existing progress endpoint(s).

## Dependencies

- Task 07 (`SectionEmpty` / `SectionError` available for the empty and failure paths).
- Task 02 (dictionary keys for media empty state, Download, Open, "no media" copy, and player labels).

Independent of Task 09 — `MediaList` consumes the existing `media` array on the topic detail payload, not `mediaCount`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - New components under `apps/web/src/components/catalog/MediaList/**` (or a single `MediaList.tsx` with sibling player files at the implementer's discretion). Three player sub-components (`VideoStage`, `AudioStage`, `PdfStage`) are code-split via `next/dynamic`.
  - The catalog detail page (`/catalog/[id]/page.tsx`) to mount `MediaList` in place of `MediaGallery` and to wire the empty / error fallbacks.
  - Existing progress-client wiring (`apps/web/src/lib/*-api.ts`) only insofar as a thin "media interacted" call is added; no new API endpoint is created.
- **Do not touch `MediaGallery`.** Admin surfaces (admin media manager, admin topic detail) keep `MediaGallery`. Only the participant catalog mounts `MediaList`.
- **Code-splitting.** Each player kind is loaded via `next/dynamic` with `ssr: false` if the underlying primitive requires the DOM. The video stage uses the native `<video>` element with controls; the audio stage uses native `<audio>` with a custom progress / waveform that does **not** require a third-party waveform library (a simple progress bar with elapsed/total time is acceptable as a v1 — RFC 0004 does not pin a waveform implementation). The PDF stage uses a static preview block (no PDF.js dependency).
- **Progress trigger.** Any interaction with a media row (expand, play, scrub) calls the existing progress endpoint(s) per RFC §"UX decisions". Precise per-kind semantics are deferred to the gaming phase; this task only ensures the existing endpoint fires.
- **Responsive contract.** Video keeps 16∶9 (`aspect-ratio`). PDF stage falls to single-column below `md` (preview above, actions below). Audio waveform / progress bar uses `flex-1` and does not overflow horizontally.
- **Token reuse.** Buttons reuse the existing `.btn-primary` / `.btn-ghost` styling. No new tokens.
- **i18n.** Every label (Download, Open, play / pause, empty state, error fallback) reads from the dictionary.
- **Cloud-agnostic.** No provider SDK on the frontend; media URLs come from the existing payload.

## Scope

In:
- Implement `MediaList` as a vertical list of collapsible rows: kind icon, title, kind badge, expand affordance.
- Implement `VideoStage`, `AudioStage`, `PdfStage`, code-split via `next/dynamic`.
- Mount `MediaList` on the catalog detail page; render `SectionEmpty` when the topic has no media and `SectionError` when the media fetch fails.
- Wire each interaction (expand, play, scrub) to the existing progress endpoint(s) via the existing topics client.

Out:
- Replacing `MediaGallery` on admin surfaces.
- Adding a new backend route, a new media-progress endpoint, or per-kind thresholds (deferred to the gaming phase).
- The `mediaCount` MediaMix pills on `SubtopicCard` (Task 11).
- The discussion component (Task 11).
- Adding PDF.js or a third-party waveform library.

## Acceptance Criteria

- [x] `MediaList` mounts on the participant catalog detail page; admin surfaces continue to render `MediaGallery`.
- [x] Each row is collapsible; activating it reveals the appropriate inline stage (video / audio / PDF).
- [x] Video stage maintains 16∶9 aspect ratio with native controls. Audio stage shows play + progress + elapsed/total time. PDF stage shows a preview block and a column with Download (primary) and Open (ghost) actions; stacks to one column below `md`.
- [x] `VideoStage`, `AudioStage`, and `PdfStage` are loaded via `next/dynamic`; the catalog bundle does not include their code paths until first interaction.
- [x] Any interaction (expand, play, scrub) calls the existing progress endpoint(s). The exact call shape is whatever the current topic detail page already uses; no new endpoint is added.
- [x] When the topic has no media, `SectionEmpty` renders with the admin-motivating copy from the dictionary. When the media payload fails to resolve, `SectionError` renders in place of the section.
- [x] No hardcoded user-facing string; `check-i18n-coverage.js` passes.
- [x] No new external runtime dependency beyond what is already in the workspace.
- [x] `make lint`, `make test-web`, and `make test-api` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` + `make dev-api`. Load `/catalog/<id>` for a topic with at least one of each kind; confirm each row expands to the correct stage.
2. Use the browser DevTools Network tab and confirm the player chunks are fetched only on first interaction (code-splitting verification).
3. Verify the progress endpoint fires on first expand, first play, and on scrub (Network tab, filter by the existing progress URL).
4. Resize below `md`; confirm the PDF stage stacks preview above actions, the audio progress bar does not overflow, and the video keeps 16∶9.
5. Pick a topic with no media; confirm `SectionEmpty` renders.
6. Force the media fetch to fail (DevTools network block) and confirm `SectionError` renders in place of the section.
7. Walk an admin surface that uses `MediaGallery` and confirm it is unchanged.
8. `git diff --stat` confirms only the files listed in the scope guardrail are touched.
