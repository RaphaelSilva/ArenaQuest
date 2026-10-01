import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import {
  SubmissionsController,
  type EditSubmissionInput,
  type PresignSubmissionInput,
  type SubmissionCaller,
} from '@api/controllers/submissions.controller';
import {
  EditSubmissionBodySchema,
  PresignSubmissionBodySchema,
  PresignSubmissionResponseSchema,
  SubmissionQuotaErrorSchema,
  SubmissionSchema,
  SubmissionSummarySchema,
} from '@api/openapi/components/entities';
import { ErrorBody } from '@api/openapi/components/errors';
import { respondNoContent, respondWith } from '@api/routes/_shared/envelope';
import type { ContentContext, EngagementContext, ProgressContext } from '@api/container';

const topicParamSchema = z.object({
  id: z.string().min(1).openapi({ example: 'topic-1', description: 'Topic node ID' }),
});

const submissionParamSchema = topicParamSchema.extend({
  sid: z.string().min(1).openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef', description: 'Submission ID' }),
});

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorBody } },
});

const topicNotFound = error("Topic missing, draft, archived or outside the caller's access");
const submissionNotFound = error(
  "Topic not readable, or the submission is missing, on another topic or another student's",
);
const configInvalid = error('`SUBMISSION_CONFIG_INVALID`: a `SUBMISSIONS_*` var is present but malformed');
const staffForbidden = error("Staff acting on someone else's submission (they read and moderate only)");

/** Responses carrying a presigned URL, or a student's private file metadata, are never cached. */
const NO_STORE = 'private, no-store';

export const presignSubmissionRoute = createRoute({
  method: 'post',
  path: '/topics/{id}/submissions/presign',
  summary: 'Start a submission upload',
  description:
    'Creates a `pending` submission and returns a presigned PUT under a server-built key. Rate limited to 30 per hour per user.',
  tags: ['topics:submissions'],
  security: [{ bearerAuth: [] }],
  request: {
    params: topicParamSchema,
    body: { content: { 'application/json': { schema: PresignSubmissionBodySchema } } },
  },
  responses: {
    201: {
      description: 'Pending submission and its upload URL',
      content: { 'application/json': { schema: PresignSubmissionResponseSchema } },
    },
    400: error('Malformed body, or `SUBMISSION_TITLE_INVALID` / `SUBMISSION_DESCRIPTION_TOO_LONG`'),
    403: error('Staff do not upload submissions'),
    404: topicNotFound,
    409: {
      description:
        '`SUBMISSION_QUOTA` (with `reason`, `used`, `limit`), or `SUBMISSION_SHARING_DISABLED` when asking for `shared` on a label with sharing off',
      content: { 'application/json': { schema: z.union([SubmissionQuotaErrorSchema, ErrorBody]) } },
    },
    422: error('`FileTooLarge` — over the per-type limit (`maxBytes`)'),
    429: error('`TooManyRequests` — over 30 presigns in an hour'),
    500: configInvalid,
  },
});

export const finalizeSubmissionRoute = createRoute({
  method: 'post',
  path: '/topics/{id}/submissions/{sid}/finalize',
  summary: 'Finish a submission upload',
  description:
    'Verifies the stored object — length, content type and leading signature bytes — and marks the submission `ready`. On a mismatch the object and the row are deleted. Idempotent on a `ready` submission.',
  tags: ['topics:submissions'],
  security: [{ bearerAuth: [] }],
  request: { params: submissionParamSchema },
  responses: {
    200: { description: 'Submission ready', content: { 'application/json': { schema: SubmissionSchema } } },
    403: staffForbidden,
    404: submissionNotFound,
    409: error('`SUBMISSION_REMOVED` — the submission was removed by the staff'),
    422: error('`NotUploaded` — no object stored yet; `UPLOAD_MISMATCH` — the stored file differs from what was declared'),
    500: configInvalid,
    502: error('`StorageUnavailable` — the mismatched object could not be deleted; retry'),
  },
});

export const editSubmissionRoute = createRoute({
  method: 'patch',
  path: '/topics/{id}/submissions/{sid}',
  summary: 'Edit a submission',
  description: 'Last-write-wins edit of title, description (sanitised Markdown) and visibility.',
  tags: ['topics:submissions'],
  security: [{ bearerAuth: [] }],
  request: {
    params: submissionParamSchema,
    body: { content: { 'application/json': { schema: EditSubmissionBodySchema } } },
  },
  responses: {
    200: { description: 'Submission updated', content: { 'application/json': { schema: SubmissionSchema } } },
    400: error('Malformed body, or `SUBMISSION_TITLE_INVALID` / `SUBMISSION_DESCRIPTION_TOO_LONG`'),
    403: staffForbidden,
    404: submissionNotFound,
    409: error(
      '`SUBMISSION_MODERATED` (sharing a force-unshared submission), `SUBMISSION_SHARING_DISABLED` or `SUBMISSION_REMOVED`',
    ),
    500: configInvalid,
  },
});

export const deleteSubmissionRoute = createRoute({
  method: 'delete',
  path: '/topics/{id}/submissions/{sid}',
  summary: 'Delete a submission',
  description:
    'Deletes the stored object, then the row — a pending or ready submission, or a tombstone being dismissed. Allowed even when the topic is no longer readable.',
  tags: ['topics:submissions'],
  security: [{ bearerAuth: [] }],
  request: { params: submissionParamSchema },
  responses: {
    204: { description: 'Submission deleted' },
    403: staffForbidden,
    404: error("The submission is missing, on another topic or another student's"),
    500: configInvalid,
    502: error('`StorageUnavailable` — the object could not be deleted; the row is kept, retry'),
  },
});

export const submissionSummaryRoute = createRoute({
  method: 'get',
  path: '/topics/{id}/submissions/summary',
  summary: 'Submission limits and counts for a topic',
  description:
    "Effective limits, `sharingEnabled`, the caller's usage and the class count; admins and content creators also get `totalCount`.",
  tags: ['topics:submissions'],
  security: [{ bearerAuth: [] }],
  request: { params: topicParamSchema },
  responses: {
    200: { description: 'Summary', content: { 'application/json': { schema: SubmissionSummarySchema } } },
    404: topicNotFound,
    500: configInvalid,
  },
});

/** The caller as the controller needs it — roles are resolved there, not here. */
function submissionCaller(c: Context): SubmissionCaller {
  const user = c.get('user');
  return { userId: user.sub, roles: user.roles };
}

export function buildSubmissionsRouter(slice: {
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

  router.use('/topics/:id/submissions/*', authGuard);
  router.use('/topics/:id/submissions/*', async (c, next) => {
    await next();
    c.header('Cache-Control', NO_STORE);
  });

  router.openapi(presignSubmissionRoute, async (c) => {
    const result = await controller.presign(
      c.req.valid('param').id,
      submissionCaller(c),
      c.req.valid('json') as PresignSubmissionInput,
    );
    if (!result.ok) {
      if (result.status === 429) c.header('Retry-After', String(result.meta?.retryAfterSeconds ?? 1));
      return respondWith(c, result) as any;
    }
    return c.json(result.data, 201) as any;
  });

  router.openapi(finalizeSubmissionRoute, async (c) => {
    const { id, sid } = c.req.valid('param');
    const result = await controller.finalize(id, sid, submissionCaller(c));
    return respondWith(c, result) as any;
  });

  router.openapi(editSubmissionRoute, async (c) => {
    const { id, sid } = c.req.valid('param');
    const result = await controller.edit(id, sid, submissionCaller(c), c.req.valid('json') as EditSubmissionInput);
    return respondWith(c, result) as any;
  });

  router.openapi(deleteSubmissionRoute, async (c) => {
    const { id, sid } = c.req.valid('param');
    const result = await controller.remove(id, sid, submissionCaller(c));
    return respondNoContent(c, result) as any;
  });

  router.openapi(submissionSummaryRoute, async (c) => {
    const result = await controller.summary(c.req.valid('param').id, submissionCaller(c));
    return respondWith(c, result) as any;
  });

  return router;
}
