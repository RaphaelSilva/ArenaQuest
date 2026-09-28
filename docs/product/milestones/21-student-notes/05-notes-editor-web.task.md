# Task 05 — Frontend: Topic notes panel — editor, autosave and conflict handling (Phase 4)

**Status:** ✅ Done
**Milestone:** [21 — Student notes — private and shared topic notes with staff moderation](./milestone.md)
**RFC:** [RFC 0016](../../RFCs/0016-student-notes.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-student-notes-api.task.md)

## Summary

Puts a **Notes** panel on the topic page, beside Discussion, with two tabs: *My note*,
delivered here, and *Class notes*, whose content Task 06 fills. *My note* is a Markdown
editor with a preview (rendered through the catalog's existing sanitised Markdown viewer),
a character counter against `NOTE_BODY_MAX`, and a **debounced autosave** (~2 s after
typing stops) that sends the body with the `revision` the tab last received and keeps the
new one from each response. A save-state indicator shows *saving*, *saved* or *not saved*.
A private/shared switch sits under the editor with the audience line — *private: only you
and the staff (admins and content creators) can read it* — and switching to shared asks a
one-line confirmation that classmates will see the note with the author's name. When the
API answers `409 NOTE_STALE`, autosave **pauses** and a banner says the note changed in
another window, offering **Load latest** (replace the editor with `meta.current` and copy
the unsaved text to the clipboard) or **Keep mine** (re-send on the current revision); when
`meta.current` is `null` (deleted elsewhere) it offers **Recreate** or **Discard**. A
moderated note shows *the staff made this note private* and disables the shared switch.
Delete asks for confirmation. Staff never see this editor on someone else's note — the
panel only ever edits the caller's own note.

## Dependencies

- [Task 03](./03-student-notes-api.task.md) — the `/v1/topics/{id}/notes/me` contract,
  including `409 NOTE_STALE` / `NOTE_MODERATED`, and the regenerated `openapi.json`.
- Existing pieces extended: `apps/web/src/lib/fetch-with-auth.ts`,
  `apps/web/src/components/catalog/MarkdownViewer.tsx`, the topic page
  `apps/web/src/app/(protected)/catalog/[id]/page.tsx`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/catalog/notes/**` (new) — the panel, tabs shell, editor,
    save-state indicator, conflict and moderation banners.
  - `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — mounting the panel only.
  - `apps/web/src/lib/notes-api.ts` (new) — the student note calls; no endpoint invented.
  - `apps/web/src/lib/api-types.gen.ts` — regenerated with `pnpm gen:api-types`, not
    hand-edited.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — a new `notes:` section.
  - Component tests beside the new components.
- **Client only where needed.** The panel is a client component (autosave and conflict
  state); the topic page stays a Server Component if it is one today.
- **Never overwrite silently.** On `409` the editor stops autosaving until the student
  chooses; *Keep mine* is the only path that re-sends over a newer revision, and it sends
  that newer revision explicitly.
- **The limit comes from `@arenaquest/shared`** (`NOTE_BODY_MAX`), never a local literal.
- **i18n.** No hardcoded user-facing strings; identical keys in both dictionaries;
  `check-i18n-coverage.js` passes.
- **`Discussion.tsx` and the comments client are untouched.**
- **No rating or XP UI.**
- **Responsive & accessible.** Tabs and switch are keyboard-operable with labelled
  controls; the banner is announced (live region).

## Scope

In:
- `notes-api.ts` with get / save / delete for the caller's note, surfacing `409` outcomes
  as typed results.
- The Notes panel with *My note* and an empty *Class notes* tab placeholder for Task 06.
- Editor, preview, counter, debounced autosave, save-state indicator.
- Visibility switch with audience line and share confirmation; moderated state.
- Conflict banner: *Load latest* / *Keep mine*; deleted-elsewhere: *Recreate* / *Discard*.
- Delete with confirmation.
- Dictionary keys in `pt` and `en`.
- Component tests: autosave sends the held revision; a `409` pauses autosave and shows the
  banner; *Load latest* replaces the text and holds the new revision; *Keep mine* re-sends
  on the new revision; moderated note disables sharing.

Out:
- The class notes list and "My notes" page — Task 06.
- Staff badges and moderation actions — Task 07.
- Any backend change.

## Acceptance Criteria

- [x] Typing in the editor and pausing ~2 s sends one save carrying the held `revision`;
      the indicator goes *saving* → *saved*.
- [x] Simulating two tabs (two editor instances on the same note), the second tab's save
      shows the conflict banner and sends nothing further until the student chooses;
      neither text is lost without pressing **Keep mine**.
- [x] **Load latest** replaces the editor content with the server's note and places the
      unsaved text on the clipboard.
- [x] The private/shared switch shows the audience line naming staff; switching to shared
      requires confirmation; a moderated note shows the moderation banner and a disabled
      switch.
- [x] The counter and the save guard use `NOTE_BODY_MAX` from `@arenaquest/shared`.
- [x] `check-i18n-coverage.js` passes; `pt` and `en` builds both render the panel.
- [x] `Discussion.tsx` and `comments-api.ts` are unchanged.
- [x] Changed files lint clean; `make test-web` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev`; log in as a seeded student and open a published topic.
2. Write a note, wait for *saved*, reload — the note is there.
3. Open the same topic in a second tab, edit in both, and confirm the second save shows the
   conflict banner; exercise *Load latest* and *Keep mine*.
4. Delete the note in one tab and save in the other — confirm *Recreate* / *Discard*.
5. Switch to shared and confirm the dialog and the audience line.
6. `make test-web`; run `check-i18n-coverage.js`; build with `NEXT_PUBLIC_LANGUAGE=en`.
7. `make lint`.
8. `git diff --stat` confirms only guardrail files changed.
