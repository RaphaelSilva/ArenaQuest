import { Hono } from 'hono';
import { z } from 'zod';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { sanitizeMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';
import type { ITopicNodeRepository, ITagRepository } from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';

const TOPIC_STATUS_VALUES = ['draft', 'published', 'archived'] as const;

const CreateTopicSchema = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1),
  content: z.string().optional(),
  status: z.enum(TOPIC_STATUS_VALUES).optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
  tagIds: z.array(z.string()).optional(),
  prerequisiteIds: z.array(z.string()).optional(),
});

const UpdateTopicSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  status: z.enum(TOPIC_STATUS_VALUES).optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
  tagIds: z.array(z.string()).optional(),
  prerequisiteIds: z.array(z.string()).optional(),
});

const MoveTopicSchema = z.object({
  newParentId: z.string().nullable(),
  newSortOrder: z.number().int().min(0).optional(),
});

export function buildAdminTopicsRouter(topics: ITopicNodeRepository, _tags: ITagRepository): Hono {
  const router = new Hono();

  router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));

  // GET /admin/topics — flat list of all nodes (all statuses, all archive states)
  router.get('/', async (c) => {
    const nodes = await topics.listAll();
    return c.json({ data: nodes });
  });

  // POST /admin/topics — create a node
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = CreateTopicSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'BadRequest', details: parsed.error.flatten() }, 400);
    }

    const { parentId, title, content, status, estimatedMinutes, tagIds, prerequisiteIds } = parsed.data;

    if (parentId) {
      const parent = await topics.findById(parentId);
      if (!parent) return c.json({ error: 'NotFound', detail: 'parentId not found' }, 404);
    }

    if (prerequisiteIds && prerequisiteIds.length > 0) {
      for (const prereqId of prerequisiteIds) {
        const prereq = await topics.findById(prereqId);
        if (!prereq) return c.json({ error: 'UNKNOWN_PREREQ', detail: `prerequisite ${prereqId} not found` }, 422);
      }
    }

    const node = await topics.create({
      parentId,
      title,
      content: content !== undefined ? sanitizeMarkdown(content) : undefined,
      status: status as Entities.Config.TopicNodeStatus,
      estimatedMinutes,
      tagIds,
      prerequisiteIds,
    });

    return c.json(node, 201);
  });

  // GET /admin/topics/:id — single node with its direct children
  router.get('/:id', async (c) => {
    const id = c.req.param('id');
    const [node, children] = await Promise.all([
      topics.findById(id),
      topics.listChildren(id),
    ]);
    if (!node) return c.json({ error: 'NotFound' }, 404);
    return c.json({ ...node, children });
  });

  // PATCH /admin/topics/:id — update metadata
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const parsed = UpdateTopicSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'BadRequest', details: parsed.error.flatten() }, 400);
    }

    const existing = await topics.findById(id);
    if (!existing) return c.json({ error: 'NotFound' }, 404);

    const { title, content, status, estimatedMinutes, tagIds, prerequisiteIds } = parsed.data;

    if (prerequisiteIds && prerequisiteIds.length > 0) {
      for (const prereqId of prerequisiteIds) {
        const prereq = await topics.findById(prereqId);
        if (!prereq) return c.json({ error: 'UNKNOWN_PREREQ', detail: `prerequisite ${prereqId} not found` }, 422);
      }
    }

    const node = await topics.update(id, {
      title,
      content: content !== undefined ? sanitizeMarkdown(content) : undefined,
      status: status as Entities.Config.TopicNodeStatus,
      estimatedMinutes,
      tagIds,
      prerequisiteIds,
    });

    return c.json(node);
  });

  // POST /admin/topics/:id/move — re-parent and/or reorder
  router.post('/:id/move', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const parsed = MoveTopicSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'BadRequest', details: parsed.error.flatten() }, 400);
    }

    const existing = await topics.findById(id);
    if (!existing) return c.json({ error: 'NotFound' }, 404);

    const { newParentId, newSortOrder } = parsed.data;

    if (newParentId === id) {
      return c.json({ error: 'WOULD_CYCLE' }, 409);
    }

    if (newParentId !== null) {
      const parent = await topics.findById(newParentId);
      if (!parent) return c.json({ error: 'NotFound', detail: 'newParentId not found' }, 404);

      const cycle = await topics.wouldCreateCycle(id, newParentId);
      if (cycle) return c.json({ error: 'WOULD_CYCLE' }, 409);
    }

    const node = await topics.move(id, newParentId, newSortOrder);
    return c.json(node);
  });

  // DELETE /admin/topics/:id — soft-archive (cascades to all descendants)
  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const existing = await topics.findById(id);
    if (!existing) return c.json({ error: 'NotFound' }, 404);

    await topics.archive(id);
    return c.body(null, 204);
  });

  return router;
}
