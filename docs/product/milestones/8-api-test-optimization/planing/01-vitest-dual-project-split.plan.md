# Plan — 01-vitest-dual-project-split

**Task:** [01-vitest-dual-project-split.task.md](../01-vitest-dual-project-split.task.md)
**Source:** Milestone 8
**Assigned personas:** backend-developer
**Branch:** feature/m8/01-vitest-dual-project-split.task (from feature/m8/api-test-optimization)

## Objective

Reorganise `apps/api/vitest.config.mts` into two named Vitest projects — `workers` and `node` — so that controller, core, adapter, and middleware specs stop paying the Miniflare boot cost (~2–3 s per file). The `workers` project keeps the existing `@cloudflare/vitest-pool-workers` pool for all files that import `cloudflare:test` or need real Miniflare bindings; a new `node` project runs on the default Node pool and covers every other spec.

The routing rule (to be preserved in code comments):
> A spec belongs to `workers` iff it imports `cloudflare:test` or otherwise depends on Miniflare bindings (D1, R2, KV, Worker `fetch`). All other specs belong to `node`.

No spec files are moved or modified. This is a config-only change.

## Affected areas

### In scope
- `apps/api/vitest.config.mts` — full rewrite using two named projects
- `apps/api/package.json` — optionally add `test:workers` / `test:node` script aliases

### Out of scope
- `apps/api/test/**/*.spec.ts` — no spec files are touched
- `apps/api/src/**` — no production code
- `packages/shared/**`, `apps/web/**`

## Step-by-step

### Backend

1. **Replace `vitest.config.mts` with a two-project config.**

   Change the top-level import from `defineWorkersConfig` to `defineConfig` (from `vitest/config`) and import `defineWorkersProject` from `@cloudflare/vitest-pool-workers/config`.

   New structure:

   ```typescript
   import { defineConfig } from "vitest/config";
   import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";
   import path from "path";

   const alias = { "@api": path.resolve(__dirname, "./src") };

   export default defineConfig({
     test: {
       projects: [
         // ── workers project ────────────────────────────────────────────────
         // Include every spec that imports `cloudflare:test` or needs Miniflare.
         defineWorkersProject({
           resolve: { alias },
           test: {
             name: "workers",
             include: [
               "test/db/**/*.spec.ts",
               "test/routes/**/*.spec.ts",
               "test/index.spec.ts",
             ],
             exclude: [
               "test/routes/parse-cookie-samesite.spec.ts",
             ],
             poolOptions: {
               workers: {
                 wrangler: { configPath: "./wrangler.jsonc" },
                 miniflare: {
                   bindings: {
                     JWT_SECRET: "test-secret-at-least-32-characters-long",
                     ALLOWED_ORIGINS: "*",
                     ALLOWED_ORIGIN: "*",
                     COOKIE_SAMESITE: "Strict",
                     MAIL_DRIVER: "console",
                     MAIL_FROM: "ArenaQuest Test <noreply@test.local>",
                     RESEND_API_KEY: "test-key-unused",
                     WEB_BASE_URL: "http://localhost:3000",
                     R2_S3_ENDPOINT: "http://localhost:4566",
                     R2_BUCKET_NAME: "test-bucket",
                     R2_PUBLIC_BASE: "",
                     R2_ACCESS_KEY_ID: "test-access-key",
                     R2_SECRET_ACCESS_KEY: "test-secret-key-at-least-32-chars-long",
                     GOOGLE_CLIENT_ID: "test-google-client-id",
                     GOOGLE_CLIENT_SECRET: "test-google-client-secret",
                     GOOGLE_REDIRECT_URI: "http://localhost:8787/auth/google/callback",
                   },
                   d1Databases: ["DB"],
                   r2Buckets: ["R2"],
                   kvNamespaces: ["RATE_LIMIT_KV"],
                 },
               },
             },
           },
         }),
         // ── node project ───────────────────────────────────────────────────
         // Pure-unit specs that do NOT import `cloudflare:test`.
         // Runs on default Node pool — no Miniflare boot cost.
         {
           resolve: { alias },
           test: {
             name: "node",
             environment: "node",
             include: [
               "test/adapters/**/*.spec.ts",
               "test/controllers/**/*.spec.ts",
               "test/core/**/*.spec.ts",
               "test/middleware/**/*.spec.ts",
               "test/routes/parse-cookie-samesite.spec.ts",
               "test/shared-roles.spec.ts",
             ],
           },
         },
       ],
     },
   });
   ```

2. **Optionally add per-project script aliases in `apps/api/package.json`.**

   Add (only if the existing `test` script still works end-to-end after the config change):
   ```json
   "test:workers": "vitest run --project workers",
   "test:node":    "vitest run --project node"
   ```
   The existing `"test": "vitest run"` must continue to run BOTH projects and must be what `make test-api` calls. Do not change the existing `test` script.

3. **Verify both projects run and pass.**

   ```bash
   cd apps/api
   pnpm test --project workers   # should show only workers specs
   pnpm test --project node      # should show only node specs
   pnpm test                     # both together, all green
   ```

4. **Record wall time.**

   After all tests pass, record the wall time of `pnpm --filter @arenaquest/api test` in `.wall-time-log.md` (the executor must NOT create this file — the orchestrator records it after observing the output).

## Acceptance Criteria mapping

| AC | Plan step | Persona | Verification |
|---|---|---|---|
| `pnpm --filter @arenaquest/api test` runs both projects, exits green | 1, 3 | backend | `pnpm test` exit 0 |
| Vitest output shows two projects named `workers` and `node` | 1, 3 | backend | `pnpm test --reporter=verbose` shows project names |
| All non-`cloudflare:test` specs run under `node` project | 1, 3 | backend | `pnpm test --project node` picks up controllers/core/adapters/middleware/parse-cookie/shared-roles |
| Wall time drops measurably vs 63.76 s baseline | 1 | backend | Observed wall time < 48 s |
| No diff outside vitest.config.mts and optionally package.json | 1, 2 | backend | `git diff --stat` shows ≤ 2 files |

## Risks & open questions

- **`defineWorkersProject` vs `defineWorkersConfig`:** `defineWorkersProject` is confirmed exported in `@cloudflare/vitest-pool-workers@^0.12.4`. If it returns a Promise, wrap the whole `projects` array in an async IIFE or use `defineConfig` accepting promises — check the return type at import time.
- **`test/tsconfig.json` types:** The `test/tsconfig.json` globally includes `@cloudflare/vitest-pool-workers` types. Node-project specs compile against these types but don't use Miniflare at runtime — this is safe because the specs only implement Cloudflare type interfaces with fakes, never calling actual Cloudflare globals.
- **Route `parse-cookie-samesite.spec.ts`:** Excluded from workers include glob via explicit `exclude` entry, then covered by the node `include` list. Double-check it appears exactly once across both projects.

## Verification

```bash
make lint          # from repo root
make test-api      # from repo root (runs pnpm --filter @arenaquest/api test)
```

Both must exit 0. Additionally:
```bash
cd apps/api && pnpm test --project workers  # only workers files
cd apps/api && pnpm test --project node     # only node files
```

## Out of scope

- Moving, renaming, or modifying any `.spec.ts` file.
- Adjusting per-file timeouts, isolate flags, or coverage providers.
- Any change to `apps/api/src/**`, `packages/shared/**`, or `apps/web/**`.
