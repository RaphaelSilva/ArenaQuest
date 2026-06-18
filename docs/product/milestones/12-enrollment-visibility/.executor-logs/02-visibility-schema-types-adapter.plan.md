# Plan — Task 02: visibility column, enum, ports, adapter (Phase 1)

**Assigned persona:** backend-developer
**Branch:** feat/m12-02-visibility-schema-types-adapter
**Task file:** docs/product/milestones/12-enrollment-visibility/02-visibility-schema-types-and-adapter.task.md

## Affected areas
- `apps/api/migrations/0025_add_topic_visibility.sql` — NEW additive migration.
- `packages/shared/types/entities.ts` — add `TopicVisibility` enum to `Entities.Config`.
- `packages/shared/ports/i-topic-node-repository.ts` — `visibility` on `TopicNodeRecord` (required) + create/update inputs (optional).
- `apps/api/src/adapters/db/d1-topic-node-repository.ts` — read/write the column.
- Test specs + the adapter spec — add `visibility` to typed record literals; new adapter cases.

## Context facts (verified)
- `topic_nodes` schema (migration 0005): columns are snake_case; `status TEXT NOT NULL DEFAULT 'draft'`, `archived INTEGER NOT NULL DEFAULT 0`. Reference ADD COLUMN style: migration 0023 (`ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';`).
- The test migration loader (`apps/api/test/helpers/apply-migrations.ts`) auto-globs `migrations/*.sql`, strips `--` comment lines, splits on `;`, and batches. So the new migration is picked up automatically. **Keep each statement on logical lines, end each with `;`, and put only `--` full-line comments** (no trailing inline `--` after code on the same line that contains a `;`).
- The adapter uses `SELECT *`, so the new column arrives in rows automatically. Two mapping sites must set `visibility`: `rowToRecord` (line ~91) AND the inline mapper in `listAll` (line ~197). Both currently omit it; both must add it or the build fails (required field).
- `TopicNodeRecord` is constructed as typed literals in several specs (e.g. `const PUBLISHED: TopicNodeRecord = {...}` in `test/controllers/topics.controller.spec.ts`). Spread-derived copies (`{ ...PUBLISHED, ... }`) inherit the field; only **base** literals need it added.

## Implementation steps

1. **Migration — `apps/api/migrations/0025_add_topic_visibility.sql`** (new file):
   - Header comment lines (`-- Migration 0025: ...`).
   - `ALTER TABLE topic_nodes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'restricted' CHECK (visibility IN ('public', 'restricted', 'private'));`
   - Belt-and-suspenders backfill: `UPDATE topic_nodes SET visibility = 'restricted' WHERE visibility IS NULL;`
   - `CREATE INDEX IF NOT EXISTS idx_topic_nodes_visibility ON topic_nodes (visibility);`

2. **`packages/shared/types/entities.ts`** — inside `Entities.Config`, after `TopicNodeStatus`, add:
   - `export enum TopicVisibility { PUBLIC = 'public', RESTRICTED = 'restricted', PRIVATE = 'private' }` with a short doc comment per value (PUBLIC = any authenticated user; RESTRICTED = grant required, default; PRIVATE = admin/creator only).

3. **`packages/shared/ports/i-topic-node-repository.ts`**:
   - Add `visibility: Entities.Config.TopicVisibility;` (required) to `TopicNodeRecord`.
   - Add `visibility?: Entities.Config.TopicVisibility;` to `CreateTopicNodeInput` and `UpdateTopicNodeInput`.

4. **`apps/api/src/adapters/db/d1-topic-node-repository.ts`**:
   - Add `visibility: string;` to the `TopicNodeRow` type.
   - In `rowToRecord`, set `visibility: row.visibility as Entities.Config.TopicVisibility`.
   - In the `listAll` inline mapper object, add the same `visibility: row.visibility as Entities.Config.TopicVisibility`.
   - In `create`: include the column in the INSERT, e.g. add `visibility` to the column list and bind `data.visibility ?? 'restricted'`. (Keep the existing default behaviour; explicit input wins.)
   - In `update`: add a partial-patch clause:
     `if (data.visibility !== undefined) { setClauses.push('visibility = ?'); values.push(data.visibility); }` — placed alongside the other optional clauses, so omitting it preserves the stored value.

5. **Record-literal fixups (required field):** grep the repo for typed `TopicNodeRecord` base literals and add `visibility`. At minimum update the **base** literals in:
   - `apps/api/test/controllers/topics.controller.spec.ts` (`PUBLISHED`, `DRAFT`, and any other base literal not derived by spread).
   - Any other base `TopicNodeRecord` literal surfaced by `grep -rn ": TopicNodeRecord = {" apps/api` and `grep -rn "as TopicNodeRecord" apps/api`.
   - Use `Entities.Config.TopicVisibility.RESTRICTED` for these defaults (matching production default). Do NOT touch spread-derived copies.

6. **Adapter tests — `apps/api/test/db/d1-topic-node-repository.spec.ts`** — add cases:
   - `create` with explicit `visibility: 'public'` round-trips (`node.visibility === 'public'`).
   - `create` without `visibility` defaults to `restricted`.
   - `update` changing `visibility` to `private` persists.
   - `update` omitting `visibility` preserves the previously-stored value.
   Reuse the existing `repo`/`applyMigrations` harness in that file.

## Out of scope (do NOT touch)
- The resolver `getEffectiveAccessTopicIds` (Task 03).
- The admin `PATCH` Zod schema / controller bypass (Task 04).
- The OpenAPI `TopicNodeSchema` response contract (Task 04 owns HTTP surface; additive field flows through without a schema edit).
- Any frontend file.

## Verification (run by orchestrator, not the child)
- Typecheck: `pnpm -C apps/api exec tsc --noEmit` and shared package build — to catch any missed required-field literal.
- Scoped lint on changed files.
- `pnpm -C apps/api test d1-topic-node-repository.spec` (+ topics.controller.spec for the literal fixups).
- Local migration apply sanity if feasible.
