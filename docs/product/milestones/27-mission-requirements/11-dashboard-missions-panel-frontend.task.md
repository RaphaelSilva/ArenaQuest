# Task 11 — Frontend: Dashboard missions panel — My missions, Available, Locked, Join (Phase 6)

**Status:** ✅ Done
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Frontend Web
**Depends On:** [Task 07](./07-student-missions-api.task.md)

## Summary

Turns the dashboard's single bar per mission into a participation panel. `MissionsList` renders the
extended entries of `GET /v1/me/dashboard` in three groups. **My missions**: each enrolled mission
with its window ("ends Oct 31"), the aggregate bar, the mission XP and badge, and a compact **step
list** — a check, a lock or a `current/required` counter per step, the step title, the step XP, and
the target as a link when the student can open it (`/catalog/{topicId}` for visits and videos,
`/catalog/{topicId}/submissions` for demonstrations, `/events/{slug}` for events); a target the
student cannot open is shown without a link and without its title; sequential missions number their
steps and show later ones locked; a completed mission stays listed with a *Completed* state until its
window ends. **Available**: `open` missions the student has not joined, with **Join** — a
confirmation states that only activity from now on counts — calling
`POST /v1/me/missions/{id}/join` and moving the card to *My missions*. **Locked**: teasers of
`assigned` missions the student is not in — title, a lock icon and the reason (*"For the Black Belt
group"*), nothing else, no link. Each card in *My missions* links to the mission page (Task 12).
Legacy missions keep their single bar. Empty states cover each group.

## Dependencies

- [Task 07](./07-student-missions-api.task.md) — hard code dependency: the extended entries, join
  route and teaser shape.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/dashboard/MissionsList.tsx` and its mount in
    `apps/web/src/components/dashboard/DashboardContent.tsx`; tests in
    `apps/web/src/components/dashboard/__tests__/`.
  - `apps/web/src/components/missions/**` — shared step-list and step-chip components (also used by
    Task 12).
  - `apps/web/src/lib/dashboard-api.ts` — adapting `steps`, `enrollment`, `joinable`, `locked`;
    `apps/web/src/lib/missions-api.ts` (new) — join; its registration in
    `apps/web/src/lib/api-client.ts`; `apps/web/src/lib/api-types.gen.ts` regenerated.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — a new `missions:` section and the
    `dashboard.missions` keys.
- **The server decides visibility.** The panel renders what the API returns; it never infers access
  or step state on the client.
- **Join is confirmed** and optimistic only after a `2xx`; a `409` shows its translated reason.
- **No hardcoded strings**; dates through the existing locale helpers; `check-i18n-coverage.js`
  passes.
- **Consumes the API contract as is**: no API source file changes in this task.

## Scope

In:
- Three groups with their empty states; step list; target links and redaction; *Join* with
  confirmation; legacy rendering; dictionaries.
- Component tests: group split from a mocked payload; sequential numbering with locked steps; a
  redacted target renders without link or title; *Join* confirmation then move to *My missions*; a
  `409 MISSION_CLOSED` message; teaser renders title and group only; legacy bar.

Out:
- The mission page, manual check and leave — Task 12.

## Acceptance Criteria

- [x] With a mocked dashboard payload, enrolled, joinable and teaser entries render under *My
      missions*, *Available* and *Locked* respectively.
- [x] A sequential mission shows numbered steps with later steps locked; a completed step shows a
      check and its XP.
- [x] A target with `accessible: false` renders no link and no title.
- [x] Clicking *Join* asks for confirmation, calls the join route once, and the card moves to *My
      missions*; a mocked `409 MISSION_CLOSED` shows its translated message.
- [x] A teaser shows only the title and the group reason, with no link.
- [x] `check-i18n-coverage.js` passes; `pt` and `en` builds both render the panel.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.
      _Closed 2026-10-03. Choices: inline confirmation inside the card (the `StaffNoteActions` pattern) instead of a modal; the badge appears as a "+ badge" hint because the payload carries only `badgeId`; Available cards do not link to the mission page; dates use dictionary month names over the `YYYY-MM-DD` prefix (UTC calendar day), replacing the previous `toLocaleDateString`. `DashboardContent.tsx` needed no change. **Not run:** browser walkthrough and PT/EN render check — covered by the Playwright smoke scheduled before the candidate PR._

## Verification Plan

1. `make dev`; as admin create an `auto`, an `open` and an `assigned` mission (for a group the
   student is not in); log in as the seeded student and open `/dashboard`.
2. Join the `open` mission; upload a demonstration on its topic and watch the step counter move.
3. `make test-web`; `make lint`.
4. `git diff --stat` confirms only guardrail files changed and nothing under `apps/api/src/`.
