# Task 10 — Leaderboard API + `/me/dashboard` Aggregate

**Status:** ⏳ Pending
**Milestone:** [7](./milestone.md)

## Summary

Expose the read endpoints that the Dashboard UI consumes: `/me/xp`, `/me/streak`, `/me/quests/daily`, `/me/quests/weekly`, `/me/missions`, `/me/badges`, `/leaderboard`, and an aggregate `/me/dashboard` that returns all of the above in a single request.

## Dependencies

Tasks 01–04, 06–09.

## Technical Constraints

- One controller per concern; the aggregate `/me/dashboard` delegates and shapes the union.
- `/leaderboard?scope=global|topic&topicId=…&period=all_time|week` returns `{ rows: TopEntry[], me: { rank, total_xp, level, rank_title } }`. The `period=week` filter uses the caller's local week.
- Pagination on the leaderboard via `limit` (default 50, max 100). Caller's `me` block is always included even if outside the page.
- The aggregate route is designed to return in < 200 ms on a seeded tenant of 200 users — verify in CI with a small fixture.

## Scope

In:
- Routes + controllers + Zod schemas + integration tests.
- `/me/dashboard` aggregate shape documented in a JSON schema or TypeScript type exported from `packages/shared`.

Out:
- Web rendering (Task 13).

## Acceptance Criteria

- [ ] `/leaderboard` returns `rows` sorted by `total_xp DESC` and breaks ties on `last_xp_event_at ASC`.
- [ ] `/leaderboard` `me.rank` is the global rank, not the page-relative rank.
- [ ] `/me/dashboard` returns `null` for empty sections (no missions active, etc.) rather than 404.
- [ ] Unauthenticated callers receive `401` on all endpoints.
- [ ] No provider-specific imports outside adapters.

## Verification Plan

1. Vitest integration suite covers each endpoint including auth, empty states, and the tie-break ordering.
2. `make lint` and `make test-api` pass.
