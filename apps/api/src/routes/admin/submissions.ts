import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { SubmissionsController, type SubmissionCaller } from '@api/controllers/submissions.controller';
import {
  StaffAuthoredSubmissionPageSchema,
  StaffSubmissionViewSchema,
} from '@api/openapi/components/entities';
import { ErrorBody } from '@api/openapi/components/errors';
import { respondNoContent, respondWith } from '@api/routes/_shared/envelope';
import { encodeCursor, invalidCursorResponse, parseCursorParam } from '@api/routes/_shared/cursor';
import { cursorQuerySchema } from '@api/routes/notes.router';
import { NO_STORE } from '@api/routes/submissions.router';
import type { AppContainer } from '@api/container';

/**
 * Staff submissions (RFC 0020 §8, §10; M23 Task 05). Mounted under `/v1/admin`,
 * whose umbrella `requireRole(ADMIN, CONTENT_CREATOR)` admits both staff roles:
 * both list and moderate; only `admin` removes (checked in the controller).
 * No route here edits or moves a student's submission.
 */

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorBody } },
});

const userParamSchema = z.object({
  userId: z.string().min(1).openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef', description: 'Author user ID' }),
});

const submissionParamSchema = z.object({
  id: z.string().min(1).openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef', description: 'Submission ID' }),
});

const submissionNotFound = error('No ready or removed submission with this ID');
const configInvalid = error('`SUBMISSION_CONFIG_INVALID`: a `SUBMISSIONS_*` var is present but malformed');

export const listUserSubmissionsRoute = createRoute({
  method: 'get',
  path: '/users/{userId}/submissions',
  summary: "List a user's submissions (staff)",
  description:
    'Every ready or removed submission by the user, across topics, newest first, with the topic title and moderation / removal provenance. Ready ones carry a signed GET `url` (TTL 1 h). An unknown user yields an empty page. Pages of 20.',
  tags: ['admin:submissions'],
  security: [{ bearerAuth: [] }],
  request: { params: userParamSchema, query: cursorQuerySchema },
  responses: {
    200: {
      description: "One page of the user's submissions",
      content: { 'application/json': { schema: StaffAuthoredSubmissionPageSchema } },
    },
    400: error('Malformed cursor (`InvalidCursor`)'),
    500: configInvalid,
  },
});

export const unshareSubmissionRoute = createRoute({
  method: 'post',
  path: '/submissions/{id}/unshare',
  summary: 'Force-unshare a submission (staff)',
  description:
    'Sets the submission private and flags it moderated, recording who and when. The author cannot share it again (`409 SUBMISSION_MODERATED`) until the flag is cleared; a move keeps the flag. Title, description and file are never changed.',
  tags: ['admin:submissions'],
  security: [{ bearerAuth: [] }],
  request: { params: submissionParamSchema },
  responses: {
    200: { description: 'The moderated submission', content: { 'application/json': { schema: StaffSubmissionViewSchema } } },
    404: submissionNotFound,
  },
});

export const clearSubmissionModerationRoute = createRoute({
  method: 'delete',
  path: '/submissions/{id}/moderation',
  summary: "Clear a submission's moderation flag (staff)",
  description: 'Lets the author share the submission again. It does not re-share it.',
  tags: ['admin:submissions'],
  security: [{ bearerAuth: [] }],
  request: { params: submissionParamSchema },
  responses: {
    204: { description: 'Moderation cleared' },
    404: submissionNotFound,
  },
});

export const removeSubmissionRoute = createRoute({
  method: 'delete',
  path: '/submissions/{id}',
  summary: 'Remove a submission (admin)',
  description:
    'Deletes the stored object, then turns the row into a tombstone: status `removed`, removal stamp and author, description cleared, private. The author sees "Removed by the staff" and the quota is freed. Idempotent on a removed submission.',
  tags: ['admin:submissions'],
  security: [{ bearerAuth: [] }],
  request: { params: submissionParamSchema },
  responses: {
    204: { description: 'Submission removed' },
    403: error('Only `admin` removes; a content creator force-unshares instead'),
    404: submissionNotFound,
    502: error('`StorageUnavailable` — the object could not be deleted; nothing changed, retry'),
  },
});

function submissionCaller(c: Context): SubmissionCaller {
  const user = c.get('user');
  return { userId: user.sub, roles: user.roles };
}

export function buildAdminSubmissionsRouter(container: AppContainer): OpenAPIHono {
  const controller = new SubmissionsController(
    container.engagement.submissionRepo,
    container.content.topics,
    container.progress.enrollmentRepo,
    container.content.storage,
    container.engagement.submissionConfig,
    container.engagement.submissionRateLimiter,
  );
  const router = new OpenAPIHono();

  const noStore = async (c: Context, next: () => Promise<void>) => {
    await next();
    c.header('Cache-Control', NO_STORE);
  };
  router.use('/submissions/*', noStore);
  router.use('/users/:userId/submissions', noStore);

  router.openapi(listUserSubmissionsRoute, async (c) => {
    const cursor = parseCursorParam(c.req.valid('query').cursor);
    if (cursor === undefined) return invalidCursorResponse(c) as any;
    const result = await controller.listByUserForStaff(c.req.valid('param').userId, submissionCaller(c), cursor);
    if (!result.ok) return respondWith(c, result) as any;
    return c.json(
      {
        data: result.data.data,
        nextCursor: result.data.nextCursor ? encodeCursor(result.data.nextCursor) : null,
      },
      200,
    ) as any;
  });

  router.openapi(unshareSubmissionRoute, async (c) => {
    const result = await controller.forceUnshare(c.req.valid('param').id, submissionCaller(c));
    return respondWith(c, result) as any;
  });

  router.openapi(clearSubmissionModerationRoute, async (c) => {
    const result = await controller.clearModeration(c.req.valid('param').id, submissionCaller(c));
    return respondNoContent(c, result) as any;
  });

  router.openapi(removeSubmissionRoute, async (c) => {
    const result = await controller.removeByStaff(c.req.valid('param').id, submissionCaller(c));
    return respondNoContent(c, result) as any;
  });

  return router;
}
