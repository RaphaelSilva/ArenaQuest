import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { NotesController, type NoteCaller, type SaveNoteInput } from '@api/controllers/notes.controller';
import {
  NoteSchema,
  ClassNotePageSchema,
  SaveNoteBodySchema,
  NoteConflictBodySchema,
} from '@api/openapi/components/entities';
import { ErrorBody } from '@api/openapi/components/errors';
import { respondWith, respondNoContent } from '@api/routes/_shared/envelope';
import { encodeCursor, parseCursorParam, invalidCursorResponse } from '@api/routes/_shared/cursor';
import type { ContentContext, EngagementContext, ProgressContext } from '@api/container';

const topicParamSchema = z.object({
  id: z.string().min(1).openapi({ example: 'topic-1', description: 'Topic node ID' }),
});

export const cursorQuerySchema = z.object({
  cursor: z.string().optional().openapi({
    description: 'Opaque cursor from a previous page (`nextCursor`); omit for the first page',
  }),
});

const notFound = {
  description: 'Topic missing, draft, archived or outside the caller\'s access',
  content: { 'application/json': { schema: ErrorBody } },
};

const invalidCursor = {
  description: 'Malformed cursor (`InvalidCursor`)',
  content: { 'application/json': { schema: ErrorBody } },
};

export const getMyNoteRoute = createRoute({
  method: 'get',
  path: '/topics/{id}/notes/me',
  summary: 'Get my note on a topic',
  description: 'Returns the caller\'s note on the topic, or `null` when there is none.',
  tags: ['topics:notes'],
  security: [{ bearerAuth: [] }],
  request: { params: topicParamSchema },
  responses: {
    200: {
      description: 'The caller\'s note, or null',
      content: { 'application/json': { schema: z.object({ data: NoteSchema.nullable() }) } },
    },
    404: notFound,
  },
});

export const saveMyNoteRoute = createRoute({
  method: 'put',
  path: '/topics/{id}/notes/me',
  summary: 'Create or update my note on a topic',
  description:
    'Conditional upsert keyed on `baseRevision` (0 = create). The body is sanitised and trimmed, then must be 1..NOTE_BODY_MAX characters.',
  tags: ['topics:notes'],
  security: [{ bearerAuth: [] }],
  request: {
    params: topicParamSchema,
    body: { content: { 'application/json': { schema: SaveNoteBodySchema } } },
  },
  responses: {
    200: { description: 'Note updated', content: { 'application/json': { schema: NoteSchema } } },
    201: { description: 'Note created', content: { 'application/json': { schema: NoteSchema } } },
    400: {
      description: 'Malformed body, or `NOTE_BODY_EMPTY` / `NOTE_BODY_TOO_LONG` after sanitisation',
      content: { 'application/json': { schema: ErrorBody } },
    },
    404: notFound,
    409: {
      description:
        '`NOTE_STALE`: `baseRevision` is not the stored revision; `current` carries the stored note (or null). `NOTE_MODERATED`: sharing a note the staff made private.',
      content: { 'application/json': { schema: NoteConflictBodySchema } },
    },
  },
});

export const deleteMyNoteRoute = createRoute({
  method: 'delete',
  path: '/topics/{id}/notes/me',
  summary: 'Delete my note on a topic',
  description: 'Hard-deletes the caller\'s note. Allowed even when the topic is no longer readable.',
  tags: ['topics:notes'],
  security: [{ bearerAuth: [] }],
  request: { params: topicParamSchema },
  responses: {
    204: { description: 'Note deleted' },
    404: {
      description: 'The caller has no note on this topic',
      content: { 'application/json': { schema: ErrorBody } },
    },
  },
});

export const listTopicNotesRoute = createRoute({
  method: 'get',
  path: '/topics/{id}/notes',
  summary: 'List the notes on a topic',
  description:
    'Students and tutors: shared notes only, newest share first, own flagged `isMine`. Admins and content creators: every note. Pages of 20.',
  tags: ['topics:notes'],
  security: [{ bearerAuth: [] }],
  request: { params: topicParamSchema, query: cursorQuerySchema },
  responses: {
    200: { description: 'One page of notes', content: { 'application/json': { schema: ClassNotePageSchema } } },
    400: invalidCursor,
    404: notFound,
  },
});

/** The caller as the controller needs it — roles are resolved there, not here. */
export function noteCaller(c: Context): NoteCaller {
  const user = c.get('user');
  return { userId: user.sub, roles: user.roles };
}

export function buildNotesRouter(slice: {
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

  router.use('/topics/:id/notes', authGuard);
  router.use('/topics/:id/notes/*', authGuard);

  router.openapi(getMyNoteRoute, async (c) => {
    const result = await controller.getMine(c.req.valid('param').id, noteCaller(c));
    if (!result.ok) return respondWith(c, result) as any;
    return c.json({ data: result.data }, 200);
  });

  router.openapi(saveMyNoteRoute, async (c) => {
    const result = await controller.saveMine(
      c.req.valid('param').id,
      noteCaller(c),
      c.req.valid('json') as SaveNoteInput,
    );
    if (!result.ok) return respondWith(c, result) as any;
    return c.json(result.data.note, result.data.created ? 201 : 200) as any;
  });

  router.openapi(deleteMyNoteRoute, async (c) => {
    const result = await controller.deleteMine(c.req.valid('param').id, noteCaller(c));
    return respondNoContent(c, result) as any;
  });

  router.openapi(listTopicNotesRoute, async (c) => {
    const cursor = parseCursorParam(c.req.valid('query').cursor);
    if (cursor === undefined) return invalidCursorResponse(c) as any;
    const result = await controller.listByTopic(c.req.valid('param').id, noteCaller(c), cursor);
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
