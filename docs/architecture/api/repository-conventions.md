# Repository Conventions — D1 Adapters

## Overview

Repositories are the **only** layer in `apps/api` that knows about D1 or SQL.
They implement port interfaces from `@arenaquest/shared/ports` and translate
between database rows (`snake_case`, integers for booleans, ISO strings for
timestamps) and domain records (`camelCase`, real `boolean`s, typed enums).

This document captures the conventions every D1 repository should follow so
new adapters look and behave like the existing ones.

## Quick Reference

| Convention | Rule |
|---|---|
| File location | `apps/api/src/adapters/db/d1-<entity>-repository.ts` |
| Class name | `D1<Entity>Repository implements I<Entity>Repository` |
| Constructor | Single argument: `private readonly db: D1Database` |
| ID generation | `crypto.randomUUID()` inside `create()` |
| Column casing | `snake_case` in SQL, `camelCase` in records |
| Boolean columns | `INTEGER NOT NULL DEFAULT 0`; convert with `=== 1` |
| Timestamps | Default `datetime('now')` in SQL; mutate `updated_at` on every write |
| Multi-statement writes | Wrap in `db.batch([...])` for atomicity |
| Migrations | `apps/api/migrations/NNNN_<description>.sql`, idempotent |
| After write | Re-read via `findById` and return the full record |

> [!IMPORTANT]
> Repositories must not contain business rules. Cycle checks, lockout guards,
> and "is this referenced anywhere" lookups belong in controllers. The
> repository's job is to faithfully read and write rows.

---

## Anatomy of a Repository

`D1TopicNodeRepository` is the reference implementation; this section walks
through the parts every repository will mirror.

### 1. Row types as a private contract

```typescript
type TopicNodeRow = {
  id: string;
  parent_id: string | null;
  title: string;
  archived: number;        // SQLite has no boolean
  created_at: string;      // ISO string, never Date
  updated_at: string;
};
```

Row types are local to the file — they describe the **on-disk shape**. Domain
records (`TopicNodeRecord`) live in the port and describe the **API shape**.
Mapping happens in a small private `rowToRecord(row)` helper.

### 2. Constructor injection only

```typescript
export class D1TopicNodeRepository implements ITopicNodeRepository {
  constructor(private readonly db: D1Database) {}
}
```

Every repository takes the bound `D1Database` and nothing else. No
configuration, no other adapters. If you find yourself needing another
dependency, that logic probably belongs in a service or controller.

### 3. Read methods

```typescript
async findById(id: string): Promise<TopicNodeRecord | null> {
  const row = await this.db
    .prepare('SELECT * FROM topic_nodes WHERE id = ?')
    .bind(id)
    .first<TopicNodeRow>();

  if (!row) return null;
  return this.rowToRecord(row);
}
```

- Always parameterise. Never interpolate user input into SQL.
- Type the row via the generic on `.first<RowType>()` or `.all<RowType>()`.
- Map rows to records with a single helper so the conversion is consistent.

### 4. Avoid N+1 in list methods

When loading associations (tags, prerequisites, …) for a list, fetch them in
**bulk** and assemble in memory rather than calling `rowToRecord` per row:

```typescript
const [allTagRows, allPrereqRows] = await Promise.all([
  this.db.prepare('SELECT tnt.topic_node_id, t.id, t.name FROM topic_node_tags tnt JOIN tags t ON …').all(),
  this.db.prepare('SELECT topic_node_id, prerequisite_id FROM topic_node_prerequisites').all(),
]);

const tagsMap = new Map<string, Tag[]>();
for (const r of allTagRows.results) { /* group by topic_node_id */ }
```

The single-row helpers are fine for `findById`; lists must always be bulked.

### 5. Write methods are atomic

Use `db.batch([...])` whenever a write touches more than one statement (insert
+ join-table inserts, parent move + sibling renumber, etc.). Batch executes
inside a single transaction:

```typescript
await this.db.batch([
  this.db.prepare('INSERT INTO topic_nodes (...) VALUES (...)').bind(...),
  ...tagIds.map(tagId =>
    this.db.prepare('INSERT OR IGNORE INTO topic_node_tags (...) VALUES (?, ?)').bind(id, tagId),
  ),
]);
```

Partial-write states are not acceptable, even on a join table.

### 6. Updates: dynamic SET, never overwrite missing fields

```typescript
const setClauses = ["updated_at = datetime('now')"];
const values: unknown[] = [];

if (data.title !== undefined)   { setClauses.push('title = ?');   values.push(data.title); }
if (data.content !== undefined) { setClauses.push('content = ?'); values.push(data.content); }

values.push(id);
await this.db.prepare(`UPDATE topic_nodes SET ${setClauses.join(', ')} WHERE id = ?`).bind(...values).run();
```

`undefined` means "leave alone"; explicit `null` means "set to null". The
controller is responsible for picking the right one.

### 7. Read-after-write

After every mutating method, re-fetch and return the full record:

```typescript
const node = await this.findById(id);
if (!node) throw new Error(`D1TopicNodeRepository: failed to fetch node after create (id=${id})`);
return node;
```

Callers should never see a partial record they just wrote.

> [!TIP]
> The throw here is intentional: if the row vanished between write and read,
> something is genuinely broken (concurrent delete, FK cascade, etc.) and a
> `500` is the honest response. This is **not** a business-rule failure.

---

## Soft-Archive vs. Hard Delete

ArenaQuest prefers **soft archival** for content tables: a `archived INTEGER`
column plus a status enum (`'archived'`). `delete()` exists for cleanup but is
not exposed through admin endpoints.

```typescript
async archive(id: string): Promise<void> {
  // Recursive CTE cascades archived status to all descendants
  await this.db.prepare(
    `WITH RECURSIVE descendants(id) AS (
       SELECT id FROM topic_nodes WHERE id = ?
       UNION ALL
       SELECT tn.id FROM topic_nodes tn JOIN descendants d ON tn.parent_id = d.id
     )
     UPDATE topic_nodes SET archived = 1, status = 'archived', updated_at = datetime('now')
     WHERE id IN (SELECT id FROM descendants)`,
  ).bind(id).run();
}
```

Recursive CTEs are the right tool for tree cascades — keep them in the
repository, not in the controller.

---

## Migrations

Migrations live under `apps/api/migrations/` and are numbered sequentially
(`0001_…`, `0002_…`). Apply with:

```bash
make db-migrations-dev      # local D1
make db-migrations-staging  # remote staging
make db-migrations-prod     # remote production
```

### Migration rules

- **Idempotent.** Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT
  EXISTS`, `INSERT OR IGNORE`, etc. Migrations may be re-applied during
  recovery; they must not fail on a partially-migrated database.
- **Forward-only.** No `DROP TABLE` of a populated table; use a new migration
  that adds the replacement and a follow-up that removes the old one once the
  app has stopped writing to it.
- **One logical change per file.** Adding a feature that needs three tables
  belongs in one migration; mixing unrelated changes in one file makes
  rollbacks impossible.
- **FK behaviour deliberate.** Pick `ON DELETE CASCADE` only when the child
  rows are conceptually owned by the parent (`topic_node_tags`,
  `topic_node_prerequisites`). Use `ON DELETE RESTRICT` when deletion should
  be blocked at the DB layer (e.g. `topic_nodes.parent_id`).
- **Defaults for new columns.** Adding a `NOT NULL` column to a populated
  table requires a `DEFAULT`. SQLite enforces this strictly.

After adding a migration, run `make cf-typegen` if it changed a binding, and
restart any running `wrangler dev` so the local D1 schema is reloaded.

---

## Implementation Checklist: Adding a New Repository

### 1. Define the port

`packages/shared/ports/i-foo-repository.ts`:

```typescript
export interface FooRecord {
  id: string;
  name: string;
  archived: boolean;
}

export interface CreateFooInput { name: string; }
export interface UpdateFooInput { name?: string; }

export interface IFooRepository {
  findById(id: string): Promise<FooRecord | null>;
  listAll(opts?: { limit?: number; offset?: number }): Promise<FooRecord[]>;
  create(data: CreateFooInput): Promise<FooRecord>;
  update(id: string, data: UpdateFooInput): Promise<FooRecord>;
  archive(id: string): Promise<void>;
}
```

Re-export from `packages/shared/ports/index.ts`.

### 2. Add the migration

`apps/api/migrations/000N_create_foos.sql`:

```sql
CREATE TABLE IF NOT EXISTS foos (
  id         TEXT    NOT NULL PRIMARY KEY,
  name       TEXT    NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

Apply with `make db-migrations-dev`.

### 3. Implement the adapter

`apps/api/src/adapters/db/d1-foo-repository.ts` — follow the anatomy above:
row type, `rowToRecord`, parameterised reads, `db.batch` for multi-statement
writes, dynamic SET on update, read-after-write.

### 4. Wire into `src/index.ts`

```typescript
const foos = new D1FooRepository(env.DB);
AppRouter.register(app, { /* …, */ foos });
```

See [`adapter-wiring.md`](./adapter-wiring.md) for the wiring pattern.

### 5. Test the repository directly

The Cloudflare Workers Vitest pool gives every test a fresh in-memory D1
instance — write small focused specs that insert seed rows, call the
repository, and assert on returned records. See
[`testing-workers.md`](./testing-workers.md) (TBD) for the harness.

---

## Anti-Patterns

| Don't | Do |
|---|---|
| `\`SELECT * FROM x WHERE id = '${id}'\`` | Always use `.bind(id)` with `?` placeholders |
| Convert booleans with `Boolean(row.archived)` | Use `row.archived === 1` for clarity and safety against `null` |
| Loop and `await` per row to load associations | Bulk-load associations and assemble with `Map` |
| Multiple separate `await db.prepare(...).run()` for a logical write | Wrap in `db.batch([...])` for atomicity |
| Return raw `TopicNodeRow` from a public method | Always map to the port-defined record |
| Put cycle checks / lockout guards in the repository | Keep them in the controller; repository stays mechanical |
| Drop or rename columns in a destructive migration | Add new column, dual-write, deprecate, then remove |
| Hand-write timestamps with `new Date().toISOString()` | Let SQL handle them via `datetime('now')` defaults |

---

## Related Files

| File | Role |
|---|---|
| `apps/api/src/adapters/db/d1-topic-node-repository.ts` | Reference implementation (CTEs, batch writes, bulk associations) |
| `apps/api/src/adapters/db/d1-user-repository.ts` | Reference for simpler entity (lockout fields, role joins) |
| `apps/api/src/adapters/db/d1-media-repository.ts` | Reference for media records and presigned-upload state |
| `apps/api/src/adapters/db/hash.ts` | Shared hashing helpers used by repositories that store secrets |
| `apps/api/migrations/` | All D1 migrations (forward-only, idempotent) |
| `packages/shared/ports/i-*-repository.ts` | Port interfaces every repository implements |
| `packages/shared/types/entities.ts` | Domain entity definitions referenced by record types |
