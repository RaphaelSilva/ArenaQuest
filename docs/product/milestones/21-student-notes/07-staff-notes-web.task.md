# Task 07 — Frontend: Staff notes surfaces — moderation actions and user backoffice section (Phase 4)

**Status:** ✅ Done
**Milestone:** [21 — Student notes — private and shared topic notes with staff moderation](./milestone.md)
**RFC:** [RFC 0016](../../RFCs/0016-student-notes.md)
**Team:** Frontend Web
**Depends On:** [Task 04](./04-staff-notes-api.task.md), [Task 06](./06-class-and-my-notes-web.task.md)

## Summary

Gives `admin` and `content_creator` their two views and their one action. In the topic's
*Class notes* tab, staff already receive every note from the API (Task 03); this task adds
a *private* / *shared* badge on each card and, for staff only, an **Unshare** action on
shared notes and **Allow sharing again** on moderated ones, each behind a confirmation and
reflecting the returned note in place. In the user backoffice
(`/admin/users/[userId]`), a new *Notes* section lists every note by that student, grouped
by topic, with the same badges and actions. Staff never see an editor, a delete button or
any control that changes another user's text. Affordances are gated with `useHasRole`, but
the API remains the authority — a student who forced the button visible would still get
`403`.

## Dependencies

- [Task 04](./04-staff-notes-api.task.md) — the per-student listing, unshare and clear
  moderation routes.
- [Task 06](./06-class-and-my-notes-web.task.md) — the note card and class list this task
  decorates.
- Existing pieces: `useHasRole` in `apps/web/src/hooks/use-auth.ts`, the user backoffice
  page.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/catalog/notes/**` — badges and staff actions on the card.
  - `apps/web/src/app/(protected)/admin/users/[userId]/page.tsx` — the *Notes* section
    mount; any new section component under `apps/web/src/components/catalog/notes/**` or
    the page's own folder.
  - `apps/web/src/lib/notes-api.ts` — the three staff calls.
  - `apps/web/src/lib/api-types.gen.ts` — regenerated, not hand-edited.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts`.
  - Component tests.
- **Both staff roles see the actions** (RFC 0016 Resolved Decisions); `tutor` and
  `student` never do.
- **Read-only for text.** No edit, no delete of another user's note anywhere in the UI.
- **i18n.** No hardcoded strings; identical keys; `check-i18n-coverage.js` passes.
- **Other backoffice sections of the user page are unchanged.**

## Scope

In:
- Visibility badge on every card for staff; *Unshare* and *Allow sharing again* with
  confirmation and in-place update.
- *Notes* section in the user backoffice with grouping, badges, actions and pagination.
- Dictionary keys; tests for role gating (admin, content creator see actions; tutor and
  student do not) and for the in-place update after each action.

Out:
- Any backend change.
- Documentation and seed — Task 08.

## Acceptance Criteria

- [x] Logged in as an admin and as a content creator, *Class notes* shows every note with a
      visibility badge; *Unshare* on a shared note turns it private and moderated in place.
- [x] *Allow sharing again* clears the moderated badge; the author can then share.
- [x] The user backoffice *Notes* section lists the student's notes, private included,
      with the same actions.
- [x] A tutor and a student see neither badges for others' private notes nor any staff
      action.
- [x] No control in the diff edits or deletes another user's note.
- [x] `check-i18n-coverage.js` passes; `pt` and `en` builds both render.
- [x] Changed files lint clean; `make test-web` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev`; as a student, share a note.
2. As a content creator, open the topic — see the badge and unshare; as the student,
   confirm the moderation banner in *My note*.
3. As an admin, open the student in the user backoffice, find the note, allow sharing
   again; as the student, share successfully.
4. As a tutor, confirm no staff affordance appears.
5. `make test-web`; run `check-i18n-coverage.js`; `make lint`.
6. `git diff --stat` confirms only guardrail files changed.
