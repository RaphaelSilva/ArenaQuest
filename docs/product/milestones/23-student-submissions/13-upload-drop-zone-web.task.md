# Task 13 — Frontend: Drop zone on the submission upload form (Phase 6)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md) — §12 web surface
**Team:** Frontend Web
**Depends On:** [Task 06](./06-mine-tab-and-upload-web.task.md), [Task 12](./12-staff-mine-tab-web.task.md)

## Summary

Product owner request (2026-10-02): the *Arquivo* field of the *Nova demonstração* form is a
bare native file input. Replace it with a **drop zone** — a bordered, clickable area that
accepts a file dragged onto it and also opens the file picker on click or keyboard
(Enter / Space), keeping the existing type/size hint below it. While a file is dragged over,
the zone shows an active state; once a file is chosen it shows the file name and size with a
way to pick another. A dropped file goes through exactly the same path as a picked one
(`preflightSubmission`, title prefill), and only the first file of a multi-file drop is used.
On a phone the zone still opens the native picker (camera / library for `.mov`). The visual
language follows the existing drop zone in `components/admin/MediaUploader.tsx` and the
`--aq-*` tokens.

## Dependencies

- [Task 06](./06-mine-tab-and-upload-web.task.md) — the upload form this task changes.
- [Task 12](./12-staff-mine-tab-web.task.md) — staff use the same form.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/catalog/submissions/UploadForm.tsx` and a new drop-zone component
    beside it under `apps/web/src/components/catalog/submissions/`.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` — new keys under `submissions:`.
  - Component tests under `apps/web/src/components/catalog/submissions/__tests__/`.
- **One code path.** Drop and pick share the same handler; no second preflight.
- **Accessible.** The zone is keyboard-focusable with a label; the native input stays in the DOM
  (visually hidden) so screen readers and mobile pickers keep working.
- **Disabled while uploading.** No drop or pick while `busy`.
- **No hardcoded strings**; `check-i18n-coverage.js` must pass. Do not fork `MediaUploader`.

## Scope

In:
- Drop zone with idle / drag-over / file-chosen / disabled states; click and keyboard open the picker.
- Tests: drop runs preflight and prefills the title; an invalid dropped file shows the preflight
  error and sends no presign; multi-file drop uses the first; disabled while busy; keyboard opens
  the picker.

Out:
- Any API change; multiple files per submission (RFC non-goal).

## Acceptance Criteria

- [x] The *Arquivo* field renders a drop zone with a call to action and the existing type/size hint.
- [x] Dropping a valid file selects it, prefills the title and shows its name and size.
- [x] Dropping an invalid file shows the same preflight error as picking it; no request is sent.
- [x] Clicking or pressing Enter/Space on the zone opens the file picker.
- [x] The zone ignores drops and clicks while an upload is in progress.
- [x] `make lint` and `make test-web` green; web `tsc --noEmit` adds no new error.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web`; `make lint`.
2. On the `m23` preview, open *Demonstrações → Minhas → Enviar demonstração*, drag a file onto
   the zone and confirm the name, size and prefilled title.
3. `git diff --stat` confirms only guardrail files changed.
