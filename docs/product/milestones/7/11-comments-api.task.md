# Task 11 — Comments API

**Status:** ⏳ Pending
**Milestone:** [7](./milestone.md)

## Summary

HTTP surface for the discussion thread on TopicNodes: list, create, reply, like-toggle, soft-delete. Awards XP through the engine on first-of-day comment posting.

## Dependencies

Tasks 05, 06.

## Technical Constraints

- Routes:
  - `GET /topics/:id/comments` — returns flat list with `parent_comment_id`, `likes_count`, `liked_by_me`, sorted top-level by `created_at DESC` and replies by `created_at ASC`.
  - `POST /topics/:id/comments` — body `{ body, parentCommentId? }`; rejects nested replies (parent must be top-level).
  - `POST /comments/:id/like` — toggle.
  - `DELETE /comments/:id` — soft-delete (author or `admin`).
- Read filter respects M5 access: a user who cannot see the topic cannot read its comments.
- Body length bounded (1..2000 chars). Plain text only — strip HTML.
- Calls `XpEngine.award('post_comment', user, commentId)` after a successful create. The engine handles "one per day" via its idempotency key.

## Scope

In:
- Routes, controller, Zod schemas, integration tests.

Out:
- UI (Task 15).
- Edit functionality (out of scope for M7).

## Acceptance Criteria

- [ ] A reply to a reply (`parentCommentId` points at a non-top-level comment) returns `400 NESTED_REPLY_FORBIDDEN`.
- [ ] Deleting another user's comment returns `403` (unless caller is admin).
- [ ] Listing returns deleted comments with `body: null` and preserves the reply tree.
- [ ] `liked_by_me` reflects the caller's like state.
- [ ] Posting a comment in a topic the user is not enrolled in returns `403`.

## Verification Plan

1. Vitest integration suite covers each route including access enforcement, nested-reply rejection, and like idempotency.
2. `make lint` and `make test-api` pass.
