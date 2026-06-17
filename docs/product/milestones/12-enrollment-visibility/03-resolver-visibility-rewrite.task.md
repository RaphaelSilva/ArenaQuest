# Task 03 — Backend: resolver `(allow ∪ public) − private` rewrite + benchmark (Phase 1)

**Status:** Open
**Milestone:** [12 — Enrollment enforcement and node visibility](./milestone.md)
**RFC:** [0005 — Enrollment enforcement and node visibility, Phase 1](../../RFCs/0005-enrollment-exclusions-and-visibility.md)
**Team:** Backend API

## Summary

Rewrite `D1EnrollmentRepository.getEffectiveAccessTopicIds` to compute `(allow_tree ∪ public_set) − private_set`: keep today's single recursive cascade CTE for granted subtrees, `UNION` it with all `visibility = 'public'` (non-archived) nodes, and subtract all `visibility = 'private'` nodes. This stays a **single recursive CTE** plus two flat indexed filters — same cost class as today — and gives non-admin callers a visibility-aware effective-access set.

## Dependencies

- Task 02 (the `visibility` column, enum, and adapter read/write must exist before the resolver can reference the column).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/adapters/db/d1-enrollment-repository.ts` — the `getEffectiveAccessTopicIds` query only.
  - `apps/api/test/**` — resolver unit tests and the benchmark fixture.
- **One recursive CTE.** Exactly the existing `allow_seed` → `allow_tree` recursion (user grants `UNION` group grants, cascaded to descendants), plus a flat `public_set` lookup `UNION`-ed in, plus a `NOT IN` against the flat `private_set`. **No second recursion.** Denies are explicitly deferred (a second CTE) and out of scope.
- **`public_set` excludes archived.** `public_set` is `visibility = 'public' AND archived = 0`. The catalog must never surface archived (or draft) content; the controller's pre-access `PUBLISHED && !archived` filter stays the outer guard.
- **`private_set` wins over allow and public.** A node that is both granted (or public) and `private` is removed for non-admin callers.
- **Cascade preserved exactly.** Granting a parent still grants every descendant. No migration of existing grants; currently-enrolled users see an identical set for `restricted` content.
- **Performance.** p95 of `getEffectiveAccessTopicIds` must stay `< 50 ms` on the 1,000-topic benchmark fixture. The index on `topic_nodes(visibility)` (added in Task 02) keeps `public_set` / `private_set` cheap.
- **Port unchanged.** `IEnrollmentRepository` is **not** modified in this RFC — only the D1 adapter's query body changes. Deny methods belong to the Deferred section.
- **Cloud-agnostic.** SQL stays inside the D1 adapter; no controller or port learns about the query shape.

## Scope

In:
- Rewrite the `getEffectiveAccessTopicIds` SQL to `(allow_tree ∪ public_set) − private_set` per RFC §2.
- Add / extend Vitest cases:
  - grant-only cascade returns the same set as today (regression);
  - a `public` topic is visible with **no** grant;
  - a `private` topic is hidden even **with** a grant;
  - a topic that is both granted and `private` is excluded;
  - archived `public` topics are excluded from `public_set`.
- Add a benchmark asserting p95 `< 50 ms` on a 1,000-topic fixture.

Out:
- Controller-level admin / content-creator bypass (Task 04) — this task changes only the resolver used for non-admins.
- The admin `PATCH` schema (Task 04).
- Negative grants / denies (Deferred section of the RFC).
- Any frontend change.

## Acceptance Criteria

- [ ] `getEffectiveAccessTopicIds` returns `(allow_tree ∪ public_set) − private_set` using a single recursive CTE plus two flat indexed filters.
- [ ] Grant-only cascade output is byte-for-byte equivalent to the pre-change behaviour for `restricted` content (regression test passes).
- [ ] A `public`, non-archived topic appears in the set for a user with zero grants.
- [ ] A `private` topic is absent even when the user (or their group) has a grant on it or an ancestor.
- [ ] Archived `public` topics are excluded.
- [ ] The resolver remains a single recursion — no second recursive CTE is introduced.
- [ ] Benchmark: p95 `< 50 ms` on the 1,000-topic fixture.
- [ ] `IEnrollmentRepository` is unchanged.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — confirm the new resolver cases and the cascade-regression case pass.
2. Run the benchmark case and record the p95 on the 1,000-topic fixture; confirm `< 50 ms`.
3. `make dev-api`: with a `public` topic and a fresh zero-grant user, confirm the user's effective set includes it; mark a granted topic `private` and confirm it disappears from the user's set.
4. Confirm a previously-enrolled user's `restricted` set is unchanged before/after the rewrite.
5. `git diff --stat` confirms only the scope-guardrail files changed.
