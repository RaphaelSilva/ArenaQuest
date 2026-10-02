# Task 06 — Frontend: Class notes list and My notes page (Phase 4)

**Status:** ✅ Done
**Milestone:** [21 — Student notes — private and shared topic notes with staff moderation](./milestone.md)
**RFC:** [RFC 0016](../../RFCs/0016-student-notes.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-student-notes-api.task.md), [Task 05](./05-notes-editor-web.task.md)

## Summary

Fills the two read surfaces a student uses. The *Class notes* tab of the panel mounted by
Task 05 lists the topic's shared notes — newest first, twenty at a time with a *load more*
driven by the API's `nextCursor` — each rendered through the catalog's sanitised Markdown
viewer with the author's name and the date it was shared; the caller's own shared note
carries a *yours* marker, and an empty state invites the student to share theirs. A new
**"My notes"** page at `/notes`, reachable from one entry in the main navigation, lists
every note the student wrote across topics, grouped by topic, each with a visibility badge,
a moderation badge when applicable, the last edit time and a link back to the topic; a
note on a topic the student can no longer read is shown read-only with the reason. Both
surfaces are read-only views — editing stays in the *My note* tab.

## Dependencies

- [Task 03](./03-student-notes-api.task.md) — `GET /v1/topics/{id}/notes` and
  `GET /v1/me/notes`.
- [Task 05](./05-notes-editor-web.task.md) — the panel, tabs shell, `notes-api.ts` and the
  `notes:` dictionary section this task extends.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/catalog/notes/**` — the class list and the note card.
  - `apps/web/src/app/(protected)/notes/**` (new) — the "My notes" page.
  - `apps/web/src/components/layout/nav.tsx` — one "My notes" entry, plus its test.
  - `apps/web/src/lib/notes-api.ts` — the two list calls.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts`.
  - Component and page tests.
- **Rendering is sanitised.** Note bodies go through the existing `MarkdownViewer`; no
  `dangerouslySetInnerHTML` outside it.
- **The client never filters privacy.** The list shows what the API returns; no
  client-side rule decides who may see a note.
- **No sort control, no rating, no score** — the list is newest-first only.
- **i18n.** No hardcoded strings; identical keys; `check-i18n-coverage.js` passes.
- **Responsive & accessible.** Cards are readable on mobile; *load more* is a button.

## Scope

In:
- *Class notes* tab: list, note card (author, shared date, *yours* marker), pagination,
  empty state.
- `/notes` page: grouped list, visibility and moderation badges, last edit, link to topic,
  read-only explanation for inaccessible topics, empty state.
- Navigation entry.
- Dictionary keys; tests for list rendering, pagination, empty states and read-only rows.

Out:
- Staff badges and moderation actions — Task 07.
- Any backend change.

## Acceptance Criteria

- [x] The *Class notes* tab shows the topic's shared notes newest first with author and
      date, marks the caller's own, and loads the next page from `nextCursor`.
- [x] `/notes` lists every note of the caller grouped by topic with visibility, moderation
      badge, last edit and a working link to the topic.
- [x] A note on an inaccessible topic is displayed read-only with the explanation.
- [x] A note body containing a `<script>` renders inert.
- [x] The navigation shows "My notes" for authenticated users.
- [x] `check-i18n-coverage.js` passes; `pt` and `en` builds both render.
- [x] Changed files lint clean; `make test-web` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev`; with two seeded students, share a note as one and open the topic as the
   other — confirm it appears in *Class notes*; confirm a private note does not.
2. Open `/notes` and confirm grouping, badges and links.
3. Remove the student's access to a topic (backoffice) and confirm the read-only row.
4. `make test-web`; run `check-i18n-coverage.js`; `make lint`.
5. `git diff --stat` confirms only guardrail files changed.
