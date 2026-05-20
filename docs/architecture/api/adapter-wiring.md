# Adapter Wiring — Per-Request Lifecycle

## Overview

ArenaQuest's API is built on the **ports & adapters** (hexagonal) pattern.
Domain code in controllers depends only on interfaces in
`@arenaquest/shared/ports`; concrete adapters (D1, R2, JWT, KV) live in
`apps/api/src/adapters/` and are stitched together at the edge.

On Cloudflare Workers, this stitching has one hard rule: **adapters are
constructed per request, never at module scope.** This document explains why,
how the wiring is structured, and how to add a new adapter or binding without
breaking the model.

## Quick Reference

| Concern | Where it lives |
|---|---|
| Worker entry point | `apps/api/src/index.ts` (`buildApp(env)`) |
| Route registration | `apps/api/src/routes/index.ts` (`AppRouter.register`) |
| Adapter implementations | `apps/api/src/adapters/{auth,db,rate-limit,storage}/` |
| Port interfaces | `packages/shared/ports/` |
| Worker bindings types | `apps/api/worker-configuration.d.ts` (regenerate via `make cf-typegen`) |
| Binding declarations | `apps/api/wrangler.jsonc` |

> [!IMPORTANT]
> Workers have **no shared memory between requests** — but module scope *is*
> shared within an isolate. Putting an adapter at module scope leaks state
> (sometimes secrets) across requests and tenants. Always construct inside the
> fetch handler.

---

## Why Per-Request Construction?

Cloudflare Workers run inside a V8 isolate that may serve **many requests
across many environments and accounts** during its lifetime. Module-level
state is observable across all of them.

| Pitfall | Consequence |
|---|---|
| Cache an `env.JWT_SECRET` in module scope | Leaks the staging secret into a production isolate after a redeploy |
| Hold a D1 prepared statement at module scope | Statement is bound to one isolate's `env.DB` — wrong reference after rotation |
| Memoise an `IAuthAdapter` instance | Captures the first request's secret forever |
| Read `env.X` at the top of a file | `env` is undefined at import time on Workers |

The contract is simple: **every adapter takes its bindings/secrets through its
constructor**, and `buildApp(env)` constructs them fresh for each invocation.

---

## The Wiring Path

### Step 1 — Worker entry: `src/index.ts`

```typescript
function buildApp(env: AppEnv): Hono {
  const auth     = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  const users    = new D1UserRepository(env.DB);
  const tokens   = new D1RefreshTokenRepository(env.DB);
  const topics   = new D1TopicNodeRepository(env.DB);
  const tags     = new D1TagRepository(env.DB);
  const media    = new D1MediaRepository(env.DB);
  const storage  = new R2StorageAdapter({
    bucket: env.R2,
    s3Endpoint: env.R2_S3_ENDPOINT,
    bucketName: env.R2_BUCKET_NAME,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    publicBase: env.R2_PUBLIC_BASE || undefined,
  });
  const authService  = new AuthService(auth, users, tokens);
  const loginLimiter = new KvRateLimiter(env.RATE_LIMIT_KV);

  const app = new Hono();
  AppRouter.register(app, { auth, users, tokens, topics, tags, media, storage, authService, loginLimiter, /* … */ });
  return app;
}

export default {
  async fetch(request, env, ctx) {
    return buildApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
```

Read this top-to-bottom and the entire dependency graph is visible: bindings
flow into adapters, adapters flow into services, services flow into the
router.

### Step 2 — Router: `src/routes/index.ts`

`AppRouter.register` accepts the constructed adapters as a typed `deps` bag
and:

1. Mounts CORS using `allowedOrigins` from the env.
2. Stashes `auth` on the Hono context so middleware (`authGuard`,
   `requireRole`) can reach it without going back through `env`.
3. Mounts each feature router (`/auth`, `/admin/users`, `/admin/topics`,
   `/topics`), passing only the adapters that router actually needs.

### Step 3 — Feature router: `src/routes/admin-topics.router.ts`

```typescript
export function buildAdminTopicsRouter(topics: ITopicNodeRepository, tags: ITagRepository): Hono {
  const router = new Hono();
  const controller = new AdminTopicsController(topics, tags);
  router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));
  // …
  return router;
}
```

Each feature router constructs its **controller** from the injected ports.
The router function is the seam between "infrastructure" (adapters) and
"behaviour" (controllers).

### Step 4 — Controller

Receives only port interfaces (`ITopicNodeRepository`, `ITagRepository`, …).
Has no knowledge of D1, R2, KV, or even Hono. See
[`controller-pattern.md`](./controller-pattern.md).

---

## Layer Boundaries

```
            ┌──────────────────────────────────────┐
            │  Cloudflare Worker runtime (env)     │
            └──────────────────┬───────────────────┘
                               │  bindings, secrets
            ┌──────────────────▼───────────────────┐
            │  buildApp(env)  — src/index.ts       │
            │  constructs adapters per request     │
            └──────────────────┬───────────────────┘
                               │  port instances
            ┌──────────────────▼───────────────────┐
            │  AppRouter.register                  │
            │  + feature routers                   │
            │  (CORS, auth guards, status mapping) │
            └──────────────────┬───────────────────┘
                               │  port instances
            ┌──────────────────▼───────────────────┐
            │  Controllers                         │
            │  (validation, business rules)        │
            │  return ControllerResult<T>          │
            └──────────────────────────────────────┘
```

Each arrow points downward only — no layer reaches up. A controller never
imports `hono`; a router never imports `@cloudflare/workers-types`; an adapter
never imports a controller.

---

## Bindings Reference

Declared in `apps/api/wrangler.jsonc` (and per-environment under `env.staging`,
etc.). Run `make cf-typegen` after any change to refresh types.

| Binding | Type | Purpose | Consumer |
|---|---|---|---|
| `JWT_SECRET` | secret | HMAC signing secret | `JwtAuthAdapter` |
| `DB` | D1 database | Primary datastore | `D1*Repository` |
| `RATE_LIMIT_KV` | KV namespace | Login throttling state | `KvRateLimiter` |
| `R2` | R2 bucket | Media storage | `R2StorageAdapter` |
| `R2_S3_ENDPOINT` | var | S3-compatible endpoint URL | `R2StorageAdapter` (presign) |
| `R2_BUCKET_NAME` | var | Bucket name for presign URLs | `R2StorageAdapter` |
| `R2_ACCESS_KEY_ID` | secret | S3 credential id | `R2StorageAdapter` (presign) |
| `R2_SECRET_ACCESS_KEY` | secret | S3 credential secret | `R2StorageAdapter` (presign) |
| `R2_PUBLIC_BASE` | var (optional) | Public CDN base URL | `R2StorageAdapter` |
| `ALLOWED_ORIGINS` | var | Comma-separated CORS allowlist | `AppRouter` (CORS middleware) |
| `COOKIE_SAMESITE` | var | `Strict` / `Lax` / `None` | Auth router (refresh cookie) |

> [!TIP]
> Set secrets with `wrangler secret put NAME` (or `--env staging`). Set vars in
> `wrangler.jsonc`. Never commit secrets, and never read them at module scope.

---

## Implementation Checklist: Adding a New Adapter

Use this for any new external dependency (a new datastore, a notification
provider, an S3-compatible bucket, etc.).

### 1. Define the port

`packages/shared/ports/i-foo-adapter.ts`:

```typescript
export interface IFooAdapter {
  send(event: FooEvent): Promise<void>;
}
```

Re-export it from `packages/shared/ports/index.ts`. The port lives in
`shared` so other apps (web, future workers) can depend on it.

### 2. Implement the adapter

`apps/api/src/adapters/foo/foo-adapter.ts`:

```typescript
export interface FooAdapterConfig { apiKey: string; endpoint: string; }

export class HttpFooAdapter implements IFooAdapter {
  constructor(private readonly cfg: FooAdapterConfig) {}
  async send(event: FooEvent) { /* fetch(this.cfg.endpoint, …) */ }
}
```

Constructor takes everything from configuration — never `env`. Adapters must
be unit-testable with no Workers runtime.

### 3. Declare the binding

`apps/api/wrangler.jsonc`:

```jsonc
{
  "vars": { "FOO_ENDPOINT": "https://api.foo.example" }
  // FOO_API_KEY is added with: wrangler secret put FOO_API_KEY
}
```

Run `make cf-typegen` to refresh `worker-configuration.d.ts`.

### 4. Wire it in `src/index.ts`

```typescript
const foo = new HttpFooAdapter({ apiKey: env.FOO_API_KEY, endpoint: env.FOO_ENDPOINT });
AppRouter.register(app, { /* …, */ foo });
```

### 5. Pass it through `AppRouter` to the routers that need it

Add `foo: IFooAdapter` to the `deps` type in `routes/index.ts`, then forward
it to the relevant `build*Router(...)` functions. Don't pass it to routers
that don't use it — keeping arguments narrow makes it obvious which routers
own which capabilities.

---

## Anti-Patterns

| Don't | Do |
|---|---|
| `const auth = new JwtAuthAdapter({ secret: process.env.JWT_SECRET })` at module top | Construct inside `buildApp(env)` |
| Cache a `D1Database` reference in a singleton | Pass `env.DB` into a fresh repository each request |
| Read `env` from inside an adapter method | Take everything you need in the constructor |
| Import `hono` in an adapter or controller | Adapters know nothing about HTTP; controllers depend on ports only |
| Make `AppRouter.register` accept the raw `env` | Accept already-built adapters; the env-to-adapter mapping is `index.ts`'s job |
| Add a binding without running `make cf-typegen` | Always regenerate types so TypeScript catches typos in `env.X` |

---

## Related Files

| File | Role |
|---|---|
| `apps/api/src/index.ts` | `buildApp(env)` — single source of per-request wiring |
| `apps/api/src/routes/index.ts` | `AppRouter.register` — typed `deps` bag, CORS, feature mounts |
| `apps/api/src/adapters/auth/jwt-auth-adapter.ts` | Reference adapter showing constructor-injected config |
| `apps/api/src/adapters/storage/r2-storage-adapter.ts` | R2/S3 presign adapter |
| `apps/api/src/adapters/db/d1-*.ts` | D1-backed repositories |
| `apps/api/src/adapters/rate-limit/kv-rate-limiter.ts` | KV-backed rate limiter |
| `apps/api/wrangler.jsonc` | Binding and per-environment declarations |
| `apps/api/worker-configuration.d.ts` | Generated `Env` type — regenerate via `make cf-typegen` |
| `packages/shared/ports/index.ts` | Port re-exports consumed by controllers and routers |
