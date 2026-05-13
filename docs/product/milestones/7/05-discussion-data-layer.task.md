# Task 05 — Discussion Data Layer

**Status:** ⏳ Pending
**Milestone:** [7](./milestone.md)

## Summary

Persist threaded comments on TopicNodes (one level of replies) and per-user likes. Expose through a new `ICommentRepository` port.

## Dependencies

None. Consumed by Task 11 (HTTP API) and Task 15 (web).

## Technical Constraints

- `topic_comments (id, topic_node_id, parent_comment_id, user_id, body, created_at, deleted_at)`. Replies forbidden when `parent_comment_id IS NOT NULL` (enforced in the controller, not the schema).
- `comment_likes (comment_id, user_id, liked_at)` with composite primary key.
- Body sanitisation reuses `utils/sanitize-markdown.ts` from shared, but renders as plain-text in M7 (no markdown).
- Soft delete via `deleted_at`; deleted bodies are returned as `null` in reads, the row stays to preserve thread shape.

## Scope

In:
- Migrations, port, adapter, unit tests.
- Repository methods: list-by-topic (returns flat list with `parent_comment_id`), insert, soft-delete, toggle like, like-count, liked-by-user lookup.

Out:
- HTTP routes (Task 11).
- Web UI (Task 15).

## Acceptance Criteria

- [ ] Insert with `parent_comment_id` pointing at a row that itself has a `parent_comment_id` is rejected at the controller layer in Task 11 — repository simply enforces the FK exists.
- [ ] Soft-deleting a comment leaves it queryable but with `deleted_at` set; its reply count and likes are preserved.
- [ ] Toggling a like is idempotent on the second identical call.
- [ ] No provider-specific imports outside adapters.

## Verification Plan

1. Vitest covers insert, soft-delete, like toggle, and listing with `likedByMe` projection.
2. `make lint` and `make test-api` pass.
