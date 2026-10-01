import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  SubmissionsController,
  type MoveSubmissionsInput,
  type SubmissionCaller,
} from '@api/controllers/submissions.controller';
import {
  AuthoredSubmissionPageSchema,
  MoveSubmissionsBodySchema,
  MoveSubmissionsResultSchema,
} from '@api/openapi/components/entities';
import { ErrorBody } from '@api/openapi/components/errors';
import { respondWith } from '@api/routes/_shared/envelope';
import { encodeCursor, invalidCursorResponse, parseCursorParam } from '@api/routes/_shared/cursor';
import { cursorQuerySchema } from '@api/routes/notes.router';
import { NO_STORE } from '@api/routes/submissions.router';
import type { Context } from 'hono';
import type { ContentContext, EngagementContext, ProgressContext } from '@api/container';

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorBody } },
});

const configInvalid = error('`SUBMISSION_CONFIG_INVALID`: a `SUBMISSIONS_*` var is present but malformed');

export const listMySubmissionsRoute = createRoute({
  method: 'get',
  path: '/submissions',
  summary: 'List my submissions',
  description:
    'Every submission the caller owns, across topics, newest first, with the topic title and `topicAccessible`. On an inaccessible topic a submission is read-only except delete and move. Ready ones carry a signed GET `url` (TTL 1 h). Pages of 20.',
  tags: ['me:submissions'],
  security: [{ bearerAuth: [] }],
  request: { query: cursorQuerySchema },
  responses: {
    200: {
      description: "One page of the caller's submissions",
      content: { 'application/json': { schema: AuthoredSubmissionPageSchema } },
    },
    400: error('Malformed cursor (`InvalidCursor`)'),
    500: configInvalid,
  },
});

export const moveMySubmissionsRoute = createRoute({
  method: 'post',
  path: '/submissions/move',
  summary: 'Move my submissions to another topic',
  description:
    "Moves up to 10 of the caller's ready submissions, in order, each guarded by the target's per-topic count. Partial success is normal. Moved submissions become private, keep their moderation flag, and their file is not touched. The source topic need not be readable.",
  tags: ['me:submissions'],
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: MoveSubmissionsBodySchema } } } },
  responses: {
    200: {
      description: 'Moved and refused items, with a reason per refusal',
      content: { 'application/json': { schema: MoveSubmissionsResultSchema } },
    },
    400: error('Malformed body (no ids, more than 10, or no target)'),
    403: error('Staff do not move submissions'),
    404: error("Target topic missing, draft, archived or outside the caller's access"),
    500: configInvalid,
  },
});

function submissionCaller(c: Context): SubmissionCaller {
  const user = c.get('user');
  return { userId: user.sub, roles: user.roles };
}

/** Mounted under `/v1/me`, whose sub-app already applies `authGuard`. */
export function buildMeSubmissionsRouter(slice: {
  engagement: EngagementContext;
  content: ContentContext;
  progress: ProgressContext;
}): OpenAPIHono {
  const controller = new SubmissionsController(
    slice.engagement.submissionRepo,
    slice.content.topics,
    slice.progress.enrollmentRepo,
    slice.content.storage,
    slice.engagement.submissionConfig,
    slice.engagement.submissionRateLimiter,
  );
  const router = new OpenAPIHono();

  // `/*` also matches the bare `/submissions` listing.
  router.use('/submissions/*', async (c, next) => {
    await next();
    c.header('Cache-Control', NO_STORE);
  });

  router.openapi(listMySubmissionsRoute, async (c) => {
    const cursor = parseCursorParam(c.req.valid('query').cursor);
    if (cursor === undefined) return invalidCursorResponse(c) as any;
    const result = await controller.listMine(submissionCaller(c), cursor);
    if (!result.ok) return respondWith(c, result) as any;
    return c.json(
      {
        data: result.data.data,
        nextCursor: result.data.nextCursor ? encodeCursor(result.data.nextCursor) : null,
      },
      200,
    ) as any;
  });

  router.openapi(moveMySubmissionsRoute, async (c) => {
    const result = await controller.move(submissionCaller(c), c.req.valid('json') as MoveSubmissionsInput);
    return respondWith(c, result) as any;
  });

  return router;
}
