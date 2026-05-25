# Plan — 03-migrations-helper-pilot

**Task:** [03-migrations-helper-pilot.task.md](../03-migrations-helper-pilot.task.md)
**Source:** Milestone 8
**Assigned personas:** backend-developer
**Branch:** feature/m8/03-migrations-helper-pilot.task (from feature/m8/02-remove-low-signal-specs.task)

## Objective

Create `apps/api/test/helpers/apply-migrations.ts` — a shared helper that applies the canonical `apps/api/migrations/*.sql` files against a D1 binding so that test files no longer declare inline `CREATE TABLE` blocks. Roll the helper out to 5 representative db-spec files as a pilot. Remaining files are migrated in Task 10.

## Affected areas

### In scope
- **New:** `apps/api/test/helpers/apply-migrations.ts`
- **5 pilot specs** (all in `apps/api/test/db/`):
  1. `test/db/d1-user-repository.spec.ts`
  2. `test/db/d1-media-repository.spec.ts`
  3. `test/db/d1-quest-repository.spec.ts`
  4. `test/db/d1-tag-repository.spec.ts`
  5. `test/db/d1-refresh-token-repository.spec.ts`

### Read-only reference
- `apps/api/migrations/*.sql` — never modified; only read via `import.meta.glob`

### Out of scope
- `apps/api/migrations/**` — not modified
- Any spec file not in the 5-file pilot list
- `apps/api/src/**`, `packages/shared/**`, `apps/web/**`

## Step-by-step

### Backend

1. **Create `apps/api/test/helpers/apply-migrations.ts`.**

   The helper uses Vite's `import.meta.glob` (processed at build time) to load all SQL files as raw strings, sorts them by filename, splits each file into individual statements, and applies them to D1 in a single `batch()` call.

   ```typescript
   // Routing: this helper belongs to the `workers` Vitest project —
   // it receives a D1Database from cloudflare:test and never imports cloudflare:test itself.

   const SQL_FILES = import.meta.glob<string>(
     '../../migrations/*.sql',
     { eager: true, as: 'raw' },
   );

   function parseStatements(sql: string): string[] {
     return sql
       .split(';')
       .map(s => s.replace(/--[^\n]*/g, '').trim())
       .filter(s => s.length > 0);
   }

   export async function applyMigrations(db: D1Database): Promise<void> {
     const sorted = Object.entries(SQL_FILES).sort(([a], [b]) => a.localeCompare(b));
     const statements: string[] = [];
     for (const [, content] of sorted) {
       statements.push(...parseStatements(content));
     }
     await db.batch(statements.map(sql => db.prepare(sql)));
   }
   ```

   Note: `import.meta.glob` is a Vite/Vitest static transform. The `../../migrations/` path is relative to `apps/api/test/helpers/`, resolving to `apps/api/migrations/`. Only files matching `*.sql` (not subdirectories) are included, so `migrations/seed/` is excluded.

2. **Update `test/db/d1-user-repository.spec.ts`:**
   - Add import at top: `import { applyMigrations } from '../helpers/apply-migrations';`
   - In `beforeAll`: replace `await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));` with `await applyMigrations(env.DB);`
   - Delete the entire `MIGRATION_STATEMENTS` / `MIGRATION_SQL` constant block.

3. **Update `test/db/d1-media-repository.spec.ts`:** same pattern as step 2.

4. **Update `test/db/d1-quest-repository.spec.ts`:** same pattern as step 2.

5. **Update `test/db/d1-tag-repository.spec.ts`:** same pattern as step 2.

6. **Update `test/db/d1-refresh-token-repository.spec.ts`:** same pattern as step 2.

7. **Run the pilot specs in isolation first**, then the full suite:
   ```bash
   cd apps/api
   pnpm test test/db/d1-user-repository
   pnpm test test/db/d1-media-repository
   pnpm test test/db/d1-quest-repository
   pnpm test test/db/d1-tag-repository
   pnpm test test/db/d1-refresh-token-repository
   pnpm test
   ```

## Acceptance Criteria mapping

| AC | Plan step | Persona | Verification |
|---|---|---|---|
| Helper file exists | 1 | backend | `ls apps/api/test/helpers/apply-migrations.ts` |
| All 5 pilot specs run green | 2–7 | backend | Per-spec `pnpm test` + full suite |
| No inline `CREATE TABLE` in pilot specs | 2–6 | backend | grep |
| Helper reads from `apps/api/migrations/**` by default | 1 | backend | `import.meta.glob` pattern verified |
| `make test-api` and `make lint` pass | 7 | backend | exit 0 |
| No diff outside `test/helpers/**` and 5 pilot specs | all | backend | `git diff --stat` |

## Risks & open questions

- **`import.meta.glob` in workers pool:** Vite processes `import.meta.glob` statically before bundling. The `eager: true, as: 'raw'` variant inlines SQL file content as strings at bundle time, so no filesystem access is needed at Worker runtime. This is safe in `@cloudflare/vitest-pool-workers`.
- **Statement splitting edge cases:** The `split(';')` approach handles standard DDL/DML. Migration files in this project are clean SQL (no stored procedures or PL/pgSQL), so simple splitting is safe. Line comments (`--`) are stripped before filtering.
- **Tag repository only needs the `tags` table**, but applying all migrations is fine since all tables use `CREATE TABLE IF NOT EXISTS`. The extra tables don't harm anything.
- **`as: 'raw'` vs `query: '?raw'`:** Vite 4+ supports both. Try `as: 'raw'` first; if it fails TypeScript compilation, switch to `{ query: '?raw', import: 'default', eager: true }`.

## Verification

```bash
make lint     # from repo root
make test-api # from repo root
```

Both must exit 0.

## Out of scope

- The remaining ~24 spec files with inline `CREATE TABLE` (Task 10).
- Modifying any migration file.
- Creating `apps/api/test/README.md` (left for Task 05 to own).
