/**
 * ArenaQuest — Cloudflare Worker entry point
 *
 * Adapter wiring pattern:
 *   - Ports (interfaces) live in @arenaquest/shared — imported here as types only.
 *   - Concrete adapters live in ./adapters — instantiated once per request
 *     via buildContainer() using secrets/bindings from the Worker `env` object.
 *   - Route handlers receive already-constructed services via closure, never via
 *     module-level singletons (Workers have no shared memory between requests).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { apiReference } from '@scalar/hono-api-reference';

import { buildContainer } from '@api/container';
import { AppRouter } from '@api/routes';
import { configureOpenAPIDocument } from '@api/openapi/document';
import '@api/types/hono-env';

export type AppEnv = Env;

export function buildApp(env: AppEnv): OpenAPIHono {
  const container = buildContainer(env);
  const app = new OpenAPIHono();

  AppRouter.register(app, container);

  // Configure OpenAPI documentation at /openapi.json
  configureOpenAPIDocument(app);

  // Serve Scalar UI at /docs for browsing the OpenAPI spec
  app.get('/docs', apiReference({ url: '/openapi.json' }));

  return app;
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Transparently rewrite legacy routes to their versioned /v1 counterparts
    if (
      path.startsWith('/auth') ||
      path.startsWith('/me') ||
      path.startsWith('/admin') ||
      path.startsWith('/topics') ||
      path.startsWith('/tasks') ||
      path.startsWith('/leaderboard') ||
      path.startsWith('/catalog')
    ) {
      url.pathname = `/v1${path}`;
      const rewrittenRequest = new Request(url.toString(), request);
      return buildApp(env).fetch(rewrittenRequest, env, ctx);
    }

    return buildApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
