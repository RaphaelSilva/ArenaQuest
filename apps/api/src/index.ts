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
import { Scalar } from '@scalar/hono-api-reference';

import { buildContainer } from '@api/container';
import { runScheduledBilling } from '@api/core/billing/billing-service';
import { sweepPendingSubmissions } from '@api/jobs/sweep-pending-submissions';
import { reconcileMissions } from '@api/jobs/reconcile-missions';
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
  app.get('/docs', Scalar({ url: '/openapi.json' }));

  return app;
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    return buildApp(env).fetch(request, env, ctx);
  },

  /**
   * The daily billing run (RFC 0013 §6), fired by `triggers.crons`.
   *
   * A delegation and nothing else: every rule lives in
   * `BillingService.runBillingCycle`, which `POST /v1/admin/billing/invoices/run`
   * calls too — one routine, two callers. The container is built **inside** the
   * handler for the same reason `fetch` builds it per request: Workers share no
   * memory between invocations, so a hoisted adapter is a correctness bug.
   *
   * The abandoned-upload sweep (RFC 0020 §9) runs after billing on the same
   * daily trigger, in a `finally` so a billing failure never skips it; the
   * sweep itself never throws, so it cannot affect billing either.
   *
   * The mission reconciliation (RFC 0022 §4) runs last, in its own `finally`
   * link, so neither a billing nor a sweep failure skips it; it never throws
   * either, so it cannot affect them.
   */
  async scheduled(
    _controller: ScheduledController,
    env: AppEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const container = buildContainer(env);
    try {
      await runScheduledBilling(container);
    } finally {
      try {
        await sweepPendingSubmissions({
          submissions: container.engagement.submissionRepo,
          storage: container.content.storage,
        });
      } finally {
        await reconcileMissions({
          missions: container.gamification.missionRepo,
          participation: container.gamification.missionParticipationRepo,
          evaluator: container.gamification.missionEvaluator,
        });
      }
    }
  },
} satisfies ExportedHandler<AppEnv>;
