# Task 06 — Frontend: Demonstrations page — Mine tab and upload (Phase 4)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-student-upload-api.task.md)

## Summary

Delivers the path from the topic to a finished upload. The topic page
(`/catalog/[id]`) gains a **Demonstrações** button whose label carries the counts from the
summary endpoint — *"2 minhas · 8 da turma"*, the class count omitted when sharing is off —
and nothing else of the feature. It opens the new **Demonstrations page**
(`/catalog/[id]/submissions`), whose shell this task builds: breadcrumb back to the topic,
the tab bar driven by `?tab=` (*Minhas* is live here; *Da turma* and staff *Todos* are
placeholders that Tasks 07 and 09 fill), and the quota line (*"3 de 10 neste tópico · 420 MB
de 1 GB"*). On *Minhas*, **Enviar demonstração** (sticky at the bottom on a phone) opens the
upload form: file input accepting `SUBMISSION_MEDIA_TYPES` plus `.mov` — so an iPhone offers
camera or library — title prefilled from the file name, description with a character counter,
and the private/shared switch with its audience line (hidden when sharing is off). Type, size
and remaining quota are checked **in the browser against the summary** before any request.
The upload shows a progress bar driven by the PUT's upload progress, with **Cancel** (abort,
then delete the pending row); an interrupted upload appears as *Envio interrompido* with
**Descartar**. The list shows the student's cards newest first — thumbnail or icon, title,
excerpt, date, size, visibility and moderation badges — opening the existing viewers in a
modal, with **Editar** and **Excluir**; tombstones render *"Removido pela equipe"* with only
**Dispensar**. API errors (`409` quota / moderated / sharing disabled, `422`, `429`) map to
translated messages.

## Dependencies

- [Task 03](./03-student-upload-api.task.md) — presign, finalize, edit, delete and summary.
- [Task 04](./04-student-read-and-move-api.task.md) — soft: the *Minhas* list reads
  `scope=mine`; until it lands, develop against a mock of that contract.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — the Demonstrations button only.
  - `apps/web/src/app/(protected)/catalog/[id]/submissions/page.tsx` (new).
  - `apps/web/src/components/catalog/submissions/**` (new) — page shell, tabs, quota line,
    upload form, progress, card, edit dialog, tombstone.
  - `apps/web/src/lib/submissions-api.ts` (new) and its registration in
    `apps/web/src/lib/api-client.ts`.
  - `apps/web/src/lib/api-types.gen.ts` — regenerated with `pnpm gen:api-types`.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — a `submissions:` section with
    identical keys.
  - Component tests beside the new components.
- **Limits come from the API.** No quota, size or sharing value is hardcoded; the type list
  comes from `SUBMISSION_MEDIA_TYPES` in `packages/shared`.
- **The PUT uses `XMLHttpRequest`** for upload progress and abort; JSON calls go through the
  existing `fetchWithAuth` client.
- **No hardcoded strings** in `src/{app,components,hooks}/**`; `check-i18n-coverage.js` must
  pass.
- **The topic page stays light** — one button, no list or preview of submissions.
- **Reuse the existing viewers** (`MediaList/VideoStage`, `PdfStage`, `MediaViewers/*`); do
  not fork them.

## Scope

In:
- Topic-page button with counts; page shell with `?tab=`; *Minhas* tab.
- Upload form with client preflight, progress, cancel, interrupted-upload rows.
- Cards, viewer modal, edit (title, description, visibility with audience line and share
  confirmation), delete, tombstone with dismiss.
- Error mapping and both dictionaries.
- Component tests for preflight rejection, cancel, interrupted upload, share confirmation,
  sharing-off rendering and tombstone.

Out:
- *Da turma* tab, the full-screen viewer with navigation and the direct link — Task 07.
- Move and the cross-topic page — Task 08.
- Staff surfaces — Task 09.

## Acceptance Criteria

- [x] The topic page shows the Demonstrations button with both counts, and only the own count
      when the summary reports sharing off.
- [x] Selecting a file over its limit, or when the topic quota is full, shows the limit in a
      translated message and sends **no** presign request (asserted on the mocked client).
- [x] A successful upload shows progress, then the new card at the top of *Minhas*; **Cancel**
      aborts the PUT and deletes the pending row.
- [x] Edit changes title, description and visibility; sharing asks for confirmation naming
      that classmates will see the author's name; the switch is absent when sharing is off.
- [x] A tombstone renders *"Removido pela equipe"* with only **Dispensar**.
- [x] `check-i18n-coverage.js` passes; `pt` and `en` builds both render the page.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev`; log in as a seeded student and open a topic.
2. Tap **Demonstrações**, upload a `.mov` from a phone (or a desktop browser with device
   emulation) and watch the progress bar; reload and see the card.
3. Try a file over the limit and confirm the refusal happens before any network request.
4. Edit the title and share it; delete another card; cancel an upload mid-way.
5. `make test-web`; `make lint`; `NEXT_PUBLIC_LANGUAGE=en make dev-web` for the English build.
6. `git diff --stat` confirms only guardrail files changed and nothing under `apps/api/src/`.
