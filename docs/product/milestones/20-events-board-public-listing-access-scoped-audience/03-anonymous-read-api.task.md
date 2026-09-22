# Task 03 — Backend: Anonymous events read API (Phase 2)

**Status:** 📝 Open
**Milestone:** [20 — Events board — public listing, access-scoped audiences and per-event WhatsApp contact](./milestone.md)
**RFC:** [RFC 0014](../../RFCs/0014-events-board-and-whatsapp-contact.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-schema-and-repository.task.md)

## Summary

Opens the first endpoints in ArenaQuest reachable without an account, and does it with one
code path rather than two. `optionalAuth` is the first middleware in the codebase that does
not reject: it verifies a Bearer token when one is present, sets the user on the context,
and calls the next handler regardless — an **invalid or expired** token degrades the caller
to anonymous rather than returning `401`, so a stale session sees a public page instead of
an error. Over it sit three routes mounted at `/v1/events`, deliberately **outside**
`routes/public/`, whose name means "non-admin but authenticated" and whose reuse would blur
a security boundary: a list honouring `?scope=upcoming` (default) and `?scope=past` with
their opposite orderings, a detail read by slug returning sanitised content and a resolved
contact block, and a flyer route that 302-redirects to a freshly minted presigned GET so the
URL pasted into a chat stays stable while the bucket stays private. The list is one endpoint
for both audiences on purpose — the client never declares what it may see; it sends whatever
token it has and the server returns the union, so the "other list for logged-in users" the
product asked for is the *difference between two responses*, not a second route a client
could call wrongly. A detail or flyer read outside the caller's audience returns **404, not
403**, byte-identical to a slug that does not exist, denying an enumeration oracle on a
surface open to the internet. Contact resolution lives here too: number from the event else
the tenant fallback else `null`, message from the event else composed from the current title
and date, so renaming an event never strands a stale message. Because these endpoints cost a
caller nothing, an IP-keyed rate limiter guards them at 60 requests per minute. Task 05
renders all of this; Task 04 writes it.

## Dependencies

- [Task 02](./02-schema-and-repository.task.md) — hard code dependency. Every read in this
  task is a call into `IEventRepository`; the audience rule and the scope predicate are
  implemented there and are not re-expressed here.
- [Task 01](./01-shared-foundations.task.md) — transitively, for the entity types and the
  shared WhatsApp normalisation used to emit the contact number.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/middleware/optional-auth.ts` (new).
  - `apps/api/src/controllers/events.controller.ts` (new).
  - `apps/api/src/routes/events.router.ts` (new) and its mount line in
    `apps/api/src/routes/index.ts`.
  - `apps/api/src/container.ts` — a new `events` bounded-context group and one `events` KV
    rate limiter beside the existing limiters. No existing group changes shape.
  - `apps/api/test/**` — middleware, controller and route specs.
- **Validation is `@hono/zod-openapi`.** Query and path input is declared with `createRoute`
  and Zod schemas at the route layer, following the routers this codebase already ships.
  **`@ValidateBody` / `@Body()` decorators do not exist here** — the `CLAUDE.md` passage
  describing them is known documentation drift
  (`docs/product/backlog/refactoring/07-validatebody-documentation-drift.task.md`). A task
  file or a PR reintroducing them is a review failure.
- **Routes vs controllers.** All resolution logic lives in `events.controller.ts` returning
  `ControllerResult<T>`; the router parses, applies `optionalAuth`, and shapes the response
  — including the 302 and its headers.
- **Per-request adapters.** The `events` group is built inside `buildApp(env)`; no adapter
  instance reaches module scope, because Workers share no memory between requests.
- **`optionalAuth` never rejects.** Missing, malformed, invalid and expired tokens all
  proceed anonymously. It must not be mounted on any existing route, and `auth-guard.ts` is
  not modified — the new middleware is a sibling, not a replacement.
- **`routes/public/` is not reused and not modified.** The new router mounts at `/v1/events`
  from `routes/index.ts`. Any diff inside `routes/public/` is a review failure.
- **404, never 403, on a read the caller may not see.** The out-of-audience body must be
  byte-identical to the not-found body — same status, same shape, same message. A
  distinguishable response is an enumeration oracle.
- **Audience is never a request parameter.** No query string, header or body field may
  influence which audience slice is returned. The only input is the token `optionalAuth`
  resolved.
- **The flyer route redirects, it does not proxy.** A 302 to a short-lived presigned GET
  (TTL 1h), with `Cache-Control: public, max-age=60` for a `public` event and `no-store`
  otherwise, so a burst on a shared link does not become a burst of signatures. The bucket
  is never made world-readable.
- **Content is served sanitised.** The markdown body is emitted through `sanitizeMarkdown`;
  this route is read by anonymous browsers and crawlers.
- **Rate limiting.** A `KvRateLimiter` keyed on `CF-Connecting-IP` at 60 requests per
  minute, registered beside the existing limiters. No existing limiter's key or budget
  changes.
- **No access effect.** Nothing here reads or writes an enrollment grant; no existing route
  gains or loses a guard.

## Scope

In:
- `optionalAuth` and its specs, covering present-and-valid, present-and-expired,
  present-and-malformed, and absent.
- `EventsController` with the three reads, contact resolution, and explicit not-found
  branches.
- `GET /v1/events` with `?scope` and pagination; `GET /v1/events/{slug}`;
  `GET /v1/events/{slug}/flyer`.
- Contact resolution: number (event → tenant fallback → `null`, suppressing the button),
  message (event → composed from the current title and date), and the label passed through
  for the web layer to default from its dictionary.
- The `events` container group and the IP-keyed rate limiter.
- The test matrix: anonymous × each audience; a member × each audience; a directly granted
  user; a group-granted user; a non-granted user; a draft; an archived event; an expired
  token; both `?scope` values across the boundary; the 404-not-403 byte-identity assertion;
  the rate-limit cutover.

Out:
- Every write — create, edit, publish, audience replacement and the flyer upload lifecycle
  are Task 04.
- Any frontend change — Task 05 consumes these endpoints.
- The seeded example event — Task 08.

## Acceptance Criteria

- [ ] `GET /v1/events` with **no `Authorization` header** returns `200` and exactly the
      `published` + `audience='public'` set.
- [ ] The same call with a student's token returns that set ∪ `members` ∪ the events
      granted to that student's groups and to that student directly, and nothing else.
- [ ] A request carrying an **invalid or expired** token receives the anonymous slice with
      `200` — never `401` — on all three routes.
- [ ] `GET /v1/events/{slug}` for an out-of-audience event returns `404` with a body
      byte-identical to the response for a slug that does not exist; asserted by comparing
      the two bodies, not by reading each separately.
- [ ] A draft and an archived event are absent from every anonymous and authenticated
      response on these routes, at both `?scope` values.
- [ ] A published event past `COALESCE(ends_at, starts_at + 1 day)` is absent from the
      default `?scope=upcoming` and present in `?scope=past`, and no row was written.
- [ ] `GET /v1/events/{slug}/flyer` returns `302` to a presigned GET with
      `Cache-Control: public, max-age=60` for a `public` event and `no-store` otherwise;
      `404` when the caller is out of audience or the event has no flyer; the bucket is
      not world-readable.
- [ ] The resolved `contact.number` is the event's own when it sets one and the tenant
      fallback when it does not; `contact` is `null` when neither resolves; the composed
      message names the event's **current** title.
- [ ] The 61st anonymous request from one IP inside the window returns `429`; a request
      from a second IP in the same window is unaffected.
- [ ] No `@ValidateBody` or `@Body()` decorator appears anywhere in the diff; the routes
      declare their input through `createRoute` + Zod.
- [ ] No provider-specific (D1/R2) import leaks into the controller; `routes/public/**`
      and `middleware/auth-guard.ts` are unchanged.
- [ ] Validation, not-found and rate-limit branches each return the correct
      `ControllerResult` status and are covered by a test.
- [ ] Changed files lint clean; `make test-api` green for the affected specs, and the
      pre-existing suite passes unchanged.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` and `make dev-api`; insert a fixture spanning all three audiences,
   both non-published statuses, one past and one open-ended event.
2. `curl -s $API/v1/events` with **no** `Authorization` header and confirm the response is
   exactly the `published` + `public` set; repeat with a student token and diff the two
   responses — the difference is the `members` and granted slice, and nothing else.
3. `curl` a restricted slug as a non-granted caller and as a caller requesting a nonsense
   slug, and `diff` the two response bodies byte for byte.
4. `curl -i` the flyer route for a `public` and a `members` event and confirm the `302`,
   the presigned target and the two different `Cache-Control` values; confirm an
   unauthenticated direct GET against the bucket URL still fails.
5. Replay a request with a deliberately expired token on all three routes and confirm
   `200` with the anonymous slice, not `401`.
6. Loop 61 requests from one IP and confirm the `429` on the last.
7. `make test-api` — the matrix specs pass and the pre-existing suite is unchanged.
8. `make lint`.
9. `git diff --stat` confirms only the guardrail files changed, and that
   `routes/public/`, `middleware/auth-guard.ts`, `d1-enrollment-repository.ts` and
   `src/core/billing/` are absent from the list.
