# Task 09 — Backend: `/v1/admin/events` has no `GET /{id}`, so the edit page pages the list

**Status:** 📝 Open
**Team:** Backend API
**Found in:** Milestone 20, Task 06 (admin events backoffice), 2026-09-22

## Summary

The admin events router (Task 04) exposes `GET /v1/admin/events` but **no
`GET /v1/admin/events/{id}`**. The backoffice edit page therefore loads one event by
calling the list endpoint and paging it 100 rows at a time until the id appears
(`findById` in the web admin events client).

This is correct today — a tenant has a handful of events — and it degrades linearly. On a
board with a few thousand events, opening the edit form for an old one walks the entire
list, and the cost lands on the D1 query and the Worker's subrequest budget, not on
anything visible in a test.

## Why it was not fixed in place

Adding the route is a change to `apps/api/src/routes/admin/events.ts` and its controller,
which is Task 04's scope. Task 06 is frontend-only and its guardrail forbids
`apps/api/**`, so the implementer flagged it rather than reaching across the boundary —
the right call.

## Scope

In:
- `GET /v1/admin/events/{id}` returning one event regardless of status or audience, under
  the existing `/v1/admin` guard (`admin` · `content_creator`). `IEventRepository.findById`
  already exists and is already implemented by `D1EventRepository`; this is a route and a
  controller branch, not new persistence.
- Replace the web client's paging `findById` with a single call.
- A route test, and the role matrix row for the new path.

Out:
- Any change to the list endpoint's shape or its pagination.

## Acceptance Criteria

- [ ] `GET /v1/admin/events/{id}` returns a draft, a published and an archived event for an
      `admin` and for a `content_creator`; `404` for an unknown id.
- [ ] A student and a `tutor` receive `403`.
- [ ] The admin edit page loads an event with **one** request, asserted by a test rather
      than by inspection.
- [ ] `make test-api` and `make test-web` green.
