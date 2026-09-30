import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { NotesController } from '@api/controllers/notes.controller';
import { StaffNoteSchema, StaffAuthoredNotePageSchema } from '@api/openapi/components/entities';
import { ErrorBody } from '@api/openapi/components/errors';
import { respondWith, respondNoContent } from '@api/routes/_shared/envelope';
import { encodeCursor, parseCursorParam, invalidCursorResponse } from '@api/routes/_shared/cursor';
import { cursorQuerySchema } from '@api/routes/notes.router';
import type { AppContainer } from '@api/container';

/**
 * Staff notes (RFC 0016 §3, M21 Task 04). Mounted under `/v1/admin`, whose
 * umbrella `requireRole(ADMIN, CONTENT_CREATOR)` is the only role gate: both
 * staff roles list and moderate. No route here edits or deletes a note body.
 */

const userParamSchema = z.object({
  userId: z.string().min(1).openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef', description: 'Author user ID' }),
});

const noteParamSchema = z.object({
  id: z.string().min(1).openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef', description: 'Note ID' }),
});

const noteNotFound = {
  description: 'No note with this ID',
  content: { 'application/json': { schema: ErrorBody } },
};

export const listUserNotesRoute = createRoute({
  method: 'get',
  path: '/users/{userId}/notes',
  summary: 'List a user\'s notes (staff)',
  description:
    'Every note the user wrote, private included, newest `updatedAt` first, with the topic title and moderation provenance. An unknown user yields an empty page. Pages of 20.',
  tags: ['admin:notes'],
  security: [{ bearerAuth: [] }],
  request: { params: userParamSchema, query: cursorQuerySchema },
  responses: {
    200: { description: 'One page of the user\'s notes', content: { 'application/json': { schema: StaffAuthoredNotePageSchema } } },
    400: {
      description: 'Malformed cursor (`InvalidCursor`)',
      content: { 'application/json': { schema: ErrorBody } },
    },
  },
});

export const unshareNoteRoute = createRoute({
  method: 'post',
  path: '/notes/{id}/unshare',
  summary: 'Force-unshare a note (staff)',
  description:
    'Sets the note private and flags it moderated, recording who and when, and increments `revision` so an open editor gets `NOTE_STALE`. The body is never changed. On a private note it is idempotent in effect (stays private, becomes flagged).',
  tags: ['admin:notes'],
  security: [{ bearerAuth: [] }],
  request: { params: noteParamSchema },
  responses: {
    200: { description: 'The moderated note', content: { 'application/json': { schema: StaffNoteSchema } } },
    404: noteNotFound,
  },
});

export const clearNoteModerationRoute = createRoute({
  method: 'delete',
  path: '/notes/{id}/moderation',
  summary: 'Clear a note\'s moderation flag (staff)',
  description: 'Lets the author share the note again. It does not re-share it.',
  tags: ['admin:notes'],
  security: [{ bearerAuth: [] }],
  request: { params: noteParamSchema },
  responses: {
    204: { description: 'Moderation cleared' },
    404: noteNotFound,
  },
});

export function buildAdminNotesRouter(container: AppContainer): OpenAPIHono {
  const controller = new NotesController(
    container.engagement.noteRepo,
    container.content.topics,
    container.progress.enrollmentRepo,
  );
  const router = new OpenAPIHono();

  router.openapi(listUserNotesRoute, async (c) => {
    const cursor = parseCursorParam(c.req.valid('query').cursor);
    if (cursor === undefined) return invalidCursorResponse(c) as any;
    const result = await controller.listByAuthorForStaff(c.req.valid('param').userId, cursor);
    if (!result.ok) return respondWith(c, result) as any;
    return c.json(
      {
        data: result.data.data,
        nextCursor: result.data.nextCursor ? encodeCursor(result.data.nextCursor) : null,
      },
      200,
    );
  });

  router.openapi(unshareNoteRoute, async (c) => {
    const result = await controller.unshare(c.req.valid('param').id, c.get('user').sub);
    return respondWith(c, result) as any;
  });

  router.openapi(clearNoteModerationRoute, async (c) => {
    const result = await controller.clearModeration(c.req.valid('param').id);
    return respondNoContent(c, result) as any;
  });

  return router;
}
