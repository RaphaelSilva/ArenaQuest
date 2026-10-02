# Task 03 — Frontend: Smoke journeys J1, J2, J5, J9

**Status:** 📝 Open
**Epic:** [End-to-end test phase — Playwright suite gating main](./2026-09-29-e2e-test-phase.epic.md)
**Team:** Frontend Web
**Depends On:** [Task 02](./02-fixtures-and-page-objects.task.md)

## Summary

Write the four `@smoke` journeys that protect the paths every user takes, and make
them the always-on core of the suite. **J1 — session:** a student logs in, reloads and
is still authenticated (silent refresh), logs out and is sent to login; a wrong
password shows the error message and does not log in. **J2 — RBAC:** a student
navigating to any `/admin/*` route is kept out, while the admin sees the backoffice
navigation. **J5 — authoring to consumption:** the admin creates a small topic tree
with Markdown content and publishes it; the student finds it in `/catalog`, opens it
and sees the rendered content (sanitised, no raw Markdown). **J9 — public events:** an
anonymous visitor sees only `public` events on `/events`, a `members` event's detail
returns the not-found page anonymously and renders once logged in, and the flyer of a
public event loads. `make e2e-smoke` runs exactly these four in under 90 seconds.

## Dependencies

- [Task 02](./02-fixtures-and-page-objects.task.md) — hard dependency: role states,
  API client, page objects.
- Existing behaviour under test: the auth pages, the protected layout's RBAC, the
  catalog, and the events board (`apps/web/src/app/(public)/events/**`,
  `GET /v1/events`, 404-not-403 for out-of-audience reads).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `e2e/specs/smoke/**` — the four journey specs, tagged `@smoke`.
  - `e2e/pages/**` — extensions to existing page objects if a journey needs them.
  - `e2e/fixtures/api-client.ts` — only the event-creation operation if task 02
    did not already cover it.
- **Own data.** J5 and J9 create their topics and events through the API client
  with `uniq()` names; no spec depends on another spec's data or on run order.
- **Web-first assertions.** No fixed sleeps; every wait is an assertion that retries.
- **Audience rules are asserted, not assumed.** J9 checks the anonymous response of a
  `members` event is the not-found page, matching the API's 404 contract.
- **No production code change.** If a journey is impossible without one, stop and
  raise it rather than editing `apps/**`.

## Scope

In:
- J1, J2, J5, J9 as four spec files under `e2e/specs/smoke/`.
- The `@smoke` tag and the `make e2e-smoke` filter it drives.

Out:
- Registration, password reset, media, tasks, progress, user management — tasks 05–08.
- CI wiring — task 04.

## Acceptance Criteria

- [ ] `make e2e-smoke` runs exactly J1, J2, J5, J9 and passes in under 90 s on a
      warm local machine.
- [ ] J1 fails if the refresh cookie is not stored (checked once by setting
      `COOKIE_SAMESITE=None` locally and observing the failure).
- [ ] J2 fails if a student can render any `/admin` page.
- [ ] J9 fails if a `members` event appears in the anonymous listing.
- [ ] Specs pass with `--repeat-each=3` and 2 workers (no order or data coupling).
- [ ] `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make e2e-smoke` — four specs green; note the duration.
2. `make e2e-smoke` with `--repeat-each=3 --workers=2` — still green.
3. Break one selector in a page object — the right journey fails with a trace;
   revert.
4. `make lint`.
5. `git diff --stat` confirms only scope-guardrail files changed.
