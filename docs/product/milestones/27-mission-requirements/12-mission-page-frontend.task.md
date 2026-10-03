# Task 12 — Frontend: Mission page — steps, manual check, leave (Phase 6)

**Status:** 📝 Open
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Frontend Web
**Depends On:** [Task 07](./07-student-missions-api.task.md), [Task 11](./11-dashboard-missions-panel-frontend.task.md)

## Summary

Adds the mission page, where a student reads the whole mission and ticks self-checks. A new route
`(protected)/missions/[id]`, backed by `GET /v1/me/missions/{id}`, shows the title, the rendered
description, the window, the mode in plain words (*Do the steps in order* / *Do the steps in any
order*), the mission XP and badge, and **every step** with its title, kind, target link (or the
redacted form when the student cannot open it), XP, state and, for `manual_check` steps, the
instructions and an **I did it** button. The button asks for confirmation — the check is final and
cannot be undone — then calls `POST /v1/me/missions/{id}/requirements/{reqId}/check` and re-renders
the returned step and mission; a locked sequential step shows the button disabled with "Complete
the previous step first", and the two `409`s (`MISSION_STEP_LOCKED`, `MISSION_CLOSED`) show their
translated messages. For a self-enrollment the page menu offers **Leave**, confirming that
completed steps and earned XP are kept and that rejoining will not reset the window; it calls
`POST …/leave` and returns to the dashboard. A mission the student may not see renders the app's
not-found page (the API answers `404`). Dashboard cards from Task 11 link here.

## Dependencies

- [Task 07](./07-student-missions-api.task.md) — hard code dependency: detail, check and leave
  routes.
- [Task 11](./11-dashboard-missions-panel-frontend.task.md) — hard code dependency: the shared
  step-list components, `missions-api.ts` and the `missions:` dictionary section.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/missions/[id]/page.tsx` (new).
  - `apps/web/src/components/missions/**` — mission header, step detail, check button, leave
    dialog.
  - `apps/web/src/lib/missions-api.ts` — detail, check and leave calls;
    `apps/web/src/lib/api-types.gen.ts` regenerated.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — keys under `missions:`.
  - Component tests beside the new components.
- **Sanitised Markdown** for the description through the catalog's existing renderer.
- **The check is final**: no un-check affordance exists.
- **No hardcoded strings**; `check-i18n-coverage.js` passes.
- **Consumes the API contract as is**: no API source file changes; no change to topic or catalog pages.

## Scope

In:
- The page, step details, *I did it* with confirmation and error states, *Leave* with
  confirmation, not-found handling, dictionaries.
- Component tests: check flow (confirm → call → completed state); disabled button on a locked
  step; `409 MISSION_CLOSED` message; leave flow; not-found on a mocked `404`; redacted target.

Out:
- Dashboard groups and *Join* — Task 11. Admin surfaces — Tasks 09 and 10.

## Acceptance Criteria

- [ ] Clicking *I did it* on an open `manual_check` step asks for confirmation, calls the check
      route once, and the step renders as completed with its XP.
- [ ] A locked sequential `manual_check` step renders the button disabled with the explanation.
- [ ] A mocked `409 MISSION_CLOSED` renders its translated message and leaves the step open.
- [ ] *Leave* is offered only for a `self` enrollment; after confirming it calls the leave route and
      returns to the dashboard.
- [ ] A mocked `404` renders the not-found page.
- [ ] `check-i18n-coverage.js` passes; `pt` and `en` builds both render the page.
- [ ] Changed files lint clean; `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev`; as admin create an `open` sequential mission whose second step is a self-check.
2. As the seeded student, join it, open the mission page, confirm the self-check is disabled, finish
   step 1, tick the self-check and see XP on the dashboard.
3. Leave the mission and confirm the dashboard shows it under *Available* again with completed
   steps kept.
4. `make test-web`; `make lint`.
5. `git diff --stat` confirms only guardrail files changed and nothing under `apps/api/src/`.
