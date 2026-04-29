# Testing — Vitest + Cloudflare Workers Pool

## Overview

`apps/api` runs its tests in the real Cloudflare Workers runtime via
[`@cloudflare/vitest-pool-workers`](https://www.npmjs.com/package/@cloudflare/vitest-pool-workers).
That gives every spec access to the Worker's `env` (D1, KV, secrets, vars)
exactly as production sees it — at the price of a stricter mental model than
plain Vitest.

This document explains the harness, the three test layers we maintain, and
how to bootstrap fixtures without leaking state across files.

## Quick Reference

| Layer | Lives in | Boundary under test | Strategy |
|---|---|---|---|
| Controller | `test/controllers/*.spec.ts` | Pure business logic | In-memory mocks of every port |
| Repository | `test/db/d1-*.spec.ts` | SQL ↔ records | Real D1 in `env.DB`, schema bootstrapped per file |
| Route (integration) | `test/routes/*.spec.ts` | HTTP through `worker.fetch` | Real D1, real JWT, real middleware |
| Middleware | `test/middleware/*.spec.ts` | Single Hono middleware | Hand-rolled minimal Hono app |
| Adapter | `test/adapters/**/*.spec.ts` | Adapter implementation | Whatever the adapter needs (D1, KV, in-memory) |

> [!IMPORTANT]
> The Workers pool gives every **test file** its own isolate, but D1, KV, and
> R2 state persists for the duration of that file. Use `beforeAll` to set up
> schema once; use `beforeEach` only when you need clean state per test.

---

## How to Run Tests

```bash
make test-api                                    # all API tests
cd apps/api && pnpm test test/db                  # one folder
cd apps/api && pnpm test d1-topic-node-repository # one file (substring match)
cd apps/api && pnpm test --grep "create + findById round-trip"
```

Tests run inside `wrangler` using `apps/api/wrangler.jsonc` — bindings declared
there (D1, KV, R2, vars) become `env.X` in tests.

---

## Vitest Config

`apps/api/vitest.config.mts`:

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  resolve: { alias: { "@api": path.resolve(__dirname, "./src") } },
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

The `cloudflare:test` module is provided by the pool. Its surface:

| Import | Type |
|---|---|
| `env` | The Worker `env` for the active environment (D1, KV, R2, secrets, vars) |
| `createExecutionContext()` | Returns an `ExecutionContext` to pass to `worker.fetch` |
| `waitOnExecutionContext(ctx)` | Awaits any `ctx.waitUntil(...)` work the worker queued |
| `SELF` | A live `Fetcher` to the worker (alternative to `worker.fetch`) |

Type augmentation lives in `test/env.d.ts`:

```typescript
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    DB: D1Database;
  }
}
```

Add new bindings here as they're declared in `wrangler.jsonc`.

---

## Layer 1 — Controller Tests (Mocked Ports)

Controllers depend only on port interfaces, so they test fastest. Use
`vi.fn()` to stub every method on every port the controller touches; assert
on the returned `ControllerResult`.

### Pattern: factory functions per port

```typescript
function makeTopicsRepo(overrides: Partial<ITopicNodeRepository> = {}): ITopicNodeRepository {
  return {
    findById: vi.fn(async (id) => (id === TOPIC.id ? TOPIC : null)),
    listAll: vi.fn(async () => []),
    listChildren: vi.fn(async () => []),
    create: vi.fn(async () => TOPIC),
    update: vi.fn(async () => TOPIC),
    move: vi.fn(async () => TOPIC),
    archive: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    wouldCreateCycle: vi.fn(async () => false),
    ...overrides,
  };
}
```

Build factories for each port at the top of the spec, then override only the
methods that matter per test:

```typescript
it('returns 404 when topic does not exist', async () => {
  topicsRepo = makeTopicsRepo({ findById: vi.fn(async () => null) });
  controller = new AdminMediaController(topicsRepo, mediaRepo, storageAdapter);

  const result = await controller.listMedia('missing');

  expect(result).toEqual({ ok: false, status: 404, error: 'NotFound', meta: { detail: 'topic not found' } });
});
```

### Rules

- **Assert the whole `ControllerResult`** when checking failures — status,
  error code, and `meta` are part of the contract; partial assertions hide
  drift.
- **Don't reach into `vi.fn().mock`** unless you genuinely need to verify
  call shape (e.g. "was `softDelete` called *before* `deleteObject`?"). Most
  tests only need the return value.
- **Reuse fixture constants** (`TOPIC`, `MEDIA_PENDING`, `MEDIA_READY`) at
  the top of the file. Don't re-declare per `it`.

---

## Layer 2 — Repository Tests (Real D1)

Repositories must run against real SQLite. The Workers pool gives each test
file an in-memory `env.DB`; bootstrap the schema with `db.batch` of raw
`CREATE TABLE` statements in `beforeAll`.

### Pattern: copy migration SQL into the spec

```typescript
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1TopicNodeRepository } from '@api/adapters/db/d1-topic-node-repository';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS topic_nodes ( /* … */ )`,
  `CREATE TABLE IF NOT EXISTS tags        ( /* … */ )`,
  // …
];

describe('D1TopicNodeRepository', () => {
  let repo: D1TopicNodeRepository;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    repo = new D1TopicNodeRepository(env.DB);
  });

  it('create + findById round-trip', async () => {
    const node = await repo.create({ title: 'Intro to Algebra' });
    const fetched = await repo.findById(node.id);
    expect(fetched!.id).toBe(node.id);
  });
});
```

### Why inline the schema instead of running real migrations?

- The local D1 simulator's `exec()` runs **one statement at a time**;
  multi-statement migration files don't import cleanly.
- Specs become self-contained — they don't break when migrations are
  reorganised.
- The trade-off: **schema drift between migration and test is possible**. If
  you change a migration, search for the affected `CREATE TABLE` strings in
  `test/` and update them in lockstep. CI will catch most drift via
  controller/route tests, but the inline schema is the source of truth for
  the repository spec.

### Test data isolation

Specs in the same file share `env.DB`. Two strategies:

1. **Use unique values per test** (random titles, generated UUIDs). Cheap,
   no cleanup needed, what most repository specs do.
2. **`beforeEach` truncate** when ordering matters. Skip this unless a test
   really needs an empty table — it's slower and easy to forget for new
   tables.

> [!TIP]
> Don't `DROP TABLE` between tests. The next `beforeAll` won't re-run, and
> later specs will fail with "no such table". Truncate, don't drop.

---

## Layer 3 — Route Integration Tests (Real Worker)

For HTTP-level concerns — auth guards, status codes, cookies, CORS — call
`worker.fetch` directly with a real `Request`. The worker constructs all
adapters from `env`, so this exercises the full per-request wiring.

### Pattern: `req()` helper + token minting

```typescript
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

let adminToken: string;

beforeAll(async () => {
  await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  adminToken = await adapter.signAccessToken({
    sub: 'admin-test',
    email: 'admin@test',
    roles: ['admin'],
  });
});

async function req(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const request = new IncomingRequest(`http://example.com${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
```

Rules of thumb:

- **Mint tokens with the same `JwtAuthAdapter`** the worker uses — use
  `env.JWT_SECRET` so the verify side accepts them.
- **Always `await waitOnExecutionContext(ctx)`** after `worker.fetch`. Some
  Worker internals (and any user `ctx.waitUntil`) finish on the context, not
  the response promise. Skipping this is a flaky-test smell.
- **Drive a matrix for auth** (admin / content_creator / student / no token)
  via a simple `[method, path][]` table — see `admin-topics.router.spec.ts`
  for the pattern.
- **Don't mock the database in route tests.** The whole point is end-to-end.

---

## Layer 4 — Middleware Tests (Hand-Rolled Hono App)

Middleware is small enough to test in isolation without the full worker.
Build a minimal Hono app, inject the adapter into context, and `app.request`:

```typescript
function buildTestApp(adapter: IAuthAdapter, ...handlers: any[]) {
  const app = new Hono();
  app.use('*', (c, next) => { c.set('auth', adapter); return next(); });
  app.get('/test', ...handlers);
  return app;
}

it('returns 401 when token verification fails', async () => {
  const app = buildTestApp(makeMockAuth(null), authGuard, (c) => c.json({ ok: true }));
  const res = await app.request('/test', { headers: { Authorization: 'Bearer x' } });
  expect(res.status).toBe(401);
});
```

This bypasses `worker.fetch` and is the right tool for "did the middleware
short-circuit at the right moment?" — much faster than a full route test.

---

## Layer 5 — Adapter Tests

Adapter tests live under `test/adapters/<area>/`. They mirror the production
surface 1:1 — one spec per adapter. Construct the adapter with whatever
config it needs, use the binding directly (KV, R2) when the adapter needs
one, and assert on the adapter's public API. No business logic involved.

For `JwtAuthAdapter`, that means testing hash format, verify behaviour, and
PBKDF2 iteration introspection. For `KvRateLimiter`, exercise `peek`, `hit`,
and `reset` against `env.RATE_LIMIT_KV`.

---

## Choosing the Right Layer

When adding a feature, prefer the **lowest** layer that gives you confidence:

| You want to verify… | Test at layer |
|---|---|
| A validation rule rejects bad input | Controller (mocked ports) |
| A repository persists a many-to-many association | Repository (real D1) |
| An admin endpoint returns 403 for students | Route (full worker) |
| A migration script's invariants hold | Repository (raw SQL or extra spec) |
| Cookie attributes are set correctly | Route (assert `Set-Cookie` header) |
| `authGuard` strips `"Bearer "` correctly | Middleware (minimal Hono app) |
| PBKDF2 iteration count is honoured | Adapter |

Don't write a route test for something a controller test already covers —
it's slower, more brittle, and tests the same logic twice.

---

## Anti-Patterns

| Don't | Do |
|---|---|
| Import from `cloudflare:test` outside spec files | Keep it confined to test code; production must not depend on it |
| Skip `waitOnExecutionContext(ctx)` after `worker.fetch` | Always await it — flakes hide here |
| Construct `JwtAuthAdapter` with a hardcoded secret | Use `env.JWT_SECRET` so the worker accepts the same tokens |
| Truncate via `DROP TABLE` between tests | `DELETE FROM`; the schema bootstrap won't re-run |
| Re-implement `req()` in every route spec | Copy the helper at the top of one file; keep it identical across files |
| Mock the database in a route integration test | If you're mocking D1, you wanted a controller test |
| Assert only `result.ok === false` | Assert the full `{ ok, status, error, meta }` shape |
| Share fixture mutable objects across tests | Treat fixtures as immutable; clone or rebuild per test |
| Use `vi.mock()` to patch adapter modules | Inject mock ports through the controller constructor instead |
| Ignore `process.env` (it doesn't exist) | All config flows through `env.X` from `wrangler.jsonc` |

---

## Related Files

| File | Role |
|---|---|
| `apps/api/vitest.config.mts` | Wires the Cloudflare Workers Vitest pool |
| `apps/api/test/env.d.ts` | Augments `cloudflare:test`'s `ProvidedEnv` with our bindings |
| `apps/api/test/db/d1-topic-node-repository.spec.ts` | Reference repository spec (inline schema, real D1) |
| `apps/api/test/controllers/admin-media.controller.spec.ts` | Reference controller spec (port-factory mocks) |
| `apps/api/test/routes/admin-topics.router.spec.ts` | Reference route spec (`worker.fetch`, token matrix) |
| `apps/api/test/middleware/auth-guard.spec.ts` | Reference middleware spec (minimal Hono harness) |
| `apps/api/wrangler.jsonc` | Bindings the test pool exposes via `env.X` |
| `docs/product/api/controller-pattern.md` | What a controller is — the unit under test in Layer 1 |
| `docs/product/api/repository-conventions.md` | What a repository must do — the contract Layer 2 verifies |
| `docs/product/api/auth-and-guards.md` | Token model and guards — referenced by Layer 3 setup |
