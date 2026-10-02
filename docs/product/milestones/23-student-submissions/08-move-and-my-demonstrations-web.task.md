# Task 08 — Frontend: Move dialog and My demonstrations page (Phase 4)

**Status:** ✅ Done
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md)
**Team:** Frontend Web
**Depends On:** [Task 04](./04-student-read-and-move-api.task.md), [Task 06](./06-mine-tab-and-upload-web.task.md)

## Summary

Lets a student reorganise what they sent. Every card on *Minhas* gains **Mover para outro
tópico**, and a **Selecionar** mode lets the student pick up to 10 cards and move them at
once. The **move dialog** shows a topic picker over the topics the student can read (the
catalog tree the app already loads), marks each target with its free slots from the summary
endpoint, and states plainly that moved demonstrations become **private** and must be shared
again on the new topic. After the call it reports what moved and what was refused, each
refusal with a translated reason (no room on the target, not ready, already there, not
found), and refreshes both the list and the counts. A new **Minhas demonstrações** page
(`/submissions`), reached from one new entry in the main navigation, lists every submission
the student owns across topics, grouped by topic with a link to each topic's Demonstrations
page, using the same cards and actions — move included. Rows on a topic the student can no
longer read explain why they are read-only and still offer delete and move, which is how a
student rescues them.

## Dependencies

- [Task 04](./04-student-read-and-move-api.task.md) — `/v1/me/submissions` and the move
  endpoint.
- [Task 06](./06-mine-tab-and-upload-web.task.md) — the card, page shell and API client.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/submissions/page.tsx` (new).
  - `apps/web/src/components/catalog/submissions/**` — move dialog, topic picker, select
    mode, grouped list.
  - `apps/web/src/components/layout/nav.tsx` — one "Minhas demonstrações" entry.
  - `apps/web/src/lib/submissions-api.ts` — `me` list and move calls.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — keys under `submissions:`.
  - Component tests beside the new components.
- **Selection is capped at 10** in the UI, matching the API.
- **The picker only offers readable topics**; the source topic is excluded.
- **Partial success is normal** — the dialog never presents a partial result as an error.
- **No hardcoded strings**; `check-i18n-coverage.js` must pass.

## Scope

In:
- Move action on a card, select mode, move dialog with free slots and the private warning,
  result report.
- `/submissions` page grouped by topic, lost-access explanation, nav entry.
- Component tests: single move, multi-move with one refusal, select cap, lost-access row.

Out:
- *Da turma* and the viewer — Task 07.
- Staff surfaces — Task 09.

## Acceptance Criteria

- [x] Moving one card to another readable topic removes it from this topic's *Minhas*, shows
      it on the target as private, and updates both counts.
- [x] Selecting 3 cards for a target with 2 free slots reports 2 moved and 1 refused with the
      "no room" reason (component test with a mocked response).
- [x] The selection cannot exceed 10 items; the picker never lists the current topic or an
      unreadable one.
- [x] `/submissions` lists all the student's submissions grouped by topic; a row on a topic
      they lost shows the read-only explanation and still offers delete and move.
- [x] The nav shows "Minhas demonstrações" for students.
- [x] `check-i18n-coverage.js` passes; `pt` and `en` builds both render.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev`; a seeded student with submissions on two topics.
2. Move one card; then select three and move them into a nearly full topic; read the report.
3. Open **Minhas demonstrações** from the nav and follow a topic link back.
4. Remove the student's access to one topic in the backoffice and confirm the row turns
   read-only but can still be moved.
5. `make test-web`; `make lint`.
6. `git diff --stat` confirms only guardrail files changed and nothing under `apps/api/src/`.
