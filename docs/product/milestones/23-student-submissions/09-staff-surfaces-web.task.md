# Task 09 — Frontend: Staff submission surfaces (Phase 4)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md)
**Team:** Frontend Web
**Depends On:** [Task 05](./05-staff-api-and-housekeeping.task.md), [Task 07](./07-class-tab-and-viewer-web.task.md)

## Summary

Gives `admin` and `content_creator` their view of what students send. On a topic, the
Demonstrations button reads **Demonstrações dos alunos** with the total count, and the page
shows a single **Todos** tab instead of *Minhas* / *Da turma*: every ready and removed
submission on the topic, grouped by student, with private / shared / moderated / removed
badges, opening the shared viewer from Task 07. Each shared card offers **Remover
compartilhamento** (force-unshare), each moderated one **Permitir compartilhar de novo**,
and — for `admin` only — **Remover**, behind a confirmation that says the file will be
deleted and the student will see *"Removido pela equipe"*. Removed items show who removed
them and when. Staff never see an upload button, an edit form or a move action on a student's
submission. The user backoffice page (`/admin/users/[userId]`) gains a **Demonstrações**
section listing that student's submissions grouped by topic, with the same badges and
actions.

## Dependencies

- [Task 05](./05-staff-api-and-housekeeping.task.md) — `scope=all`, the per-student list and
  the moderation / remove routes.
- [Task 07](./07-class-tab-and-viewer-web.task.md) — the viewer and card components reused
  here.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — staff label and total on the
    existing button only.
  - `apps/web/src/components/catalog/submissions/**` — *Todos* tab, grouping, staff actions,
    confirmations.
  - `apps/web/src/app/(protected)/admin/users/[userId]/page.tsx` — one *Demonstrações*
    section.
  - `apps/web/src/lib/submissions-api.ts` — staff calls.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — keys under `submissions:`.
  - Component tests beside the new components.
- **Role gating uses `useHasRole`**; the UI hides actions, the API enforces them.
- **Remove is `admin`-only** in the UI as in the API; a content creator never sees it.
- **No staff edit or move affordance** on another user's submission.
- **No hardcoded strings**; `check-i18n-coverage.js` must pass.

## Scope

In:
- Staff label on the topic button; *Todos* tab grouped by student with badges and actions.
- Unshare, allow sharing again, remove (admin) with confirmations and optimistic refresh.
- *Demonstrações* section in the user backoffice.
- Component tests: each action per role, remove hidden for content creators, removed-item
  details, no upload / edit / move controls for staff.

Out:
- Staff review, comments or grading — the next RFC.

## Acceptance Criteria

- [x] A staff user sees **Demonstrações dos alunos** with the total and a single *Todos* tab
      grouped by student.
- [x] **Remover compartilhamento** makes a shared submission private and moderated;
      **Permitir compartilhar de novo** clears it.
- [x] **Remover** appears for `admin` only, asks for confirmation, and turns the card into a
      removed item showing who and when.
- [x] No upload, edit or move control renders for staff on a student's submission.
- [x] The user backoffice shows the student's submissions grouped by topic with the same
      actions.
- [x] `check-i18n-coverage.js` passes; `pt` and `en` builds both render.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev`; a student uploads and shares submissions on a topic.
2. As a content creator open the topic's Demonstrations page: unshare one, allow it again;
   confirm **Remover** is absent.
3. As an admin remove one and confirm the removed item; log in as the student and see
   *"Removido pela equipe"*.
4. Open the student in the user backoffice and check the *Demonstrações* section.
5. `make test-web`; `make lint`.
6. `git diff --stat` confirms only guardrail files changed and nothing under `apps/api/src/`.
