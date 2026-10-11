# Task 06 — Backend: Mission hooks at the evidence write sites (Phase 4)

**Status:** ✅ Done
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-mission-evaluator-domain.task.md), [Task 04](./04-schema-and-d1-adapters.task.md)

## Summary

Wires the evaluator into the writes that produce evidence, so a step closes **in the same request**
that produced its last qualifying item. A small runner in `apps/api/src/core/missions/hook.ts`
takes the container and a typed signal, calls the evaluator with origin `hook`, and wraps
everything in a `try/catch` that only logs (mission, requirement and user ids, never descriptions or
file names) — the same best-effort pattern as today's `questEvaluator.evaluate` calls. One call is
added **after the existing write succeeded** at each site of RFC 0022 §3.2: submission finalize
(`POST /v1/topics/{id}/submissions/{sid}/finalize`), submission edit when the description or the
visibility changed (`PATCH …/{sid}`), author delete (`DELETE …/{sid}`), move
(`POST /v1/me/submissions/move`, signalling the source and target topics), staff unshare, clear
moderation and remove (`/v1/admin/submissions/{id}/unshare`, `…/moderation`, `DELETE …/{id}`,
signalling the **author**), topic visit (`POST /v1/me/topics/{id}/visit`, on **every** successful
call, not only when the status changed, because a repeat visit inside the window is new evidence),
video watched (`POST /v1/topics/{id}/videos/{videoId}/watched`), and the event-charge writes
(`POST /v1/admin/billing/charges/{id}/payments`, `…/adjustments`, `…/void` and
`POST /v1/admin/billing/charge-payments/{id}/reverse`, signalling the charge's user and event).
When the evaluation closes a step, the same hook site records one **streak activity**; when it
closes a mission, the hook also runs the existing `badgeEngine.evaluate` for the
`mission_completed` rule, as the other hooks do. A hook failure never changes the originating
response; Task 08's reconciliation repairs what it missed.

## Dependencies

- [Task 03](./03-mission-evaluator-domain.task.md) — hard code dependency: the evaluator.
- [Task 04](./04-schema-and-d1-adapters.task.md) — hard code dependency: the adapters and the
  `missionEvaluator` wiring they enable.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/core/missions/hook.ts` (new).
  - `apps/api/src/container.ts` — `missionEvaluator` in the `gamification` group.
  - **One hook call per handler, after the existing write**, in
    `apps/api/src/routes/submissions.router.ts`, `apps/api/src/routes/me/submissions.ts`,
    `apps/api/src/routes/admin/submissions.ts`, `apps/api/src/routes/me/progress.ts`,
    `apps/api/src/routes/topics.router.ts`, `apps/api/src/routes/admin/billing.ts`. No other line of
    those handlers changes; their status codes and bodies are identical.
  - `apps/api/test/**` — hook specs.
- **Never inside a service.** `submissions.controller.ts`, `progress-service.ts`,
  `event-charge-service.ts` and every repository they use are not edited; the topic and submission
  rules are untouched (milestone guardrail).
- **Cheap when idle.** With no active requirement on the signal's topic or event, a hook performs
  one indexed query and returns.
- **Best-effort.** Any error from the runner, the evaluator or a repository is caught and logged
  with ids only; the response is built exactly as before.
- **Streak only on a closed step** and only on this hook path; the reconciliation (Task 08) records
  none.

## Scope

In:
- The runner, the container wiring, the hook calls at the thirteen handlers listed above.
- Specs: per site, the step advances (or regresses, for delete, move, unshare, void, reversal)
  within the request; a thrown evaluator leaves the originating status and body unchanged; with no
  matching mission exactly one extra query runs; the third described ready submission closes a
  `minCount: 3` step and its mission in the finalize request with one `mission_step_reward` and one
  `mission_reward`; a closed step advances `user_streak`; a `video_watched` signal with a media id
  of another topic is ignored; a moved-in old submission does not count.

Out:
- The manual check route — Task 07. The daily run — Task 08. Any change to the originating
  controllers or services.

## Acceptance Criteria

- [x] Finalizing the third ready submission with a description on a topic targeted by a
      `submissions_on_topic` step (`minCount: 3`, `requireDescription: true`) completes the step and
      a one-step mission in that request; `xp_events` holds exactly one
      `mission_step_reward:<reqId>:v1` and one `mission_reward:<missionId>:v1`; the finalize
      response is byte-identical to one without missions.
- [x] With the evaluator stubbed to throw, every hooked route returns its usual status and body.
- [x] Deleting a counted submission of an incomplete step lowers `current_count`; of a completed
      step changes nothing.
- [x] Voiding a paid charge before completion takes an `event_participation` count back to 0.
- [x] A closed step on a day with no other activity advances `user_streak` once.
- [x] `git diff` shows no change in `submissions.controller.ts`, `progress-service.ts`,
      `event-charge-service.ts` or any repository under `apps/api/src/adapters/db/`.
- [x] Changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.
      _Closed 2026-10-03. Authorized wiring beyond the guardrail: `gamification` added to the two submissions router slices and passed at `routes/index.ts`. Runner choices: a move signals the target topic plus every `submissions_on_topic` topic of the user's active enrollments (source topics cannot be read after the write), so source regression is immediate rather than left to the daily run; the PATCH hook fires whenever the body carries `description` or `visibility`; staff actions and charge writes are resolved by id inside the runner; the streak is recorded by the evaluator, not twice. Follow-up: the resolver derives a user's groups through `listAll` + `listMembers` because no port lists a user's groups directly (a `listGroupIdsForUser` port method would make it one query)._

## Verification Plan

1. `make db-reset-local`; `make dev-api`; as admin, create an `auto` mission on a seeded topic with
   a `submissions_on_topic` step (`minCount: 2`).
2. As a seeded student, upload two submissions with descriptions; after the second finalize read
   the participants endpoint — the step and mission are complete with `completed_by = 'hook'`.
3. Run the hook spec that stubs the evaluator to throw and confirm the upload route still answers
   its normal status and body.
4. `make test-api`; `make lint`.
5. `git diff --stat` confirms only guardrail files changed.
