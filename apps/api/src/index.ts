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
import { runReconcilePayments, scheduledPlan } from '@api/jobs/reconcile-payments';
import {
  recordJobRun,
  pruneJobRuns,
  billingOutcome,
  sweepOutcome,
  JOB_RUNS_RETENTION_DAYS,
} from '@api/jobs/record-job-run';
import { Entities } from '@arenaquest/shared/types/entities';
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
   * Dispatches on `controller.cron` (`scheduledPlan`): the hourly expression
   * runs the payment reconcile alone, so it neither spends the daily jobs'
   * budget nor waits behind them; an unknown expression logs an error and runs
   * nothing. The payment run records its own `job_runs` row and, with no
   * provider bound, returns before reading anything.
   *
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
   * Each job is wrapped in `recordJobRun` (RFC 0025 §3.1), which leaves one
   * `job_runs` row per execution - `ok` with counts, or `failed` with the
   * error - and rethrows whatever the job threw, so the `try/finally` above
   * keeps its meaning. A failing `job_runs` write is logged and changes
   * nothing about the jobs.
   *
   * The mission reconciliation (RFC 0022 §4) runs after the sweep, in its own
   * `finally` link, so neither a billing nor a sweep failure skips it; it
   * never throws either, so it cannot affect them. It is not recorded in
   * `job_runs` yet: the table's `job` CHECK (migration 0032) names only
   * billing and the sweep, so adding it needs a migration (follow-up). Rows
   * older than 180 days are pruned last.
   */
  async scheduled(
    controller: ScheduledController,
    env: AppEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const plan = scheduledPlan(controller.cron, controller.scheduledTime);
    if (!plan) {
      console.error(
        JSON.stringify({ event: 'scheduled.unknown_cron', cron: controller.cron, at: new Date().toISOString() }),
      );
      return;
    }

    const container = buildContainer(env);
    const jobRuns = container.infra.jobRuns;
    const { JobName, JobTrigger } = Entities.Config;

    if (plan.reconcilePayments) {
      // Sequenced before the daily jobs only in the single-trigger fallback;
      // a failure here must not skip them.
      try {
        await runReconcilePayments(
          {
            config: container.payments.config,
            gateways: container.payments.gateways,
            gatewayRepo: container.payments.gatewayRepo,
            gatewayService: container.payments.gatewayService,
            jobRuns,
          },
          { trigger: JobTrigger.CRON },
        );
      } catch (error) {
        if (!plan.daily) throw error;
        console.error(
          JSON.stringify({
            event: 'payments.reconcile_failed',
            error: error instanceof Error ? error.name : 'Error',
            at: new Date().toISOString(),
          }),
        );
      }
    }
    if (!plan.daily) return;

    try {
      await recordJobRun(
        jobRuns,
        { job: JobName.BILLING, trigger: JobTrigger.CRON },
        () => runScheduledBilling(container),
        billingOutcome,
      );
    } finally {
      try {
        await recordJobRun(
          jobRuns,
          { job: JobName.SWEEP_SUBMISSIONS, trigger: JobTrigger.CRON },
          () =>
            sweepPendingSubmissions({
              submissions: container.engagement.submissionRepo,
              storage: container.content.storage,
            }),
          sweepOutcome,
        );
      } finally {
        await reconcileMissions({
          missions: container.gamification.missionRepo,
          participation: container.gamification.missionParticipationRepo,
          evaluator: container.gamification.missionEvaluator,
        });
        await pruneJobRuns(jobRuns, JOB_RUNS_RETENTION_DAYS);
      }
    }
  },
} satisfies ExportedHandler<AppEnv>;
