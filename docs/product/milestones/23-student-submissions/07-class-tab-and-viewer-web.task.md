# Task 07 — Frontend: Class tab, full-screen viewer and direct link (Phase 4)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md)
**Team:** Frontend Web
**Depends On:** [Task 04](./04-student-read-and-move-api.task.md), [Task 06](./06-mine-tab-and-upload-web.task.md)

## Summary

Lets a student watch what classmates posted. The **Da turma** tab of the Demonstrations page
shows the topic's shared submissions as a card grid, newest first — thumbnail or icon, title,
author name, date — with the student's own shared ones marked **Você**; it has no edit or
move actions, and it is not rendered at all when the summary reports sharing off. Tapping a
card opens the **full-screen viewer** (a modal on desktop, full screen on a phone): the player,
then title, author, date and the rendered description, with **anterior / próximo** arrows and
swipe on touch that step through the class list in order, fetching the next page of the
cursor when the end of the loaded list is reached. The viewer offers **Copiar link**. The
**direct link** route `/catalog/[id]/submissions/[sid]` opens the page with the viewer on that
submission, backed by the single-read endpoint; a reader who cannot see it gets the catalog's
not-found page, never an error revealing it exists. When a video cannot be decoded by the
browser (an HEVC `.mov` on a browser without HEVC support), the player is replaced by
*"Este vídeo não pode ser reproduzido neste navegador"* and a **Baixar** button. The same
viewer is reused by *Minhas* (replacing Task 06's simple modal) and later by staff. An empty
tab shows *"Ninguém da turma compartilhou ainda."* with a shortcut to *Minhas*.

## Dependencies

- [Task 04](./04-student-read-and-move-api.task.md) — `scope=class` and the single read.
- [Task 06](./06-mine-tab-and-upload-web.task.md) — the page shell, tabs, card and API client.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/catalog/[id]/submissions/[sid]/page.tsx` (new).
  - `apps/web/src/components/catalog/submissions/**` — class grid, viewer, navigation,
    playback fallback, copy link; the *Minhas* card switched to the shared viewer.
  - `apps/web/src/lib/submissions-api.ts` — list and single-read calls if not yet present.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — keys under `submissions:`.
  - Component tests beside the new components.
- **The fallback triggers on the media element's "source not supported" error**, not on file
  extension or user agent sniffing.
- **No autoplay with sound** when stepping to the next item.
- **The link grants nothing.** It only encodes ids; access is the API's decision.
- **Reuse `VideoStage`, `PdfStage` and the image viewer**; the fallback wraps, not forks, them.
- **No hardcoded strings**; `check-i18n-coverage.js` must pass.

## Scope

In:
- *Da turma* grid, empty state, hidden when sharing is off.
- Full-screen viewer with previous / next, swipe, cursor paging, rendered description, copy
  link, playback fallback with download.
- `[sid]` route and its not-found behaviour.
- *Minhas* cards opening the same viewer.
- Component tests for navigation across a page boundary, the fallback, the empty state, the
  `Você` marker and the not-found link.

Out:
- Move and the cross-topic page — Task 08.
- Staff tab and actions — Task 09.

## Acceptance Criteria

- [x] *Da turma* lists shared submissions with author names and marks the caller's own as
      **Você**; it is absent when sharing is off.
- [x] In the viewer, **próximo** past the last loaded item fetches the next page and shows
      its first item (component test with a mocked two-page cursor).
- [x] A `MEDIA_ERR_SRC_NOT_SUPPORTED` error replaces the player with the translated message
      and a working **Baixar** link (component test).
- [x] Opening `/catalog/[id]/submissions/[sid]` shows the viewer on that submission; a `404`
      from the API renders the catalog not-found page.
- [x] **Copiar link** copies the `[sid]` URL.
- [x] `check-i18n-coverage.js` passes; `pt` and `en` builds both render.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev`; two seeded students; student A shares two videos and a PDF on a topic.
2. As student B open *Da turma*, open the first card, step with the arrows and by swipe in
   device emulation.
3. Copy a link, open it in a fresh tab as B (viewer opens) and as a user without access to the
   topic (not-found).
4. Play an HEVC `.mov` in Firefox to see the fallback, or force the error in the component
   test.
5. `make test-web`; `make lint`.
6. `git diff --stat` confirms only guardrail files changed and nothing under `apps/api/src/`.
