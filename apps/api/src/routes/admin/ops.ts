import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { JOB_RUNS_LIST_DEFAULT_LIMIT, JOB_RUNS_LIST_MAX_LIMIT } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { AdminOpsController } from '@api/controllers/admin-ops.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import { JobRunListSchema, OpsHealthSchema } from '@api/openapi/components/entities';
import type { AppContainer } from '@api/container';

/**
 * `/v1/admin/ops` — measured health and the job-run ledger (RFC 0025 section 3.2).
 *
 * HTTP only: parse, shape. Probing and classification live in
 * `AdminOpsController`. No stricter guard than the `/v1/admin` umbrella: both
 * staff roles may read ops. The anonymous `/health` is a different route and
 * stays untouched — this one names dependencies, migrations and jobs.
 */

const common = { tags: ['admin:ops'], security: [{ bearerAuth: [] }] };

const json = <S extends z.ZodTypeAny>(description: string, schema: S) => ({
  description,
  content: { 'application/json': { schema } },
});

const ERROR_RESPONSES = {
  400: { description: 'Validation failed' },
  401: { description: 'Missing or invalid token' },
  403: { description: 'Forbidden — staff only' },
};

export const opsHealthRoute = createRoute({
  ...common,
  method: 'get',
  path: '/health',
  summary: 'Measured health of every dependency',
  description:
    'Probes the database, the rate-limit store and the object storage with one read each, bounded by a '
    + 'per-probe timeout, and reports the latency, the newest applied migration and the last run of every '
    + 'job. Always `200`: the verdict is in the body.',
  responses: { 200: json('Health report', OpsHealthSchema), ...ERROR_RESPONSES },
});

export const listJobRunsRoute = createRoute({
  ...common,
  method: 'get',
  path: '/job-runs',
  summary: 'List job runs, newest first',
  request: {
    query: z.object({
      job: z.nativeEnum(Entities.Config.JobName).optional().openapi({ example: Entities.Config.JobName.BILLING }),
      since: z
        .string()
        .datetime({ offset: true })
        .optional()
        .openapi({ description: 'ISO timestamp; only runs started at or after it.', example: '2026-10-01T00:00:00Z' }),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(JOB_RUNS_LIST_MAX_LIMIT)
        .default(JOB_RUNS_LIST_DEFAULT_LIMIT)
        .openapi({ example: JOB_RUNS_LIST_DEFAULT_LIMIT }),
    }),
  },
  responses: { 200: json('Job runs', JobRunListSchema), ...ERROR_RESPONSES },
});

export function buildAdminOpsRouter(container: AppContainer) {
  const controller = new AdminOpsController({
    jobRuns: container.infra.jobRuns,
    kv: container.infra.rateLimiters.login,
    storage: container.content.storage,
  });

  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400);
      }
    },
  });

  router.openapi(opsHealthRoute, async (c) => {
    const result = await controller.health();
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(listJobRunsRoute, async (c) => {
    const result = await controller.listJobRuns(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  return router;
}
