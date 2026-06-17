# Plan — Task 03: resolver (allow ∪ public) − private rewrite (Phase 1)

**Assigned persona:** backend-developer
**Branch:** feat/m12-03-resolver-visibility
**Task file:** docs/product/milestones/12-enrollment-visibility/03-resolver-visibility-rewrite.task.md

## Affected areas
- `apps/api/src/adapters/db/d1-enrollment-repository.ts` — the `getEffectiveAccessTopicIds` query body ONLY (method at line ~51).
- `apps/api/test/db/d1-enrollment-repository.spec.ts` — extend the `getEffectiveAccessTopicIds` describe block + add a benchmark case.

## Context facts (verified)
- Current resolver is a single recursive CTE: `direct_grants` (user UNION group) → `tree` (cascade) → `SELECT DISTINCT id FROM tree`. Bind is `.bind(userId)` with `?1`.
- The `topic_nodes.visibility` column exists (Task 02, migration 0025) with default `'restricted'`, values `public|restricted|private`, and an index `idx_topic_nodes_visibility`.
- The spec seeds topics via `INSERT INTO topic_nodes (id, title)` / `(id, parent_id, title)` — these default to `visibility='restricted'`. So **existing resolver tests remain valid** (restricted ⇒ grant-cascade only). New tests must set visibility explicitly in the INSERT column list.
- `beforeEach` provides `userId`, `adminId`, `rootTopicId` → `childTopicId` → `grandChildId` (a 3-deep chain), and `groupId`. Use `repo.grantUser(userId, topicId, adminId)` to grant.

## Implementation steps

1. **Rewrite `getEffectiveAccessTopicIds`** in `d1-enrollment-repository.ts` to `(allow_tree ∪ public_set) − private_set`, preserving the SINGLE recursion. Exact SQL (RFC §2):
   ```
   WITH RECURSIVE
     allow_seed(id) AS (
       SELECT topic_node_id FROM enrollments_user WHERE user_id = ?1
       UNION
       SELECT eg.topic_node_id
         FROM enrollments_user_group eg
         JOIN user_group_members ugm ON ugm.group_id = eg.group_id
        WHERE ugm.user_id = ?1
     ),
     allow_tree(id) AS (
       SELECT id FROM allow_seed
       UNION ALL
       SELECT tn.id FROM topic_nodes tn JOIN allow_tree ON tn.parent_id = allow_tree.id
     ),
     public_set(id) AS (
       SELECT id FROM topic_nodes WHERE visibility = 'public' AND archived = 0
     )
   SELECT DISTINCT id FROM (
     SELECT id FROM allow_tree
     UNION
     SELECT id FROM public_set
   )
   WHERE id NOT IN (SELECT id FROM topic_nodes WHERE visibility = 'private')
   ```
   Keep `.bind(userId)` and the `.all<{ id: string }>()` mapping. Do NOT add a second recursive CTE.

2. **Tests** — extend the `getEffectiveAccessTopicIds` describe block with cases (insert helper topics with explicit `visibility`):
   - **grant-only cascade unchanged**: already covered by existing tests; leave them intact (they must still pass).
   - **public visible with no grant**: insert a topic with `visibility='public'`; with the user holding NO grants, `getEffectiveAccessTopicIds(userId)` includes that topic id.
   - **private hidden even with a grant**: insert a `visibility='private'` topic; `grantUser(userId, privateId, adminId)`; result EXCLUDES it.
   - **granted-but-private descendant excluded**: grant `rootTopicId` (restricted) so the cascade would include `childTopicId`; flip `childTopicId` to `visibility='private'` (UPDATE or insert a private child); result includes root/grandchild path per cascade but EXCLUDES the private child.
   - **archived public excluded**: insert a topic with `visibility='public'` AND `archived=1`; result EXCLUDES it (public_set has `archived = 0`).
   - Insert explicit-visibility topics with e.g. `INSERT INTO topic_nodes (id, title, visibility) VALUES (?, 'Pub', 'public')` and `(id, title, visibility, archived) VALUES (?, 'Arch', 'public', 1)`.

3. **Benchmark case** — add an `it('p95 stays < 50ms on a 1,000-topic fixture', ...)`:
   - Batch-insert ~1,000 topic_nodes (a shallow tree or flat set; default restricted is fine). Grant the user the root (or a handful) so the cascade has work to do.
   - Run `getEffectiveAccessTopicIds(userId)` ~20 times, collect `performance.now()` deltas, compute p95 (sort, take the ~19th of 20).
   - Assert `p95 < 50`. Give the test a generous timeout (e.g. `{ timeout: 30000 }`) for the seeding. Keep the seed insert batched to avoid per-row overhead.

## Out of scope (do NOT touch)
- `IEnrollmentRepository` port (UNCHANGED in this RFC — no deny methods).
- The controller bypass / admin PATCH (Task 04).
- Any other method in the adapter (grant/revoke/list paths).
- Any frontend file.

## Verification (run by orchestrator, not the child)
- Scoped lint on the two changed files.
- `pnpm -C apps/api test d1-enrollment-repository.spec` — existing + new resolver cases + benchmark green.
- Spot-check the SQL keeps exactly one recursive CTE.
