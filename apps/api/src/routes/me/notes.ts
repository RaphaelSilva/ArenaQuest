import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { NotesController } from '@api/controllers/notes.controller';
import { AuthoredNotePageSchema } from '@api/openapi/components/entities';
import { ErrorBody } from '@api/openapi/components/errors';
import { respondWith } from '@api/routes/_shared/envelope';
import { encodeCursor, parseCursorParam, invalidCursorResponse } from '@api/routes/_shared/cursor';
import { cursorQuerySchema, noteCaller } from '@api/routes/notes.router';
import type { ContentContext, EngagementContext, ProgressContext } from '@api/container';

export const listMyNotesRoute = createRoute({
  method: 'get',
  path: '/notes',
  summary: 'List my notes',
  description:
    'Every note the caller wrote, across topics, newest `updatedAt` first, with the topic title and `topicAccessible`. A note whose topic is no longer accessible is read-only (delete allowed). Pages of 20.',
  tags: ['me:notes'],
  security: [{ bearerAuth: [] }],
  request: { query: cursorQuerySchema },
  responses: {
    200: { description: 'One page of the caller\'s notes', content: { 'application/json': { schema: AuthoredNotePageSchema } } },
    400: {
      description: 'Malformed cursor (`InvalidCursor`)',
      content: { 'application/json': { schema: ErrorBody } },
    },
  },
});

/** Mounted under `/v1/me`, whose sub-app already applies `authGuard`. */
export function buildMeNotesRouter(slice: {
  engagement: EngagementContext;
  content: ContentContext;
  progress: ProgressContext;
}): OpenAPIHono {
  const controller = new NotesController(
    slice.engagement.noteRepo,
    slice.content.topics,
    slice.progress.enrollmentRepo,
  );
  const router = new OpenAPIHono();

  router.openapi(listMyNotesRoute, async (c) => {
    const cursor = parseCursorParam(c.req.valid('query').cursor);
    if (cursor === undefined) return invalidCursorResponse(c) as any;
    const result = await controller.listMine(noteCaller(c), cursor);
    if (!result.ok) return respondWith(c, result) as any;
    return c.json(
      {
        data: result.data.data,
        nextCursor: result.data.nextCursor ? encodeCursor(result.data.nextCursor) : null,
      },
      200,
    );
  });

  return router;
}
