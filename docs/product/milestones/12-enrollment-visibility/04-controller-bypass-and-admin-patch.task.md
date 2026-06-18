# Task 04 — Backend: admin/creator `PRIVATE` bypass + admin `PATCH` visibility schema (Phase 2)

**Status:** ✅ Done
**Milestone:** [12 — Enrollment enforcement and node visibility](./milestone.md)
**RFC:** [0005 — Enrollment enforcement and node visibility, Phase 2](../../RFCs/0005-enrollment-exclusions-and-visibility.md)
**Team:** Backend API

## Summary

Expose visibility at the HTTP and authorization layers. Extend the admin `PATCH /admin/topics/{id}` Zod schema to accept `visibility?: TopicVisibility`, and make the `ROLES.ADMIN` / `ROLES.CONTENT_CREATOR` bypass explicit in `TopicsController`: those principals are never subject to the resolver and see **all** content — every grant, every `PRIVATE` topic — platform-wide, while every other principal is filtered by `(allow ∪ public) − private`. Add integration and comment-inheritance regression tests.

## Dependencies

- Task 02 (visibility column / enum / inputs).
- Task 03 (resolver returns the visibility-aware set for non-admins).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/routes/admin/topics.ts` — extend the `PATCH` body schema with `visibility?`.
  - `apps/api/src/controllers/topics.controller.ts` (and `admin-topics.controller.ts` if the admin patch is handled there) — make the admin / content-creator full bypass explicit, including the `PRIVATE` filter, in the `userId === undefined` branch.
  - `apps/api/test/**` — integration and comment-inheritance regression tests.
- **No new route.** `PATCH /admin/topics/{id}` already accepts a partial update; only its schema is extended. Grant and revoke routes are unchanged.
- **Validation via decorator.** The `visibility?` field validates through the existing `@ValidateBody(schema)` / `@Body()` decorator flow; on invalid input the controller short-circuits with a `400 BadRequest` `ControllerResult`.
- **Explicit bypass rule.** `ROLES.ADMIN` and `ROLES.CONTENT_CREATOR` bypass the resolver entirely (called with `userId: undefined`) and see all content including `PRIVATE`. Every other principal is filtered. Making this explicit (rather than an implicit consequence of `userId === undefined`) is the point of this task — no new role is introduced.
- **Platform-wide, trust-based bypass.** A content creator can see other creators' `PRIVATE` drafts. Per-creator content scoping is a Non-Goal (no topic-ownership concept exists).
- **Comments inherit, no new primitive.** Comment read/write is already gated by the same `getEffectiveAccessTopicIds` set. No edit to the comment controller/router is expected; `PRIVATE` propagates to the discussion automatically and `PUBLIC` topics become commentable by any authenticated user. `PUBLIC` comment abuse is explicitly out of scope (resolved decision 2 — no rate limiting / moderation toggle here).
- **Pre-access status filter intact.** The `status === PUBLISHED && !archived` filter runs before the access check for every caller, including admins/creators — draft / archived topics stay catalog-invisible to everyone.
- **`ControllerResult<T>` contract.** All controller paths return the standard result envelope with proper error handling.

## Scope

In:
- Extend the admin `PATCH /admin/topics/{id}` schema with `visibility?: TopicVisibility` (Zod), validated via the decorator.
- Make the admin / content-creator bypass explicit in `TopicsController`, covering the `PRIVATE` filter, in the `userId === undefined` branch.
- Integration tests against in-memory D1:
  - admin sees a `PRIVATE` topic; a participant does not;
  - a `PUBLIC` topic is visible to a zero-grant participant;
  - a `RESTRICTED` topic is gated by the cascade;
  - patching `visibility` round-trips through the admin endpoint.
- Comment-inheritance regression tests:
  - an authenticated user can comment on a `PUBLIC` topic with no grant;
  - a participant cannot comment on a `RESTRICTED` topic they lack — **with no edit to the comment controller**.

## Acceptance Criteria

- [x] `PATCH /admin/topics/{id}` accepts and persists `visibility?`; invalid values return `400` via the validation decorator.
- [x] An admin and a content creator see all content (including `PRIVATE`), platform-wide, on both `GET /topics` and `GET /topics/{id}`.
- [x] A non-admin's responses are `(allow ∪ public) − private`; a `PRIVATE` topic is absent even with a grant, and reachable only via `/admin/topics/*`.
- [x] A `PUBLIC` topic appears for a zero-grant participant; a `RESTRICTED` topic is cascade-gated.
- [x] Draft / archived topics never appear in `GET /topics` / `GET /topics/{id}` for anyone, including admins/creators.
- [x] Comment access follows visibility with **no comment-controller change**: `PUBLIC` is commentable by any authenticated user; a lacked `RESTRICTED` topic rejects comments with `403`.
- [x] All controller paths return `ControllerResult<T>` with proper error handling.
- [x] The admin PATCH/create OpenAPI body schema and the `TopicNodeRecordSchema` response now carry `visibility` (route-level OpenAPI; Bruno collection regen deferred to the closeout).
- [x] Changed files lint clean; affected specs pass (68 tests across topics.router, comments, admin-topics.controller, topics.controller). _Repo-wide `make lint` / full `make test-api` caveats unchanged from Tasks 01–03._
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — integration and comment-inheritance tests green.
2. `make dev-api`: as admin, `PATCH /admin/topics/{id}` to `private`; confirm the topic vanishes from a participant's `GET /topics` / `GET /topics/{id}` (`404`) yet remains in `/admin/topics/*`.
3. As a zero-grant participant, confirm a `PUBLIC` topic appears in `GET /topics` and is commentable; confirm a lacked `RESTRICTED` topic returns `404` and rejects a comment with `403`.
4. As a content creator, confirm all content including `PRIVATE` is visible.
5. Submit an invalid `visibility` value to the patch endpoint and confirm a `400`.
6. `git diff --stat` confirms only the scope-guardrail files changed (no comment-controller edit).
