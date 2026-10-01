# Task 12 — Frontend: *Minhas* tab and upload for staff (Phase 6)

**Status:** 📝 Open
**Milestone:** [23 — Student submissions](./milestone.md)
**RFC:** [RFC 0020](../../RFCs/0020-student-submissions.md) — §7 as amended on 2026-10-01 ("Staff also upload")
**Team:** Frontend Web
**Depends On:** [Task 11](./11-staff-upload-api.task.md), [Task 09](./09-staff-surfaces-web.task.md)

## Summary

Staff now post demonstrations too (Task 11). On the Demonstrations page an `admin` or
`content_creator` sees two tabs: **Minhas** — only what they uploaded, with the same
**Enviar demonstração** button, quota line, upload form, edit, share, move and delete a student
has — and **Todos**, the moderation view from Task 09 (every submission on the topic grouped by
student, with unshare / allow sharing again / admin-only remove). *Todos* stays the default tab
for staff so the moderation view is not hidden; the *Da turma* tab stays student-only, since
*Todos* already holds everything shared. The *Minhas demonstrações* nav entry and the
`/submissions` page are shown to staff as well, listing their own uploads. Staff still get no
edit / move control on a submission someone else authored.

## Dependencies

- [Task 11](./11-staff-upload-api.task.md) — the API now accepts staff uploads and moves.
- [Task 09](./09-staff-surfaces-web.task.md) — the *Todos* tab and staff actions it keeps.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/catalog/submissions/**` — `tabsFor`, the page's upload gating,
    and any card logic that assumed staff never author.
  - `apps/web/src/components/layout/nav.tsx` — show *Minhas demonstrações* to staff too.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` — only if a label must change.
  - Component tests beside the changed components (and `layout/__tests__/nav.test.tsx`).
- **Role gating uses `useHasRole`**; the API enforces every rule.
- **No hardcoded strings**; `check-i18n-coverage.js` must pass.

## Scope

In:
- Staff tabs `['all', 'mine']` (default `all`), upload button and quota line on *Minhas*.
- Author actions on a staff user's own cards; moderation actions only on *Todos*.
- Nav entry and `/submissions` for staff.
- Tests: staff see both tabs and the upload button on *Minhas*; *Minhas* lists only their own;
  *Todos* unchanged; students unchanged; nav entry for staff.

Out:
- Any API change — Task 11.

## Acceptance Criteria

- [ ] An `admin` and a `content_creator` see *Todos* and *Minhas* on the Demonstrations page;
      *Minhas* shows only their own uploads and the **Enviar demonstração** button.
- [ ] A staff user can upload, edit, share, move and delete their own demonstration from
      *Minhas*.
- [ ] *Todos* still lists every submission grouped by student with the Task 09 actions; no edit
      or move control appears on another user's submission.
- [ ] Students see exactly what they saw before (*Minhas* / *Da turma*).
- [ ] The *Minhas demonstrações* nav entry is shown to staff and students.
- [ ] `make lint` and `make test-web` green; web `tsc --noEmit` adds no new error.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web`; `make lint`.
2. `make dev` (API from this worktree); as `admin@arenaquest.dev` open
   `/catalog/00000000-0000-4000-8000-0000000023a1/submissions`, switch to *Minhas*, and confirm
   the upload button; as `student@arenaquest.dev` confirm the page is unchanged.
3. `git diff --stat` confirms only guardrail files changed and nothing under `apps/api` is touched.
