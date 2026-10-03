# Task 07 — Backend: Student missions API — steps, teasers, join, leave, manual check (Phase 4)

**Status:** ✅ Done
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-mission-evaluator-domain.task.md), [Task 04](./04-schema-and-d1-adapters.task.md)

## Summary

Opens the student side. `GET /v1/me/missions` (and the missions part of `GET /v1/me/dashboard`)
returns, for active missions, three kinds of entry: missions the caller is **enrolled in** (or
implicitly enrolled in, for an `auto` mission whose gate they pass — shown with an implicit
enrollment and steps computed read-only, without writing a row), **joinable** `open` missions, and
**locked teasers** of `assigned` missions the caller is not in — title and reason only
(`locked.reason = 'assigned'` and the names of the mission's audience groups), no description,
step, target or reward (RFC Open Question 4, decided). An `auto` mission whose topic targets are
not all in the caller's effective access set is **absent** (Open Question 3, decided), and staff
are never implicitly enrolled. Each enrolled entry carries its steps: position, kind, title, XP,
state (`locked` | `open` | `completed`), current and required counts, `completedAt`, and a target
view — a topic target outside the caller's access set and an event the caller cannot see are
returned **without** id, title or slug. Legacy missions keep their single bar with `steps: []`.
New routes in `apps/api/src/routes/me/missions.ts`: `GET /v1/me/missions/{id}` (the mission page),
`POST …/join` (`open` only, inside the window; `201`, or `200` if already joined; enrollment source
`self`, `counts_from` = join time), `POST …/leave` (`self` enrollments only; sets `left_at`, keeps
completed steps and rewards; rejoining clears `left_at` and keeps the original `counts_from`), and
`POST …/requirements/{reqId}/check` for `manual_check` steps — it sets `checked_at` once and runs
the evaluator with origin `manual_check` in the same request, so the step completes, earns its XP
and records streak activity; it answers `409 MISSION_STEP_LOCKED` when a sequential predecessor is
incomplete and `409 MISSION_CLOSED` outside the window. Every miss — an `assigned` mission the
caller is not in, a mission the caller cannot see, a requirement that is not a `manual_check` step
of that mission — is `404`.

## Dependencies

- [Task 03](./03-mission-evaluator-domain.task.md) — hard code dependency: step states and the
  manual-check entry point.
- [Task 04](./04-schema-and-d1-adapters.task.md) — hard code dependency: enrollments, progress and
  audience reads.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/me-missions.controller.ts` and the missions part of
    `apps/api/src/controllers/me-dashboard.controller.ts`.
  - `apps/api/src/routes/me/gamification.ts` — the `GET /missions` handler and its response schema
    only; `apps/api/src/routes/me/missions.ts` (new) and its mount in
    `apps/api/src/routes/me/index.ts`.
  - `apps/api/src/openapi/components/entities.ts`; `apps/api/openapi.json` regenerated.
  - `apps/api/test/**` — route and controller specs.
- **Reads never write.** `GET` routes create no enrollment and no progress row.
- **Gate reuse.** Topic accessibility comes from the enrollment repository's effective access set
  and event visibility from the event repository's audience rules; neither is re-implemented or
  changed.
- **`404` on every miss**, like notes and submissions; the list teaser is the only disclosure of an
  `assigned` mission to a non-member.
- **Validation is `@hono/zod-openapi`**; controllers return `ControllerResult<T>`.
- **Additive response.** Existing `mission` and `progress` fields keep their shape so the current
  dashboard renders until Task 11 ships.

## Scope

In:
- Extended `GET /v1/me/missions` and dashboard missions; `GET /v1/me/missions/{id}`; join; leave;
  manual check.
- Specs: list composition (enrolled, joinable, teaser, absent `auto` for a gated-out student, staff
  not implicitly enrolled); target redaction; detail `404` for a non-member of an `assigned`
  mission; join inside and outside the window and on a non-`open` mission
  (`409 MISSION_NOT_JOINABLE`); late join counts only later evidence; leave and rejoin keep
  `counts_from`; leave on a non-`self` enrollment (`409 MISSION_NOT_LEAVABLE`); check completes the
  step with XP and streak, is idempotent, and answers the two `409`s; check on a non-manual step is
  `404`.

Out:
- Hooks — Task 06. The daily run — Task 08. Any web change — Tasks 11 and 12.

## Acceptance Criteria

- [x] A student not in an `assigned` mission sees it in `GET /v1/me/missions` only as an entry
      with `locked.reason = 'assigned'`, its title, group names and `steps: []`, and gets `404` on
      its detail, join and check.
- [x] An `auto` mission targeting a topic outside a student's access set is absent from their list;
      an admin's list shows no implicit enrollment in `auto` missions.
- [x] A topic target outside the caller's access set is returned with `topicId`, `title` null and
      `accessible: false`.
- [x] Joining an `open` mission mid-window returns `201`; evidence created before the join does not
      count, evidence after it does; leaving and rejoining keeps the first `counts_from`.
- [x] Ticking a `manual_check` step completes it in the same request, writes one
      `mission_step_reward` when it has XP, advances `user_streak`, and a second tick changes
      nothing; a locked sequential step answers `409 MISSION_STEP_LOCKED`.
- [x] Two `GET /v1/me/missions` calls create no row in `mission_enrollments` or
      `mission_requirement_progress`.
- [x] Changed files lint clean; `make test-api` green; `pnpm dump-openapi` leaves no diff.
- [x] No diff outside the scope guardrail.
      _Closed 2026-10-03. Authorized widening: `buildMeRouter` slice gains `events` (the call site already passes the container). Choices: controller methods take a `{ userId, roles }` caller; implicit enrollments show `current = 0` or the stored row (the evidence count covers saved enrollments only); a soft-deleted mission is `404` everywhere and `MISSION_CLOSED` means outside the window; a rejoin after Leave answers `201`; the new routes send `Cache-Control: private, no-store`; without a wired evaluator the write routes answer `500 MISSION_EVALUATOR_UNAVAILABLE`._

## Verification Plan

1. `make db-reset-local`; `make dev-api`; as admin create one `auto`, one `open` and one `assigned`
   mission (the last for a group the seeded student is not in).
2. As the student, `curl GET /v1/me/missions` and confirm the three entry kinds; join the `open`
   one; tick a manual step; read the detail.
3. `make test-api`; `make lint`; `pnpm dump-openapi`.
4. `git diff --stat` confirms only guardrail files changed.
